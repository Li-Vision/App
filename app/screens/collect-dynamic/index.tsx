import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { View, TouchableOpacity, Dimensions, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import DatasetPicker from "@/components/collect/DatasetPicker";
import GesturePicker from "@/components/collect/GesturePicker";
import { useCollectDatasets } from "@/hooks/useCollectDatasets";
import { Alert } from "@/services/appAlert";
import Text from "@/components/TranslatableText";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Camera, useCameraDevice, useCameraFormat, useFrameProcessor, useCameraPermission } from "react-native-vision-camera";
import { Worklets } from "react-native-worklets-core";
import { useFrameWatchdog } from "@/hooks/useFrameWatchdog";
import CollectButton from "@/components/CollectButton";
import { collectPhase, collectProgress } from "@/lib/collectPhase";
import { detectHandLandmarks, HolisticDetectionResult, packResult, unpackResult } from "@/services/handLandmarkerPlugin";
import { gestureWS } from "@/services/gestureWebSocket";
import { buildPayload, makeCoverMapper, buildOverlayChannels, OverlayChannels } from "@/services/holisticFeatures";
import LandmarkOverlay, { FACE_POINT_INDICES } from "@/components/LandmarkOverlay";
import { useTranslation } from "react-i18next";
import { makeCollectDynamicStyles as makeStyles } from "@/styles/collect-dynamic.styles";
import { useAppTheme } from "@/context/ThemeContext";
import { flushLog, logEvent } from "@/services/inferenceLogger";
import { CollectVerdict, describeVerdict } from "@/lib/collectVerdict";

const VERDICT_COLORS: Record<CollectVerdict["status"], string> = {
  accepted: "#2ecc71",
  suspect: "#f39c12",
  rejected: "#e74c3c",
  error: "#e74c3c",
};

// Prazo para o 1º frame ser aceito (inclui criar o dataset) e, depois, para cada
// frame seguinte.
// Frames que o servidor reúne por sequência (a janela do modelo dinâmico).
const SEQUENCE_FRAMES = 15;
const RECORDING_START_MS = 10000;
const RECORDING_IDLE_MS = 4000;

export default function CollectDynamicScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [label, setLabel] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(isRecording);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sequences, setSequences] = useState(0);
  // Último veredito da validação assíncrona (aceita / revisão / descartada).
  const [verdict, setVerdict] = useState<CollectVerdict | null>(null);
  // Frames válidos já aceitos pelo servidor na sequência em andamento (0–15).
  const [buffered, setBuffered] = useState(0);
  // Os três canais num único estado — ver cam/index.tsx: separá-los custaria um
  // ciclo de render do React por canal a cada frame.
  const [overlay, setOverlay] = useState<OverlayChannels>({ hands: [], pose: [], face: [] });
  const { hands: landmarks, pose: poseLandmarks, face: faceLandmarks } = overlay;
  const { datasets, stats, statsLoading, totals, loadTotals, recordCount } = useCollectDatasets("dynamic", datasetName);
  // O handler do WebSocket é registrado uma vez só; o ref entrega a ele a
  // versão atual de recordCount (que depende do gesto e do dataset escolhidos).
  const recordCountRef = useRef(recordCount);
  recordCountRef.current = recordCount;
  const labelRef = useRef(label);
  labelRef.current = label;
  const [isAdmin, setIsAdmin] = useState(false);
  // Holístico: coleta mãos + corpo + rosto. Compartilha a preferência com a cam.
  const [holisticEnabled, setHolisticEnabled] = useState(false);
  const holisticEnabledRef = useRef(holisticEnabled);
  // Dimensões da imagem usada na inferência (do plugin nativo) — alinham o
  // overlay ao preview com crop "cover".
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => { holisticEnabledRef.current = holisticEnabled; }, [holisticEnabled]);

  useEffect(() => {
    AsyncStorage.getItem("userRole").then(r => setIsAdmin(r === "admin"));
    AsyncStorage.getItem("config_holistic_enabled").then(v => setHolisticEnabled(v === "true"));
  }, []);

  const device = useCameraDevice("front");
  // Sem pedir a permissão aqui, quem abre a coleta antes da tela de inferência
  // fica com a câmera preta: o Camera renderiza, mas nunca recebe frames.
  const { hasPermission, requestPermission } = useCameraPermission();
  useEffect(() => { if (!hasPermission) requestPermission(); }, [hasPermission, requestPermission]);
  // Ver comentário em collect-static: fixa a resolução de inferência para não
  // pagar cópia/rotação de um buffer maior do que os modelos aproveitam.
  const format = useCameraFormat(device, [
    { videoResolution: { width: 640, height: 480 } },
    { fps: 30 },
  ]);
  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

  // Última vez que um payload foi enviado ao servidor (ms). O overlay atualiza
  // mais rápido que isso; ver o comentário no envio abaixo.
  const lastSentRef = useRef(0);
  // Contadores da gravação em andamento, só para o log de diagnóstico: separam
  // "o plugin não viu a mão" de "o frame foi enviado e o servidor não aceitou".
  const recStats = useRef({ startedAt: 0, sent: 0, noHands: 0, errFrames: 0 });
  const logCollectEnd = (outcome: string, extra: Record<string, unknown> = {}) => {
    const st = recStats.current;
    logEvent("collect_end", {
      screen: "dynamic",
      outcome,
      ms: st.startedAt ? Date.now() - st.startedAt : undefined,
      sent: st.sent,
      noHands: st.noHands,
      errFrames: st.errFrames,
      ...extra,
    });
    // Grava na hora: um travamento logo depois não leva o registro junto.
    flushLog();
  };

  useEffect(() => {
    logEvent("collect_focus", { screen: "dynamic" });
    return () => {
      logEvent("collect_blur", { screen: "dynamic" });
      flushLog();
    };
  }, []);

  const { cameraKey, beat } = useFrameWatchdog();

  const onLandmarksDetected = Worklets.createRunOnJS((packed: string) => {
    // Chega como string e vira objeto comum aqui — ver packResult.
    const result: HolisticDetectionResult = unpackResult(packed);
    beat(result);
    const hands = result?.hands ?? [];
    if (isRecordingRef.current) {
      if (hands.length === 0) recStats.current.noHands += 1;
      if ((result as any)?.error) recStats.current.errFrames += 1;
    }
    const imgW = result?.imageWidth;
    const imgH = result?.imageHeight;
    if (imgW && imgH) {
      setFrameSize((prev) =>
        prev && prev.width === imgW && prev.height === imgH ? prev : { width: imgW, height: imgH },
      );
    }
    // Mãos, pose e rosto são canais independentes: a ausência de uma mão no
    // frame não deve apagar o corpo/rosto já detectados do overlay.
    setOverlay(buildOverlayChannels(result, holisticEnabledRef.current, FACE_POINT_INDICES));

    // O overlay acompanha a câmera o mais rápido possível, mas o servidor não
    // precisa da mesma taxa — ver cam/index.tsx. Com o throttle removido do
    // frame processor, é AQUI que a taxa de envio é limitada: manter os ~50ms
    // originais preserva o ritmo que o backend já esperava para montar a
    // sequência, sem prender a fluidez do que é desenhado na tela.
    // O envio também continua exigindo mão: `buildPayload` devolve null sem
    // mãos e a sequência só é válida com elas.
    const agora = Date.now();
    if (
      hands.length > 0 &&
      isRecordingRef.current &&
      gestureWS.isConnected() &&
      agora - lastSentRef.current >= 50
    ) {
      lastSentRef.current = agora;
      const schema = holisticEnabledRef.current ? "holistic_v1" : "hands_v1";
      const payload = buildPayload(result, schema);
      if (payload) {
        gestureWS.sendHolistic(payload);
        recStats.current.sent += 1;
      }
    }
  });

  // Espelha o toggle holístico para o worklet — ver cam/index.tsx.
  const holisticSharedRef = useRef<{ value: boolean } | null>(null);
  if (holisticSharedRef.current === null) holisticSharedRef.current = Worklets.createSharedValue(false);
  const holisticShared = holisticSharedRef.current;
  useEffect(() => { holisticShared.value = holisticEnabled; }, [holisticEnabled, holisticShared]);
  const frameProcessor = useFrameProcessor((frame) => {
    "worklet";
    // Sem throttle nem guarda de reentrância aqui, de propósito — ver
    // cam/index.tsx: o descarte é feito na ORIGEM pelo CameraX via
    // STRATEGY_KEEP_ONLY_LATEST, que sempre entrega o frame MAIS RECENTE.
    //
    // O throttle de 50ms daqui não reduzia fila: a guarda `busy` nunca
    // disparava (análise síncrona) e o limite só recusava frames que o aparelho
    // conseguiria processar, travando o overlay abaixo da capacidade real.
    // A taxa de ENVIO ao servidor continua limitada — em onLandmarksDetected,
    // separada da taxa de exibição.
    try {
      const holistic = holisticShared.value;
      // Repassa o resultado INTEIRO mesmo sem mãos: filtrar por `hands` aqui
      // descartava pose e rosto do frame, deixando o modo Holístico sem
      // corpo/rosto no overlay sempre que a mão saía do enquadramento.
      const result = detectHandLandmarks(frame, { pose: holistic, face: holistic });
      onLandmarksDetected(packResult(result));
    } catch (e: any) {
      onLandmarksDetected(packResult(null, e?.message || String(e)));
    }
  }, [holisticShared]);

  // Janela para o servidor reunir os 15 frames. É reiniciada a cada frame
  // aceito: o limite vale para "parou de progredir", não para a gravação
  // inteira — a 1ª sequência de um dataset gasta alguns segundos criando-o no
  // Supabase, e o prazo fixo de 6s estourava mesmo com a mão enquadrada.
  const armRecordingTimeout = (ms: number) => {
    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
    recordingTimeoutRef.current = setTimeout(() => {
      recordingTimeoutRef.current = null;
      if (isRecordingRef.current) {
        logCollectEnd("timeout", { limitMs: ms, connected: gestureWS.isConnected() });
        gestureWS.sendAction({ action: "stop_collect" });
        setIsRecording(false);
        setBuffered(0);
        Alert.alert(t('collect_dynamic.timeout_title'), t('collect_dynamic.timeout_msg'));
      }
    }, ms);
  };

  useEffect(() => {
    gestureWS.connect((res) => {
      console.log("WS Response:", res);
      // Veredito da validação assíncrona de uma sequência JÁ gravada. Chega
      // depois e pode cair durante a gravação seguinte: só atualiza contador e
      // aviso, nunca para a gravação (por isso é tratado antes de tudo).
      if ((res as any).action === "collect_result") {
        const result = describeVerdict(res);
        if (result) {
          logEvent("collect_verdict", { screen: "dynamic", status: result.status });
          setVerdict(result);
        }
        if (typeof (res as any).sequences === "number") {
          setSequences((res as any).sequences);
          recordCountRef.current((res as any).label ?? labelRef.current, (res as any).sequences);
        }
        return;
      }
      if (res.ok && (res as any).collecting && isRecordingRef.current) {
        setBuffered((res as any).buffer ?? 0);
        armRecordingTimeout(RECORDING_IDLE_MS);
      }
      if (res.ok && res.sequences !== undefined) {
        setSequences(res.sequences);
        recordCountRef.current(labelRef.current, res.sequences);
        setBuffered(0);
        // Stop recording cleanly upon success
        if (isRecordingRef.current) {
          logCollectEnd("saved", { sequences: res.sequences });
          setIsRecording(false);
          gestureWS.sendAction({ action: "stop_collect" });
          if (recordingTimeoutRef.current) {
             clearTimeout(recordingTimeoutRef.current);
             recordingTimeoutRef.current = null;
          }
        }
      }
      if (!res.ok && res.error) {
        console.error("WS Error:", res.error);
        if (isRecordingRef.current) {
          logCollectEnd("server_error", { error: res.error });
          setIsRecording(false);
          setBuffered(0);
          gestureWS.sendAction({ action: "stop_collect" });
          if (recordingTimeoutRef.current) {
            clearTimeout(recordingTimeoutRef.current);
            recordingTimeoutRef.current = null;
          }
          // Antes a gravação parava em silêncio: a sequência sumia sem aviso.
          Alert.alert(t('collect_dynamic.recording_error'), res.error);
        }
      }
    }, () => { });

    return () => {
      gestureWS.disconnect();
    };
  }, []);

  const startDynamic = async () => {
    if (!label || !datasetName) {
      Alert.alert(t('collect_static.warning'), t('collect_static.fill_required'));
      return;
    }

    // sendAction descarta a mensagem se o socket não está aberto (ex.: o Render
    // derrubou a conexão ociosa e ela ainda está reconectando). Sem este teste o
    // start_collect se perdia, nenhum frame era enviado e só restava o timeout.
    if (!gestureWS.isConnected()) {
      logEvent("collect_not_connected", { screen: "dynamic" });
      Alert.alert(t('collect_dynamic.recording_error'), t('collect_dynamic.not_connected'));
      return;
    }

    try {
      setBuffered(0);
      setIsRecording(true);
      // Zera o throttle de envio: sem isto, o primeiro frame de uma gravação
      // iniciada logo após a anterior cairia na janela de 50ms e seria perdido.
      lastSentRef.current = 0;
      recStats.current = { startedAt: Date.now(), sent: 0, noHands: 0, errFrames: 0 };
      logEvent("collect_start", {
        screen: "dynamic",
        label,
        dataset: datasetName,
        schema: holisticEnabledRef.current ? "holistic_v1" : "hands_v1",
      });
      flushLog();
      const userId = await AsyncStorage.getItem("userId") || undefined;
      
      gestureWS.sendAction({ 
        action: "start_collect", 
        label, 
        dataset_name: datasetName, 
        user_id: userId 
      });

      armRecordingTimeout(RECORDING_START_MS);
    } catch (e) {
      logCollectEnd("start_failed", { error: String(e) });
      Alert.alert(t('collect_dynamic.recording_error'), String(e));
      setIsRecording(false);
    }
  };

  const finalizeDataset = () => {
    Alert.alert(
      t('collect_dynamic.success_title'),
      t('collect_dynamic.success_msg', { label, count: stats[label] ?? sequences, datasetName }),
      [{ text: "OK", onPress: () => router.back() }]
    );
  };

  // Fase do botão: pronto / preparando / gravando / salvando (ver collectPhase).
  const phase = collectPhase(isRecording, buffered, SEQUENCE_FRAMES);

  const CAM_WIDTH = screenWidth - 32;
  const CAM_HEIGHT = 280;
  const cover = useMemo(
    () => makeCoverMapper(frameSize, CAM_WIDTH, CAM_HEIGHT),
    [frameSize, CAM_WIDTH, CAM_HEIGHT],
  );

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={28} color="#00e5ff" />
        </TouchableOpacity>
        <Text translatable style={styles.title}>{t('collect_dynamic.title')}</Text>
        <TouchableOpacity
          onPress={() => {
            if (isRecording) return; // não troca de schema no meio de uma gravação
            setHolisticEnabled((v) => {
              const next = !v;
              AsyncStorage.setItem("config_holistic_enabled", String(next));
              return next;
            });
          }}
          style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4, opacity: isRecording ? 0.4 : 1 }}
          accessibilityLabel="Alternar holístico (mãos + corpo + rosto)"
        >
          <MaterialIcons name="accessibility-new" size={20} color={holisticEnabled ? "#00e5ff" : "#888"} />
          <Text translatable style={{ color: holisticEnabled ? "#00e5ff" : "#888", fontSize: 12, fontWeight: "600" }}>
            {holisticEnabled ? "Holístico" : "Só mãos"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.cameraContainer, { width: CAM_WIDTH, height: CAM_HEIGHT }]}>
        {hasPermission && device ? (
          <Camera
            key={cameraKey}
            style={StyleSheet.absoluteFill}
            device={device}
            format={format}
            isActive={true}
            pixelFormat="rgb"
            frameProcessor={frameProcessor}
            onError={(e) => { logEvent("camera_error", { code: e.code, message: e.message }); flushLog(); }}
            onInitialized={() => logEvent("camera_initialized", { key: cameraKey })}
            onStarted={() => logEvent("camera_started", { key: cameraKey })}
            onStopped={() => logEvent("camera_stopped", { key: cameraKey })}
          />
        ) : (
          <View style={styles.permissionBox}>
            <Text translatable style={{ color: "#888" }}>{t('collect_static.waiting_camera')}</Text>
          </View>
        )}

        <LandmarkOverlay
          hands={landmarks}
          pose={poseLandmarks}
          face={faceLandmarks}
          cover={cover}
          // Durante a gravação o overlay das mãos vira vermelho, como antes.
          handColorOverride={isRecording ? "red" : undefined}
        />

        {isRecording && (
          <View style={styles.recordingOverlay}>
            <MaterialIcons name="videocam" size={20} color="red" />
            <Text translatable style={styles.recordingText}>{t('collect_dynamic.recording_status')} {buffered}/{SEQUENCE_FRAMES}</Text>
          </View>
        )}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
          <DatasetPicker
            value={datasetName}
            onChange={setDatasetName}
            datasets={datasets}
            totals={totals}
            onOpen={() => loadTotals(datasets.map((d) => d.id))}
            canCreate={isAdmin}
            locked={isRecording}
            unit="sequences"
          />

          <GesturePicker
            value={label}
            onChange={setLabel}
            stats={stats}
            loading={statsLoading}
            hasDataset={!!datasetName}
            locked={isRecording}
            unit="sequences"
            datasetName={datasetName}
          />

          <View style={styles.buttonRow}>
            <CollectButton
              icon="fiber-manual-record"
              label={t('collect_dynamic.record_btn')}
              busy={phase !== "ready"}
              busyLabel={
                phase === "preparing" ? t('collect_dynamic.preparing_btn')
                : phase === "saving" ? t('collect_dynamic.saving_btn')
                : t('collect_dynamic.recording_progress', { count: buffered, total: SEQUENCE_FRAMES })
              }
              progress={phase === "recording" ? collectProgress(buffered, SEQUENCE_FRAMES) : undefined}
              onPress={startDynamic}
            />

            {sequences > 0 && !isRecording && (
              <TouchableOpacity style={styles.finalizeBtn} onPress={finalizeDataset}>
                <MaterialIcons name="check-circle" size={24} color="#fff" />
                <Text style={styles.finalizeBtnText}>{t('collect_static.finalize_btn')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {verdict && (
            <Text translatable style={{ color: VERDICT_COLORS[verdict.status], fontSize: 13, marginTop: 8 }}>
              {verdict.message}
            </Text>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}





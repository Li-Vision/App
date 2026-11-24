import { detectHandLandmarks, HolisticDetectionResult, packResult, unpackResult } from "@/services/handLandmarkerPlugin";
import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useMemo, useEffect, useRef, useState } from "react";
import CollectButton from "@/components/CollectButton";
import { Dimensions, ScrollView, TouchableOpacity, View, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import DatasetPicker from "@/components/collect/DatasetPicker";
import GesturePicker from "@/components/collect/GesturePicker";
import { useCollectDatasets, CollectDataset } from "@/hooks/useCollectDatasets";
import { Alert } from "@/services/appAlert";
import Text from "@/components/TranslatableText";
import { Camera, useCameraDevice, useCameraFormat, useFrameProcessor, useCameraPermission } from "react-native-vision-camera";
import { Worklets } from "react-native-worklets-core";
import { useFrameWatchdog } from "@/hooks/useFrameWatchdog";
import { trainingService } from "@/services/trainingService";
import { buildPayload, makeCoverMapper, buildOverlayChannels, OverlayChannels, HolisticPayload } from "@/services/holisticFeatures";
import LandmarkOverlay, { FACE_POINT_INDICES } from "@/components/LandmarkOverlay";
import { useTranslation } from "react-i18next";
import { makeCollectStaticStyles as makeStyles } from "@/styles/collect-static.styles";
import { useAppTheme } from "@/context/ThemeContext";
import { flushLog, logEvent } from "@/services/inferenceLogger";
import { CollectVerdict, describeVerdict } from "@/lib/collectVerdict";

const VERDICT_COLORS: Record<CollectVerdict["status"], string> = {
  accepted: "#2ecc71",
  suspect: "#f39c12",
  rejected: "#e74c3c",
  error: "#e74c3c",
};

export default function CollectStaticScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [label, setLabel] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [sampleCount, setSampleCount] = useState(0);
  // Último veredito da validação assíncrona (aceita / revisão / descartada).
  const [verdict, setVerdict] = useState<CollectVerdict | null>(null);
  // Captura em andamento: o botão mostra o spinner até o servidor confirmar, e
  // com isso quem coleta sabe quando já pode capturar o próximo frame.
  const [isCapturing, setIsCapturing] = useState(false);
  const capturingRef = useRef(false);
  // Os três canais num único estado: eles vêm sempre do mesmo frame, e separá-los
  // custaria um ciclo de render do React por canal a cada atualização.
  const [overlay, setOverlay] = useState<OverlayChannels>({ hands: [], pose: [], face: [] });
  const { hands: landmarks, pose: poseLandmarks, face: faceLandmarks } = overlay;
  const { datasets, stats, statsLoading, totals, loadTotals, recordCount } = useCollectDatasets("static", datasetName);
  const [isAdmin, setIsAdmin] = useState(false);
  // Holístico: coleta mãos + corpo + rosto. Compartilha a preferência com a cam.
  const [holisticEnabled, setHolisticEnabled] = useState(false);
  const holisticEnabledRef = useRef(holisticEnabled);
  // Payload holístico do último frame com mão — já transformado, pronto para a
  // captura. Ver onLandmarksDetected: guardar o frame cru retinha os 478 pontos
  // de rosto a cada frame sem necessidade.
  const lastPayloadRef = useRef<HolisticPayload | null>(null);
  // Dimensões da imagem usada na inferência (do plugin nativo) — alinham o
  // overlay ao preview com crop "cover".
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const { t } = useTranslation();

  useEffect(() => { holisticEnabledRef.current = holisticEnabled; }, [holisticEnabled]);

  // Ao trocar de modo, descarta o dataset escolhido se ele for do outro formato.
  useEffect(() => {
    const ds = datasets.find(d => d.name === datasetName);
    if (ds && !isDatasetInCurrentMode(ds)) setDatasetName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holisticEnabled]);

  useEffect(() => {
    AsyncStorage.getItem("userRole").then(r => setIsAdmin(r === "admin"));
    AsyncStorage.getItem("config_holistic_enabled").then(v => setHolisticEnabled(v === "true"));
  }, []);

  // Só lista datasets do mesmo formato da coleta atual (Holístico / Só mãos).
  const isDatasetInCurrentMode = (d: CollectDataset) =>
    (d.feature_schema ?? "hands_v1") === (holisticEnabled ? "holistic_v1" : "hands_v1");
  const modeDatasets = useMemo(
    () => datasets.filter(isDatasetInCurrentMode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datasets, holisticEnabled],
  );

  const device = useCameraDevice("front");
  // Sem pedir a permissão aqui, quem abre a coleta antes da tela de inferência
  // fica com a câmera preta: o Camera renderiza, mas nunca recebe frames.
  const { hasPermission, requestPermission } = useCameraPermission();
  useEffect(() => { if (!hasPermission) requestPermission(); }, [hasPermission, requestPermission]);
  // Formato fixado: os modelos do MediaPipe redimensionam internamente para
  // ~192-256px, então resolução acima de 640x480 é custo puro de cópia e
  // rotação de buffer por frame, sem ganho de precisão. Sem fixar, o
  // VisionCamera pode escolher um formato bem maior em outro aparelho.
  const format = useCameraFormat(device, [
    { videoResolution: { width: 640, height: 480 } },
    { fps: 30 },
  ]);
  const { width: screenWidth } = Dimensions.get("window");

  const { cameraKey, beat } = useFrameWatchdog();

  const onLandmarksDetected = Worklets.createRunOnJS((packed: string) => {
    // Chega como string e vira objeto comum aqui — ver packResult.
    const result: HolisticDetectionResult = unpackResult(packed);
    beat(result);
    const hands = result?.hands ?? [];
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

    // Guarda o payload JÁ MONTADO em vez do frame cru. Reter o resultado cru
    // significava segurar os 478 pontos do FaceLandmarker (mais pose e mãos) a
    // cada frame só para usá-los no clique de captura — pressão de GC contínua
    // num loop que roda dezenas de vezes por segundo. `buildPayload` aplica o
    // mesmo transformPoint em todos os canais, então pose/rosto seguem o
    // referencial das mãos exatamente como antes.
    lastPayloadRef.current =
      hands.length > 0 && holisticEnabledRef.current
        ? buildPayload(result, "holistic_v1")
        : null;
  });

  // Espelha o toggle holístico para o worklet — ver cam/index.tsx.
  const holisticSharedRef = useRef<{ value: boolean } | null>(null);
  if (holisticSharedRef.current === null) holisticSharedRef.current = Worklets.createSharedValue(false);
  const holisticShared = holisticSharedRef.current;
  useEffect(() => { holisticShared.value = holisticEnabled; }, [holisticEnabled, holisticShared]);

  const frameProcessor = useFrameProcessor((frame) => {
    "worklet";
    // Sem throttle nem guarda de reentrância aqui, de propósito — mesma razão
    // documentada em cam/index.tsx: o descarte de frames é feito na ORIGEM pelo
    // CameraX, via STRATEGY_KEEP_ONLY_LATEST (o plugin aplica o patch no
    // prebuild). Como esta análise é síncrona, o CameraX não entrega um novo
    // frame enquanto ela não retorna — e, quando retorna, entrega o MAIS
    // RECENTE, descartando os intermediários.
    //
    // O throttle que existia aqui (100ms) não reduzia fila nenhuma: a guarda
    // `busy` nunca disparava (a análise síncrona já devolveu o worklet quando o
    // próximo frame chega) e o limite de 10 fps apenas RECUSAVA frames que o
    // aparelho daria conta de processar — o resultado era um overlay travado
    // bem abaixo da capacidade real do dispositivo.
    try {
      const holistic = holisticShared.value;
      const result = detectHandLandmarks(frame, { pose: holistic, face: holistic });
      onLandmarksDetected(packResult(result));
    } catch (e: any) {
      onLandmarksDetected(packResult(null, e?.message || String(e)));
    }
  }, [holisticShared]);

  useEffect(() => {
    logEvent("collect_focus", { screen: "static" });
    return () => {
      logEvent("collect_blur", { screen: "static" });
      flushLog();
    };
  }, []);

  const captureStatic = async () => {
    if (!label || !datasetName) {
      Alert.alert(t('collect_static.warning'), t('collect_static.fill_required'));
      return;
    }
    // `landmarks` é a lista de MÃOS; a captura exige ao menos uma mão completa.
    const primaryHand = landmarks.find((hand) => hand?.length === 21);
    if (!primaryHand) {
      logEvent("collect_end", { screen: "static", outcome: "no_hand", hands: landmarks.length });
      Alert.alert(t('collect_static.hand_not_detected_title'), t('collect_static.hand_not_detected_msg'));
      return;
    }

    // Uma captura por vez: o ref barra o toque duplo antes de o estado re-renderizar.
    if (capturingRef.current) return;
    capturingRef.current = true;
    setIsCapturing(true);
    const startedAt = Date.now();
    logEvent("collect_start", {
      screen: "static",
      label,
      dataset: datasetName,
      schema: holisticEnabled ? "holistic_v1" : "hands_v1",
    });

    try {
      // Holístico envia {hands, pose, face}; caso contrário mantém o formato
      // legado {landmark} de 42 features, aceito pelos datasets antigos.
      const holisticPayload = holisticEnabled ? lastPayloadRef.current : null;
      const payloadLandmarks =
        holisticPayload && !Array.isArray(holisticPayload)
          ? holisticPayload
          // Formato legado de 42 features: uma única mão plana, aceito pelos
          // datasets antigos.
          : { landmark: primaryHand };

      const res = await trainingService.startStaticCollection(label, datasetName, payloadLandmarks);

      console.log("RESPOSTA DA API: ", res);

      if (res.ok) {
        logEvent("collect_end", { screen: "static", outcome: res.queued ? "queued" : "saved", ms: Date.now() - startedAt, samples: res.sample_count });
        setSampleCount(res.sample_count);
        recordCount(label, res.sample_count);
        // A validação roda no servidor em segundo plano: o botão é liberado
        // já (captura rápida) e o veredito aparece abaixo dele quando sair.
        if (res.ticket_id) followTicket(res.ticket_id, label);
      } else {
        const errorMsg = res.error || (res.detail ? JSON.stringify(res.detail) : JSON.stringify(res));
        logEvent("collect_end", { screen: "static", outcome: "server_error", ms: Date.now() - startedAt, error: errorMsg });
        flushLog();
        Alert.alert(t('collect_static.api_error'), errorMsg || t('collect_static.api_error'));
      }
    } catch (e) {
      logEvent("collect_end", { screen: "static", outcome: "network_error", ms: Date.now() - startedAt, error: String(e) });
      flushLog();
      Alert.alert(t('collect_static.network_error'), t('collect_static.network_error') + ": " + String(e));
    } finally {
      capturingRef.current = false;
      setIsCapturing(false);
    }
  };

  // Acompanha o ticket da validação (long-poll de até ~8s por tentativa). Não
  // bloqueia a tela: várias capturas podem estar sendo validadas ao mesmo tempo.
  const followTicket = async (ticketId: string, ticketLabel: string) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const ticket = await trainingService.getCollectTicket(ticketId);
        const result = describeVerdict(ticket);
        if (!result) continue;
        logEvent("collect_verdict", { screen: "static", status: result.status, label: ticketLabel });
        if (typeof ticket.sample_count === "number") {
          setSampleCount(ticket.sample_count);
          recordCount(ticketLabel, ticket.sample_count);
        }
        setVerdict(result);
        return;
      } catch {
        // rede instável: tenta de novo
      }
    }
  };

  const finalizeDataset = () => {
    Alert.alert(
      t('collect_static.success_title'),
      t('collect_static.success_msg', { label, count: stats[label] ?? sampleCount, datasetName }),
      [{ text: "OK", onPress: () => router.back() }]
    );
  };

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
        <Text translatable style={styles.title}>{t('collect_static.title')}</Text>
        <TouchableOpacity
          onPress={() => {
            setHolisticEnabled((v) => {
              const next = !v;
              AsyncStorage.setItem("config_holistic_enabled", String(next));
              return next;
            });
          }}
          style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4 }}
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
        />
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
            datasets={modeDatasets}
            totals={totals}
            onOpen={() => loadTotals(modeDatasets.map((d) => d.id))}
            canCreate={isAdmin}
            locked={isCapturing}
            unit="samples"
          />

          <GesturePicker
            value={label}
            onChange={setLabel}
            stats={stats}
            loading={statsLoading}
            hasDataset={!!datasetName}
            locked={isCapturing}
            unit="samples"
            datasetName={datasetName}
          />

          <View style={styles.buttonRow}>
            <CollectButton
              icon="camera"
              label={t('collect_static.capture_btn')}
              busy={isCapturing}
              busyLabel={t('collect_static.saving_btn')}
              onPress={captureStatic}
            />

            {sampleCount > 0 && (
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





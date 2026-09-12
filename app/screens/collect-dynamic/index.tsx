import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { View, TouchableOpacity, TextInput, Dimensions, Alert, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import Text from "@/components/TranslatableText";
import { MaterialIcons } from "@expo/vector-icons";
import { trainingService } from "@/services/trainingService";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Camera, useCameraDevice, useCameraFormat, useFrameProcessor } from "react-native-vision-camera";
import { Worklets } from "react-native-worklets-core";
import { detectHandLandmarks, HolisticDetectionResult } from "@/services/handLandmarkerPlugin";
import { gestureWS } from "@/services/gestureWebSocket";
import { buildPayload, makeCoverMapper, buildOverlayChannels, OverlayChannels } from "@/services/holisticFeatures";
import LandmarkOverlay, { FACE_POINT_INDICES } from "@/components/LandmarkOverlay";
import { useTranslation } from "react-i18next";
import { makeCollectDynamicStyles as makeStyles } from "@/styles/collect-dynamic.styles";
import { useAppTheme } from "@/context/ThemeContext";

export default function CollectDynamicScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [label, setLabel] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(isRecording);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sequences, setSequences] = useState(0);
  // Os três canais num único estado — ver cam/index.tsx: separá-los custaria um
  // ciclo de render do React por canal a cada frame.
  const [overlay, setOverlay] = useState<OverlayChannels>({ hands: [], pose: [], face: [] });
  const { hands: landmarks, pose: poseLandmarks, face: faceLandmarks } = overlay;
  const [datasets, setDatasets] = useState<any[]>([]);
  const [gestureLabels, setGestureLabels] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [labelHint, setLabelHint] = useState<string | null>(null);
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
    loadDatasets();
    AsyncStorage.getItem("userRole").then(r => setIsAdmin(r === "admin"));
    AsyncStorage.getItem("config_holistic_enabled").then(v => setHolisticEnabled(v === "true"));
  }, []);

  useEffect(() => {
    const ds = datasets.find(d => d.name === datasetName);
    if (ds) {
      loadLabels(ds.id);
    } else {
      setGestureLabels([]);
    }
  }, [datasetName, datasets]);

  const loadDatasets = async () => {
    try {
      const res = await trainingService.getDatasets();
      if (res && res.datasets) {
        setDatasets(res.datasets.filter((d: any) => d.type === "dynamic"));
      }
    } catch (e) {
      console.log("Failed to load datasets", e);
    }
  };

  const loadLabels = async (id: string) => {
    try {
      const res = await trainingService.getDatasetStats(id);
      if (res && res.stats) {
        setGestureLabels(Object.keys(res.stats));
      }
    } catch (e) {
      console.log("Failed to load labels", e);
    }
  };

  const device = useCameraDevice("front");
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

  const onLandmarksDetected = Worklets.createRunOnJS((result: HolisticDetectionResult) => {
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
      if (payload) gestureWS.sendHolistic(payload);
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
      onLandmarksDetected(result ?? ({ hands: [] } as any));
    } catch (e) {
      onLandmarksDetected({ hands: [] } as any);
    }
  }, [holisticShared]);

  useEffect(() => {
    gestureWS.connect((res) => {
      console.log("WS Response:", res);
      if (res.ok && res.sequences !== undefined) {
        setSequences(res.sequences);
        // Stop recording cleanly upon success
        if (isRecordingRef.current) {
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
          setIsRecording(false);
          gestureWS.sendAction({ action: "stop_collect" });
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

    try {
      setIsRecording(true);
      // Zera o throttle de envio: sem isto, o primeiro frame de uma gravação
      // iniciada logo após a anterior cairia na janela de 50ms e seria perdido.
      lastSentRef.current = 0;
      const userId = await AsyncStorage.getItem("userId") || undefined;
      
      gestureWS.sendAction({ 
        action: "start_collect", 
        label, 
        dataset_name: datasetName, 
        user_id: userId 
      });

      // Allow up to 6 seconds for the user to provide 15 valid ML frames
      recordingTimeoutRef.current = setTimeout(() => {
        if (isRecordingRef.current) {
           gestureWS.sendAction({ action: "stop_collect" });
           setIsRecording(false);
           Alert.alert(t('collect_dynamic.timeout_title'), t('collect_dynamic.timeout_msg'));
        }
      }, 6000);
    } catch (e) {
      Alert.alert(t('collect_dynamic.recording_error'), String(e));
      setIsRecording(false);
    }
  };

  const finalizeDataset = () => {
    Alert.alert(
      t('collect_dynamic.success_title'),
      t('collect_dynamic.success_msg', { label, count: sequences, datasetName }),
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
        {device ? (
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            format={format}
            isActive={true}
            pixelFormat="rgb"
            frameProcessor={frameProcessor}
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
            <Text translatable style={styles.recordingText}>{t('collect_dynamic.recording_status')}</Text>
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
          <Text translatable style={styles.label}>{t('collect_static.dataset_name')}</Text>

          {datasets.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {datasets.map((ds) => (
                <TouchableOpacity
                  key={ds.id}
                  style={[styles.chip, datasetName === ds.name && styles.chipActive]}
                  onPress={() => setDatasetName(ds.name)}
                >
                  <Text style={[styles.chipText, datasetName === ds.name && styles.chipTextActive]}>
                    {ds.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {isAdmin ? (
            <TextInput
              style={styles.input}
              placeholderTextColor="#666"
              placeholder="EX: LIBRAS_V1"
              value={datasetName}
              onChangeText={setDatasetName}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          ) : (
            datasets.length === 0 && <Text translatable style={{ color: "#888" }}>{t('collect_static.no_dataset')}</Text>
          )}

          <Text translatable style={styles.label}>{t('collect_static.label_gesto')}</Text>
          {gestureLabels.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {gestureLabels.map((lbl) => (
                <TouchableOpacity
                  key={lbl}
                  style={[styles.chip, label === lbl && styles.chipActive]}
                  onPress={() => setLabel(lbl)}
                >
                  <Text style={[styles.chipText, label === lbl && styles.chipTextActive]}>
                    {lbl}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <TextInput
            style={[
              styles.input,
              labelHint && { borderColor: 'rgba(255, 171, 0, 0.5)' },
            ]}
            placeholderTextColor="#666"
            placeholder="EX: OI"
            value={label}
            autoCapitalize="characters"
            autoCorrect={false}
            onChangeText={(v) => {
              setLabel(v);
              const normalized = v.toUpperCase();
              if (normalized && gestureLabels.includes(normalized)) {
                setLabelHint(t('collect_dynamic.label_hint', { normalized }));
              } else {
                setLabelHint(null);
              }
            }}
          />
          {labelHint && (
            <View style={styles.labelHint}>
              <MaterialIcons name="info-outline" size={16} color="#ffab00" />
              <Text translatable style={styles.labelHintText}>{labelHint}</Text>
            </View>
          )}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.captureBtn, isRecording && { backgroundColor: '#333' }]}
              onPress={startDynamic}
              disabled={isRecording}
            >
              <MaterialIcons name={isRecording ? "radio-button-checked" : "fiber-manual-record"} size={24} color={isRecording ? "red" : "#000"} />
              <Text style={[styles.captureBtnText, isRecording && { color: "#888" }]}>
                {isRecording ? t('collect_dynamic.recording_btn') : t('collect_dynamic.record_btn')}
              </Text>
            </TouchableOpacity>

            {sequences > 0 && !isRecording && (
              <TouchableOpacity style={styles.finalizeBtn} onPress={finalizeDataset}>
                <MaterialIcons name="check-circle" size={24} color="#fff" />
                <Text style={styles.finalizeBtnText}>{t('collect_static.finalize_btn')}</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text translatable style={styles.stats}>
            {t('collect_dynamic.stats', { count: sequences })}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}





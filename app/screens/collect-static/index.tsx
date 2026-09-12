import { detectHandLandmarks, HolisticDetectionResult } from "@/services/handLandmarkerPlugin";
import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useMemo, useEffect, useRef, useState } from "react";
import { Alert, Dimensions, ScrollView, TextInput, TouchableOpacity, View, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import Text from "@/components/TranslatableText";
import { Camera, useCameraDevice, useCameraFormat, useFrameProcessor } from "react-native-vision-camera";
import { Worklets } from "react-native-worklets-core";
import { trainingService } from "@/services/trainingService";
import { buildPayload, makeCoverMapper, buildOverlayChannels, OverlayChannels, HolisticPayload } from "@/services/holisticFeatures";
import LandmarkOverlay, { FACE_POINT_INDICES } from "@/components/LandmarkOverlay";
import { useTranslation } from "react-i18next";
import { makeCollectStaticStyles as makeStyles } from "@/styles/collect-static.styles";
import { useAppTheme } from "@/context/ThemeContext";

export default function CollectStaticScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [label, setLabel] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [sampleCount, setSampleCount] = useState(0);
  // Os três canais num único estado: eles vêm sempre do mesmo frame, e separá-los
  // custaria um ciclo de render do React por canal a cada atualização.
  const [overlay, setOverlay] = useState<OverlayChannels>({ hands: [], pose: [], face: [] });
  const { hands: landmarks, pose: poseLandmarks, face: faceLandmarks } = overlay;
  const [datasets, setDatasets] = useState<any[]>([]);
  const [gestureLabels, setGestureLabels] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [labelHint, setLabelHint] = useState<string | null>(null);
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
        // filter for static datasets only
        setDatasets(res.datasets.filter((d: any) => d.type === "static"));
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
  // Formato fixado: os modelos do MediaPipe redimensionam internamente para
  // ~192-256px, então resolução acima de 640x480 é custo puro de cópia e
  // rotação de buffer por frame, sem ganho de precisão. Sem fixar, o
  // VisionCamera pode escolher um formato bem maior em outro aparelho.
  const format = useCameraFormat(device, [
    { videoResolution: { width: 640, height: 480 } },
    { fps: 30 },
  ]);
  const { width: screenWidth } = Dimensions.get("window");

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
      onLandmarksDetected(result ?? ({ hands: [] } as any));
    } catch {
      onLandmarksDetected({ hands: [] } as any);
    }
  }, [holisticShared]);

  const captureStatic = async () => {
    if (!label || !datasetName) {
      Alert.alert(t('collect_static.warning'), t('collect_static.fill_required'));
      return;
    }
    // `landmarks` é a lista de MÃOS; a captura exige ao menos uma mão completa.
    const primaryHand = landmarks.find((hand) => hand?.length === 21);
    if (!primaryHand) {
      Alert.alert(t('collect_static.hand_not_detected_title'), t('collect_static.hand_not_detected_msg'));
      return;
    }

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
        setSampleCount(res.sample_count);
        // Visual feeback removed Alert.alert to not block fast clicking, but added to state maybe
      } else {
        const errorMsg = res.error || (res.detail ? JSON.stringify(res.detail) : JSON.stringify(res));
        Alert.alert(t('collect_static.api_error'), errorMsg || t('collect_static.api_error'));
      }
    } catch (e) {
      Alert.alert(t('collect_static.network_error'), t('collect_static.network_error') + ": " + String(e));
    }
  };

  const finalizeDataset = () => {
    Alert.alert(
      t('collect_static.success_title'),
      t('collect_static.success_msg', { label, count: sampleCount, datasetName }),
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
        />
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
              placeholder="EX: ALFABETO_V1"
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
            placeholder="EX: A"
            value={label}
            autoCapitalize="characters"
            autoCorrect={false}
            onChangeText={(v) => {
              setLabel(v);
              // Verifica se o label jÃ¡ existe no dataset atual
              const normalized = v.toUpperCase();
              if (normalized && gestureLabels.includes(normalized)) {
                setLabelHint(t('collect_static.label_hint', { normalized }));
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
            <TouchableOpacity style={styles.captureBtn} onPress={captureStatic}>
              <MaterialIcons name="camera" size={24} color="#000" />
              <Text style={styles.captureBtnText}>{t('collect_static.capture_btn')}</Text>
            </TouchableOpacity>

            {sampleCount > 0 && (
              <TouchableOpacity style={styles.finalizeBtn} onPress={finalizeDataset}>
                <MaterialIcons name="check-circle" size={24} color="#fff" />
                <Text style={styles.finalizeBtnText}>{t('collect_static.finalize_btn')}</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text translatable style={styles.stats}>
            {t('collect_static.stats', { label, count: sampleCount })}
          </Text>
          </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}





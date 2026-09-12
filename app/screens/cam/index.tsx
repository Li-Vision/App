import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View, StyleSheet, TouchableOpacity, Alert, Dimensions, Modal, Switch } from "react-native";
import Text from "@/components/TranslatableText";
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useFrameProcessor,
  useCameraPermission,
} from "react-native-vision-camera";
import { Worklets } from "react-native-worklets-core";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  gestureWS,
  ConnectionStatus,
  GestureResult,
  DetectionMode,
} from "@/services/gestureWebSocket";
import {
  detectHandLandmarks,
  HolisticDetectionResult,
} from "@/services/handLandmarkerPlugin";
import { buildPayload, makeCoverMapper, buildOverlayChannels, OverlayChannels } from "@/services/holisticFeatures";
import LandmarkOverlay, { FACE_POINT_INDICES } from "@/components/LandmarkOverlay";
import { useModelStatus } from "@/hooks/useModelStatus";
import { trainingService } from "@/services/trainingService";
import speechService, { getSpeechLanguageConfig, SpeechPreferences } from "@/services/speechService";
import { useSpellingDetector } from "@/hooks/useSpellingDetector";
import SpellingPanel from "@/components/voice/SpellingPanel";
import VoiceSettingsModal from "@/components/voice/VoiceSettingsModal";
import { makeCamStyles } from "@/styles/cam.styles";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "@/context/ThemeContext";

const DETECTION_MODES: { key: DetectionMode; label: string; desc: string; icon: string }[] = [
  { key: "hybrid",     label: "Híbrido",        desc: "Combina regras + ML estático + ML dinâmico",   icon: "merge-type" },
  { key: "rules",      label: "Regras Lógicas", desc: "Apenas detectores baseados em lógica (A–E)",   icon: "calculate" },
  { key: "ml",         label: "ML Estático",    desc: "Apenas modelos de gestos sem movimento",       icon: "pan-tool" },
  { key: "dynamic_ml", label: "ML Dinâmico",    desc: "Apenas modelos de gestos com movimento",       icon: "dynamic-form" },
];

export default function CameraScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeCamStyles(colors), [colors]);
  const [gesture, setGesture] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number>(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [apiError, setApiError] = useState<string | null>(null);
  // Os três canais num único estado: eles vêm sempre do mesmo frame, e separá-los
  // custava um ciclo de render do React por canal a cada atualização.
  const [overlay, setOverlay] = useState<OverlayChannels>({ hands: [], pose: [], face: [] });
  const { hands: landmarks, pose: poseLandmarks, face: faceLandmarks } = overlay;
  // Dimensões da imagem (em pé) usada na inferência — vindas do plugin
  // nativo, necessárias para alinhar o overlay ao preview com crop "cover".
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [showLandmarks, setShowLandmarks] = useState<boolean>(true);
  // Aba inicial do modal de configurações: cada botão da barra abre o mesmo
  // modal, já na seção correspondente.
  const [settingsTab, setSettingsTab] = useState<"display" | "voice">("display");
  const [detectionMode, setDetectionMode] = useState<DetectionMode>("hybrid");
  const [showModeModal, setShowModeModal] = useState<boolean>(false);
  const [activeModelName, setActiveModelName] = useState<string | null>(null);
  const [availableModes, setAvailableModes] = useState(DETECTION_MODES);
  // Holístico: quando ON, envia mãos + corpo + rosto (schema holistic_v1).
  // Quando OFF, envia só mãos (hands_v1) — compat com modelos antigos.
  const [holisticEnabled, setHolisticEnabled] = useState<boolean>(false);
  const holisticEnabledRef = useRef(holisticEnabled);
  const { t } = useTranslation();

  // Voz / Soletração
  const [speechPrefs, setSpeechPrefs] = useState<SpeechPreferences>(speechService.getPreferences());
  const [showSpeechModal, setShowSpeechModal] = useState<boolean>(false);
  const [lastSpokenWord, setLastSpokenWord] = useState<string | null>(null);

  const handleWordComplete = useCallback((word: string) => {
    setLastSpokenWord(word);
    speechService.speakWord(word);
    setTimeout(() => setLastSpokenWord((prev) => (prev === word ? null : prev)), 4000);
  }, []);

  const spellingConfig = useMemo(() => ({
    spellingIdleMs: speechPrefs.spellingIdleMs,
    letterStableMs: speechPrefs.letterStableMs,
    minConfidence: speechPrefs.minConfidence,
    enabled: speechPrefs.enabled && speechPrefs.spellingEnabled,
  }), [
    speechPrefs.spellingIdleMs,
    speechPrefs.letterStableMs,
    speechPrefs.minConfidence,
    speechPrefs.enabled,
    speechPrefs.spellingEnabled,
  ]);

  const spelling = useSpellingDetector({
    config: spellingConfig,
    onWordComplete: handleWordComplete,
  });

  useEffect(() => { holisticEnabledRef.current = holisticEnabled; }, [holisticEnabled]);

  useEffect(() => {
    let mounted = true;
    speechService.init().then((prefs) => { if (mounted) setSpeechPrefs(prefs); });
    AsyncStorage.getItem("config_holistic_enabled").then((v) => {
      if (mounted && v === "true") setHolisticEnabled(true);
    });
    // Também editável em Configurações do app; ausente = ligado (padrão).
    AsyncStorage.getItem("config_show_landmarks").then((v) => {
      if (mounted && v === "false") setShowLandmarks(false);
    });

    const checkRulesConfig = async () => {
      let rulesEnabled = true;
      try {
        const rulesState = await trainingService.getRulesEnabled();
        if (rulesState !== undefined) {
          rulesEnabled = rulesState;
          await AsyncStorage.setItem("config_rules_enabled", String(rulesEnabled));
        } else {
          const rulesStored = await AsyncStorage.getItem("config_rules_enabled");
          rulesEnabled = rulesStored !== "false";
        }
      } catch (e) {
        console.log("Erro ao carregar rules da API no cam, usando local:", e);
        const rulesStored = await AsyncStorage.getItem("config_rules_enabled");
        rulesEnabled = rulesStored !== "false";
      }

      const userRole = await AsyncStorage.getItem("userRole");
      
      // Filtra os modos baseados no papel do usuário e config global
      const filtered = DETECTION_MODES.filter(m => {
        if (m.key === "rules") {
          // Só admin vê modo rules, e só se estiver habilitado
          return userRole === "admin" && rulesEnabled;
        }
        // Híbrido, ML e Dinâmico sempre aparecem
        return true;
      });

      if (mounted) {
        setAvailableModes(filtered);
        // Se o modo atual sumiu, reseta para hybrid
        if (!filtered.find(m => m.key === detectionMode)) {
          setDetectionMode("hybrid");
        }
      }
    };
    checkRulesConfig();

    const unsubscribe = speechService.subscribe((prefs) => { if (mounted) setSpeechPrefs(prefs); });
    return () => { mounted = false; unsubscribe(); speechService.stop(); };
  }, []);

  const { status: modelStatus, errorMessage: modelError } = useModelStatus();
  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
  const device = useCameraDevice("front");
  // Resolução de inferência fixada em 640x480: os três modelos redimensionam
  // internamente para ~192-256px, então um buffer maior só encarece a cópia e
  // a rotação feitas a cada frame no plugin nativo.
  const format = useCameraFormat(device, [
    { videoResolution: { width: 640, height: 480 } },
    { fps: 30 },
  ]);
  const { hasPermission, requestPermission } = useCameraPermission();

  useEffect(() => { if (!hasPermission) requestPermission(); }, [hasPermission]);

  const handleGesture = useCallback((result: GestureResult) => {
    if (result.error) {
      console.log("[API Error]:", result.error);
      setApiError(result.error);
      setTimeout(() => setApiError(null), 3000);
    } else {
      setApiError(null);
    }

    if (result.gesture) {
      setGesture(result.gesture);
      setConfidence(result.confidence);

      const prefs = speechService.getPreferences();
      const conf = result.confidence ?? 0;
      const label = result.gesture;

      // Alimenta o detector de soletração (filtro interno para letras)
      spelling.onDetection(label, conf);

      // Coexistência: se soletração está ON e é letra, não fala individual.
      const looksLikeLetter =
        typeof label === "string" &&
        label.trim().length === 1 &&
        /^[A-Za-zÀ-ÿ]$/.test(label.trim());

      const shouldSpeakIndividual =
        prefs.enabled &&
        prefs.speakGestures &&
        !(prefs.spellingEnabled && looksLikeLetter);

      if (shouldSpeakIndividual) speechService.speakGesture(label);
    }

    if (result.mode) setDetectionMode(result.mode as DetectionMode);
  }, [spelling]);

  const handleStatusChange = useCallback(
    (status: ConnectionStatus, message?: string) => {
      setConnectionStatus(status);
      if (status === "failed") {
        Alert.alert(
          t('cam.connection_error'),
          `${t('cam.api_fail')}\n${message ?? ""}`,
          [{ text: "OK" }]
        );
      }
    }, []
  );

  // Ref para manter referência estável do handleGesture/handleStatusChange
  const handleGestureRef = useRef(handleGesture);
  handleGestureRef.current = handleGesture;
  const handleStatusChangeRef = useRef(handleStatusChange);
  handleStatusChangeRef.current = handleStatusChange;

  // Conecta/reconecta o WS toda vez que a tela ganha foco
  // Isso garante que ao voltar de 'select-model', o modelo mais recente é usado
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const activateAndConnect = async () => {
        const activeId = await AsyncStorage.getItem("activeModelId");
        const modelName = await AsyncStorage.getItem("activeModelName");
        let finalModelName = modelName;
        if (modelName) setActiveModelName(modelName);

        if (!activeId) {
          // Nenhum modelo selecionado — tenta auto-ativar o melhor
          try {
            const res = await trainingService.listModels();
            if (res.models && res.models.length > 0) {
              const best = res.models.sort((a: any, b: any) => (b.accuracy ?? 0) - (a.accuracy ?? 0))[0];
              await trainingService.activateModel(best.id);
              await AsyncStorage.setItem("activeModelId", best.id);
              await AsyncStorage.setItem("activeModelName", best.name);
              finalModelName = best.name;
              if (!cancelled) setActiveModelName(best.name);
              console.log(`[AutoActivate] Modelo "${best.name}" ativado automaticamente`);
            }
          } catch (e) {
            console.log("[AutoActivate] Falha na ativação automática:", e);
          }
        } else {
          // Modelo já selecionado — garante que está ativado no servidor
          // (filesystem efêmero do Render pode ter perdido o arquivo)
          try {
            await trainingService.activateModel(activeId);
          } catch (e) {
            console.log("[ReActivate] Falha ao re-ativar modelo:", e);
          }
        }

        if (!cancelled) {
          let rulesEnabled = true;
          try {
            const rulesState = await trainingService.getRulesEnabled();
            if (rulesState !== undefined) {
              rulesEnabled = rulesState;
              await AsyncStorage.setItem("config_rules_enabled", String(rulesEnabled));
            } else {
              const rulesStored = await AsyncStorage.getItem("config_rules_enabled");
              rulesEnabled = rulesStored !== "false";
            }
          } catch (e) {
            const rulesStored = await AsyncStorage.getItem("config_rules_enabled");
            rulesEnabled = rulesStored !== "false";
          }

          gestureWS.connect(
            (result) => handleGestureRef.current(result),
            (status, msg) => handleStatusChangeRef.current(status, msg),
            detectionMode,
            finalModelName,
            rulesEnabled
          );
        }
      };

      activateAndConnect();

      return () => {
        cancelled = true;
        gestureWS.disconnect();
      };
    }, [])  // Sem dependência em detectionMode: troca de modo é feita in-session via sendAction
  );

  const changeMode = (mode: DetectionMode) => {
    setShowModeModal(false);
    // Apenas envia a ação para o servidor trocar o modo na sessão existente.
    // NÃO altere o state detectionMode aqui — isso acionaria o useFocusEffect
    // que desconecta e reconecta o WS, criando uma condição de corrida
    // onde a ação é enviada na conexão antiga que morre em seguida.
    // O state será atualizado pelo callback handleGesture quando o servidor
    // confirmar o novo modo na próxima resposta (result.mode).
    gestureWS.sendAction({ action: "set_mode", mode });
  };

  // Última vez que um payload foi enviado ao servidor (ms). O overlay atualiza
  // mais rápido que isso; ver comentário no envio abaixo.
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

    // Mãos, pose e rosto são canais independentes no plugin nativo — a
    // ausência de uma mão no frame não deve zerar pose/rosto já detectados.
    // Um único setState por frame: quatro chamadas separadas disparavam quatro
    // ciclos de render do React a cada atualização do overlay.
    setOverlay(buildOverlayChannels(result, holisticEnabledRef.current, FACE_POINT_INDICES));

    // O overlay acompanha a câmera o mais rápido possível, mas o servidor não
    // precisa da mesma taxa: o reconhecimento usa janela de 15 frames e o
    // DetectorManager estabiliza no tempo. Enviar a ~10/s (como antes) mantém
    // o comportamento do backend e evita saturar a rede e a serialização JSON.
    const agora = Date.now();
    if (gestureWS.isConnected() && agora - lastSentRef.current >= 100) {
      lastSentRef.current = agora;
      const schema = holisticEnabledRef.current ? "holistic_v1" : "hands_v1";
      const payload = buildPayload(result, schema);
      if (payload) gestureWS.sendHolistic(payload);
    }
  });

  const sendLogToJS = Worklets.createRunOnJS((msg: string) => { console.log("[Edge MediaPipe]:", msg); });
  const onPluginError = Worklets.createRunOnJS((error: string) => { console.error("[Edge ERRO]:", error); });

  // O shared value PRECISA sobreviver aos re-renders: `overlay` muda a cada
  // frame, então o componente re-renderiza continuamente e um valor criado
  // solto no corpo do componente seria recriado junto (o sintoma era
  // `frameCount` travado em 1 no log, mesmo após centenas de frames).
  const frameCountRef = useRef<{ value: number } | null>(null);
  if (frameCountRef.current === null) frameCountRef.current = Worklets.createSharedValue(0);
  const frameCount = frameCountRef.current;

  // Espelha o toggle "Holístico" para dentro do worklet. Um ref comum de JS
  // não atravessa a fronteira do worklet, daí o shared value — é ele que faz
  // o toggle PULAR a inferência de pose/rosto no nativo, em vez de só
  // descartar o resultado depois de pago o custo.
  const holisticSharedRef = useRef<{ value: boolean } | null>(null);
  if (holisticSharedRef.current === null) holisticSharedRef.current = Worklets.createSharedValue(false);
  const holisticShared = holisticSharedRef.current;
  useEffect(() => { holisticShared.value = holisticEnabled; }, [holisticEnabled, holisticShared]);

  const frameProcessor = useFrameProcessor((frame) => {
    "worklet";
    // Sem throttle nem guarda de reentrância aqui, de propósito: o descarte de
    // frames é feito na ORIGEM pelo CameraX, via STRATEGY_KEEP_ONLY_LATEST
    // (ver o patch em CameraSession+Configuration.kt). Como a análise é
    // síncrona neste worklet, o CameraX simplesmente não entrega um novo frame
    // enquanto este não retorna — e, quando retorna, entrega o MAIS RECENTE,
    // descartando os intermediários.
    //
    // Repetir o descarte aqui era contraproducente: segurar o worklet até o
    // React terminar de desenhar tornava o consumo mais lento que a produção
    // e só atrasava mais o frame seguinte, sem reduzir fila nenhuma.
    frameCount.value += 1;
    const shouldLog = frameCount.value % 30 === 1;

    try {
      // width/height lidos antes do detect: acessar props do frame dentro dos
      // argumentos de um runOnJS as avalia fora do ciclo de vida do frame.
      const frameWidth = frame.width;
      const frameHeight = frame.height;
      const t0 = performance.now();
      // Com o holístico desligado, pose e rosto nem são inferidos: o custo
      // desses dois modelos some do frame, em vez de ser pago e descartado.
      const holistic = holisticShared.value;
      const result = detectHandLandmarks(frame, { pose: holistic, face: holistic });
      // Custo real da inferência dos 3 modelos, medido no dispositivo. É ele
      // que define o teto de fps do overlay — se ficar perto do intervalo entre
      // frames, o gargalo é o modelo, não o desenho.
      const inferMs = performance.now() - t0;
      if (shouldLog) {
        if (result) {
          const handsLen = result.hands ? result.hands.length : 0;
          const errorMsg = (result as any).error;
          // Canais e dimensões da imagem de inferência entram no log: é por
          // eles que se confere, sem depurador, se a rotação e o mapeamento do
          // overlay estão certos (imagem em pé ⇒ imgH > imgW em retrato).
          const imgW = result.imageWidth ?? 0;
          const imgH = result.imageHeight ?? 0;
          const poseLen = result.pose ? result.pose.length : 0;
          const faceLen = result.face ? result.face.length : 0;
          const poseErr = result.poseError;
          const faceErr = result.faceError;
          // Delegate por canal: o fallback GPU→CPU é silencioso, então sem
          // isto não dá para saber se a aceleração pegou neste aparelho.
          const dg = result.delegates;
          const dgStr = dg
            ? Object.keys(dg).map((k) => `${k.replace("Landmarker", "")}=${dg[k]}`).join(",")
            : "?";
          sendLogToJS(
            `Frame #${frameCount.value}: buf ${frameWidth}x${frameHeight} | img ${imgW}x${imgH} | ` +
            `delegate ${dgStr} | ` +
            `infer ${inferMs.toFixed(0)}ms (~${(1000 / Math.max(inferMs, 1)).toFixed(0)}fps máx) → ` +
            `${handsLen} mão(s), pose ${poseLen}, face ${faceLen}` +
            (errorMsg ? ` | ERRO: ${errorMsg}` : "") +
            (poseErr ? ` | POSE_ERR: ${poseErr}` : "") +
            (faceErr ? ` | FACE_ERR: ${faceErr}` : "")
          );
        } else {
          sendLogToJS(`Frame #${frameCount.value}: plugin retornou null`);
        }
      }
      onLandmarksDetected(result ?? ({ hands: [] } as any));
    } catch (e: any) {
      if (shouldLog) onPluginError(`Frame: ${e?.message || String(e)}`);
    }
  }, [frameCount, holisticShared]);

  const statusConfig = {
    color: connectionStatus === "connected" ? "#4caf50"
         : connectionStatus === "reconnecting" ? "#ff9800" : "#f44336",
    label: connectionStatus,
  };

  const currentModeConfig = DETECTION_MODES.find(m => m.key === detectionMode);
  const HEADER_HEIGHT = 90;
  const CAM_WIDTH = screenWidth - 32;
  const CAM_HEIGHT = screenHeight - HEADER_HEIGHT - 32;
  const cover = useMemo(
    () => makeCoverMapper(frameSize, CAM_WIDTH, CAM_HEIGHT),
    [frameSize, CAM_WIDTH, CAM_HEIGHT],
  );

  const toggleSpeech = async () => { await speechService.toggleEnabled(); };
  const toggleSpeakGestures = async () => { await speechService.toggleSpeakGestures(); };
  const toggleSpellingEnabled = async () => {
    const wasEnabled = speechPrefs.spellingEnabled;
    await speechService.toggleSpellingEnabled();
    if (wasEnabled) spelling.clear();
  };
  const adjustIdle = (d: number) => {
    const next = Math.min(5000, Math.max(1000, speechPrefs.spellingIdleMs + d));
    speechService.setPreferences({ spellingIdleMs: next });
  };
  const adjustStable = (d: number) => {
    const next = Math.min(1500, Math.max(200, speechPrefs.letterStableMs + d));
    speechService.setPreferences({ letterStableMs: next });
  };
  const adjustConfidence = (d: number) => {
    const next = Math.min(0.95, Math.max(0.3, +(speechPrefs.minConfidence + d).toFixed(2)));
    speechService.setPreferences({ minConfidence: next });
  };
  const setSpeechLanguage = (language: string) => {
    speechService.setLanguage(language);
  };
  const testVoice = () => {
    speechService.speak(getSpeechLanguageConfig(speechPrefs.language).testText, { interrupt: true });
  };

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Voltar">
          <MaterialIcons name="arrow-back" size={24} color={colors.text.primary} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setShowModeModal(true)}
          style={[styles.iconBtn, styles.modeBtnActive]}
          accessibilityLabel={t('cam.mode_title')}
        >
          <MaterialIcons name={(currentModeConfig?.icon as any) || "memory"} size={18} color="#00e5ff" />
          <Text style={styles.modeBtnText} numberOfLines={1} ellipsizeMode="tail">
            {currentModeConfig ? t(`cam.mode_${currentModeConfig.key}`) : detectionMode}
          </Text>
        </TouchableOpacity>

        {/* Atalho: liga/desliga a voz sem abrir nada. */}
        <TouchableOpacity
          onPress={toggleSpeech}
          style={[styles.iconBtn, speechPrefs.enabled && styles.iconBtnActive]}
          accessibilityLabel="Ativar/desativar síntese de voz"
        >
          <MaterialIcons
            name={speechPrefs.enabled ? "volume-up" : "volume-off"}
            size={20}
            color={speechPrefs.enabled ? "#00e5ff" : "#888"}
          />
        </TouchableOpacity>

        {/* Um único ponto de entrada para as configurações da tela. */}
        <TouchableOpacity
          onPress={() => { setSettingsTab("display"); setShowSpeechModal(true); }}
          style={styles.iconBtn}
          accessibilityLabel="Configurações de exibição e voz"
        >
          <MaterialIcons name="tune" size={20} color="#b388ff" />
        </TouchableOpacity>

        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, { backgroundColor: statusConfig.color }]} />
          <Text translatable style={[styles.statusText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
        </View>
      </View>

      {/* CÂMERA + OVERLAY */}
      <View style={[styles.cameraContainer, { width: CAM_WIDTH, height: CAM_HEIGHT }]}>
        {hasPermission && device ? (
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            format={format}
            isActive={true}
            pixelFormat="rgb"
            frameProcessor={modelStatus === "ready" ? frameProcessor : undefined}
          />
        ) : (
          <View style={styles.permissionBox}>
            <MaterialIcons name="videocam-off" size={48} color="#888" />
            <Text translatable style={styles.warn}>{t('cam.permission_waiting')}</Text>
          </View>
        )}

        {showLandmarks && (
          <LandmarkOverlay
            hands={landmarks}
            pose={poseLandmarks}
            face={faceLandmarks}
            cover={cover}
          />
        )}

        {gesture && (
          <View style={styles.gestureOverlay}>
            <Text translatable style={styles.gestureLabel}>{gesture}</Text>
            <View style={styles.confidencePill}>
              <Text translatable style={styles.confidenceText}>{(confidence * 100).toFixed(0)}%</Text>
            </View>
          </View>
        )}

        <View style={styles.edgeBadge}>
          <MaterialIcons name="developer-board" size={12} color={modelStatus === "ready" ? "#00e5ff" : "#ff6b6b"} />
          <Text translatable style={[styles.edgeBadgeText, modelStatus !== "ready" && { color: "#ff6b6b" }]}>
            {modelStatus === "ready" ? t('cam.edge_ready') : t('cam.edge_error')}
          </Text>
        </View>

        {activeModelName && (
          <View style={styles.modelBadge}>
            <MaterialIcons name="psychology" size={12} color="#b388ff" />
            <Text translatable style={styles.modelBadgeText} numberOfLines={1}>{activeModelName}</Text>
          </View>
        )}

        {speechPrefs.spellingEnabled && speechPrefs.enabled && (
          <SpellingPanel
            isSpelling={spelling.isSpelling}
            buffer={spelling.buffer}
            candidate={spelling.candidate}
            lastSpokenWord={lastSpokenWord}
            letterStableMs={speechPrefs.letterStableMs}
            onFinalize={spelling.finalize}
            onClear={spelling.clear}
            onAdjustStable={adjustStable}
          />
        )}

        {modelStatus === "error" && (
          <View style={styles.modelErrorBanner}>
            <MaterialIcons name="error" size={20} color="#ff6b6b" />
            <View style={{ flex: 1 }}>
              <Text translatable style={styles.modelErrorTitle}>{t('cam.edge_unavailable')}</Text>
              <Text translatable style={styles.modelErrorDesc} numberOfLines={2}>
                {modelError || t('cam.edge_unavailable_desc')}
              </Text>
            </View>
          </View>
        )}

        {apiError && (
          <View style={styles.errorBanner}>
            <MaterialIcons name="error-outline" size={16} color="#ff6b6b" />
            <Text translatable style={styles.errorText} numberOfLines={2}>{apiError}</Text>
          </View>
        )}

        {showLandmarks && landmarks.length === 0 && hasPermission && !apiError && (
          <View style={styles.noHandBadge}>
            <MaterialIcons name="pan-tool" size={14} color="#888" />
            <Text translatable style={styles.noHandText}>{t('cam.no_hand')}</Text>
          </View>
        )}
      </View>

      {/* MODAL SELEÇÃO DE MODO */}
      <Modal transparent visible={showModeModal} animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <MaterialIcons name="memory" size={28} color="#00e5ff" />
              <Text translatable style={styles.modalTitle}>{t('cam.mode_title')}</Text>
            </View>
            <Text translatable style={styles.modalSubtitle}>
              {t('cam.mode_subtitle')}
            </Text>

            {availableModes.map((mode) => {
              const isActive = detectionMode === mode.key;
              return (
                <TouchableOpacity
                  key={mode.key}
                  style={[styles.modeOption, isActive && styles.modeOptionActive]}
                  onPress={() => changeMode(mode.key)}
                  activeOpacity={0.7}
                >
                  <View style={styles.modeOptionLeft}>
                    <MaterialIcons
                      name={mode.icon as any}
                      size={22}
                      color={isActive ? "#00e5ff" : "#888"}
                    />
                    <View>
                      <Text style={[styles.modeLabel, isActive && styles.modeLabelActive]}>
                        {t(`cam.mode_${mode.key}`)}
                      </Text>
                      <Text style={styles.modeDesc}>{t(`cam.mode_${mode.key}_desc`)}</Text>
                    </View>
                  </View>
                  {isActive && (
                    <View style={styles.activeDotOuter}>
                      <View style={styles.activeDotInner} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowModeModal(false)}>
              <Text style={styles.modalCloseBtnText}>{t('cam.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL DE LANDMARKS EXIBIDOS */}
      {/* MODAL ÚNICO DE CONFIGURAÇÕES (abas Exibição + Voz) */}
      <VoiceSettingsModal
        visible={showSpeechModal}
        initialTab={settingsTab}
        prefs={speechPrefs}
        showLandmarks={showLandmarks}
        onToggleShowLandmarks={(next) => {
          setShowLandmarks(next);
          AsyncStorage.setItem("config_show_landmarks", String(next));
        }}
        holisticEnabled={holisticEnabled}
        onToggleHolistic={(next) => {
          setHolisticEnabled(next);
          AsyncStorage.setItem("config_holistic_enabled", String(next));
        }}
        onClose={() => setShowSpeechModal(false)}
        onToggleEnabled={toggleSpeech}
        onToggleSpeakGestures={toggleSpeakGestures}
        onToggleSpelling={toggleSpellingEnabled}
        onAdjustIdle={adjustIdle}
        onAdjustStable={adjustStable}
        onAdjustConfidence={adjustConfidence}
        onSetLanguage={setSpeechLanguage}
        onTestVoice={testVoice}
      />
    </View>
  );
}

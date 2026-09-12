/**
 * Bridge TypeScript para o plugin nativo HandLandmarker.
 *
 * Usa o MediaPipe Tasks SDK no Android via Frame Processor Plugin
 * do VisionCamera para detectar os 21 landmarks da mão localmente.
 *
 * Retorna coordenadas normalizadas [0, 1] para cada ponto,
 * além da classificação de lateralidade (Left/Right).
 *
 * @see https://github.com/CarlosEduFF/expo-vision-camera-v4-mediapipe
 */

import { VisionCameraProxy, Frame } from "react-native-vision-camera";

// Re-exporta tipos do plugin para uso no app
export type {
  HandLandmark as LandmarkPoint,
  HandDetectionResult as HandLandmarkResult,
  // Resultado holístico (mãos + corpo + rosto). Mesmo shape de
  // HandDetectionResult, com pose/face populados quando enablePose/enableFace
  // estão ligados no app.json.
  HolisticDetectionResult,
  HandednessCategory,
  PoseLandmark,
  FaceLandmark,
} from "expo-vision-camera-v4-mediapipe";

export { HandLandmarkIndex, PoseLandmarkIndex } from "expo-vision-camera-v4-mediapipe";

// ── Estado do plugin ──────────────────────────────────
let plugin: ReturnType<typeof VisionCameraProxy.initFrameProcessorPlugin> | null = null;
let pluginError: string | null = null;

try {
  plugin = VisionCameraProxy.initFrameProcessorPlugin("handLandmarker", {});
  if (!plugin) {
    pluginError = "Plugin 'handLandmarker' retornou null. Verifique se o build nativo inclui o HandLandmarkerPlugin.";
  }
} catch (e: any) {
  pluginError = e.message || "Erro desconhecido ao inicializar o plugin HandLandmarker.";
}

/**
 * Retorna o estado atual do plugin nativo.
 * Seguro para chamar a qualquer momento no thread JS.
 * NÃO é um worklet — use apenas na UI.
 */
export function getPluginStatus(): { ready: boolean; error: string | null } {
  return {
    ready: plugin !== null && pluginError === null,
    error: pluginError,
  };
}

/**
 * Executa a detecção de landmarks da mão no frame da câmera.
 *
 * DEVE ser chamado dentro de um useFrameProcessor (worklet).
 *
 * @param frame - Frame da câmera do VisionCamera
 * @returns Resultado com os landmarks, handedness, ou null se o plugin não carregou
 */
export function detectHandLandmarks(
  frame: Frame,
  options?: { pose?: boolean; face?: boolean },
): import("expo-vision-camera-v4-mediapipe").HolisticDetectionResult | null {
  "worklet";

  if (plugin == null) {
    // Retorna null silenciosamente em vez de lançar exceção.
    // O código JS pode verificar via getPluginStatus().
    return null;
  }

  // `options` desliga canais POR FRAME, pulando a inferência no nativo — não
  // apenas descartando o resultado aqui. É o que torna o modo "só mãos"
  // realmente mais barato: pose e rosto respondem por boa parte do tempo de
  // inferência, e em aparelhos fracos isso decide se o app é usável.
  // Omitir o argumento mantém os dois ligados (comportamento anterior); os
  // canais só existem se enablePose/enableFace estiverem no app.json.
  const result = (options
    ? plugin.call(frame, {
        pose: options.pose !== false,
        face: options.face !== false,
      })
    : plugin.call(frame)) as unknown as import("expo-vision-camera-v4-mediapipe").HolisticDetectionResult | null;
  return result;
}

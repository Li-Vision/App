/**
 * Montagem do payload holístico (mãos + corpo + rosto) enviado à API.
 *
 * Centraliza duas coisas que antes estavam duplicadas inline em cada tela
 * (cam, collect-static, collect-dynamic):
 *
 *  1. `transformPoint` — rotação/espelhamento aplicado aos landmarks da câmera
 *     frontal. DEVE ser idêntico para mãos, pose e face, senão os canais ficam
 *     em referenciais diferentes e o vetor de features no servidor fica
 *     inconsistente.
 *
 *  2. `buildPayload` — decide a *forma* do que vai pela WebSocket:
 *       - schema "hands_v1"    → array cru de mãos  `[[{x,y,z}×21], ...]`
 *       - schema "holistic_v1" → objeto `{ hands, pose, face }`
 *
 * O backend detecta o schema pela forma do payload (lista = hands_v1,
 * objeto = holistic_v1) e seleciona internamente os subconjuntos de pose/face
 * (POSE_INDICES / FACE_INDICES). Por isso o app envia pose/face COMPLETOS
 * (33 e 478 pontos) — NÃO pré-filtrar aqui, ou os índices do servidor não
 * baterão.
 *
 * @see ../../Li-Vision/src/api/holistic.py (parse_input)
 * @see ../../Li-Vision/src/data_collection/holistic_features.py
 */

import type {
  LandmarkPoint,
  PoseLandmark,
  FaceLandmark,
  HolisticDetectionResult,
} from "@/services/handLandmarkerPlugin";

export type FeatureSchema = "hands_v1" | "holistic_v1";

/** Mão / face transformadas: {x,y,z}. Pose mantém também visibility. */
export type TPoint = { x: number; y: number; z: number };
export type TPosePoint = TPoint & { visibility: number };

export type HolisticPayload =
  | TPoint[][] // hands_v1 — array cru de mãos (formato legado)
  | {
      hands: TPoint[][];
      pose?: TPosePoint[];
      face?: TPoint[];
    };

/**
 * Espelhamento horizontal para a câmera frontal.
 *
 * O plugin nativo (expo-vision-camera-v4-mediapipe >= 1.2.1) já corrige a
 * rotação do frame via ImageProcessingOptions antes de detectar, então os
 * landmarks chegam aqui já "em pé". Só falta o espelho horizontal típico de
 * câmera frontal (efeito selfie). Aplicar a antiga troca de eixos X⇄Y por
 * cima re-rotacionaria os pontos incorretamente — ver CHANGELOG do plugin.
 * Preserva z. Aplicada a TODOS os canais para mantê-los no mesmo referencial.
 *
 * Nota: é um worklet-safe puro (sem captura), então pode ser chamado tanto no
 * thread JS quanto repassado a partir de resultados já trazidos pelo runOnJS.
 */
export function transformPoint<T extends { x: number; y: number; z?: number; visibility?: number }>(
  lm: T,
): TPoint & { visibility?: number } {
  const out: TPoint & { visibility?: number } = { x: 1.0 - lm.x, y: lm.y, z: lm.z ?? 0 };
  // visibility é invariante ao espelhamento e o overlay filtra por ela: se for
  // descartada aqui, todo ponto de pose vira visibility=0 e some da tela.
  if (typeof lm.visibility === "number") out.visibility = lm.visibility;
  return out;
}

/**
 * Geometria de um "osso" do esqueleto desenhado como uma View retangular.
 *
 * Uma View com `transform: [{rotate}]` gira em torno do PRÓPRIO CENTRO, então
 * a barra tem de ser posicionada centrada no ponto médio entre as duas
 * articulações. A tentativa de compensar com um par de `translateX(±len/2)` em
 * volta do `rotate` não funciona (os transforms se aplicam da direita para a
 * esquerda e o resultado é um deslocamento de len/2): ossos curtos, como os
 * dos dedos, saíam quase certos e ossos longos, como os do tronco, saíam
 * visivelmente fora do corpo.
 */
export function boneStyle(
  ax: number, ay: number, bx: number, by: number, thickness: number,
): { left: number; top: number; width: number; height: number; angle: number } {
  const width = Math.hypot(bx - ax, by - ay);
  const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  return {
    left: (ax + bx) / 2 - width / 2,
    top: (ay + by) / 2 - thickness / 2,
    width,
    height: thickness,
    angle,
  };
}

/** Mapeia coordenadas normalizadas [0,1] para pixels do preview. */
export type CoverMapper = {
  toX: (x: number) => number;
  toY: (y: number) => number;
};

/**
 * Cria o mapeador normalizado→pixels que compensa o crop do preview.
 *
 * O <Camera> do VisionCamera usa resizeMode "cover": a imagem é escalada até
 * PREENCHER a view e o excedente é cortado (centralizado). Multiplicar as
 * coordenadas normalizadas direto por viewW/viewH (o que o overlay fazia
 * antes) assume resizeMode "stretch" e desalinha tudo que está longe do
 * centro — era uma das razões de o esqueleto não acompanhar o corpo.
 *
 * `frame` são as dimensões da imagem EM PÉ usada na inferência, devolvidas
 * pelo plugin nativo em `imageWidth`/`imageHeight`. Sem elas (build nativo
 * antigo), cai no comportamento anterior de esticar.
 */
export function makeCoverMapper(
  frame: { width: number; height: number } | null | undefined,
  viewW: number,
  viewH: number,
): CoverMapper {
  if (!frame || frame.width <= 0 || frame.height <= 0 || viewW <= 0 || viewH <= 0) {
    return { toX: (x) => x * viewW, toY: (y) => y * viewH };
  }
  const scale = Math.max(viewW / frame.width, viewH / frame.height);
  const dispW = frame.width * scale;
  const dispH = frame.height * scale;
  const offX = (dispW - viewW) / 2;
  const offY = (dispH - viewH) / 2;
  return { toX: (x) => x * dispW - offX, toY: (y) => y * dispH - offY };
}

function transformHands(hands: LandmarkPoint[][]): TPoint[][] {
  return hands.map((hand) => hand.map(transformPoint));
}

function transformPose(pose: PoseLandmark[]): TPosePoint[] {
  return pose.map((lm) => ({
    ...transformPoint(lm),
    // visibility é uma probabilidade do ponto, invariante à rotação 2D.
    // Quando o plugin não informa (Optional vazio no MediaPipe Tasks), o vetor
    // de features usa 1 — "presente" — em vez de 0. Zerar aqui ensinaria o
    // modelo que todo ponto de pose é invisível, tornando o canal inútil.
    visibility: lm.visibility ?? 1,
  }));
}

/**
 * Um frame de pose é plausível?
 *
 * O PoseLandmarker (BlazePose) nunca "não responde": sem um corpo reconhecível
 * no enquadramento ele devolve os 33 pontos mesmo assim, com um palpite ruim —
 * pontos espalhados que o overlay desenha como linhas atravessando a tela.
 * Como `visibility` frequentemente não vem preenchida, ela não serve de filtro;
 * a checagem precisa ser geométrica.
 *
 * Critérios (em coordenadas normalizadas, todos folgados de propósito para não
 * descartar poses válidas de perfil ou parcialmente cortadas):
 *  - ombros dentro do quadro e separados por uma distância crível;
 *  - ombros aproximadamente nivelados (tolera inclinação de tronco);
 *  - cabeça acima da linha dos ombros.
 */
export function isPosePlausible(pose: { x: number; y: number }[] | null | undefined): boolean {
  if (!pose || pose.length < 33) return false;

  const NOSE = 0, L_SHOULDER = 11, R_SHOULDER = 12;
  const ls = pose[L_SHOULDER];
  const rs = pose[R_SHOULDER];
  const nose = pose[NOSE];
  if (!ls || !rs || !nose) return false;

  const inFrame = (p: { x: number; y: number }) =>
    Number.isFinite(p.x) && Number.isFinite(p.y) &&
    p.x >= -0.15 && p.x <= 1.15 && p.y >= -0.15 && p.y <= 1.15;
  if (!inFrame(ls) || !inFrame(rs) || !inFrame(nose)) return false;

  // Largura dos ombros: estreita demais = pontos colapsados; larga demais =
  // pontos jogados em cantos opostos da imagem.
  const shoulderSpan = Math.abs(ls.x - rs.x);
  if (shoulderSpan < 0.06 || shoulderSpan > 0.95) return false;

  // Ombros não podem estar quase na vertical um do outro.
  if (Math.abs(ls.y - rs.y) > shoulderSpan * 1.6) return false;

  // A cabeça fica acima dos ombros (y cresce para baixo).
  if (nose.y > Math.min(ls.y, rs.y) + 0.06) return false;

  return true;
}

function transformFace(face: FaceLandmark[]): TPoint[] {
  return face.map(transformPoint);
}

/**
 * Monta o payload pronto para `gestureWS.sendHolistic()` / `sendLandmarks()`.
 *
 * @param result  Resultado holístico cru vindo do plugin (pode ter pose/face).
 * @param schema  "holistic_v1" envia o objeto completo; "hands_v1" envia só o
 *                array de mãos (compat total com datasets/modelos antigos).
 * @returns       Payload já transformado, ou `null` se não há mãos detectadas.
 */
export function buildPayload(
  result: HolisticDetectionResult,
  schema: FeatureSchema,
): HolisticPayload | null {
  const rawHands = result?.hands ?? [];
  if (rawHands.length === 0) return null;

  const hands = transformHands(rawHands);

  if (schema === "hands_v1") {
    // Formato legado: array cru de mãos. O backend o lê como hands_v1.
    return hands;
  }

  // holistic_v1: objeto com canais opcionais. pose/face só entram se o plugin
  // os detectou neste frame (podem faltar mesmo com os canais habilitados).
  const payload: { hands: TPoint[][]; pose?: TPosePoint[]; face?: TPoint[] } = { hands };
  if (result.pose && result.pose.length > 0) payload.pose = transformPose(result.pose);
  if (result.face && result.face.length > 0) payload.face = transformFace(result.face);
  return payload;
}

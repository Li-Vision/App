/**
 * Reconstrói os pontos da mão a partir das features GRAVADAS de uma amostra
 * (o vetor que o servidor guarda em `samples` / `samples_quarantine`), para
 * desenhar o gesto na revisão da quarentena.
 *
 * Formatos (ver API/src/data_collection/holistic_features.py):
 *  - 42          estático "só mãos": 21 × (x, y) relativos à caixa da mão.
 *  - 269         estático holístico: 2 mãos × 65 (pulso absoluto x,y +
 *                21 × (dx, dy, z) relativos ao pulso) + pose + rosto.
 *  - N × 269 / N × 130   dinâmico: N frames no mesmo layout de mãos.
 *
 * Pose e rosto ficam de fora: são gravados relativos aos ombros/ao centro do
 * rosto, sem posição absoluta para alinhar com as mãos.
 */
import type { TPoint } from "@/services/holisticFeatures";

export type GestureFrame = { hands: TPoint[][] };

export type DecodedGesture = {
  frames: GestureFrame[];
  /** "box" = 42 features, coordenadas relativas à caixa da mão (sem posição na tela). */
  layout: "box" | "image";
};

const HAND = 65;
const HOLISTIC_FRAME = 269;
const HANDS_FRAME = 130;
/** Largura/altura da imagem em pé usada na coleta (480/640), igual ao servidor. */
const DEFAULT_ASPECT = 0.75;

function handFromBlock(block: number[]): TPoint[] | null {
  if (block.length < HAND || !block.some((v) => v !== 0)) return null; // mão ausente
  const [wx, wy] = block;
  const pts: TPoint[] = [];
  for (let i = 0; i < 21; i++) {
    const o = 2 + i * 3;
    pts.push({ x: (wx + block[o]) * DEFAULT_ASPECT, y: wy + block[o + 1], z: block[o + 2] });
  }
  return pts;
}

function frameFromVector(vec: number[]): GestureFrame {
  const hands: TPoint[][] = [];
  for (let h = 0; h < 2; h++) {
    const hand = handFromBlock(vec.slice(h * HAND, (h + 1) * HAND));
    if (hand) hands.push(hand);
  }
  return { hands };
}

export function decodeGesture(features: unknown): DecodedGesture | null {
  if (!Array.isArray(features) || features.length === 0) return null;
  const vec = features.map(Number);
  if (vec.some((v) => !Number.isFinite(v))) return null;

  if (vec.length === 42) {
    const hand: TPoint[] = [];
    for (let i = 0; i < 21; i++) hand.push({ x: vec[i * 2], y: vec[i * 2 + 1], z: 0 });
    return { frames: [{ hands: [hand] }], layout: "box" };
  }
  if (vec.length === HOLISTIC_FRAME) {
    return { frames: [frameFromVector(vec)], layout: "image" };
  }
  for (const size of [HOLISTIC_FRAME, HANDS_FRAME]) {
    if (vec.length % size === 0 && vec.length / size >= 2) {
      const frames: GestureFrame[] = [];
      for (let i = 0; i < vec.length; i += size) frames.push(frameFromVector(vec.slice(i, i + size)));
      return { frames, layout: "image" };
    }
  }
  return null;
}

/**
 * Mapeador que enquadra TODOS os frames num quadro de `w × h` px, mantendo a
 * proporção. O mesmo enquadramento vale para a sequência inteira, então o
 * deslocamento da mão entre frames continua visível.
 */
export function fitMapper(gesture: DecodedGesture, w: number, h: number, pad = 0.12) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of gesture.frames) {
    for (const hand of f.hands) {
      for (const p of hand) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
    }
  }
  if (!Number.isFinite(minX)) return { toX: (x: number) => x * w, toY: (y: number) => y * h };
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((w * (1 - 2 * pad)) / spanX, (h * (1 - 2 * pad)) / spanY);
  const offX = (w - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;
  return {
    toX: (x: number) => offX + (x - minX) * scale,
    toY: (y: number) => offY + (y - minY) * scale,
  };
}

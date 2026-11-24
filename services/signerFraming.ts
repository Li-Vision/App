/**
 * Enquadramento de quem sinaliza para a câmera traseira (sem retreinar).
 *
 * Os modelos foram treinados com a câmera frontal, com a pessoa perto (selfie).
 * Medido nas amostras do Supabase em 22/11/2026 (BASICO_HOLISTICO e
 * ALFABETO_FORMA_MAO, ~16 mil frames):
 *   - largura dos ombros ~ 0,387 da ALTURA da imagem (p10-p90: 0,35-0,46);
 *   - centro dos ombros em (0,47; 0,62) da imagem.
 *
 * Com a traseira, a pessoa fica longe e pequena. O modelo estático (letras) não
 * sofre, porque divide a forma da mão pelo tamanho dela. Já o dinâmico usa
 * coordenadas sem normalizar a escala (pulso absoluto, mão relativa ao pulso,
 * pose relativa aos ombros, rosto relativo ao centróide): de longe todos os
 * valores encolhem e o gesto não se parece com o do treino.
 *
 * Aqui se faz um "recorte virtual": um zoom digital em volta da pessoa que
 * deixa os ombros do tamanho e na posição do treino. Matematicamente é o mesmo
 * que recortar a imagem antes do MediaPipe, porque os landmarks são coordenadas
 * normalizadas. Como a imagem tem só 640x480, um recorte real não acrescentaria
 * pixels.
 *
 *   x' = TRAIN_CX + (x - cx) * s      y' = TRAIN_CY + (y - cy) * s      z' = z * s
 *
 * A mesma janela limita o campo visual: mãos fora dela (fora do que seria o
 * quadro do treino) ou longe dos pulsos de quem sinaliza são descartadas, o
 * que mantém o foco em uma pessoa.
 *
 * Todas as coordenadas aqui estão no espaço ESPELHADO (o do payload, saído de
 * transformPoint), que é o do treino.
 */
import type { TPoint, TPosePoint } from "@/services/holisticFeatures";

/** Ponto com visibility opcional (pose tem; mão e rosto, não). */
type VPoint = TPoint & { visibility?: number };

export const TRAIN_SHOULDER = 0.387;
export const TRAIN_CX = 0.47;
export const TRAIN_CY = 0.62;

/** Acima disso a pessoa está longe demais: a mão tem poucos pixels. */
export const MAX_SCALE = 4;
/** Só amplia: perto (s < 1) já é o caso do treino. */
const MIN_SCALE = 1;
/** Suavização por frame. Variar a escala de um frame para o outro viraria
 *  "movimento" falso para o detector dinâmico (portão de movimento do híbrido). */
const SMOOTHING = 0.2;
/** Sem pose por mais que isto, perde a pessoa. */
const LOST_MS = 1000;
/** Mão a mais de N larguras de ombro do pulso mais próximo não é de quem sinaliza. */
const HAND_TO_WRIST_MAX = 0.4;
/** Folga da janela (unidades do quadro de treino). */
const WINDOW_MARGIN = 0.1;

// ── Tamanho da mão: quem está atrás aparece menor ──────────────────────────
// Medido nas amostras do Supabase em 24/11/2026 (BASICO_HOLISTICO e
// ALFABETO_HOLISTICO, 16.743 frames, dos quais 2.124 com as duas mãos), com o
// tamanho dado por handScale (maior osso da palma em 3D):
//   - menor/maior entre as duas mãos da MESMA pessoa: p0,5 = 0,53, p1 = 0,59;
//   - tamanho da mão / largura dos ombros: p0,5 = 0,25, p1 = 0,27.
// Os cortes abaixo ficam sob o p0,5, então quase nunca descartam a mão de quem
// sinaliza, e pegam a mão de alguém a partir de ~2x a distância dela.
// Com um só osso (pulso→dedo médio, em 2D) a mão girada encurtava tanto que a
// menor/maior da mesma pessoa caía a 0,22 no p0,5: não servia de régua.

/** Abaixo disso a mão menor é de outra pessoa, mais longe da câmera. */
export const SAME_SIGNER_MIN_RATIO = 0.5;
/** Abaixo disso (em larguras de ombro de quem sinaliza) a mão é de alguém mais longe. */
export const HAND_TO_SHOULDER_MIN = 0.2;
/** Ossos da palma: o maior deles quase não encurta quando a mão gira. */
const PALM_BONES: [number, number][] = [[0, 5], [0, 17], [5, 17], [0, 9], [5, 9], [9, 13], [13, 17], [0, 1]];

/**
 * Por que uma mão conta ou não como de quem sinaliza:
 * - signer: conta;
 * - outside: fora do campo visual (fora do quadro equivalente ao do treino);
 * - too_small: pequena demais para os ombros de quem sinaliza;
 * - smaller: bem menor que a outra mão do frame;
 * - far_from_wrist: longe dos pulsos da pose de quem sinaliza.
 */
export type HandVerdict = "signer" | "outside" | "too_small" | "smaller" | "far_from_wrist";

/**
 * Tamanho da mão em unidades de altura da imagem: o maior osso da palma em 3D
 * (x e z corrigidos pela proporção da imagem, como em shoulderWidth).
 */
export function handScale(hand: TPoint[], aspect: number): number {
  let max = 0;
  for (const [a, b] of PALM_BONES) {
    const p = hand[a], q = hand[b];
    if (!p || !q) continue;
    const d = Math.hypot((p.x - q.x) * aspect, p.y - q.y, ((p.z ?? 0) - (q.z ?? 0)) * aspect);
    if (d > max) max = d;
  }
  return max;
}

/**
 * Veredito só pelo tamanho relativo entre as mãos do frame. É o que sobra
 * quando não há pose (holístico desligado, ou a pessoa sem ombros no quadro).
 */
export function sameSignerVerdicts(hands: TPoint[][], aspect: number): HandVerdict[] {
  const scales = hands.map((h) => handScale(h, aspect));
  const biggest = Math.max(0, ...scales);
  return scales.map((s) => (s < SAME_SIGNER_MIN_RATIO * biggest ? "smaller" : "signer"));
}

const L_SHOULDER = 11, R_SHOULDER = 12, L_WRIST = 15, R_WRIST = 16;

export type Framing = {
  /** Centro dos ombros na imagem (espaço espelhado). */
  cx: number;
  cy: number;
  /** Fator de zoom aplicado (>= 1). */
  scale: number;
  /** Largura dos ombros medida, em unidades de altura da imagem. */
  shoulder: number;
};

export type FramingStatus = "ok" | "no_person" | "too_far";

export type HolisticObjectPayload = {
  hands: TPoint[][];
  pose?: TPosePoint[];
  face?: TPoint[];
  aspect?: number;
};

const visible = (p?: { visibility?: number }) => !!p && (p.visibility ?? 1) >= 0.5;

/** Largura dos ombros em unidades de altura (corrige a proporção da imagem). */
export function shoulderWidth(pose: VPoint[], aspect: number): number | null {
  const a = pose[L_SHOULDER], b = pose[R_SHOULDER];
  if (!a || !b || !visible(a) || !visible(b)) return null;
  const w = Math.hypot((b.x - a.x) * aspect, b.y - a.y);
  return w > 1e-3 ? w : null;
}

export function applyFraming<T extends TPoint>(p: T, f: Framing): T {
  return {
    ...p,
    x: TRAIN_CX + (p.x - f.cx) * f.scale,
    y: TRAIN_CY + (p.y - f.cy) * f.scale,
    z: (p.z ?? 0) * f.scale,
  };
}

/**
 * Região da imagem real (espaço espelhado) que corresponde ao quadro inteiro
 * do treino. É o "campo visual" desenhado no overlay.
 */
export function framingWindow(f: Framing): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: f.cx + (0 - TRAIN_CX) / f.scale,
    x1: f.cx + (1 - TRAIN_CX) / f.scale,
    y0: f.cy + (0 - TRAIN_CY) / f.scale,
    y1: f.cy + (1 - TRAIN_CY) / f.scale,
  };
}

/**
 * Veredito de cada mão, na ordem recebida. Conta como de quem sinaliza a mão
 * que está no campo visual, tem o tamanho de uma mão dessa pessoa (pelos
 * ombros e pela outra mão) e, quando a pose vê os pulsos, fica perto de um deles.
 *
 * O tamanho vem antes dos pulsos de propósito: o MediaPipe quase nunca informa
 * a visibilidade da pose, então o pulso do braço abaixado é uma estimativa que
 * conta como visível. A mão de alguém atrás que caia perto desse pulso passaria
 * só pelo teste do pulso, mas é bem menor que a de quem sinaliza.
 * Recebe coordenadas da imagem real.
 */
export function classifySignerHands(
  hands: TPoint[][],
  pose: VPoint[],
  f: Framing,
  aspect: number,
): HandVerdict[] {
  const wrists: VPoint[] = [pose[L_WRIST], pose[R_WRIST]].filter(visible);
  const lo = -WINDOW_MARGIN, hi = 1 + WINDOW_MARGIN;
  const scales = hands.map((h) => handScale(h, aspect));

  // 1ª passada: campo visual e tamanho em relação aos ombros.
  const verdicts: HandVerdict[] = hands.map((hand, i) => {
    const w = hand[0];
    if (!w) return "outside";
    const fw = applyFraming(w, f);
    if (fw.x < lo || fw.x > hi || fw.y < lo || fw.y > hi) return "outside";
    if (scales[i] < HAND_TO_SHOULDER_MIN * f.shoulder) return "too_small";
    return "signer";
  });

  // 2ª passada: entre as que sobraram, a bem menor é de outra pessoa.
  const biggest = Math.max(0, ...scales.filter((_, i) => verdicts[i] === "signer"));
  return verdicts.map((v, i) => {
    if (v !== "signer") return v;
    if (scales[i] < SAME_SIGNER_MIN_RATIO * biggest) return "smaller";
    if (wrists.length === 0) return "signer";
    const w = hands[i][0];
    const d = Math.min(...wrists.map((p) => Math.hypot((p.x - w.x) * aspect, p.y - w.y)));
    return d <= HAND_TO_WRIST_MAX * f.shoulder ? "signer" : "far_from_wrist";
  });
}

/**
 * Tira do payload (hands_v1 ou holístico) as mãos marcadas em `rejected`, na
 * mesma ordem. Devolve null se não sobrar nenhuma.
 */
export function keepSignerHands<P extends TPoint[][] | HolisticObjectPayload>(payload: P, rejected: boolean[]): P | null {
  if (!rejected.some(Boolean)) return payload;
  if (Array.isArray(payload)) {
    const hands = payload.filter((_, i) => !rejected[i]);
    return hands.length > 0 ? (hands as P) : null;
  }
  const hands = payload.hands.filter((_, i) => !rejected[i]);
  return hands.length > 0 ? { ...payload, hands } : null;
}

/** Só as mãos de quem sinaliza (ver classifySignerHands). */
export function selectSignerHands(
  hands: TPoint[][],
  pose: VPoint[],
  f: Framing,
  aspect: number,
): TPoint[][] {
  const verdicts = classifySignerHands(hands, pose, f, aspect);
  return hands.filter((_, i) => verdicts[i] === "signer");
}

/**
 * Acompanha quem sinaliza entre frames (escala e centro suavizados) e
 * reenquadra o payload. Uma instância por tela; `reset()` ao trocar de câmera.
 */
export class SignerFramer {
  private state: Framing | null = null;
  private lastSeen = 0;

  reset(): void {
    this.state = null;
    this.lastSeen = 0;
  }

  get current(): Framing | null {
    return this.state;
  }

  /**
   * Atualiza com a pose do frame (já espelhada e filtrada por plausibilidade;
   * vazia se não houver). Devolve o status do enquadramento.
   */
  observe(pose: VPoint[], aspect: number, now: number): FramingStatus {
    const sw = pose.length > 0 ? shoulderWidth(pose, aspect) : null;
    if (sw === null) {
      if (this.state && now - this.lastSeen <= LOST_MS) return this.statusOf(this.state);
      this.state = null;
      return "no_person";
    }
    const a = pose[L_SHOULDER], b = pose[R_SHOULDER];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const raw = TRAIN_SHOULDER / sw;
    this.lastSeen = now;
    if (raw > MAX_SCALE) {
      this.state = { cx, cy, scale: raw, shoulder: sw };
      return "too_far";
    }
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
    const prev = this.state;
    this.state = prev && prev.scale <= MAX_SCALE
      ? {
          cx: prev.cx + (cx - prev.cx) * SMOOTHING,
          cy: prev.cy + (cy - prev.cy) * SMOOTHING,
          scale: prev.scale + (scale - prev.scale) * SMOOTHING,
          shoulder: prev.shoulder + (sw - prev.shoulder) * SMOOTHING,
        }
      : { cx, cy, scale, shoulder: sw };
    return "ok";
  }

  /**
   * Veredito de cada mão do frame (coordenadas da imagem real, espelhadas).
   * Com a pessoa enquadrada usa campo visual, ombros, tamanho e pulsos; sem
   * enquadramento (sem pose, longe demais ou holístico desligado) sobra o
   * tamanho relativo entre as mãos.
   */
  verdicts(hands: TPoint[][], pose: VPoint[], status: FramingStatus | null, aspect: number): HandVerdict[] {
    const f = this.state;
    if (status === "ok" && f && pose.length > 0) return classifySignerHands(hands, pose, f, aspect);
    return sameSignerVerdicts(hands, aspect);
  }

  private statusOf(f: Framing): FramingStatus {
    return f.scale > MAX_SCALE ? "too_far" : "ok";
  }

  /**
   * Reenquadra um payload holístico. Devolve null quando não há o que enviar:
   * sem pessoa, longe demais, ou nenhuma mão de quem sinaliza.
   */
  frame(payload: HolisticObjectPayload, status: FramingStatus): HolisticObjectPayload | null {
    const f = this.state;
    if (status !== "ok" || !f || !payload.pose) return null;
    const aspect = payload.aspect ?? 0.75;
    const hands = selectSignerHands(payload.hands, payload.pose, f, aspect);
    if (hands.length === 0) return null;
    return {
      ...payload,
      hands: hands.map((h) => h.map((p) => applyFraming(p, f))),
      pose: payload.pose.map((p) => applyFraming(p, f)),
      face: payload.face?.map((p) => applyFraming(p, f)),
    };
  }
}

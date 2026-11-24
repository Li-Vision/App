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
 * Mantém só as mãos de quem sinaliza: dentro da janela e (quando a pose vê os
 * pulsos) perto de um deles. Recebe e devolve coordenadas da imagem real.
 */
export function selectSignerHands(
  hands: TPoint[][],
  pose: VPoint[],
  f: Framing,
  aspect: number,
): TPoint[][] {
  const wrists: VPoint[] = [pose[L_WRIST], pose[R_WRIST]].filter(visible);
  const lo = -WINDOW_MARGIN, hi = 1 + WINDOW_MARGIN;
  return hands.filter((hand) => {
    const w = hand[0];
    if (!w) return false;
    const fw = applyFraming(w, f);
    if (fw.x < lo || fw.x > hi || fw.y < lo || fw.y > hi) return false;
    if (wrists.length === 0) return true;
    const d = Math.min(...wrists.map((p) => Math.hypot((p.x - w.x) * aspect, p.y - w.y)));
    return d <= HAND_TO_WRIST_MAX * f.shoulder;
  });
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

import {
  SignerFramer, applyFraming, framingWindow, selectSignerHands, shoulderWidth,
  TRAIN_SHOULDER, TRAIN_CX, TRAIN_CY, MAX_SCALE,
} from '../signerFraming';

const ASPECT = 0.75; // 480x640 em pé
const L_SH = 11, R_SH = 12, L_WR = 15, R_WR = 16;

type P = { x: number; y: number; z: number; visibility: number };

/**
 * Pessoa "como no treino": ombros com largura TRAIN_SHOULDER (em altura) e
 * centro em (TRAIN_CX, TRAIN_CY); pulsos abaixo dos ombros; uma mão no pulso
 * esquerdo.
 */
function nearPerson() {
  const half = TRAIN_SHOULDER / 2 / ASPECT; // meia largura em unidades de x
  const pose: P[] = Array.from({ length: 33 }, () => ({ x: TRAIN_CX, y: TRAIN_CY, z: 0, visibility: 1 }));
  pose[L_SH] = { x: TRAIN_CX - half, y: TRAIN_CY, z: 0, visibility: 1 };
  pose[R_SH] = { x: TRAIN_CX + half, y: TRAIN_CY, z: 0, visibility: 1 };
  pose[L_WR] = { x: TRAIN_CX - half * 0.6, y: TRAIN_CY + 0.25, z: -0.1, visibility: 1 };
  pose[R_WR] = { x: TRAIN_CX + half * 0.6, y: TRAIN_CY + 0.25, z: -0.1, visibility: 1 };
  const hand: P[] = Array.from({ length: 21 }, (_, i) => ({
    x: pose[L_WR].x + (i % 5) * 0.01, y: pose[L_WR].y - Math.floor(i / 5) * 0.02, z: -0.01 * i, visibility: 1,
  }));
  return { pose, hand };
}

/** A mesma pessoa `k` vezes menor (mais longe), centrada em (cx, cy). */
function shrink(points: P[], k: number, cx: number, cy: number): P[] {
  return points.map((p) => ({
    ...p, x: cx + (p.x - TRAIN_CX) / k, y: cy + (p.y - TRAIN_CY) / k, z: p.z / k,
  }));
}

describe('signerFraming', () => {
  it('pessoa longe, depois de enquadrada, vira a mesma pessoa de perto', () => {
    const near = nearPerson();
    const k = 3;
    const pose = shrink(near.pose, k, 0.3, 0.35);
    const hand = shrink(near.hand, k, 0.3, 0.35);

    const framer = new SignerFramer();
    expect(framer.observe(pose, ASPECT, 0)).toBe('ok');
    expect(framer.current!.scale).toBeCloseTo(k, 5);

    const out = framer.frame({ hands: [hand], pose, aspect: ASPECT }, 'ok')!;
    out.hands[0].forEach((p, i) => {
      expect(p.x).toBeCloseTo(near.hand[i].x, 6);
      expect(p.y).toBeCloseTo(near.hand[i].y, 6);
      expect(p.z).toBeCloseTo(near.hand[i].z, 6);
    });
    expect(out.pose![L_SH].x).toBeCloseTo(near.pose[L_SH].x, 6);
  });

  it('pessoa já na escala do treino praticamente não muda', () => {
    const near = nearPerson();
    const framer = new SignerFramer();
    framer.observe(near.pose, ASPECT, 0);
    const out = framer.frame({ hands: [near.hand], pose: near.pose, aspect: ASPECT }, 'ok')!;
    expect(out.hands[0][0].x).toBeCloseTo(near.hand[0].x, 6);
    expect(out.hands[0][0].y).toBeCloseTo(near.hand[0].y, 6);
  });

  it('só amplia: pessoa mais perto que o treino não é reduzida', () => {
    const near = nearPerson();
    const pose = shrink(near.pose, 0.5, TRAIN_CX, TRAIN_CY); // 2x maior
    const framer = new SignerFramer();
    framer.observe(pose, ASPECT, 0);
    expect(framer.current!.scale).toBe(1);
  });

  it('longe demais: status too_far e nada é enviado', () => {
    const near = nearPerson();
    const pose = shrink(near.pose, MAX_SCALE * 1.5, 0.5, 0.5);
    const hand = shrink(near.hand, MAX_SCALE * 1.5, 0.5, 0.5);
    const framer = new SignerFramer();
    const st = framer.observe(pose, ASPECT, 0);
    expect(st).toBe('too_far');
    expect(framer.frame({ hands: [hand], pose, aspect: ASPECT }, st)).toBeNull();
  });

  it('descarta a mão de outra pessoa (longe dos pulsos de quem sinaliza)', () => {
    const near = nearPerson();
    const pose = shrink(near.pose, 2, 0.4, 0.5);
    const mine = shrink(near.hand, 2, 0.4, 0.5);
    const other = mine.map((p) => ({ ...p, x: p.x + 0.3 })); // outra pessoa ao lado, ainda dentro da janela
    const framer = new SignerFramer();
    framer.observe(pose, ASPECT, 0);
    const kept = selectSignerHands([mine, other], pose, framer.current!, ASPECT);
    expect(kept).toEqual([mine]);
  });

  it('descarta mão fora do campo visual (fora do quadro equivalente ao treino)', () => {
    const near = nearPerson();
    const pose = shrink(near.pose, 3, 0.3, 0.35);
    const framer = new SignerFramer();
    framer.observe(pose, ASPECT, 0);
    const w = framingWindow(framer.current!);
    const outside = near.hand.map((p) => ({ ...p, x: w.x1 + 0.2, y: 0.9 }));
    // sem pulsos visíveis, só a janela decide
    const noWrists = pose.map((p, i) => (i === L_WR || i === R_WR ? { ...p, visibility: 0 } : p));
    expect(selectSignerHands([outside], noWrists, framer.current!, ASPECT)).toHaveLength(0);
  });

  it('segura o enquadramento por até 1 s sem pose e depois perde a pessoa', () => {
    const near = nearPerson();
    const framer = new SignerFramer();
    framer.observe(near.pose, ASPECT, 0);
    expect(framer.observe([], ASPECT, 800)).toBe('ok');
    expect(framer.observe([], ASPECT, 1200)).toBe('no_person');
    expect(framer.current).toBeNull();
  });

  it('suaviza a escala entre frames (não injeta movimento falso)', () => {
    const near = nearPerson();
    const framer = new SignerFramer();
    framer.observe(shrink(near.pose, 2, 0.5, 0.5), ASPECT, 0);
    framer.observe(shrink(near.pose, 3, 0.5, 0.5), ASPECT, 300);
    const s = framer.current!.scale;
    expect(s).toBeGreaterThan(2);
    expect(s).toBeLessThan(2.5);
  });

  it('largura dos ombros considera a proporção da imagem', () => {
    const near = nearPerson();
    expect(shoulderWidth(near.pose, ASPECT)).toBeCloseTo(TRAIN_SHOULDER, 6);
    expect(shoulderWidth(near.pose.map((p, i) => (i === L_SH ? { ...p, visibility: 0.1 } : p)), ASPECT)).toBeNull();
  });

  it('applyFraming leva o centro dos ombros ao centro do treino', () => {
    const f = { cx: 0.2, cy: 0.3, scale: 2.5, shoulder: 0.15 };
    const c = applyFraming({ x: 0.2, y: 0.3, z: 0 }, f);
    expect(c.x).toBeCloseTo(TRAIN_CX);
    expect(c.y).toBeCloseTo(TRAIN_CY);
  });
});

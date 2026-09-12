import { transformPoint, buildPayload, makeCoverMapper, isPosePlausible, boneStyle, buildOverlayChannels } from '../holisticFeatures';

/** Monta os 33 pontos de pose, aplicando sobrescritas por índice. */
function makePose(overrides: Record<number, { x: number; y: number }>) {
  const pts = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [idx, p] of Object.entries(overrides)) pts[Number(idx)] = p;
  return pts;
}

describe('isPosePlausible', () => {
  const NOSE = 0, L_SHOULDER = 11, R_SHOULDER = 12;

  it('aceita um busto normal de frente', () => {
    expect(isPosePlausible(makePose({
      [NOSE]: { x: 0.50, y: 0.20 },
      [L_SHOULDER]: { x: 0.35, y: 0.42 },
      [R_SHOULDER]: { x: 0.65, y: 0.42 },
    }))).toBe(true);
  });

  it('aceita tronco inclinado (ombros desnivelados dentro do tolerado)', () => {
    expect(isPosePlausible(makePose({
      [NOSE]: { x: 0.50, y: 0.18 },
      [L_SHOULDER]: { x: 0.34, y: 0.38 },
      [R_SHOULDER]: { x: 0.64, y: 0.52 },
    }))).toBe(true);
  });

  it('rejeita pontos espalhados em cantos opostos (o padrão do bug)', () => {
    // Palpite ruim do BlazePose: "ombros" ocupando quase a imagem inteira.
    expect(isPosePlausible(makePose({
      [NOSE]: { x: 0.50, y: 0.50 },
      [L_SHOULDER]: { x: 0.02, y: 0.10 },
      [R_SHOULDER]: { x: 0.99, y: 0.95 },
    }))).toBe(false);
  });

  it('rejeita ombros colapsados num ponto só', () => {
    expect(isPosePlausible(makePose({
      [NOSE]: { x: 0.50, y: 0.30 },
      [L_SHOULDER]: { x: 0.50, y: 0.40 },
      [R_SHOULDER]: { x: 0.52, y: 0.40 },
    }))).toBe(false);
  });

  it('rejeita cabeça abaixo dos ombros', () => {
    expect(isPosePlausible(makePose({
      [NOSE]: { x: 0.50, y: 0.80 },
      [L_SHOULDER]: { x: 0.35, y: 0.40 },
      [R_SHOULDER]: { x: 0.65, y: 0.40 },
    }))).toBe(false);
  });

  it('rejeita pose vazia, curta ou com NaN', () => {
    expect(isPosePlausible(null)).toBe(false);
    expect(isPosePlausible([])).toBe(false);
    expect(isPosePlausible(makePose({
      [NOSE]: { x: NaN, y: 0.2 },
      [L_SHOULDER]: { x: 0.35, y: 0.42 },
      [R_SHOULDER]: { x: 0.65, y: 0.42 },
    }))).toBe(false);
  });
});

describe('transformPoint', () => {
  it('espelha o eixo x e preserva y/z', () => {
    expect(transformPoint({ x: 0.25, y: 0.7, z: 0.5 })).toEqual({
      x: 0.75,
      y: 0.7,
      z: 0.5,
    });
  });

  it('preserva visibility dos pontos de pose', () => {
    // Sem isso o overlay lê visibility=0 e o filtro (< 0.3) apaga o tronco
    // inteiro, mesmo com o modelo reportando confiança alta.
    const out = transformPoint({ x: 0.4, y: 0.6, z: 0, visibility: 0.99 });
    expect(out.visibility).toBe(0.99);
  });

  it('não inventa visibility para pontos que não têm (mão/rosto)', () => {
    expect(transformPoint({ x: 0.4, y: 0.6, z: 0 })).not.toHaveProperty('visibility');
  });
});

describe('boneStyle', () => {
  /** Reconstrói onde as pontas da barra caem depois do rotate no centro. */
  function pontas(st: ReturnType<typeof boneStyle>) {
    const cx = st.left + st.width / 2;
    const cy = st.top + st.height / 2;
    const rad = (st.angle * Math.PI) / 180;
    const hx = (Math.cos(rad) * st.width) / 2;
    const hy = (Math.sin(rad) * st.width) / 2;
    return { a: [cx - hx, cy - hy], b: [cx + hx, cy + hy] };
  }

  it('as pontas da barra caem exatamente sobre as articulações', () => {
    const { a, b } = pontas(boneStyle(100, 200, 300, 220, 2));
    expect(a[0]).toBeCloseTo(100); expect(a[1]).toBeCloseTo(200);
    expect(b[0]).toBeCloseTo(300); expect(b[1]).toBeCloseTo(220);
  });

  it('vale para osso vertical e para osso longo do tronco', () => {
    for (const [ax, ay, bx, by] of [[50, 10, 50, 260], [12, 340, 300, 44]]) {
      const { a, b } = pontas(boneStyle(ax, ay, bx, by, 3));
      expect(a[0]).toBeCloseTo(ax); expect(a[1]).toBeCloseTo(ay);
      expect(b[0]).toBeCloseTo(bx); expect(b[1]).toBeCloseTo(by);
    }
  });

  it('osso de comprimento zero não gera NaN', () => {
    const st = boneStyle(70, 70, 70, 70, 2);
    expect(st.width).toBe(0);
    expect(Number.isFinite(st.left)).toBe(true);
    expect(Number.isFinite(st.top)).toBe(true);
  });
});

describe('makeCoverMapper', () => {
  it('sem dimensões do frame, estica direto para a view (fallback)', () => {
    const m = makeCoverMapper(null, 300, 600);
    expect(m.toX(0.5)).toBe(150);
    expect(m.toY(0.5)).toBe(300);
  });

  it('compensa o crop horizontal quando a view é mais estreita que o frame', () => {
    // Frame 480x640 (3:4) numa view 300x600 (1:2): "cover" escala pela
    // altura (600/640) e corta as laterais.
    const m = makeCoverMapper({ width: 480, height: 640 }, 300, 600);
    const scale = 600 / 640;
    const dispW = 480 * scale; // 450
    const offX = (dispW - 300) / 2; // 75
    // Centro continua no centro; borda esquerda visível fica em x=0.
    expect(m.toX(0.5)).toBeCloseTo(150);
    expect(m.toX(offX / dispW)).toBeCloseTo(0);
    // Eixo sem crop mapeia 1:1 na view.
    expect(m.toY(0)).toBeCloseTo(0);
    expect(m.toY(1)).toBeCloseTo(600);
  });

  it('compensa o crop vertical quando a view é mais larga que o frame', () => {
    const m = makeCoverMapper({ width: 640, height: 480 }, 600, 300);
    const scale = 600 / 640;
    const dispH = 480 * scale; // 450
    const offY = (dispH - 300) / 2; // 75
    expect(m.toY(0.5)).toBeCloseTo(150);
    expect(m.toY(offY / dispH)).toBeCloseTo(0);
    expect(m.toX(0)).toBeCloseTo(0);
    expect(m.toX(1)).toBeCloseTo(600);
  });
});

describe('buildPayload', () => {
  const hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));

  it('retorna null quando não há mãos', () => {
    expect(buildPayload({ hands: [] } as any, 'holistic_v1')).toBeNull();
  });

  it('hands_v1 envia apenas o array de mãos', () => {
    const payload = buildPayload({ hands: [hand] } as any, 'hands_v1');
    expect(Array.isArray(payload)).toBe(true);
  });

  it('pose sem visibility vira 1 (presente), não 0', () => {
    // O MediaPipe Tasks devolve visibility como Optional vazio em várias
    // builds. Assumir 0 marcaria todo ponto como invisível — o modelo
    // aprenderia que o canal de pose nunca existe.
    const payload = buildPayload(
      { hands: [hand], pose: [{ x: 0.1, y: 0.2, z: 0 }] } as any,
      'holistic_v1',
    ) as { pose?: { visibility: number }[] };
    expect(payload.pose![0].visibility).toBe(1);
  });

  it('holistic_v1 inclui pose e face quando presentes', () => {
    const payload = buildPayload(
      {
        hands: [hand],
        pose: [{ x: 0.1, y: 0.2, z: 0, visibility: 0.9 }],
        face: [{ x: 0.3, y: 0.4, z: 0 }],
      } as any,
      'holistic_v1',
    ) as { hands: unknown[]; pose?: unknown[]; face?: unknown[] };

    expect(payload.pose).toHaveLength(1);
    expect(payload.face).toHaveLength(1);
    expect((payload.pose as any)[0].visibility).toBe(0.9);
  });
});

describe('buildOverlayChannels', () => {
  const NOSE = 0, L_SHOULDER = 11, R_SHOULDER = 12;

  /** Uma mão de 21 pontos, deslocada por `off` para distinguir mãos. */
  const makeHand = (off: number) =>
    Array.from({ length: 21 }, (_, i) => ({ x: off + i * 0.001, y: 0.5, z: 0 }));

  const posePlausivel = () => makePose({
    [NOSE]: { x: 0.50, y: 0.20 },
    [L_SHOULDER]: { x: 0.35, y: 0.42 },
    [R_SHOULDER]: { x: 0.65, y: 0.42 },
  });

  const FACE_IDX = [10, 152, 33];

  it('devolve AS DUAS mãos, não apenas a primeira', () => {
    // O bug das telas de coleta: `hands[0]` descartava a segunda mão.
    const out = buildOverlayChannels(
      { hands: [makeHand(0.1), makeHand(0.6)] } as any, false, FACE_IDX,
    );
    expect(out.hands).toHaveLength(2);
    expect(out.hands[0]).toHaveLength(21);
    expect(out.hands[1]).toHaveLength(21);
    // Espelhamento aplicado a ambas.
    expect(out.hands[0][0].x).toBeCloseTo(0.9);
    expect(out.hands[1][0].x).toBeCloseTo(0.4);
  });

  it('mantém pose e rosto quando nenhuma mão está no frame', () => {
    // Canais independentes: tirar a mão do enquadramento não pode apagar o
    // corpo/rosto já detectados.
    const face = Array.from({ length: 478 }, () => ({ x: 0.4, y: 0.3, z: 0 }));
    const out = buildOverlayChannels(
      { hands: [], pose: posePlausivel(), face } as any, true, FACE_IDX,
    );
    expect(out.hands).toHaveLength(0);
    expect(out.pose).toHaveLength(33);
    expect(FACE_IDX.every((i) => out.face[i])).toBe(true);
  });

  it('modo "só mãos" não devolve pose nem rosto', () => {
    const face = Array.from({ length: 478 }, () => ({ x: 0.4, y: 0.3, z: 0 }));
    const out = buildOverlayChannels(
      { hands: [makeHand(0.1)], pose: posePlausivel(), face } as any, false, FACE_IDX,
    );
    expect(out.hands).toHaveLength(1);
    expect(out.pose).toHaveLength(0);
    expect(out.face).toHaveLength(0);
  });

  it('descarta pose implausível (palpite do BlazePose sem corpo)', () => {
    const out = buildOverlayChannels(
      { hands: [], pose: makePose({
        [NOSE]: { x: 0.50, y: 0.50 },
        [L_SHOULDER]: { x: 0.02, y: 0.10 },
        [R_SHOULDER]: { x: 0.99, y: 0.95 },
      }) } as any, true, FACE_IDX,
    );
    expect(out.pose).toHaveLength(0);
  });

  it('só transforma os índices de rosto que o overlay desenha (array esparso)', () => {
    const face = Array.from({ length: 478 }, (_, i) => ({ x: i / 478, y: 0.3, z: 0 }));
    const out = buildOverlayChannels({ hands: [], face } as any, true, FACE_IDX);
    // Índices pedidos, presentes e espelhados; os demais, ausentes.
    expect(out.face[10].x).toBeCloseTo(1 - 10 / 478);
    expect(out.face[11]).toBeUndefined();
    expect(Object.keys(out.face)).toHaveLength(FACE_IDX.length);
  });

  it('resultado nulo devolve os três canais vazios', () => {
    const out = buildOverlayChannels(null, true, FACE_IDX);
    expect(out).toEqual({ hands: [], pose: [], face: [] });
  });
});

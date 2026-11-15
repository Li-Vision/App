import { isHandRecent, NO_HAND_MS } from "../handPresence";

describe("isHandRecent", () => {
  it("nunca vista: ausente", () => {
    expect(isHandRecent(0, 10_000)).toBe(false);
  });

  it("vista agora há pouco: presente", () => {
    expect(isHandRecent(10_000, 10_000 + 300)).toBe(true);
    expect(isHandRecent(10_000, 10_000 + NO_HAND_MS)).toBe(true);
  });

  it("sem ver a mão além da janela: ausente", () => {
    expect(isHandRecent(10_000, 10_000 + NO_HAND_MS + 1)).toBe(false);
  });

  it("a janela cobre o intervalo entre frames em câmera lenta", () => {
    expect(NO_HAND_MS).toBeGreaterThan(333);
  });
});

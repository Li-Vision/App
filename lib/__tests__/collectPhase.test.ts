import { collectPhase, collectProgress } from "../collectPhase";

describe("collectPhase", () => {
  it("sem gravação o botão está pronto", () => {
    expect(collectPhase(false, 0, 15)).toBe("ready");
    expect(collectPhase(false, 9, 15)).toBe("ready"); // resto de uma gravação antiga
  });

  it("gravando mas sem nenhum frame aceito: preparando", () => {
    expect(collectPhase(true, 0, 15)).toBe("preparing");
  });

  it("frames sendo aceitos: gravando", () => {
    expect(collectPhase(true, 1, 15)).toBe("recording");
    expect(collectPhase(true, 14, 15)).toBe("recording");
  });

  it("janela completa aguardando o servidor: salvando", () => {
    expect(collectPhase(true, 15, 15)).toBe("saving");
  });
});

describe("collectProgress", () => {
  it("fica entre 0 e 1", () => {
    expect(collectProgress(0, 15)).toBe(0);
    expect(collectProgress(15, 15)).toBe(1);
    expect(collectProgress(40, 15)).toBe(1);
    expect(collectProgress(-3, 15)).toBe(0);
    expect(collectProgress(5, 0)).toBe(0);
  });
});

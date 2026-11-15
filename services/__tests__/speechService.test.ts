import { spokenWordText } from "../speechService";

// Módulos nativos indisponíveis no Jest; a função testada não os usa.
jest.mock("expo-speech", () => ({}));
jest.mock("expo-intent-launcher", () => ({}));
jest.mock("../inferenceLogger", () => ({ logEvent: jest.fn() }));

describe("fala da palavra soletrada", () => {
  it("entrega a palavra em minúsculas, para o TTS não ler como sigla", () => {
    expect(spokenWordText("CASA")).toBe("casa");
    expect(spokenWordText("  ÁGUA ")).toBe("água");
  });

  it("mantém uma letra sozinha como está", () => {
    expect(spokenWordText("A")).toBe("A");
  });
});

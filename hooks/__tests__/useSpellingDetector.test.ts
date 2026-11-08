import { act, renderHook } from "@testing-library/react-native";
import { useSpellingDetector } from "../useSpellingDetector";

/**
 * Simula o servidor: a cada resposta (~20 Hz) o app recebe o gesto atual, e o
 * servidor REPETE a última letra durante o cooldown/hold mesmo depois de a mão
 * já ter mudado de pose. Por isso `feed` manda a mesma letra por vários
 * segundos, e `silence` é o tempo sem nenhuma letra chegando.
 */
const CONFIG = { spellingIdleMs: 2500, letterStableMs: 1200, minConfidence: 0.7, enabled: true };

function setup() {
  const onWordComplete = jest.fn();
  const hook = renderHook(() => useSpellingDetector({ config: CONFIG, onWordComplete }));
  const tick = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });
  const feed = (letter: string, ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      act(() => { hook.result.current.onDetection(letter, 0.95); });
      tick(50);
    }
  };
  const words = () => onWordComplete.mock.calls.map((c) => c[0]);
  return { hook, tick, feed, words };
}

describe("soletração · tempo entre letras", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("segurar a mesma letra NÃO a captura de novo como outra palavra", () => {
    const { feed, tick, words } = setup();

    feed("A", 9000); // mão parada em A por 9 s
    tick(6000);

    expect(words()).toEqual(["A"]);
  });

  it("a letra seguinte que chega depois do tempo de ociosidade continua a MESMA palavra", () => {
    const { feed, tick, words } = setup();

    // A é aceita aos 1,2 s. O servidor segue mandando A (cooldown + hold) e o B
    // só chega 2,2 s depois, mais do que o tempo de ociosidade contado do commit.
    feed("A", 3400);
    feed("B", 2000);
    tick(6000);

    expect(words()).toEqual(["AB"]);
  });

  it("A, B, C em sequência viram uma palavra só", () => {
    const { feed, tick, words } = setup();

    feed("A", 1800);
    feed("B", 1800);
    feed("C", 1800);
    tick(6000);

    expect(words()).toEqual(["ABC"]);
  });

  it("mesma letra duas vezes só depois de soltar a mão (LL)", () => {
    const { feed, tick, words } = setup();

    feed("L", 1800);
    tick(1500); // nenhuma letra chega: mão fora da câmera
    feed("L", 1800);
    tick(6000);

    expect(words()).toEqual(["LL"]);
  });
});

import {
  filterLabels, gridColumns, lowSampleLabels, normalizeName, sortLabels, stepLabel,
} from "../gestureStats";

describe("normalizeName", () => {
  it("grava em maiúsculas, sem espaços sobrando", () => {
    expect(normalizeName("  tudo   bem ")).toBe("TUDO BEM");
  });
});

describe("sortLabels", () => {
  it("ordena alfabeticamente e numericamente, sem repetir", () => {
    expect(sortLabels(["B", "A", "GESTO 10", "GESTO 2", "A"])).toEqual(["A", "B", "GESTO 2", "GESTO 10"]);
  });
});

describe("lowSampleLabels", () => {
  // Contagens reais do ALFABETO_HOLISTICO em 2026-11-24.
  const alfabeto = {
    A: 459, B: 470, C: 464, D: 454, E: 275, F: 311, G: 452, I: 509,
    L: 350, M: 75, N: 410, O: 451, P: 181, R: 451, S: 380, U: 132,
  };

  it("marca só as letras bem abaixo das demais", () => {
    expect([...lowSampleLabels(alfabeto)].sort()).toEqual(["M", "P", "U"]);
  });

  it("não marca ninguém com menos de 3 gestos", () => {
    expect(lowSampleLabels({ A: 500, B: 1 }).size).toBe(0);
  });

  it("não marca ninguém num dataset equilibrado", () => {
    expect(lowSampleLabels({ OI: 182, SIM: 182, OBRIGADO: 182, "TUDO BEM": 182 }).size).toBe(0);
  });
});

describe("stepLabel", () => {
  const labels = ["A", "B", "C"];

  it("avança e volta ao início", () => {
    expect(stepLabel(labels, "B", 1)).toBe("C");
    expect(stepLabel(labels, "C", 1)).toBe("A");
    expect(stepLabel(labels, "A", -1)).toBe("C");
  });

  it("parte da ponta quando o gesto atual não está na lista", () => {
    expect(stepLabel(labels, "Z", 1)).toBe("A");
    expect(stepLabel(labels, "", -1)).toBe("C");
  });

  it("devolve null sem gestos", () => {
    expect(stepLabel([], "A", 1)).toBeNull();
  });
});

describe("filterLabels", () => {
  it("ignora maiúsculas e acentos", () => {
    expect(filterLabels(["OBRIGADO", "OI", "SIM", "TUDO BEM"], "ó")).toEqual(["OBRIGADO", "OI", "TUDO BEM"]);
    expect(filterLabels(["A", "B"], "  ")).toEqual(["A", "B"]);
  });
});

describe("gridColumns", () => {
  it("usa mais colunas para letras e menos para nomes longos", () => {
    expect(gridColumns(["A", "B"])).toBe(5);
    expect(gridColumns(["OI", "SIM"])).toBe(3);
    expect(gridColumns(["OBRIGADO", "TUDO BEM"])).toBe(2);
  });
});

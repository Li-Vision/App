/**
 * Lógica pura dos seletores de dataset/gesto das telas de coleta.
 *
 * Fica fora dos componentes para poder ser testada sem renderizar nada e para
 * que a coleta estática e a dinâmica usem exatamente as mesmas regras.
 */

/** Contagem de amostras por gesto, como vem de `getDatasetStats().stats`. */
export type LabelStats = Record<string, number>;

/**
 * Normaliza um nome digitado (gesto ou dataset) do jeito que a coleta grava:
 * maiúsculas, sem espaços nas pontas e com espaços internos simples.
 */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** Gestos em ordem alfabética (A, B, C… e "GESTO 2" antes de "GESTO 10"). */
export function sortLabels(labels: Iterable<string>): string[] {
  return Array.from(new Set(labels)).sort(collator.compare);
}

/**
 * Gestos com poucas amostras em relação aos demais do mesmo dataset.
 *
 * O critério é relativo (menos da metade da mediana) porque o que prejudica o
 * modelo é o desequilíbrio entre classes, não um número absoluto: num dataset
 * com ~450 amostras por letra, uma letra com 75 é a que o treino erra. Com
 * menos de 3 gestos a mediana não diz nada, então ninguém é marcado.
 */
export function lowSampleLabels(stats: LabelStats, ratio = 0.5): Set<string> {
  const entries = Object.entries(stats);
  if (entries.length < 3) return new Set();
  const counts = entries.map(([, n]) => n).sort((a, b) => a - b);
  const mid = Math.floor(counts.length / 2);
  const median = counts.length % 2 ? counts[mid] : (counts[mid - 1] + counts[mid]) / 2;
  const limit = median * ratio;
  return new Set(entries.filter(([, n]) => n < limit).map(([label]) => label));
}

/**
 * Próximo/anterior gesto para as setas do seletor, com volta ao início/fim.
 * Um gesto atual fora da lista (novo, ainda sem amostras) parte da ponta
 * correspondente à direção.
 */
export function stepLabel(labels: string[], current: string, direction: 1 | -1): string | null {
  if (labels.length === 0) return null;
  const idx = labels.indexOf(current);
  if (idx === -1) return direction === 1 ? labels[0] : labels[labels.length - 1];
  return labels[(idx + direction + labels.length) % labels.length];
}

/** Filtra por trecho do nome, ignorando maiúsculas e acentos. */
export function filterLabels(labels: string[], query: string): string[] {
  const q = fold(query.trim());
  if (!q) return labels;
  return labels.filter((l) => fold(l).includes(q));
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Colunas da grade de gestos: letras soltas cabem 5 por linha; nomes como
 * "TUDO BEM" precisam de mais largura.
 */
export function gridColumns(labels: string[]): number {
  const longest = labels.reduce((max, l) => Math.max(max, l.length), 0);
  if (longest <= 2) return 5;
  if (longest <= 5) return 3;
  return 2;
}

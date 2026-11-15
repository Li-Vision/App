/**
 * Fase do botão de coleta dinâmica, a partir do que o servidor já informa.
 *
 * - `ready`: pode gravar a próxima sequência.
 * - `preparing`: o app pediu a gravação, mas o servidor ainda não aceitou
 *   nenhum frame (a 1ª sequência de um dataset gasta alguns segundos criando-o
 *   no banco). A mão deve ficar enquadrada, mas ainda não está gravando.
 * - `recording`: frames sendo aceitos (`buffered` de `total`).
 * - `saving`: janela completa, aguardando o servidor confirmar a sequência.
 */
export type CollectPhase = "ready" | "preparing" | "recording" | "saving";

export function collectPhase(isRecording: boolean, buffered: number, total: number): CollectPhase {
  if (!isRecording) return "ready";
  if (buffered <= 0) return "preparing";
  if (buffered >= total) return "saving";
  return "recording";
}

/** Progresso 0..1 da gravação; só faz sentido na fase `recording`. */
export function collectProgress(buffered: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, buffered / total));
}

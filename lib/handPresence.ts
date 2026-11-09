/**
 * Presença da mão na tela de reconhecimento.
 *
 * O app não envia frames sem mão e o servidor pode responder com atraso. Uma
 * resposta que chega depois de a mão ter saído é velha: mostrá-la era o "gesto
 * aleatório sem parar" depois de tirar as mãos, e o rótulo anterior ficava
 * preso na tela porque nada o limpava.
 */

/**
 * Tempo sem ver a mão a partir do qual ela conta como ausente. Acima do
 * intervalo entre frames em câmera lenta (~330 ms) para a mão presente não
 * piscar como ausente.
 */
export const NO_HAND_MS = 600;

/** A mão foi vista há pouco? `lastSeenAt === 0` significa que nunca foi vista. */
export function isHandRecent(lastSeenAt: number, now: number, windowMs: number = NO_HAND_MS): boolean {
  return lastSeenAt > 0 && now - lastSeenAt <= windowMs;
}

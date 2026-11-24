/**
 * Veredito da validação assíncrona de uma amostra coletada (ver
 * API/src/services/collection_queue.py):
 *   accepted -> entrou no dataset
 *   suspect  -> foi para a quarentena (fora do treino até um admin revisar)
 *   rejected -> descartada (corrompida)
 *   error    -> falha no servidor ao validar
 */
export type CollectVerdict = {
  status: "accepted" | "suspect" | "rejected" | "error";
  message: string;
};

type Reason = { code: string; message: string; severity: "error" | "suspect" | "info" };

export function describeVerdict(ticket: any): CollectVerdict | null {
  const status = ticket?.status;
  if (!status || status === "queued" || status === "processing") return null;

  const reasons: Reason[] = Array.isArray(ticket.reasons) ? ticket.reasons : [];
  const relevant = reasons.filter((r) => r.severity !== "info").map((r) => r.message);

  if (status === "accepted") return { status, message: "Amostra validada e salva." };
  if (status === "suspect") {
    const where = ticket.stored_in === "quarantine" ? "foi para revisão" : "não foi salva";
    return { status, message: `Amostra ${where}: ${relevant.join("; ") || "fora do padrão do sinal"}` };
  }
  if (status === "rejected") {
    return { status, message: `Amostra descartada: ${relevant.join("; ") || "dados corrompidos"}` };
  }
  return { status: "error", message: ticket.error || "Falha ao validar a amostra." };
}

/**
 * Estado de disponibilidade do servidor.
 *
 * Existe porque uma queda da API (502/503/504 ou rede) gerava um erro no modal
 * global, que aparecia do nada e nunca avisava quando o servidor voltava.
 * Aqui a queda vira um estado, não um erro: `http.ts` informa falhas e
 * sucessos, e enquanto o servidor estiver fora uma sondagem leve tenta de novo
 * até ele responder.
 *
 * Independente do React, como o `errorReporter`.
 *
 * @see ../components/ConnectionBanner.tsx
 * @see ../lib/http.ts
 */
import { API_BASE_URL } from "@/config/api";

export type ConnectionState = "online" | "offline" | "recovered";

type Listener = (state: ConnectionState) => void;

const PROBE_INTERVAL_MS = 10_000;
const PROBE_TIMEOUT_MS = 8_000;
/** Quanto tempo "Conexão restabelecida" fica na tela. */
const RECOVERED_VISIBLE_MS = 2_000;

let state: ConnectionState = "online";
let probeTimer: ReturnType<typeof setInterval> | null = null;
let recoveredTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function setState(next: ConnectionState) {
  if (state === next) return;
  state = next;
  listeners.forEach((l) => l(state));
}

/** 502/503/504: o gateway respondeu, mas o servidor por trás não. */
export function isServerUnavailableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

async function probe(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE_URL}/`, { signal: controller.signal });
    // Qualquer resposta fora da faixa de indisponibilidade prova que o servidor
    // voltou — até um 404 na raiz.
    if (!isServerUnavailableStatus(res.status)) markServerAvailable();
  } catch {
    // Continua fora; a próxima sondagem tenta de novo.
  } finally {
    clearTimeout(timeout);
  }
}

function startProbing() {
  if (probeTimer) return;
  probeTimer = setInterval(probe, PROBE_INTERVAL_MS);
}

function stopProbing() {
  if (!probeTimer) return;
  clearInterval(probeTimer);
  probeTimer = null;
}

/** Chamado quando uma requisição falha por indisponibilidade do servidor. */
export function markServerUnavailable(): void {
  if (recoveredTimer) {
    clearTimeout(recoveredTimer);
    recoveredTimer = null;
  }
  setState("offline");
  startProbing();
}

/** Chamado quando o servidor respondeu de verdade (qualquer status < 500). */
export function markServerAvailable(): void {
  if (state !== "offline") return;
  stopProbing();
  setState("recovered");
  recoveredTimer = setTimeout(() => {
    recoveredTimer = null;
    setState("online");
  }, RECOVERED_VISIBLE_MS);
}

export function getConnectionState(): ConnectionState {
  return state;
}

export function subscribeConnection(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

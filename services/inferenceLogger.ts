/**
 * Log de diagnóstico da inferência, salvo localmente no aparelho.
 *
 * Grava uma linha JSON (JSONL) por evento do WebSocket — conexão, resposta do
 * servidor com o detector vencedor e o movimento medido — para descobrir por
 * que o reconhecimento erra sem depender de adivinhar pelo código.
 *
 * Desligado por padrão (preferência `config_inference_log_enabled`). Quando
 * desligado, `logEvent` não faz nada.
 *
 * Resistência a travamento: os eventos ficam em memória por no máximo FLUSH_MS
 * e vão para um arquivo pequeno de "cauda" (TAIL_PATH), regravado inteiro a
 * cada lote — barato, porque a cauda é limitada a TAIL_MAX_CHARS. Quando ela
 * enche (ou ao compartilhar), é fundida no arquivo principal, limitado a
 * MAX_CHARS (mantém o fim). Se o app morrer, a cauda fica no disco e é
 * recuperada na abertura seguinte, que também registra `session_start` com o
 * último evento da execução anterior: `unclean: true` indica que o processo
 * terminou com o app em primeiro plano (travamento ou crash).
 */
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";

const ENABLED_KEY = "config_inference_log_enabled";
const FLUSH_MS = 2000;
const MAX_CHARS = 1_500_000;
const TAIL_MAX_CHARS = 100_000;

const LOG_PATH = `${FileSystem.documentDirectory ?? ""}inference-log.jsonl`;
const TAIL_PATH = `${FileSystem.documentDirectory ?? ""}inference-log.tail.jsonl`;

let enabled = false;
let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();
// Conteúdo atual da cauda (o que já foi gravado em TAIL_PATH nesta execução).
let tailText = "";

/** Enfileira uma operação de arquivo: nunca duas ao mesmo tempo. */
function enqueue(op: () => Promise<void>): Promise<void> {
  writing = writing.then(async () => {
    try {
      await op();
    } catch (e) {
      console.log("[Log] Falha ao gravar o log:", e);
    }
  });
  return writing;
}

async function readIfExists(path: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? await FileSystem.readAsStringAsync(path) : "";
}

/** Funde `extra` no arquivo principal, respeitando MAX_CHARS. Roda dentro da fila. */
async function appendToMain(extra: string): Promise<string> {
  let text = (await readIfExists(LOG_PATH)) + extra;
  if (text.length > MAX_CHARS) {
    text = text.slice(text.length - MAX_CHARS);
    text = text.slice(text.indexOf("\n") + 1); // descarta a linha cortada
  }
  await FileSystem.writeAsStringAsync(LOG_PATH, text);
  return text;
}

/** Funde a cauda desta execução no arquivo principal. Roda dentro da fila. */
async function mergeTail(): Promise<void> {
  if (!tailText) return;
  await appendToMain(tailText);
  tailText = "";
  await FileSystem.deleteAsync(TAIL_PATH, { idempotent: true });
}

/**
 * Recupera a cauda deixada pela execução anterior e devolve o último evento
 * dela — é o que diz onde o app estava quando o processo terminou.
 */
async function recoverPreviousRun(): Promise<{ e?: string; t?: number; state?: string } | null> {
  const orphan = await readIfExists(TAIL_PATH);
  const text = orphan ? await appendToMain(orphan) : await readIfExists(LOG_PATH);
  if (orphan) await FileSystem.deleteAsync(TAIL_PATH, { idempotent: true });
  const lines = text.trimEnd().split("\n");
  const last = lines[lines.length - 1];
  if (!last) return null;
  try {
    return JSON.parse(last);
  } catch {
    return null;
  }
}

// Carrega a preferência e recupera a execução anterior assim que o módulo é
// importado. A recuperação entra na fila antes de qualquer gravação nova.
(async () => {
  try {
    enabled = (await AsyncStorage.getItem(ENABLED_KEY)) === "true";
    let prev: Awaited<ReturnType<typeof recoverPreviousRun>> = null;
    await enqueue(async () => { prev = await recoverPreviousRun(); });
    if (!enabled) return;
    const p = prev as { e?: string; t?: number; state?: string } | null;
    logEvent("session_start", {
      prevE: p?.e,
      prevAgoMs: p?.t ? Date.now() - p.t : undefined,
      // Terminou em primeiro plano = o processo morreu com o app aberto.
      unclean: p ? !(p.e === "app_state" && p.state !== "active") : undefined,
    });
    flushLog();
  } catch {
    // Sem armazenamento disponível (ex.: testes): o log simplesmente não liga.
  }
})();

// Ir para segundo plano grava na hora: é o último momento garantido antes de o
// sistema poder encerrar o processo, e marca a saída como "limpa".
try {
  AppState.addEventListener("change", (state) => {
    logEvent("app_state", { state });
    flushLog();
  });
} catch {
  // AppState indisponível fora do app.
}

// Erros de JS não tratados (inclusive os fatais, que fecham o app em release).
try {
  const errorUtils = (globalThis as any).ErrorUtils;
  const previous = errorUtils?.getGlobalHandler?.();
  errorUtils?.setGlobalHandler?.((error: any, isFatal?: boolean) => {
    logEvent("js_error", {
      fatal: !!isFatal,
      message: String(error?.message ?? error),
      stack: String(error?.stack ?? "").slice(0, 800),
    });
    flushLog();
    previous?.(error, isFatal);
  });
} catch {
  // Sem ErrorUtils: nada a interceptar.
}

export function isLogEnabled(): boolean {
  return enabled;
}

/** Registra um evento. Sem custo quando o log está desligado. */
export function logEvent(event: string, data: Record<string, unknown> = {}): void {
  if (!enabled) return;
  pending.push(JSON.stringify({ t: Date.now(), e: event, ...data }));
  if (!timer) timer = setTimeout(flushLog, FLUSH_MS);
}

/** Grava no disco o que está em memória (em série, sem sobrepor gravações). */
export function flushLog(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  const lines = pending;
  pending = [];
  if (lines.length === 0) return writing;

  return enqueue(async () => {
    tailText += lines.join("\n") + "\n";
    await FileSystem.writeAsStringAsync(TAIL_PATH, tailText);
    if (tailText.length > TAIL_MAX_CHARS) await mergeTail();
  });
}

/** Grava tudo e deixa o arquivo principal completo (para medir ou compartilhar). */
async function consolidate(): Promise<void> {
  await flushLog();
  await enqueue(mergeTail);
}

export async function setLogEnabled(next: boolean): Promise<void> {
  if (next) {
    enabled = true;
    logEvent("log_start");
  } else {
    await flushLog();
    enabled = false;
  }
  await AsyncStorage.setItem(ENABLED_KEY, String(next));
}

/** Tamanho atual do log em KB (0 se não existir). */
export async function getLogSizeKb(): Promise<number> {
  await consolidate();
  const info = await FileSystem.getInfoAsync(LOG_PATH);
  return info.exists && "size" in info ? Math.round((info.size ?? 0) / 1024) : 0;
}

export async function clearLog(): Promise<void> {
  pending = [];
  if (timer) { clearTimeout(timer); timer = null; }
  await enqueue(async () => {
    tailText = "";
    await FileSystem.deleteAsync(TAIL_PATH, { idempotent: true });
    await FileSystem.deleteAsync(LOG_PATH, { idempotent: true });
  });
}

/** Abre o compartilhamento do arquivo. Devolve false se não há log para enviar. */
export async function shareLog(): Promise<boolean> {
  await consolidate();
  const info = await FileSystem.getInfoAsync(LOG_PATH);
  if (!info.exists || !(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(LOG_PATH, { mimeType: "text/plain", dialogTitle: "Log de inferência" });
  return true;
}

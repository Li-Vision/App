/**
 * Log de diagnóstico da inferência, salvo localmente no aparelho.
 *
 * Grava uma linha JSON (JSONL) por evento do WebSocket — conexão, resposta do
 * servidor com o detector vencedor e o movimento medido — para descobrir por
 * que o reconhecimento erra sem depender de adivinhar pelo código.
 *
 * Desligado por padrão (preferência `config_inference_log_enabled`). Quando
 * desligado, `logEvent` não faz nada. Os eventos ficam em memória e são
 * gravados em lote; o arquivo é limitado a MAX_CHARS (mantém o fim).
 */
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import AsyncStorage from "@react-native-async-storage/async-storage";

const ENABLED_KEY = "config_inference_log_enabled";
const FLUSH_MS = 5000;
const MAX_CHARS = 1_500_000;

const LOG_PATH = `${FileSystem.documentDirectory ?? ""}inference-log.jsonl`;

let enabled = false;
let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();

// Carrega a preferência assim que o módulo é importado.
AsyncStorage.getItem(ENABLED_KEY)
  .then((v) => { enabled = v === "true"; })
  .catch(() => {});

export function isLogEnabled(): boolean {
  return enabled;
}

/** Registra um evento. Sem custo quando o log está desligado. */
export function logEvent(event: string, data: Record<string, unknown> = {}): void {
  if (!enabled) return;
  pending.push(JSON.stringify({ t: Date.now(), e: event, ...data }));
  if (!timer) timer = setTimeout(flushLog, FLUSH_MS);
}

/** Grava no arquivo o que está em memória (em série, sem sobrepor gravações). */
export function flushLog(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  const lines = pending;
  pending = [];
  if (lines.length === 0) return writing;

  writing = writing.then(async () => {
    try {
      const info = await FileSystem.getInfoAsync(LOG_PATH);
      const old = info.exists ? await FileSystem.readAsStringAsync(LOG_PATH) : "";
      let text = old + lines.join("\n") + "\n";
      if (text.length > MAX_CHARS) {
        text = text.slice(text.length - MAX_CHARS);
        text = text.slice(text.indexOf("\n") + 1); // descarta a linha cortada
      }
      await FileSystem.writeAsStringAsync(LOG_PATH, text);
    } catch (e) {
      console.log("[Log] Falha ao gravar o log:", e);
    }
  });
  return writing;
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
  await flushLog();
  const info = await FileSystem.getInfoAsync(LOG_PATH);
  return info.exists && "size" in info ? Math.round((info.size ?? 0) / 1024) : 0;
}

export async function clearLog(): Promise<void> {
  pending = [];
  if (timer) { clearTimeout(timer); timer = null; }
  await writing;
  await FileSystem.deleteAsync(LOG_PATH, { idempotent: true });
}

/** Abre o compartilhamento do arquivo. Devolve false se não há log para enviar. */
export async function shareLog(): Promise<boolean> {
  await flushLog();
  const info = await FileSystem.getInfoAsync(LOG_PATH);
  if (!info.exists || !(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(LOG_PATH, { mimeType: "text/plain", dialogTitle: "Log de inferência" });
  return true;
}

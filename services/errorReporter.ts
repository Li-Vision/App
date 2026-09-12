/**
 * Coletor central de erros do app.
 *
 * Existe porque falhas estavam desaparecendo em silêncio: o WebView do VLibras
 * sobrescrevia `console.error`, chamadas de API caíam em `catch (e) {}` vazios,
 * e o sintoma que chegava ao usuário era só uma tela que nunca carregava. Sem
 * um lugar único para onde os erros convergem, cada diagnóstico virava uma
 * investigação por fora do app (logcat, adb, rede).
 *
 * O serviço é deliberadamente independente do React: `report()` pode ser
 * chamado de qualquer lugar — handlers globais, worklets via runOnJS, catch de
 * services — sem depender de hook ou de árvore de componentes montada.
 *
 * @see ../context/ErrorContext.tsx  (ponte para a UI)
 * @see ../components/ErrorModal.tsx (apresentação)
 */

export type AppErrorSeverity = "error" | "warning";

export type AppError = {
  id: string;
  /** Origem legível: "VLibras", "API", "Câmera"… Agrupa erros repetidos. */
  source: string;
  message: string;
  /** Stack ou corpo da resposta — o que ajuda a diagnosticar, não a ler. */
  detail?: string;
  severity: AppErrorSeverity;
  timestamp: number;
  /** Quantas vezes este mesmo erro ocorreu desde a primeira aparição. */
  count: number;
};

type Listener = (errors: AppError[]) => void;

/** Teto do histórico: o modal é para diagnóstico recente, não auditoria. */
const MAX_ERRORS = 50;

let errors: AppError[] = [];
const listeners = new Set<Listener>();

function emit() {
  const snapshot = [...errors];
  listeners.forEach((l) => l(snapshot));
}

/**
 * Registra um erro. Ocorrências idênticas (mesma origem + mensagem) não viram
 * entradas novas: incrementam o contador da existente e sobem para o topo.
 * Sem isso, um erro num frame processor a 30fps encheria a lista em segundos.
 */
export function report(
  source: string,
  message: string,
  options?: { detail?: string; severity?: AppErrorSeverity },
): void {
  const severity = options?.severity ?? "error";
  const text = String(message ?? "").trim() || "Erro desconhecido";

  const existing = errors.find((e) => e.source === source && e.message === text);
  if (existing) {
    existing.count += 1;
    existing.timestamp = Date.now();
    existing.detail = options?.detail ?? existing.detail;
    errors = [existing, ...errors.filter((e) => e !== existing)];
  } else {
    errors = [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        source,
        message: text,
        detail: options?.detail,
        severity,
        timestamp: Date.now(),
        count: 1,
      },
      ...errors,
    ].slice(0, MAX_ERRORS);
  }
  emit();
}

/** Conveniência para blocos catch: extrai mensagem e stack de qualquer valor. */
export function reportException(source: string, e: unknown): void {
  const err = e as { message?: string; stack?: string; detail?: string; status?: number };
  const message = err?.message || String(e);
  const detail = [
    err?.status ? `HTTP ${err.status}` : null,
    err?.detail && err.detail !== err.message ? err.detail : null,
    err?.stack,
  ]
    .filter(Boolean)
    .join("\n");
  report(source, message, { detail: detail || undefined });
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  listener([...errors]);
  return () => {
    listeners.delete(listener);
  };
}

export function clearErrors(): void {
  errors = [];
  emit();
}

export function dismissError(id: string): void {
  errors = errors.filter((e) => e.id !== id);
  emit();
}

export function getErrors(): AppError[] {
  return [...errors];
}

/**
 * Captura falhas que ninguém tratou.
 *
 * - `ErrorUtils` é o hook global do React Native para exceções JS não
 *   capturadas (inclui as que derrubariam o app em produção).
 * - Promises rejeitadas sem `.catch` não passam pelo ErrorUtils, e são a
 *   forma mais comum de erro silencioso em código async — daí o segundo
 *   handler.
 *
 * A chain com o handler anterior é preservada: sobrescrever sem chamar o
 * original tiraria a tela vermelha de desenvolvimento.
 */
export function installGlobalHandlers(): void {
  const globalAny = global as any;

  if (globalAny.ErrorUtils && !globalAny.__liVisionErrorHandlerInstalled) {
    const previous = globalAny.ErrorUtils.getGlobalHandler?.();
    globalAny.ErrorUtils.setGlobalHandler((e: any, isFatal?: boolean) => {
      reportException(isFatal ? "Erro fatal" : "Erro não tratado", e);
      previous?.(e, isFatal);
    });
    globalAny.__liVisionErrorHandlerInstalled = true;
  }

  const tracking = globalAny.HermesInternal?.hasPromise?.()
    ? globalAny.HermesInternal?.enablePromiseRejectionTracker
    : undefined;
  if (tracking && !globalAny.__liVisionRejectionTrackerInstalled) {
    tracking({
      allRejections: true,
      onUnhandled: (_id: number, rejection: unknown) => {
        reportException("Promise não tratada", rejection);
      },
    });
    globalAny.__liVisionRejectionTrackerInstalled = true;
  }
}

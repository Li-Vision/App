import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { flushLog, logEvent } from "@/services/inferenceLogger";

interface Options {
  /** Liga/desliga a vigilância (ex.: enquanto o modelo nativo ainda não está pronto). */
  enabled?: boolean;
  /** Sem nenhum resultado do plugin por tanto tempo, a câmera é recriada. */
  stallMs?: number;
  /** Quantos resultados seguidos com `error` do plugin nativo antes de recriar a câmera. */
  errorStreak?: number;
  /**
   * Lê contadores de dentro do worklet (shared values) para o log de diagnóstico.
   * Comparar o que o worklet fez com o que chegou ao JS (`frames`) separa
   * "o nativo parou" de "o JS não está recebendo".
   */
  probe?: () => Record<string, number>;
}

/** Mínimo entre duas recriações, para um erro permanente não virar loop de remount. */
const RESTART_COOLDOWN_MS = 8000;

/**
 * Detecta quando o frame processor deixa de entregar landmarks e recria a câmera.
 *
 * Duas falhas são tratadas:
 *  - parada: o plugin nativo para de devolver resultados (o worklet não roda mais);
 *  - erro persistente: o plugin devolve só `error` (ex.: o MediaPipe rejeitando
 *    frames), que nas telas de coleta era engolido e aparecia como "sem mão".
 *
 * Chame `beat(result)` a cada resultado e use `cameraKey` como `key` do <Camera>:
 * mudar a key desmonta e remonta a sessão da câmera. Todo evento é logado com o
 * prefixo [Watchdog], para dar para ver no logcat o que de fato aconteceu.
 *
 * Também grava no log de diagnóstico (quando ligado nas configurações) um
 * resumo do fluxo a cada 2 s: frames, frames com erro, o último erro do plugin
 * e quantas vezes o timestamp do frame andou para trás. É o que diferencia,
 * depois de um travamento, "o plugin devolve erro em todo frame" de "o plugin
 * parou de responder" — sem isso as duas coisas parecem a mesma.
 */
export function useFrameWatchdog({ enabled = true, stallMs = 4000, errorStreak = 45, probe }: Options = {}) {
  const probeRef = useRef(probe);
  probeRef.current = probe;
  const [cameraKey, setCameraKey] = useState(0);
  const lastFrameAt = useRef(Date.now());
  const lastRestartAt = useRef(0);
  const errorCount = useRef(0);
  // Contadores do intervalo atual do log de diagnóstico (zerados a cada resumo).
  const stats = useRef({ frames: 0, errFrames: 0, noHands: 0, lastError: "", tsBackwards: 0, lastTs: 0, lagMs: 0 });

  const restart = useCallback((reason: string) => {
    const now = Date.now();
    if (now - lastRestartAt.current < RESTART_COOLDOWN_MS) return;
    lastRestartAt.current = now;
    lastFrameAt.current = now;
    errorCount.current = 0;
    console.warn(`[Watchdog] recriando a câmera — ${reason}`);
    logEvent("watchdog_restart", { reason });
    flushLog();
    setCameraKey((k) => k + 1);
  }, []);

  const beat = useCallback(
    (result?: { error?: string; hands?: unknown[] } | null, frameTs?: number) => {
      lastFrameAt.current = Date.now();
      const st = stats.current;
      st.frames += 1;
      if (!result?.hands?.length) st.noHands += 1;
      // O MediaPipe em modo VIDEO rejeita timestamp que não cresce; contar aqui
      // mostra se o frame da câmera recriada começa "atrás" do anterior.
      if (typeof frameTs === "number") {
        if (st.lastTs && frameTs <= st.lastTs) st.tsBackwards += 1;
        st.lastTs = frameTs;
      }
      const error = result?.error;
      if (error) {
        st.errFrames += 1;
        st.lastError = error;
      }
      if (!error) {
        errorCount.current = 0;
        return;
      }
      errorCount.current += 1;
      if (errorCount.current === 1) {
        console.warn(`[Watchdog] erro do plugin nativo: ${error}`);
        logEvent("plugin_error", { error });
        // Grava já: se o plugin nativo derrubar o app em seguida, o que está só
        // em memória (até 5 s) se perderia junto.
        flushLog();
      }
      if (errorCount.current >= errorStreak) {
        restart(`${errorCount.current} erros seguidos do plugin (${error})`);
      }
    },
    [errorStreak, restart],
  );

  useEffect(() => {
    if (!enabled) return;
    lastFrameAt.current = Date.now();
    let tick = 0;
    let lastTickAt = Date.now();
    const timer = setInterval(() => {
      // Atraso do próprio temporizador: se a thread JS ficar bloqueada, o tick
      // chega tarde. É a evidência direta de um JS travado.
      const nowTick = Date.now();
      const lag = Math.max(0, nowTick - lastTickAt - 1000);
      lastTickAt = nowTick;
      if (lag > stats.current.lagMs) stats.current.lagMs = lag;
      if (AppState.currentState !== "active") return;
      tick += 1;
      if (tick % 2 === 0) {
        const { frames, errFrames, noHands, lastError, tsBackwards, lagMs } = stats.current;
        logEvent("plugin", {
          frames,
          errFrames,
          noHands,
          lastError: lastError || undefined,
          tsBackwards,
          lagMs,
          silentMs: Date.now() - lastFrameAt.current,
          ...(probeRef.current?.() ?? {}),
        });
        stats.current = { frames: 0, errFrames: 0, noHands: 0, lastError: "", tsBackwards: 0, lastTs: stats.current.lastTs, lagMs: 0 };
      }
      const silent = Date.now() - lastFrameAt.current;
      if (silent >= stallMs) restart(`nenhum frame processado há ${(silent / 1000).toFixed(1)}s`);
    }, 1000);
    const sub = AppState.addEventListener("change", (state) => {
      // Voltar do segundo plano não conta como silêncio: a câmera acabou de retomar.
      if (state === "active") lastFrameAt.current = Date.now();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, stallMs, restart]);

  return { cameraKey, beat };
}

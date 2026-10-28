import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

interface Options {
  /** Liga/desliga a vigilância (ex.: enquanto o modelo nativo ainda não está pronto). */
  enabled?: boolean;
  /** Sem nenhum resultado do plugin por tanto tempo, a câmera é recriada. */
  stallMs?: number;
  /** Quantos resultados seguidos com `error` do plugin nativo antes de recriar a câmera. */
  errorStreak?: number;
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
 */
export function useFrameWatchdog({ enabled = true, stallMs = 4000, errorStreak = 45 }: Options = {}) {
  const [cameraKey, setCameraKey] = useState(0);
  const lastFrameAt = useRef(Date.now());
  const lastRestartAt = useRef(0);
  const errorCount = useRef(0);

  const restart = useCallback((reason: string) => {
    const now = Date.now();
    if (now - lastRestartAt.current < RESTART_COOLDOWN_MS) return;
    lastRestartAt.current = now;
    lastFrameAt.current = now;
    errorCount.current = 0;
    console.warn(`[Watchdog] recriando a câmera — ${reason}`);
    setCameraKey((k) => k + 1);
  }, []);

  const beat = useCallback(
    (result?: { error?: string } | null) => {
      lastFrameAt.current = Date.now();
      const error = result?.error;
      if (!error) {
        errorCount.current = 0;
        return;
      }
      errorCount.current += 1;
      if (errorCount.current === 1) console.warn(`[Watchdog] erro do plugin nativo: ${error}`);
      if (errorCount.current >= errorStreak) {
        restart(`${errorCount.current} erros seguidos do plugin (${error})`);
      }
    },
    [errorStreak, restart],
  );

  useEffect(() => {
    if (!enabled) return;
    lastFrameAt.current = Date.now();
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") return;
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

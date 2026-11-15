import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { flushLog, isLogEnabled, logEvent } from "@/services/inferenceLogger";
import { cbTrace, renderStats } from "@/services/renderStats";

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

/** Canais do resultado que o resumo de diagnóstico acompanha. */
type Channel = "hands" | "pose" | "face";
const CHANNELS: Channel[] = ["hands", "pose", "face"];

/**
 * Assinatura barata de um canal: as coordenadas do primeiro ponto. Serve só
 * para comparar com o frame anterior — se o canal vem preenchido mas com a
 * assinatura idêntica por vários frames, o plugin está repetindo um resultado
 * velho ("landmarks congelados"), o que é diferente de vir vazio.
 */
function channelSignature(value: unknown): string | null {
  let node: any = value;
  for (let depth = 0; depth < 3 && Array.isArray(node); depth++) node = node[0];
  if (!node || typeof node.x !== "number") return null;
  return `${node.x},${node.y}`;
}

const emptyStats = (lastTs = 0) => ({
  frames: 0, errFrames: 0, noHands: 0, lastError: "", tsBackwards: 0, lastTs, lagMs: 0,
  // Por canal: frames em que veio preenchido e, desses, quantos repetiram o anterior.
  poseFrames: 0, faceFrames: 0, staleHands: 0, stalePose: 0, staleFace: 0,
  // Thread de UI: ticks do requestAnimationFrame (um por vsync) e o maior
  // intervalo entre dois deles. Se os frames da câmera continuam chegando mas
  // os ticks param, a thread de UI está travada — é o que separa "o plugin
  // parou" de "o overlay não consegue desenhar".
  uiTicks: 0, uiGapMs: 0,
});

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
  const stats = useRef(emptyStats());
  const lastSignature = useRef<Record<Channel, string | null>>({ hands: null, pose: null, face: null });

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
    (result?: { error?: string; hands?: unknown[]; pose?: unknown; face?: unknown } | null, frameTs?: number) => {
      cbTrace.beat = 0;
      lastFrameAt.current = Date.now();
      const st = stats.current;
      st.frames += 1;
      if (!result?.hands?.length) st.noHands += 1;
      cbTrace.beat = 1;
      for (const channel of CHANNELS) {
        const signature = channelSignature(result?.[channel]);
        if (signature !== null) {
          if (channel === "pose") st.poseFrames += 1;
          if (channel === "face") st.faceFrames += 1;
          if (signature === lastSignature.current[channel]) {
            if (channel === "hands") st.staleHands += 1;
            else if (channel === "pose") st.stalePose += 1;
            else st.staleFace += 1;
          }
        }
        lastSignature.current[channel] = signature;
      }
      cbTrace.beat = 2;
      // O MediaPipe em modo VIDEO rejeita timestamp que não cresce; contar aqui
      // mostra se o frame da câmera recriada começa "atrás" do anterior.
      if (typeof frameTs === "number") {
        if (st.lastTs && frameTs <= st.lastTs) st.tsBackwards += 1;
        st.lastTs = frameTs;
      }
      cbTrace.beat = 3;
      const error = result?.error;
      cbTrace.beat = 4;
      if (error) {
        st.errFrames += 1;
        st.lastError = error;
      }
      if (!error) {
        errorCount.current = 0;
        cbTrace.beat = 5;
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
    let lastOverlayRenders = renderStats.overlayRenders;
    let lastCbCalls = cbTrace.calls;
    let rafId = 0;
    let lastRafAt = 0;
    const onRaf = () => {
      const now = Date.now();
      if (lastRafAt) stats.current.uiGapMs = Math.max(stats.current.uiGapMs, now - lastRafAt);
      lastRafAt = now;
      stats.current.uiTicks += 1;
      rafId = requestAnimationFrame(onRaf);
    };
    // Só roda com o log ligado: um callback por vsync não deve pesar no uso normal.
    if (isLogEnabled()) rafId = requestAnimationFrame(onRaf);
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
        const { poseFrames, faceFrames, staleHands, stalePose, staleFace, uiTicks, uiGapMs } = stats.current;
        const ovRenders = renderStats.overlayRenders - lastOverlayRenders;
        lastOverlayRenders = renderStats.overlayRenders;
        // O probe lê shared values do worklet, e essa leitura já lançou
        // "__next_prime overflow" de dentro da biblioteca (logcat de 14/11):
        // sem o try/catch o erro subia pelo setInterval e fechava o app.
        // Diagnóstico não pode derrubar a tela que ele observa.
        let probed: Record<string, number> = {};
        let probeError: string | undefined;
        try {
          probed = probeRef.current?.() ?? {};
        } catch (e: any) {
          probeError = e?.message || String(e);
        }
        logEvent("plugin", {
          frames,
          errFrames,
          noHands,
          lastError: lastError || undefined,
          tsBackwards,
          lagMs,
          silentMs: Date.now() - lastFrameAt.current,
          poseFrames,
          faceFrames,
          staleHands,
          stalePose,
          staleFace,
          ovRenders,
          cbCalls: cbTrace.calls - lastCbCalls,
          cbStage: cbTrace.stage,
          cbInst: cbTrace.inst || undefined,
          cbGen: cbTrace.gen || undefined,
          beatStage: cbTrace.beat,
          beatErrs: cbTrace.beatErrs,
          uiTicks,
          uiGapMs,
          probeError,
          ...probed,
        });
        lastCbCalls = cbTrace.calls;
        if (probeError) flushLog();
        stats.current = emptyStats(stats.current.lastTs);
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
      if (rafId) cancelAnimationFrame(rafId);
      sub.remove();
    };
  }, [enabled, stallMs, restart]);

  return { cameraKey, beat };
}

/**
 * Hook de detecção de soletração de Libras.
 *
 * Observa gestos recebidos (normalmente letras do alfabeto) e monta uma
 * palavra automaticamente. Regras:
 *   1. Só letras (1 caractere) entram no buffer — palavras/números ficam fora.
 *   2. A mesma letra precisa permanecer estável por `letterStableMs` antes
 *      de ser commitada, evitando flood do detector rodando em ~10 FPS.
 *   3. Após `spellingIdleMs` sem NENHUMA letra chegando, a palavra é finalizada
 *      automaticamente e o callback `onWordComplete` é disparado. O prazo é
 *      contado da última letra recebida, não da última commitada: o servidor
 *      segue mandando a letra antiga durante o cooldown, e contar do commit
 *      encerrava a palavra antes de a próxima letra chegar.
 *   4. `finalize()` permite encerrar manualmente (botão do usuário).
 *   5. `clear()` descarta o buffer atual sem falar.
 *
 * Não consome diretamente o expo-speech — quem decide falar é a tela,
 * para manter responsabilidade única.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type SpellingConfig = {
  /** Tempo sem receber letras para considerar a palavra completa. */
  spellingIdleMs: number;
  /** Tempo mínimo de estabilidade antes de commitar uma letra. */
  letterStableMs: number;
  /** Confiança mínima para aceitar uma letra. */
  minConfidence: number;
  /** Ativa/desativa todo o detector. */
  enabled: boolean;
};

type Options = {
  config: SpellingConfig;
  /** Chamado quando a palavra é finalizada (auto ou manual). */
  onWordComplete?: (word: string) => void;
  /** Chamado quando uma nova letra entra no buffer. */
  onLetterCommitted?: (letter: string, buffer: string[]) => void;
};

export type SpellingDetector = {
  /** Buffer de letras já commitadas, em ordem. */
  buffer: string[];
  /** True quando o detector está acumulando letras no momento. */
  isSpelling: boolean;
  /** Letra candidata sendo avaliada (ainda não commitada). */
  candidate: string | null;
  /** Recebe uma detecção do modelo de gestos. */
  onDetection: (gesture: string | null, confidence: number) => void;
  /** Finaliza manualmente a soletração agora (dispara onWordComplete). */
  finalize: () => void;
  /** Limpa o buffer sem disparar callback. */
  clear: () => void;
  /** Força reset completo (incluindo candidato). */
  reset: () => void;
};

/**
 * Valida se o rótulo detectado parece uma letra simples (A-Z, 1 char).
 * Aceita letras acentuadas por extensão, mas normaliza para maiúsculo.
 */
function isLetter(label: string): boolean {
  if (!label) return false;
  const trimmed = label.trim();
  if (trimmed.length !== 1) return false;
  return /^[A-Za-zÀ-ÿ]$/.test(trimmed);
}

/**
 * Sem receber nenhuma letra por este tempo, a letra "segurada" é solta e pode
 * ser commitada de novo (é o que permite LL, SS, RR). Enquanto o servidor
 * repete a letra, ela continua segurada.
 */
const RELEASE_MS = 600;

export function useSpellingDetector({
  config,
  onWordComplete,
  onLetterCommitted,
}: Options): SpellingDetector {
  const [buffer, setBuffer] = useState<string[]>([]);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [isSpelling, setIsSpelling] = useState(false);

  // Refs para timers e estado imperativo (evita closures stale)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stabilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Última letra commitada que o usuário ainda está mostrando. Sobrevive à
  // finalização da palavra: segurar a pose depois disso não pode recomeçar
  // outra palavra com a mesma letra.
  const heldRef = useRef<string | null>(null);
  const candidateRef = useRef<string | null>(null);
  const bufferRef = useRef<string[]>([]);
  const configRef = useRef(config);
  const callbacksRef = useRef({ onWordComplete, onLetterCommitted });

  // Mantém refs sincronizadas com props mais recentes
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    callbacksRef.current = { onWordComplete, onLetterCommitted };
  }, [onWordComplete, onLetterCommitted]);

  useEffect(() => {
    bufferRef.current = buffer;
  }, [buffer]);

  // Limpa timers ao desmontar
  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current);
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    };
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const clearStabilityTimer = useCallback(() => {
    if (stabilityTimerRef.current) {
      clearTimeout(stabilityTimerRef.current);
      stabilityTimerRef.current = null;
    }
  }, []);

  // Rearma a contagem de "soltou a mão": só dispara se as letras pararem de chegar.
  const armRelease = useCallback(() => {
    if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = setTimeout(() => {
      releaseTimerRef.current = null;
      heldRef.current = null;
    }, RELEASE_MS);
  }, []);

  const finalizeInternal = useCallback(
    (reason: "auto" | "manual") => {
      const current = bufferRef.current;
      clearIdleTimer();
      clearStabilityTimer();
      if (current.length === 0) {
        setIsSpelling(false);
        setCandidate(null);
        candidateRef.current = null;
        return;
      }
      const word = current.join("");
      // Reset primeiro para que a próxima palavra comece limpa
      bufferRef.current = [];
      setBuffer([]);
      setIsSpelling(false);
      setCandidate(null);
      candidateRef.current = null;
      try {
        callbacksRef.current.onWordComplete?.(word);
      } catch (e) {
        console.log("[useSpellingDetector] onWordComplete threw:", e);
      }
    },
    [clearIdleTimer, clearStabilityTimer]
  );

  const scheduleIdleFinalize = useCallback(() => {
    clearIdleTimer();
    const delay = Math.max(500, configRef.current.spellingIdleMs);
    idleTimerRef.current = setTimeout(() => {
      finalizeInternal("auto");
    }, delay);
  }, [clearIdleTimer, finalizeInternal]);

  const commitLetter = useCallback(
    (letter: string) => {
      const next = [...bufferRef.current, letter];
      bufferRef.current = next;
      heldRef.current = letter;
      setBuffer(next);
      setIsSpelling(true);
      setCandidate(null);
      candidateRef.current = null;
      try {
        callbacksRef.current.onLetterCommitted?.(letter, next);
      } catch (e) {
        console.log("[useSpellingDetector] onLetterCommitted threw:", e);
      }
      scheduleIdleFinalize();
    },
    [scheduleIdleFinalize]
  );

  const onDetection = useCallback(
    (gesture: string | null, confidence: number) => {
      const cfg = configRef.current;
      if (!cfg.enabled) return;
      if (!gesture) return;
      if (!isLetter(gesture)) {
        // Rótulo não-letra: ignora para soletração (mas não cancela buffer).
        return;
      }
      if (confidence < cfg.minConfidence) return;

      const letter = gesture.trim().toUpperCase();

      // Chegou uma letra: o usuário ainda está soletrando, então a palavra não
      // pode ser encerrada por ociosidade, e a contagem de "soltou" recomeça.
      if (bufferRef.current.length > 0) scheduleIdleFinalize();
      armRelease();

      // Ainda mostrando a letra que já entrou: ignora por completo (nem vira
      // candidata). Só entra de novo depois de soltar ou de trocar de letra.
      if (letter === heldRef.current) return;

      if (candidateRef.current === letter) {
        // Mesmo candidato mantendo estabilidade — nada a fazer, aguardamos timer.
        return;
      }

      // Novo candidato
      candidateRef.current = letter;
      setCandidate(letter);
      clearStabilityTimer();

      const stableDelay = Math.max(150, cfg.letterStableMs);
      stabilityTimerRef.current = setTimeout(() => {
        // Ao estabilizar, só entra se ainda for o candidato e não for a letra
        // que continua segurada (ela pode ter sido commitada nesse intervalo).
        if (candidateRef.current !== letter) return;
        if (heldRef.current === letter) return;
        commitLetter(letter);
      }, stableDelay);
    },
    [armRelease, clearStabilityTimer, commitLetter, scheduleIdleFinalize]
  );

  const finalize = useCallback(() => {
    finalizeInternal("manual");
  }, [finalizeInternal]);

  const clear = useCallback(() => {
    clearIdleTimer();
    clearStabilityTimer();
    if (releaseTimerRef.current) {
      clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
    heldRef.current = null;
    bufferRef.current = [];
    setBuffer([]);
    setIsSpelling(false);
    setCandidate(null);
    candidateRef.current = null;
  }, [clearIdleTimer, clearStabilityTimer]);

  const reset = clear;

  return {
    buffer,
    isSpelling,
    candidate,
    onDetection,
    finalize,
    clear,
    reset,
  };
}

export default useSpellingDetector;

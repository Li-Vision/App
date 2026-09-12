/**
 * Ponte entre o coletor de erros e a UI.
 *
 * O `errorReporter` é um módulo puro (chamável de qualquer lugar, inclusive de
 * fora da árvore React); este contexto apenas o observa e expõe o estado para
 * o modal, além de instalar os handlers globais uma única vez.
 *
 * @see ../services/errorReporter.ts
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  AppError,
  clearErrors,
  dismissError,
  installGlobalHandlers,
  subscribe,
} from "@/services/errorReporter";

type ErrorContextValue = {
  errors: AppError[];
  /** Aberto automaticamente ao chegar um erro novo; fechável pelo usuário. */
  visible: boolean;
  open: () => void;
  close: () => void;
  clear: () => void;
  dismiss: (id: string) => void;
};

const ErrorContext = createContext<ErrorContextValue | null>(null);

export function ErrorProvider({ children }: { children: React.ReactNode }) {
  const [errors, setErrors] = useState<AppError[]>([]);
  const [visible, setVisible] = useState(false);
  const [seen, setSeen] = useState(0);

  useEffect(() => {
    installGlobalHandlers();
    return subscribe(setErrors);
  }, []);

  // Abre sozinho APENAS na primeira vez. Depois que o usuário fecha, novos
  // erros passam a ser silenciosos: só voltam a aparecer quando ele reabrir o
  // modal pela ação explícita (`open`). Reabrir a cada erro novo tornava o app
  // inutilizável — uma falha recorrente (rede, sessão, um canal de detecção)
  // gera dezenas de entradas distintas e o modal reaparecia sem parar.
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (!autoOpened && errors.length > 0) {
      setVisible(true);
      setAutoOpened(true);
    }
  }, [errors.length, autoOpened]);

  const value = useMemo<ErrorContextValue>(
    () => ({
      errors,
      visible,
      open: () => setVisible(true),
      close: () => {
        setVisible(false);
        setSeen(errors.length);
      },
      clear: () => {
        clearErrors();
        setSeen(0);
        setVisible(false);
      },
      dismiss: (id: string) => {
        dismissError(id);
        setSeen((s) => Math.max(0, s - 1));
      },
    }),
    [errors, visible],
  );

  return <ErrorContext.Provider value={value}>{children}</ErrorContext.Provider>;
}

export function useErrors(): ErrorContextValue {
  const ctx = useContext(ErrorContext);
  if (!ctx) throw new Error("useErrors precisa estar dentro de <ErrorProvider>");
  return ctx;
}

/**
 * Contadores de renderização lidos só pelo log de diagnóstico (ver
 * hooks/useFrameWatchdog.ts). Ficam num módulo à parte para o componente visual
 * não precisar conhecer o hook, nem o hook importar um componente.
 */
export const renderStats = {
  /** Quantas vezes o LandmarkOverlay renderizou (cada render recria todas as Views dos pontos). */
  overlayRenders: 0,
};

/**
 * [DIAG travamento] Rastro do callback de landmarks da tela de reconhecimento.
 * Fica no módulo (e não num ref) de propósito: o log de 14/11 23:42 mostrou os
 * frames sendo contados enquanto os contadores em ref da mesma tela ficavam em
 * zero, então o rastro não pode depender de qual instância/closure está viva.
 */
export const cbTrace = {
  calls: 0,      // entradas no callback (antes de qualquer outra coisa)
  stage: 0,      // última etapa concluída na chamada mais recente (5 = fim)
  inst: "",      // instância da tela que criou o closure em execução
  gen: 0,        // render em que esse closure foi criado
  beat: 0,       // última etapa concluída dentro do beat() do watchdog (5 = fim)
  beatErrs: 0,   // exceções lançadas por beat()
};

/**
 * Serviço WebSocket para detecção de gestos em tempo real.
 *
 * Mantém uma conexão persistente com a API, enviando landmarks
 * e recebendo resultados de detecção continuamente.
 *
 * MULTI-TENANT: Suporta envio do modo de detecção via query param
 * e ações de controle (set_mode, start_collect, stop_collect).
 *
 * Features:
 * - Reconexão automática com backoff exponencial
 * - Callback de gesto detectado
 * - Callback de status de conexão (para UI)
 * - Limpeza de recursos ao desconectar
 */

import type { HolisticPayload } from "@/services/holisticFeatures";
import { wsUrl } from "@/config/api";
import { isLogEnabled, logEvent } from "@/services/inferenceLogger";

const WS_DETECT_URL = wsUrl("/ws/detect");

// Render plano gratuito fecha conexoes idle com codigo 1000.
// Usamos tentativas ilimitadas com cap de 30s para manter conexao.
const MAX_RECONNECT_ATTEMPTS = Infinity;
const INITIAL_RECONNECT_DELAY = 1000; // 1s
const MAX_RECONNECT_DELAY = 30_000;   // 30s teto

// Controle de fluxo do reconhecimento (ver sendHolisticLimited).
const MAX_IN_FLIGHT = 2;               // frames enviados sem resposta
const IN_FLIGHT_TIMEOUT_MS = 1000;     // sem resposta além disto = frame perdido

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting" | "failed";

export type DetectionMode = "hybrid" | "rules" | "ml" | "dynamic_ml";

export type GestureResult = {
  gesture: string | null;
  confidence: number;
  /** Modo de detecção ativo na sessão (rules | ml | dynamic_ml | hybrid) */
  mode?: string;
  error?: string;
  /** Landmarks retornados pelo MediaPipe do servidor */
  landmarks?: any[];
  /** Resposta de ações de controle */
  ok?: boolean;
  action?: string;
  detectors?: number;
  status?: string;
  sequences?: number;
  /** Diagnóstico do servidor: detector vencedor e resposta de cada detector */
  debug?: {
    winner: string | null;
    cooldown: boolean;
    trace: { detector: string; label: string | null; score: number; motion?: number }[];
  };
};

type GestureCallback = (result: GestureResult) => void;
type StatusCallback = (status: ConnectionStatus, message?: string) => void;

class GestureWebSocket {
  private ws: WebSocket | null = null;
  private onGesture: GestureCallback | null = null;
  private onStatusChange: StatusCallback | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private currentMode: DetectionMode = "hybrid";
  private useRules = false;

  private activeModelName: string | null = null;

  // Métricas só para o log de diagnóstico (ver services/inferenceLogger.ts).
  private lastSendAt = 0;
  private lastResAt = 0;
  private sentSinceRes = 0;
  private lastSchema = "";

  // Controle de fluxo do reconhecimento (ver sendHolisticLimited): instante de
  // envio de cada frame ainda sem resposta, do mais antigo ao mais novo.
  private pendingSends: number[] = [];
  private droppedSinceRes = 0;

  /**
   * Conecta ao WebSocket da API com o modo de detecção especificado.
   * @param onGesture - callback chamado a cada resposta de detecção
   * @param onStatusChange - callback chamado quando o status da conexão muda
   * @param mode - modo de detecção (hybrid/rules/ml/dynamic_ml)
   * @param activeModelName - nome do idioma de IA principal selecionado
   * @param useRules - flag global para habilitar/desabilitar regras lógicas
   */
  connect(onGesture: GestureCallback, onStatusChange?: StatusCallback, mode?: DetectionMode, activeModelName?: string | null, useRules?: boolean): void {
    this.onGesture = onGesture;
    this.onStatusChange = onStatusChange ?? null;
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    if (mode) this.currentMode = mode;
    if (activeModelName !== undefined) this.activeModelName = activeModelName;
    if (useRules !== undefined) this.useRules = useRules;
    this._connect();
  }

  private _connect(): void {
    // Limpa conexão anterior se existir
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    this._setStatus(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");

    // Envia o modo de detecção e o modelo ativo como query parameter
    let url = `${WS_DETECT_URL}?mode=${this.currentMode}&use_rules=${this.useRules}`;
    if (this.activeModelName) {
      url += `&model=${encodeURIComponent(this.activeModelName)}`;
    }

    logEvent("connect", {
      mode: this.currentMode,
      rules: this.useRules,
      model: this.activeModelName,
      attempt: this.reconnectAttempts,
    });

    const ws = new WebSocket(url);

    // Conexão nova: nenhuma resposta pendente da anterior vai chegar.
    this.pendingSends = [];

    ws.onopen = () => {
      console.log(`[WS] Conectado (modo: ${this.currentMode})`);
      logEvent("open");
      this.reconnectAttempts = 0;
      this._setStatus("connected");
    };

    ws.onmessage = (event: WebSocketMessageEvent) => {
      try {
        const result: GestureResult = JSON.parse(event.data);
        // Cada resposta de detecção quita o frame pendente mais antigo. Respostas
        // de controle (set_mode etc.) não correspondem a um frame enviado.
        const isControl = !!result.action || result.ok !== undefined;
        const sentAt = isControl ? undefined : this.pendingSends.shift();
        if (isLogEnabled()) this._logResult(result, sentAt);
        this.onGesture?.(result);
      } catch (e) {
        console.log("[WS] Erro ao parsear resposta:", e);
      }
    };

    ws.onerror = (event: Event) => {
      logEvent("error");
      console.log("[WS] Erro Capturado na Conexão:", event);
    };

    ws.onclose = (event: WebSocketCloseEvent) => {
      console.log(`[WS] Conexao fechada. Codigo: ${event.code}, Razao: "${event.reason}"`);
      logEvent("close", { code: event.code, reason: event.reason, intentional: this.intentionalClose });

      if (!this.intentionalClose) {
        // Qualquer fechamento nao-intencional (incluindo codigo 1000 do Render
        // por inatividade) dispara reconexao automatica.
        this._attemptReconnect();
      } else {
        this._setStatus("disconnected");
      }
    };

    this.ws = ws;
  }

  /**
   * Reconecta com um novo modo de detecção.
   * Fecha a conexão atual e reconecta com o modo especificado.
   */
  reconnectWithMode(mode: DetectionMode, useRules?: boolean): void {
    this.currentMode = mode;
    if (useRules !== undefined) this.useRules = useRules;
    this.intentionalClose = true; // Evita reconexão automática durante a troca

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    // Reconecta imediatamente com o novo modo
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    this._connect();
  }

  /**
   * Envia uma ação de controle (set_mode, start_collect, stop_collect) pelo WebSocket.
   */
  sendAction(action: Record<string, any>): void {
    // Guarda o modo escolhido: se a conexão cair, a reconexão sobe no mesmo modo.
    // Sem isso ela voltava como "hybrid" até o modo ser reenviado, e o modelo
    // selecionado deixava de valer por alguns segundos.
    if (action.action === "set_mode" && typeof action.mode === "string") {
      this.currentMode = action.mode as DetectionMode;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(action));
    }
  }

  /**
   * Envia os bytes do frame redimensionado para a API para processamento.
   * @deprecated Use sendLandmarks() para edge computing (muito mais leve).
   */
  sendFrame(frameData: ArrayBuffer | Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(frameData);
    }
  }

  /**
   * Envia landmarks JSON para a API classificar o gesto.
   * Formato esperado pela API: [[{x, y, z}, ...21 pontos], ...mãos]
   * Trafego: ~1KB vs 196KB do sendFrame (redução de 99.5%)
   *
   * Este é o caminho legado (schema hands_v1). Para enviar mãos + corpo + rosto
   * use sendHolistic().
   */
  sendLandmarks(hands: Array<Array<{ x: number; y: number; z: number }>>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(hands));
    }
  }

  /**
   * Envia o payload holístico (mãos + corpo + rosto) para a API.
   *
   * Aceita tanto o array legado de mãos (schema hands_v1) quanto o objeto
   * `{ hands, pose?, face? }` (schema holistic_v1). O backend detecta o schema
   * pela *forma* do payload — array = hands_v1, objeto = holistic_v1 —, então
   * este método cobre os dois casos sem mudança de protocolo.
   *
   * @see services/holisticFeatures.ts (buildPayload)
   */
  sendHolistic(payload: HolisticPayload): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.lastSendAt = Date.now();
      this.sentSinceRes++;
      this.lastSchema = Array.isArray(payload) ? "hands_v1" : "holistic_v1";
      this.ws.send(JSON.stringify(payload));
    }
  }

  /**
   * Como sendHolistic, mas com controle de fluxo, para o RECONHECIMENTO.
   *
   * O app captura bem mais frames do que o servidor processa quando ele atrasa.
   * Sem limite, os frames sobrantes formam uma fila: a resposta chegava até 35 s
   * depois do gesto e continuava saindo depois de a mão ter saído do quadro.
   * Aqui só há `MAX_IN_FLIGHT` frames sem resposta; o resto é descartado, então
   * o atraso fica limitado e o servidor nunca recebe mais do que consegue
   * processar. Com o servidor rápido (~60 ms) nada é descartado.
   *
   * O servidor não responde a todo frame (sem mão ele ignora), então um frame
   * sem resposta há mais de `IN_FLIGHT_TIMEOUT_MS` é dado como perdido.
   *
   * Não usar na coleta: as respostas dela têm outro formato.
   *
   * @returns true se o frame foi enviado, false se foi descartado ou não há conexão.
   */
  sendHolisticLimited(payload: HolisticPayload): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;

    const now = Date.now();
    if (this.pendingSends.length >= MAX_IN_FLIGHT) {
      if (now - this.pendingSends[0] < IN_FLIGHT_TIMEOUT_MS) {
        this.droppedSinceRes++;
        return false;
      }
      this.pendingSends = []; // resposta perdida: libera o fluxo
    }

    this.pendingSends.push(now);
    this.sendHolistic(payload);
    return true;
  }

  /**
   * Verifica se a conexão está ativa.
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Retorna o modo de detecção atual.
   */
  getMode(): DetectionMode {
    return this.currentMode;
  }

  /**
   * Desconecta intencionalmente (sem reconexão).
   */
  disconnect(): void {
    this.intentionalClose = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }

    this._setStatus("disconnected");
  }

  /**
   * Tenta reconectar com backoff exponencial.
   */
  private _attemptReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log("[WS] Numero maximo de tentativas atingido");
      this._setStatus("failed", `Falha ao reconectar apos ${this.reconnectAttempts} tentativas`);
      return;
    }

    this.reconnectAttempts++;
    // Backoff exponencial com teto em MAX_RECONNECT_DELAY
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY
    );

    console.log(`[WS] Reconectando em ${delay}ms (tentativa ${this.reconnectAttempts})`);
    this._setStatus("reconnecting", `Tentativa ${this.reconnectAttempts}`);

    this.reconnectTimer = setTimeout(() => {
      this._connect();
    }, delay);
  }

  /** Registra uma resposta do servidor (só chamado com o log ligado). */
  private _logResult(result: GestureResult, sentAt?: number): void {
    if (result.action || result.ok !== undefined) {
      // buf/seq/err só vêm nas respostas de coleta: sem eles o log mostrava que
      // o servidor respondeu, mas não se o frame entrou na sequência.
      const collect = result as GestureResult & { buffer?: number; collecting?: boolean };
      logEvent("ctl", {
        action: result.action,
        ok: result.ok,
        mode: result.mode,
        collecting: collect.collecting,
        buf: collect.buffer,
        seq: result.sequences,
        err: result.error,
      });
      return;
    }
    const now = Date.now();
    logEvent("res", {
      g: result.gesture,
      c: result.confidence,
      hands: result.landmarks?.length,
      schema: this.lastSchema,
      rtt: this.lastSendAt ? now - this.lastSendAt : undefined, // último envio -> resposta
      frameRtt: sentAt ? now - sentAt : undefined,              // ESTE frame: envio -> resposta
      pending: this.pendingSends.length,                        // frames ainda sem resposta
      dropped: this.droppedSinceRes,                            // descartados desde a última resposta
      dt: this.lastResAt ? now - this.lastResAt : undefined,    // entre respostas
      sent: this.sentSinceRes,
      err: result.error,
      dbg: result.debug,
    });
    this.lastResAt = now;
    this.sentSinceRes = 0;
    this.droppedSinceRes = 0;
  }

  private _setStatus(status: ConnectionStatus, message?: string): void {
    this.onStatusChange?.(status, message);
  }
}

// Singleton — uma única instância para toda a app
export const gestureWS = new GestureWebSocket();

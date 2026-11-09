jest.mock("@/config/api", () => ({ wsUrl: (p: string) => `ws://test${p}` }));
jest.mock("@/services/inferenceLogger", () => ({ isLogEnabled: () => false, logEvent: jest.fn() }));

type FakeSocket = {
  url: string;
  readyState: number;
  send: jest.Mock;
  close: jest.Mock;
  onclose?: (e: { code: number; reason: string }) => void;
  onmessage?: (e: { data: string }) => void;
};

const sockets: FakeSocket[] = [];

class FakeWebSocket {
  static OPEN = 1;
  url: string;
  readyState = 1;
  send = jest.fn();
  close = jest.fn();
  constructor(url: string) {
    this.url = url;
    sockets.push(this as unknown as FakeSocket);
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  sockets.length = 0;
  (global as any).WebSocket = FakeWebSocket;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("gestureWS modo escolhido", () => {
  it("a reconexão após queda usa o modo trocado em sessão, não o inicial", () => {
    const { gestureWS } = require("../gestureWebSocket");

    gestureWS.connect(jest.fn(), undefined, "hybrid", "HOLISTICO", false);
    expect(sockets[0].url).toContain("mode=hybrid");

    // O usuário troca para o modelo dinâmico na sessão aberta.
    gestureWS.sendAction({ action: "set_mode", mode: "dynamic_ml" });
    expect(sockets[0].send).toHaveBeenCalledWith(JSON.stringify({ action: "set_mode", mode: "dynamic_ml" }));

    // Queda não intencional (1006): o socket novo sobe no modo escolhido.
    sockets[0].onclose?.({ code: 1006, reason: "" });
    jest.advanceTimersByTime(1000);

    expect(sockets).toHaveLength(2);
    expect(sockets[1].url).toContain("mode=dynamic_ml");

    gestureWS.disconnect();
  });

  // (continua abaixo: controle de fluxo)
  it("guarda o modo mesmo se a troca for pedida com a conexão fechada", () => {
    const { gestureWS } = require("../gestureWebSocket");

    gestureWS.connect(jest.fn(), undefined, "hybrid", null, false);
    sockets[0].readyState = 3; // CLOSED
    gestureWS.sendAction({ action: "set_mode", mode: "ml" });

    expect(gestureWS.getMode()).toBe("ml");
    gestureWS.disconnect();
  });
});

describe("gestureWS.sendHolisticLimited (controle de fluxo)", () => {
  const payload = { hands: [[]] } as any;

  function connect() {
    const { gestureWS } = require("../gestureWebSocket");
    gestureWS.connect(jest.fn(), undefined, "hybrid", null, false);
    return { gestureWS, socket: sockets[sockets.length - 1] };
  }

  const answer = (socket: FakeSocket, extra: object = {}) =>
    socket.onmessage?.({ data: JSON.stringify({ gesture: null, confidence: 0, landmarks: [], ...extra }) });

  it("envia até 2 frames sem resposta e descarta o resto", () => {
    const { gestureWS, socket } = connect();

    expect(gestureWS.sendHolisticLimited(payload)).toBe(true);
    expect(gestureWS.sendHolisticLimited(payload)).toBe(true);
    expect(gestureWS.sendHolisticLimited(payload)).toBe(false); // fila cheia: descarta
    expect(socket.send).toHaveBeenCalledTimes(2);

    gestureWS.disconnect();
  });

  it("uma resposta de detecção libera uma vaga", () => {
    const { gestureWS, socket } = connect();
    gestureWS.sendHolisticLimited(payload);
    gestureWS.sendHolisticLimited(payload);

    answer(socket);

    expect(gestureWS.sendHolisticLimited(payload)).toBe(true);
    expect(socket.send).toHaveBeenCalledTimes(3);
    gestureWS.disconnect();
  });

  it("resposta de controle (set_mode) não libera vaga", () => {
    const { gestureWS, socket } = connect();
    gestureWS.sendHolisticLimited(payload);
    gestureWS.sendHolisticLimited(payload);

    answer(socket, { action: "set_mode", ok: true });

    expect(gestureWS.sendHolisticLimited(payload)).toBe(false);
    gestureWS.disconnect();
  });

  it("frame sem resposta por mais de 1 s é dado como perdido (servidor ignora frame sem mão)", () => {
    const { gestureWS } = connect();
    gestureWS.sendHolisticLimited(payload);
    gestureWS.sendHolisticLimited(payload);
    expect(gestureWS.sendHolisticLimited(payload)).toBe(false);

    jest.advanceTimersByTime(1001);

    expect(gestureWS.sendHolisticLimited(payload)).toBe(true);
    gestureWS.disconnect();
  });

  it("conexão nova zera os pendentes da anterior", () => {
    const { gestureWS, socket } = connect();
    gestureWS.sendHolisticLimited(payload);
    gestureWS.sendHolisticLimited(payload);

    socket.onclose?.({ code: 1006, reason: "" });
    jest.advanceTimersByTime(1000); // reconecta

    expect(gestureWS.sendHolisticLimited(payload)).toBe(true);
    gestureWS.disconnect();
  });

  it("sem conexão aberta não envia", () => {
    const { gestureWS, socket } = connect();
    socket.readyState = 3;
    expect(gestureWS.sendHolisticLimited(payload)).toBe(false);
    gestureWS.disconnect();
  });
});

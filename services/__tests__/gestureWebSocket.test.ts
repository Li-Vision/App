jest.mock("@/config/api", () => ({ wsUrl: (p: string) => `ws://test${p}` }));
jest.mock("@/services/inferenceLogger", () => ({ isLogEnabled: () => false, logEvent: jest.fn() }));

type FakeSocket = {
  url: string;
  readyState: number;
  send: jest.Mock;
  close: jest.Mock;
  onclose?: (e: { code: number; reason: string }) => void;
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

  it("guarda o modo mesmo se a troca for pedida com a conexão fechada", () => {
    const { gestureWS } = require("../gestureWebSocket");

    gestureWS.connect(jest.fn(), undefined, "hybrid", null, false);
    sockets[0].readyState = 3; // CLOSED
    gestureWS.sendAction({ action: "set_mode", mode: "ml" });

    expect(gestureWS.getMode()).toBe("ml");
    gestureWS.disconnect();
  });
});

describe("wakeServer", () => {
  const fetchMock = jest.fn();
  let status: typeof import("../connectionStatus");

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    fetchMock.mockReset();
    (globalThis as any).fetch = fetchMock;
    status = require("../connectionStatus");
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("chama /healthz e mantém online quando a API responde", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    await status.wakeServer();

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/healthz$/);
    expect(status.getConnectionState()).toBe("online");
  });

  it("marca offline em 502 (cold start ainda em andamento)", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 502 }));

    await status.wakeServer();

    expect(status.getConnectionState()).toBe("offline");
  });

  it("marca offline em falha de rede e nunca lança", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));

    await expect(status.wakeServer()).resolves.toBeUndefined();
    expect(status.getConnectionState()).toBe("offline");
  });
});

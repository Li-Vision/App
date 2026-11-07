import { apiRequest } from "../http";
import { getConnectionState } from "@/services/connectionStatus";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn(),
  multiRemove: jest.fn(),
}));
jest.mock("@/services/errorReporter", () => ({ report: jest.fn() }));

const { report } = jest.requireMock("@/services/errorReporter") as { report: jest.Mock };

function res(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status });
}

async function run<T>(promise: Promise<T>): Promise<T> {
  // Avança as esperas do backoff (1s + 2s) sem aguardar de verdade.
  await jest.advanceTimersByTimeAsync(5000);
  return promise;
}

describe("apiRequest · retry e disponibilidade do servidor", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockReset();
    report.mockClear();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("GET repete em 502 e retorna o sucesso sem sinalizar queda", async () => {
    fetchMock.mockResolvedValueOnce(res(502)).mockResolvedValueOnce(res(200, { ok: true }));

    const data = await run(apiRequest<{ ok: boolean }>("/auth/profile"));

    expect(data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getConnectionState()).toBe("online");
    expect(report).not.toHaveBeenCalled();
  });

  it("GET repete em falha de rede", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(res(200, { ok: true }));

    await run(apiRequest("/auth/profile"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("esgotadas as tentativas: lança, marca offline e não vai ao modal de erros", async () => {
    fetchMock.mockResolvedValue(res(502));

    const promise = apiRequest("/auth/profile");
    const assertion = expect(promise).rejects.toMatchObject({ status: 502 });
    await jest.advanceTimersByTimeAsync(5000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retentativas
    expect(getConnectionState()).toBe("offline");
    expect(report).not.toHaveBeenCalled();
  });

  it("POST nunca é repetido, mesmo com 502", async () => {
    fetchMock.mockResolvedValue(res(502));

    const promise = apiRequest("/auth/profile", { method: "POST", body: "{}" });
    const assertion = expect(promise).rejects.toMatchObject({ status: 502 });
    await jest.advanceTimersByTimeAsync(5000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("outros erros HTTP (ex.: 500) continuam indo ao modal e não são repetidos", async () => {
    fetchMock.mockResolvedValue(res(500, { detail: "boom" }));

    await expect(apiRequest("/algo")).rejects.toMatchObject({ status: 500 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("API", "boom", expect.anything());
  });
});

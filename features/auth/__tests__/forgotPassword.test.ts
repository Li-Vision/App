import 'react-native-gesture-handler/jestSetup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authService } from '../authService';
import { API_BASE_URL } from '@/config/api';

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
// O mock de AsyncStorage vem do jest-setup.js e expõe getItem/setItem como
// jest.fn() — sem store real, então cada teste define o retorno que precisa.
const mockGetItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;

/** Resposta JSON mínima que o apiRequest consegue interpretar. */
function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('authService.forgotPassword', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
  });

  it('faz POST em /auth/forgot-password com o e-mail no corpo', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const res = await authService.forgotPassword('alguem@exemplo.com');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/auth/forgot-password`);
    expect((options as RequestInit).method).toBe('POST');
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({
      email: 'alguem@exemplo.com',
    });
    expect(res).toEqual({ ok: true });
  });

  it('não distingue e-mail cadastrado de não cadastrado', async () => {
    // A rota responde ok:true nos dois casos, de propósito: diferenciar
    // transformaria o endpoint num oráculo de quais contas existem. O serviço
    // não pode inventar essa distinção no cliente.
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(authService.forgotPassword('naoexiste@exemplo.com'))
      .resolves.toEqual({ ok: true });
  });

  it('um 401 NÃO dispara tentativa de refresh de token', async () => {
    // /auth/forgot-password é rota pública: se o interceptor tentasse renovar o
    // token, o erro real viraria "Sessão expirada" e o usuário deslogado
    // perderia o acesso à recuperação — justamente quando mais precisa dela.
    // Há um refreshToken salvo: se a rota não fosse tratada como pública, o
    // interceptor teria material para tentar a renovação.
    mockGetItem.mockResolvedValue('refresh-antigo');
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ detail: 'Rate limit' }, { ok: false, status: 401 }),
    );

    await expect(authService.forgotPassword('alguem@exemplo.com')).rejects.toThrow();

    // Uma única chamada: nada de /auth/refresh nem de retry.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(`${API_BASE_URL}/auth/forgot-password`);
  });

  it('propaga falha de servidor para a UI poder avisar', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ detail: 'Erro interno' }, { ok: false, status: 500 }),
    );
    await expect(authService.forgotPassword('alguem@exemplo.com'))
      .rejects.toMatchObject({ status: 500 });
  });
});

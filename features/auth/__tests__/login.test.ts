import 'react-native-gesture-handler/jestSetup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authService } from '../authService';
import { describeLoginError } from '../loginError';
import { ApiError } from '@/lib/http';
import { clearErrors, getErrors } from '@/services/errorReporter';

globalThis.fetch = jest.fn();
const mockFetch = globalThis.fetch as jest.MockedFunction<typeof fetch>;
const mockGetItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('login com senha errada', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearErrors();
    mockGetItem.mockResolvedValue(null);
  });

  it('rejeita com ApiError 401 e NÃO manda o erro ao modal global', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ detail: 'Invalid login credentials' }, { ok: false, status: 401 }),
    );

    await expect(authService.login('a@b.com', 'errada')).rejects.toMatchObject({ status: 401 });

    // O aviso amigável vem da tela de login; o modal técnico não pode aparecer.
    expect(getErrors()).toHaveLength(0);
  });

  it('o registro também não manda o erro ao modal global', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ detail: 'Email already registered' }, { ok: false, status: 400 }),
    );

    await expect(authService.register('Nome', 'a@b.com', 'senha123')).rejects.toBeInstanceOf(ApiError);
    expect(getErrors()).toHaveLength(0);
  });
});

describe('describeLoginError', () => {
  it('401 vira a mensagem amigável de credenciais incorretas', () => {
    expect(describeLoginError(new ApiError(401, 'Invalid login credentials'))).toEqual({
      title: 'login.access_denied',
      message: 'login.wrong_credentials',
    });
  });

  it('5xx e falha de rede viram erro de conexão, não culpa o usuário', () => {
    const conn = { title: 'login.connection_error', message: 'login.connection_failed' };
    expect(describeLoginError(new ApiError(502, ''))).toEqual(conn);
    expect(describeLoginError(new TypeError('Network request failed'))).toEqual(conn);
  });

  it('outros status mantêm a mensagem do servidor (sem texto fixo)', () => {
    expect(describeLoginError(new ApiError(403, 'Confirme seu e-mail'))).toEqual({
      title: 'login.access_denied',
    });
  });
});

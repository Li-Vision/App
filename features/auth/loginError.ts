import { ApiError } from "@/lib/http";

// Módulo puro (sem navegação): testável sem carregar o expo-router.
/**
 * Escolhe o aviso amigável para uma falha de login. 401 é senha/e-mail errados
 * (o texto cru do servidor é técnico e em inglês); 5xx é o servidor, não o
 * usuário; qualquer outro status mantém a mensagem que o servidor mandou.
 */
export function describeLoginError(e: unknown): { title: string; message?: string } {
  if (e instanceof ApiError) {
    if (e.status === 401) return { title: "login.access_denied", message: "login.wrong_credentials" };
    if (e.status >= 500) return { title: "login.connection_error", message: "login.connection_failed" };
    return { title: "login.access_denied" };
  }
  return { title: "login.connection_error", message: "login.connection_failed" };
}

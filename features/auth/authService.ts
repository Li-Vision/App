import { apiRequest } from "@/lib/http";
import { UserStorage } from "@/lib/storage";
import type { LoginResponse, RegisterResponse } from "./types";

export const authService = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const data = await apiRequest<LoginResponse>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    await UserStorage.saveSession({
      token: data.token,
      refreshToken: data.refresh_token,
      userId: String(data.user_id),
      role: String(data.role),
      name: data.full_name,
      avatarUrl: data.avatar_url,
    });
    return data;
  },

  /**
   * Pede ao backend o e-mail de redefinição de senha.
   *
   * A rota responde `ok: true` mesmo para e-mails não cadastrados — de
   * propósito, para não revelar quais contas existem. A UI, portanto, mostra a
   * mesma mensagem em qualquer caso.
   */
  async forgotPassword(email: string): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>("/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  },

  async register(full_name: string, email: string, password: string): Promise<RegisterResponse> {
    const data = await apiRequest<RegisterResponse>("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name, email, password }),
    });
    await UserStorage.saveSession({
      token: data.token,
      refreshToken: data.refresh_token,
      userId: String(data.user_id),
      role: String(data.role),
      name: data.full_name,
    });
    return data;
  },
};

export interface LoginResponse {
  ok: boolean;
  token: string;
  refresh_token: string;
  user_id: number;
  role: string;
  full_name: string;
  avatar_url?: string;
}

export interface RegisterResponse {
  ok: boolean;
  /** Nulos quando o Supabase exige confirmação de e-mail (conta criada, sem sessão). */
  token: string | null;
  refresh_token: string | null;
  user_id?: number;
  user?: string | number | null;
  role?: string;
  full_name?: string;
  detail?: string;
}

export interface RefreshResponse {
  ok: boolean;
  token: string;
  refresh_token?: string;
}

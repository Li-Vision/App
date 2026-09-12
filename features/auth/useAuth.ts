import { useState } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { authService } from "./authService";
import { ApiError } from "@/lib/http";
import { UserStorage } from "@/lib/storage";

export function useAuth() {
  const [loading, setLoading] = useState(false);
  // Separado de `loading`: o spinner do botão "Entrar" não deve aparecer
  // enquanto o e-mail de recuperação é pedido, e vice-versa.
  const [recovering, setRecovering] = useState(false);
  const { t } = useTranslation();

  async function handleLogin(email: string, password: string) {
    if (!email || !password) {
      Alert.alert(t("login.warning"), t("login.fill_fields"));
      return;
    }
    setLoading(true);
    try {
      await authService.login(email, password);
      router.replace("/(tabs)");
    } catch (e) {
      if (e instanceof ApiError) {
        Alert.alert(t("login.access_denied"), e.detail || t("login.invalid_credentials"));
      } else {
        Alert.alert(t("login.connection_error"), t("login.connection_failed"));
      }
    } finally {
      setLoading(false);
    }
  }

  /**
   * Pede o e-mail de redefinição de senha para o endereço digitado.
   *
   * A confirmação é deliberadamente a MESMA para e-mail cadastrado ou não: a
   * rota do backend nunca diferencia os casos, para não revelar quais contas
   * existem. Por isso a mensagem fala em "se houver uma conta".
   */
  async function handleForgotPassword(email: string) {
    const address = email.trim();
    if (!address) {
      Alert.alert(t("login.warning"), t("login.forgot_need_email"));
      return;
    }
    setRecovering(true);
    try {
      await authService.forgotPassword(address);
      Alert.alert(t("login.forgot_sent_title"), t("login.forgot_sent_msg", { email: address }));
    } catch (e) {
      // Só falha de rede/servidor chega aqui — a rota responde ok mesmo quando
      // o e-mail não existe.
      if (e instanceof ApiError) {
        Alert.alert(t("login.forgot_error_title"), e.detail || t("login.forgot_error_msg"));
      } else {
        Alert.alert(t("login.connection_error"), t("login.connection_failed"));
      }
    } finally {
      setRecovering(false);
    }
  }

  async function handleLogout() {
    await UserStorage.clear();
    router.replace("/screens/login");
  }

  return { handleLogin, handleLogout, handleForgotPassword, loading, recovering };
}

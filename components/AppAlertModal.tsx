/**
 * Diálogo de aviso/confirmação com o tema do app (substitui o Alert nativo).
 *
 * Montado uma vez em `app/_layout.tsx`; recebe os pedidos de `services/appAlert`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Text, TouchableOpacity, TouchableWithoutFeedback, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppTheme } from "@/context/ThemeContext";
import { AlertButton, AlertRequest, setAlertListener } from "@/services/appAlert";
import { makeAppAlertStyles } from "@/styles/appAlert.styles";

export default function AppAlertModal() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeAppAlertStyles(colors), [colors]);
  const [current, setCurrent] = useState<AlertRequest | null>(null);
  const queueRef = useRef<AlertRequest[]>([]);
  const currentRef = useRef<AlertRequest | null>(null);

  const show = useCallback((req: AlertRequest | null) => {
    currentRef.current = req;
    setCurrent(req);
  }, []);

  useEffect(() => {
    setAlertListener((req) => {
      if (currentRef.current) queueRef.current.push(req);
      else show(req);
    });
    return () => setAlertListener(null);
  }, [show]);

  const close = (after?: () => void) => {
    show(queueRef.current.shift() ?? null);
    // Depois de fechar: o onPress costuma navegar ou abrir outro aviso.
    if (after) setTimeout(after, 0);
  };

  if (!current) return null;

  const { title, message, buttons, options } = current;
  const cancelBtn = buttons.find((b) => b.style === "cancel");
  const cancelable = options.cancelable !== false;
  const hasDestructive = buttons.some((b) => b.style === "destructive");
  // Dois botões lado a lado; três ou mais empilhados (textos longos não cabem).
  const horizontal = buttons.length <= 2;

  const dismiss = () => {
    if (!cancelable) return;
    close(() => {
      cancelBtn?.onPress?.();
      options.onDismiss?.();
    });
  };

  const colorsFor = (b: AlertButton) => {
    if (b.style === "destructive") {
      return { bg: colors.accent.error, border: colors.accent.error, text: "#fff" };
    }
    if (b.style === "cancel") {
      return { bg: "transparent", border: colors.border.subtle, text: colors.text.tertiary };
    }
    return { bg: colors.primary, border: colors.primary, text: "#0c0f16" };
  };

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
      <TouchableWithoutFeedback onPress={dismiss}>
        <View style={styles.bg}>
          {/* Toque no cartão não fecha. */}
          <TouchableWithoutFeedback>
            <View style={styles.card} accessibilityViewIsModal>
              <View style={styles.header}>
                <MaterialIcons
                  name={hasDestructive ? "warning-amber" : "info-outline"}
                  size={24}
                  color={hasDestructive ? colors.accent.error : colors.primary}
                />
                <Text style={styles.title}>{title}</Text>
              </View>
              {!!message && <Text style={styles.message}>{message}</Text>}

              <View style={[styles.actions, horizontal && styles.actionsRow, horizontal && { gap: 10 }]}>
                {buttons.map((b, i) => {
                  const c = colorsFor(b);
                  return (
                    <TouchableOpacity
                      key={`${b.text}-${i}`}
                      style={[styles.btn, { backgroundColor: c.bg, borderColor: c.border }]}
                      onPress={() => close(b.onPress)}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.btnText, { color: c.text }]}>{b.text ?? "OK"}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

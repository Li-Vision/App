/**
 * Botão de coleta com estado visível.
 *
 * Existe para gerir a expectativa de quem coleta: enquanto o app espera o
 * servidor (preparar, gravar, salvar), o botão mostra um spinner, troca o texto
 * e fica desabilitado; ao voltar à cor normal, a próxima coleta já pode começar.
 * A barra de progresso (opcional) mostra quanto da gravação já foi aceito.
 */
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useAppTheme } from "@/context/ThemeContext";

type IconName = React.ComponentProps<typeof MaterialIcons>["name"];

type Props = {
  label: string;
  icon: IconName;
  /** Ocupado: mostra spinner e bloqueia toques. */
  busy: boolean;
  /** Texto enquanto ocupado (ex.: "Salvando..."). */
  busyLabel: string;
  /** 0..1. Quando definido, preenche o botão como barra de progresso. */
  progress?: number;
  onPress: () => void;
};

export default function CollectButton({ label, icon, busy, busyLabel, progress, onPress }: Props) {
  const { colors } = useAppTheme();
  const showProgress = busy && progress !== undefined;

  return (
    <TouchableOpacity
      style={[styles.button, { backgroundColor: busy ? colors.surfaceAlt : colors.primary }]}
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={busy ? busyLabel : label}
      accessibilityState={{ busy, disabled: busy }}
      accessibilityLiveRegion="polite"
    >
      {showProgress && (
        <View
          pointerEvents="none"
          style={[
            styles.progress,
            { width: `${Math.round((progress ?? 0) * 100)}%`, backgroundColor: colors.primary },
          ]}
        />
      )}
      {busy ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <MaterialIcons name={icon} size={24} color="#000" />
      )}
      <Text style={[styles.text, { color: busy ? colors.text.primary : "#000" }]}>
        {busy ? busyLabel : label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 15,
    borderRadius: 10,
    gap: 10,
    overflow: "hidden",
  },
  progress: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    opacity: 0.35,
  },
  text: { fontWeight: "bold", fontSize: 16 },
});

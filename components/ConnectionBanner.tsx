/**
 * Faixa fina no topo avisando que o servidor está fora do ar e, depois,
 * que voltou. Não bloqueia toques: o app continua usável por baixo.
 *
 * @see ../services/connectionStatus.ts
 */
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "@/context/ThemeContext";
import { ConnectionState, subscribeConnection } from "@/services/connectionStatus";

export default function ConnectionBanner() {
  const [state, setState] = useState<ConnectionState>("online");

  useEffect(() => subscribeConnection(setState), []);

  // O corpo é um componente à parte para que useSafeAreaInsets só rode com o
  // banner visível (e, portanto, só dentro de um SafeAreaProvider).
  if (state === "online") return null;
  return <BannerBody recovered={state === "recovered"} />;
}

function BannerBody({ recovered }: { recovered: boolean }) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const accent = recovered ? colors.accent.green : colors.accent.warning;

  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        {
          top: 0,
          paddingTop: insets.top + 6,
          backgroundColor: colors.backgroundAlt,
          borderBottomColor: accent,
        },
      ]}
    >
      <MaterialIcons name={recovered ? "check-circle" : "cloud-off"} size={16} color={accent} />
      <Text style={[styles.text, { color: colors.text.primary }]}>
        {recovered ? t("connection.recovered") : t("connection.unavailable")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 6,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
  },
  text: {
    fontSize: 13,
    fontWeight: "600",
  },
});

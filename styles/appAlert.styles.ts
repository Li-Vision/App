import { StyleSheet } from "react-native";
import { AppColorTokens, AppRadius, AppSpacing } from "@/constants/theme";

export function makeAppAlertStyles(colors: AppColorTokens) {
  return StyleSheet.create({
    bg: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.7)",
      justifyContent: "center",
      alignItems: "center",
      padding: AppSpacing.xl,
    },
    card: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: colors.surface,
      borderRadius: AppRadius.md,
      padding: AppSpacing.xl,
      borderWidth: 1,
      borderColor: colors.border.subtle,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    title: {
      flex: 1,
      fontSize: 18,
      fontWeight: "bold",
      color: colors.text.primary,
    },
    message: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.text.tertiary,
      marginTop: 10,
    },
    actions: {
      marginTop: AppSpacing.xl,
      gap: 10,
    },
    actionsRow: {
      flexDirection: "row",
    },
    btn: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
    },
    btnText: {
      fontSize: 14,
      fontWeight: "700",
    },
  });
}

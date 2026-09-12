import { StyleSheet } from "react-native";
import { AppColorTokens, AppRadius, AppSpacing } from "@/constants/theme";

export function makeErrorModalStyles(colors: AppColorTokens) {
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
      maxWidth: 480,
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
      marginBottom: 4,
    },
    title: {
      flex: 1,
      fontSize: 18,
      fontWeight: "bold",
      color: colors.text.primary,
    },
    subtitle: {
      fontSize: 12,
      color: colors.text.secondary,
      lineHeight: 17,
      marginBottom: AppSpacing.lg,
    },
    row: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
    },
    rowHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: 6,
    },
    rowSource: {
      flex: 1,
      fontSize: 13,
      fontWeight: "700",
    },
    badge: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    badgeText: {
      fontSize: 10.5,
      fontWeight: "700",
    },
    rowTime: {
      fontSize: 10.5,
      color: colors.text.tertiary,
      fontVariant: ["tabular-nums"],
    },
    rowMessage: {
      fontSize: 13,
      color: colors.text.primary,
      lineHeight: 18,
    },
    detailToggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: 8,
    },
    detailToggleText: {
      fontSize: 11.5,
      color: colors.text.secondary,
      fontWeight: "600",
    },
    detailBox: {
      maxHeight: 140,
      backgroundColor: colors.background,
      borderRadius: 8,
      padding: 8,
      marginTop: 6,
    },
    detailText: {
      fontSize: 10.5,
      color: colors.text.secondary,
      fontFamily: "monospace",
      lineHeight: 15,
    },
    actions: {
      flexDirection: "row",
      gap: 10,
      marginTop: AppSpacing.lg,
    },
    secondaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      paddingVertical: 12,
      // Com três botões na linha, o padding original estourava a largura em
      // telas estreitas e o rótulo quebrava no meio.
      paddingHorizontal: 10,
      borderRadius: 10,
      backgroundColor: colors.surfaceAlt,
    },
    secondaryBtnText: {
      fontSize: 12.5,
      fontWeight: "600",
      color: colors.text.secondary,
    },
    primaryBtn: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.primary,
    },
    primaryBtnText: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.background,
    },
  });
}

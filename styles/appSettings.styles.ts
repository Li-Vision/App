import { StyleSheet } from "react-native";
import { AppColorTokens, AppRadius, AppSpacing } from "@/constants/theme";

export function makeAppSettingsStyles(colors: AppColorTokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.backgroundAlt,
      padding: AppSpacing.xl,
      paddingTop: 50,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 15,
      marginBottom: AppSpacing.xl,
    },
    title: { fontSize: 24, fontWeight: "bold", color: colors.text.primary },
    card: {
      backgroundColor: colors.surface,
      borderRadius: AppRadius.md,
      padding: AppSpacing.lg,
      marginBottom: AppSpacing.lg,
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 6,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text.primary,
    },
    sectionDesc: {
      fontSize: 12,
      color: colors.text.secondary,
      lineHeight: 17,
      marginBottom: AppSpacing.lg,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
    },
    rowText: { flex: 1, paddingRight: 12 },
    rowTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text.primary,
      marginBottom: 2,
    },
    rowDesc: {
      fontSize: 11.5,
      color: colors.text.secondary,
      lineHeight: 16,
    },
    hint: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      paddingHorizontal: 12,
      paddingBottom: 10,
      marginTop: -4,
      marginBottom: 6,
    },
    hintText: {
      flex: 1,
      fontSize: 11.5,
      color: colors.primary,
      lineHeight: 16,
    },
  });
}

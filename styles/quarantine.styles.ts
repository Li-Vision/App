import { StyleSheet } from "react-native";
import { AppColorTokens, AppRadius, AppSpacing } from "@/constants/theme";

export function makeQuarantineStyles(colors: AppColorTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.backgroundAlt, padding: AppSpacing.xl, paddingTop: 50 },
    header: { flexDirection: "row", alignItems: "center", gap: 15, marginBottom: AppSpacing.lg },
    title: { fontSize: 22, fontWeight: "bold", color: colors.text.primary, flex: 1 },
    counter: { color: colors.text.secondary, fontSize: 14, fontWeight: "bold" },
    scroll: { paddingBottom: 60 },
    emptyText: { color: colors.text.secondary, textAlign: "center", marginTop: 40, fontSize: 16 },
    hint: { color: colors.text.tertiary, fontSize: 12, marginBottom: AppSpacing.md },

    chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: AppSpacing.sm, marginBottom: AppSpacing.lg },
    chip: {
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
      borderWidth: 1, borderColor: colors.border.subtle, backgroundColor: colors.surface,
    },
    chipActive: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
    chipText: { color: colors.text.secondary, fontSize: 13, fontWeight: "bold" },
    chipTextActive: { color: colors.primary },
    chipSuggested: { borderColor: colors.accent.warning },

    card: {
      backgroundColor: colors.surface, borderRadius: AppRadius.md, padding: AppSpacing.lg,
      borderWidth: 1, borderColor: colors.border.cyan,
    },
    cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: AppSpacing.md },
    recordedAs: { color: colors.text.secondary, fontSize: 13 },
    recordedLabel: { color: colors.text.primary, fontSize: 26, fontWeight: "bold" },
    meta: { color: colors.text.tertiary, fontSize: 12, marginTop: 2 },
    navRow: { flexDirection: "row", gap: 4 },
    navBtn: { padding: 6, borderRadius: 8, backgroundColor: colors.surfaceAlt },

    previews: { flexDirection: "row", justifyContent: "space-between", marginBottom: AppSpacing.md },
    previewCol: { alignItems: "center", gap: 4 },
    previewLabel: { color: colors.text.secondary, fontSize: 12 },

    sectionTitle: { color: colors.text.secondary, fontSize: 13, fontWeight: "bold", marginTop: AppSpacing.md, marginBottom: 6 },
    reason: { flexDirection: "row", gap: 6, alignItems: "flex-start", marginBottom: 4 },
    reasonText: { color: colors.text.primary, fontSize: 13, flex: 1 },
    reasonInfo: { color: colors.text.tertiary, fontSize: 12, flex: 1 },

    input: {
      backgroundColor: colors.background, color: colors.primary, fontSize: 16, fontWeight: "bold",
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginTop: AppSpacing.sm,
    },

    actions: { flexDirection: "row", gap: AppSpacing.md, marginTop: AppSpacing.lg },
    discardBtn: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
      paddingVertical: 12, borderRadius: 10, backgroundColor: colors.accent.danger,
    },
    approveBtn: {
      flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
      paddingVertical: 12, borderRadius: 10, backgroundColor: colors.primary,
    },
    // Cores fixas: sempre sobre fundo sólido (vermelho / ciano).
    discardText: { color: "#fff", fontWeight: "bold" },
    approveText: { color: "#000", fontWeight: "bold" },
    busy: { opacity: 0.5 },
  });
}

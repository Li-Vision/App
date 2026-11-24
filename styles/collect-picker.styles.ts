import { StyleSheet } from "react-native";
import { AppColorTokens, AppRadius, AppSpacing } from "@/constants/theme";

/** Destaque translúcido a partir de uma cor #rrggbb do tema. */
export const tint = (hex: string, alpha: number) =>
  `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;

export const TILE_GAP = AppSpacing.sm;

export function makeCollectPickerStyles(colors: AppColorTokens) {
  return StyleSheet.create({
    // ── Campos na tela de coleta ────────────────────────────────────────────
    fieldLabel: { color: colors.text.secondary, fontSize: 14, fontWeight: "bold" },
    field: {
      minHeight: 64,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: AppRadius.sm,
      borderWidth: 1,
      borderColor: colors.border.cyan,
    },
    fieldDisabled: { opacity: 0.5 },
    fieldBody: { flex: 1, paddingVertical: AppSpacing.md, paddingHorizontal: AppSpacing.lg, gap: 2 },
    fieldBodyCentered: { alignItems: "center", paddingHorizontal: AppSpacing.xs },
    fieldValue: { color: colors.primary, fontSize: 18, fontWeight: "bold" },
    fieldValueLarge: { fontSize: 24, letterSpacing: 0.5 },
    fieldPlaceholder: { color: colors.text.secondary, fontWeight: "600" },
    fieldMeta: { color: colors.text.muted, fontSize: 13, fontVariant: ["tabular-nums"] },
    fieldMetaWarn: { color: colors.accent.warning },
    fieldChevron: { paddingRight: AppSpacing.md },
    stepBtn: { width: 52, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
    stepDivider: { width: 1, alignSelf: "stretch", marginVertical: AppSpacing.md, backgroundColor: colors.border.subtle },

    // ── Painel inferior ────────────────────────────────────────────────────
    backdrop: { backgroundColor: "rgba(5, 8, 12, 0.6)" },
    sheetWrap: { flex: 1, justifyContent: "flex-end" },
    sheet: {
      maxHeight: "82%",
      backgroundColor: colors.surface,
      borderTopLeftRadius: AppRadius.xxxl,
      borderTopRightRadius: AppRadius.xxxl,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: colors.border.subtle,
      paddingHorizontal: AppSpacing.xl,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.25,
      shadowRadius: 18,
      elevation: 16,
    },
    grabber: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border.subtle,
      marginTop: AppSpacing.sm,
    },
    sheetHeader: { flexDirection: "row", alignItems: "center", marginTop: AppSpacing.xs, marginBottom: AppSpacing.md },
    sheetTitle: { flex: 1, color: colors.text.primary, fontSize: 20, fontWeight: "800" },
    sheetSubtitle: { color: colors.text.muted, fontSize: 13, marginTop: 2 },
    closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -AppSpacing.sm },

    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: AppSpacing.sm,
      backgroundColor: colors.surfaceAlt,
      borderRadius: AppRadius.sm,
      borderWidth: 1,
      borderColor: colors.border.subtle,
      paddingHorizontal: AppSpacing.md,
      marginBottom: AppSpacing.md,
    },
    searchInput: { flex: 1, color: colors.text.primary, fontSize: 16, paddingVertical: AppSpacing.md },

    createRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: AppSpacing.sm,
      minHeight: 48,
      paddingHorizontal: AppSpacing.md,
      borderRadius: AppRadius.sm,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.primary,
      marginBottom: AppSpacing.md,
    },
    createText: { color: colors.primary, fontWeight: "700", fontSize: 15, flex: 1 },

    // Grade de gestos
    grid: { flexDirection: "row", flexWrap: "wrap", gap: TILE_GAP, paddingBottom: AppSpacing.sm },
    tile: {
      minHeight: 64,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: AppSpacing.sm,
      paddingHorizontal: AppSpacing.xs,
      borderRadius: AppRadius.md,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: "transparent",
    },
    tileSelected: { borderColor: colors.primary, backgroundColor: tint(colors.primary, 0.15) },
    tileLabel: { color: colors.text.primary, fontSize: 20, fontWeight: "800", textAlign: "center" },
    tileLabelLong: { fontSize: 15 },
    tileLabelSelected: { color: colors.primary },
    tileCountRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
    tileCount: { color: colors.text.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
    tileCountLow: { color: colors.accent.warning, fontWeight: "700" },
    lowDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent.warning },

    legend: { flexDirection: "row", alignItems: "center", gap: AppSpacing.sm, paddingTop: AppSpacing.md },
    legendText: { color: colors.text.muted, fontSize: 12, flex: 1 },

    // Lista de datasets
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: AppSpacing.md,
      minHeight: 60,
      paddingVertical: AppSpacing.sm,
      paddingHorizontal: AppSpacing.md,
      borderRadius: AppRadius.sm,
    },
    rowSelected: { backgroundColor: tint(colors.primary, 0.12) },
    rowBody: { flex: 1, gap: 2 },
    rowTitle: { color: colors.text.primary, fontSize: 16, fontWeight: "700" },
    rowTitleSelected: { color: colors.primary },
    rowMeta: { color: colors.text.muted, fontSize: 13, fontVariant: ["tabular-nums"] },

    empty: { color: colors.text.muted, textAlign: "center", paddingVertical: AppSpacing.xxl, lineHeight: 20 },
  });
}

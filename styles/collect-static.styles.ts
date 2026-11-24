import { StyleSheet } from "react-native";
import { AppColorTokens, AppRadius, AppSpacing } from "@/constants/theme";

export function makeCollectStaticStyles(colors: AppColorTokens) {
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
  cameraContainer: {
    backgroundColor: colors.surface,
    borderRadius: 15,
    overflow: "hidden",
    position: "relative",
    marginBottom: AppSpacing.xl,
  },
  permissionBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  form: { gap: 15 },
  buttonRow: { flexDirection: "column", gap: 10, marginTop: 10 },
  captureBtn: {
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 15,
    borderRadius: 10,
    gap: 10,
  },
  captureBtnText: { color: "#000", fontWeight: "bold", fontSize: 16 },
  finalizeBtn: {
    backgroundColor: colors.accent.green,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 15,
    borderRadius: 10,
    gap: 10,
  },
  finalizeBtnText: { color: colors.text.primary, fontWeight: "bold", fontSize: 16 },
});
}

export const collectStaticStyles = makeCollectStaticStyles;

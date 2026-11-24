import { StyleSheet } from "react-native";
import { AppColorTokens, AppSpacing } from "@/constants/theme";

export function makeCollectDynamicStyles(colors: AppColorTokens) {
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
  recordingOverlay: {
    position: "absolute",
    top: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: AppSpacing.sm,
    borderRadius: 10,
    gap: 5,
  },
  recordingText: { color: colors.accent.error, fontWeight: "bold", fontSize: 12 },
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

export const collectDynamicStyles = makeCollectDynamicStyles;

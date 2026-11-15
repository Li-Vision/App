import { MaterialIcons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useAppTheme } from "@/context/ThemeContext";
import { AppRadius, AppSpacing } from "@/constants/theme";

type Props = {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  title: string;
  createLabel: string;
  createPlaceholder: string;
  confirmLabel: string;
  cancelLabel: string;
  emptyLabel: string;
  placeholder?: string;
};

/**
 * Campo que abre um modal com a lista de opções existentes e permite criar uma nova.
 * Usado para categoria e módulo/idioma, que antes eram texto livre.
 */
export default function OptionPickerField({
  label, value, options, onChange, title, createLabel, createPlaceholder,
  confirmLabel, cancelLabel, emptyLabel, placeholder,
}: Props) {
  const { colors } = useAppTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");

  const close = () => {
    setOpen(false);
    setCreating(false);
    setDraft("");
  };

  const choose = (v: string) => {
    onChange(v);
    close();
  };

  const confirmNew = () => {
    const v = draft.trim();
    if (!v) return;
    // Reaproveita a grafia existente se só mudou maiúscula/minúscula.
    const existing = options.find((o) => o.toLowerCase() === v.toLowerCase());
    choose(existing ?? v);
  };

  return (
    <>
      <Text style={s.label}>{label}</Text>
      <TouchableOpacity style={s.field} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Text style={[s.fieldText, !value && s.fieldPlaceholder]} numberOfLines={1}>
          {value || placeholder || ""}
        </Text>
        <MaterialIcons name="arrow-drop-down" size={24} color={colors.primary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={s.bg}>
          <View style={s.card}>
            <Text style={s.title}>{title}</Text>

            <ScrollView style={s.list} keyboardShouldPersistTaps="handled">
              {options.length === 0 && <Text style={s.empty}>{emptyLabel}</Text>}
              {options.map((opt) => {
                const selected = opt === value;
                return (
                  <TouchableOpacity key={opt} style={[s.row, selected && s.rowSelected]} onPress={() => choose(opt)}>
                    <Text style={[s.rowText, selected && s.rowTextSelected]} numberOfLines={1}>{opt}</Text>
                    {selected && <MaterialIcons name="check" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {creating ? (
              <View style={s.createBox}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  style={s.input}
                  autoFocus
                  placeholder={createPlaceholder}
                  placeholderTextColor={colors.text.secondary}
                  onSubmitEditing={confirmNew}
                  returnKeyType="done"
                />
                <View style={s.actions}>
                  <TouchableOpacity style={[s.btn, s.cancelBtn]} onPress={() => { setCreating(false); setDraft(""); }}>
                    <Text style={s.cancelText}>{cancelLabel}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.btn, s.confirmBtn, !draft.trim() && { opacity: 0.5 }]} onPress={confirmNew} disabled={!draft.trim()}>
                    <Text style={s.confirmText}>{confirmLabel}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                <TouchableOpacity style={s.createRow} onPress={() => setCreating(true)}>
                  <MaterialIcons name="add" size={20} color={colors.primary} />
                  <Text style={s.createText}>{createLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, s.cancelBtn, { marginTop: 8 }]} onPress={close}>
                  <Text style={s.cancelText}>{cancelLabel}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>["colors"]) {
  return StyleSheet.create({
    label: { color: colors.text.muted, fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 12 },
    field: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border.subtle,
      borderRadius: AppRadius.sm,
      paddingLeft: 14,
      paddingRight: 8,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    fieldText: { color: colors.text.primary, fontSize: 15, flex: 1 },
    fieldPlaceholder: { color: colors.text.secondary },
    bg: { flex: 1, backgroundColor: "rgba(5,8,12,0.8)", justifyContent: "center", padding: AppSpacing.xl },
    card: {
      backgroundColor: colors.surface,
      borderRadius: AppRadius.xxl,
      padding: AppSpacing.xxl,
      borderWidth: 1,
      borderColor: colors.border.subtle,
      maxHeight: "80%",
    },
    title: { color: colors.text.primary, fontSize: 20, fontWeight: "800", marginBottom: AppSpacing.xl },
    list: { flexGrow: 0, marginBottom: 8 },
    empty: { color: colors.text.secondary, textAlign: "center", paddingVertical: 16 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 14,
      paddingHorizontal: 12,
      borderRadius: AppRadius.sm,
    },
    rowSelected: { backgroundColor: colors.surfaceAlt },
    rowText: { color: colors.text.primary, fontSize: 15, flex: 1 },
    rowTextSelected: { fontWeight: "700", color: colors.primary },
    createRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 14,
      paddingHorizontal: 12,
      borderRadius: AppRadius.sm,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.primary,
    },
    createText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
    createBox: { marginTop: 4 },
    input: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border.subtle,
      borderRadius: AppRadius.sm,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: colors.text.primary,
      fontSize: 15,
    },
    actions: { flexDirection: "row", gap: 12, marginTop: 12 },
    btn: { flex: 1, borderRadius: AppRadius.sm, paddingVertical: 14, alignItems: "center" },
    cancelBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border.subtle },
    confirmBtn: { backgroundColor: colors.primary },
    cancelText: { color: colors.text.alt, fontWeight: "700", fontSize: 15 },
    confirmText: { color: colors.background, fontWeight: "800", fontSize: 15 },
  });
}

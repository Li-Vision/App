import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "@/context/ThemeContext";
import { filterLabels, normalizeName, sortLabels } from "@/lib/gestureStats";
import type { CollectDataset } from "@/hooks/useCollectDatasets";
import { makeCollectPickerStyles } from "@/styles/collect-picker.styles";
import BottomSheet from "./BottomSheet";

type Props = {
  value: string;
  onChange: (name: string) => void;
  datasets: CollectDataset[];
  /** Total de amostras por id de dataset; ausente enquanto carrega. */
  totals: Record<string, number>;
  /** Chamado ao abrir a lista, para buscar os totais que faltam. */
  onOpen?: () => void;
  /** Só admins criam datasets novos. */
  canCreate: boolean;
  locked?: boolean;
  unit: "samples" | "sequences";
};

/** Busca aparece só quando a lista passa a ser longa o bastante para precisar. */
const SEARCH_FROM = 6;

/**
 * Seletor de dataset da coleta: um campo com o dataset atual e seu tamanho, que
 * abre a lista completa com formato e total de amostras de cada dataset.
 */
export default function DatasetPicker({
  value, onChange, datasets, totals, onOpen, canCreate, locked = false, unit,
}: Props) {
  const { colors } = useAppTheme();
  const s = useMemo(() => makeCollectPickerStyles(colors), [colors]);
  const { t, i18n } = useTranslation();
  const fmt = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const byName = useMemo(() => new Map(datasets.map((d) => [d.name, d])), [datasets]);
  const names = useMemo(() => sortLabels(datasets.map((d) => d.name)), [datasets]);
  const visible = useMemo(() => filterLabels(names, query), [names, query]);
  const typed = normalizeName(query);
  const showCreate = canCreate && typed.length > 0 && !byName.has(typed);
  const showSearch = canCreate || datasets.length >= SEARCH_FROM;

  const formatOf = (d?: CollectDataset) =>
    (d?.feature_schema ?? "hands_v1") === "holistic_v1" ? t("collect_picker.format_holistic") : t("collect_picker.format_hands");

  const describe = (d?: CollectDataset) => {
    const total = d ? totals[d.id] : undefined;
    const size = total === undefined ? "…" : t(`collect_picker.${unit}`, { count: total, formatted: fmt.format(total) });
    return `${formatOf(d)} · ${size}`;
  };

  const current = byName.get(value);
  let meta: string;
  if (!value) meta = datasets.length ? t("collect_picker.tap_to_choose") : t("collect_static.no_dataset");
  else if (current) meta = describe(current);
  else meta = t("collect_picker.new_dataset");

  const openSheet = () => {
    onOpen?.();
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const choose = (name: string) => {
    Haptics.selectionAsync().catch(() => {});
    onChange(name);
    close();
  };

  const disabled = locked || (datasets.length === 0 && !canCreate);

  return (
    <>
      <Text style={s.fieldLabel}>{t("collect_picker.dataset_label")}</Text>
      <Pressable
        style={({ pressed }) => [s.field, disabled && s.fieldDisabled, pressed && { opacity: 0.85 }]}
        onPress={openSheet}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${t("collect_picker.dataset_label")}: ${value || t("collect_picker.none")}. ${meta}`}
        accessibilityHint={t("collect_picker.choose_dataset")}
      >
        <View style={s.fieldBody}>
          <Text style={[s.fieldValue, !value && s.fieldPlaceholder]} numberOfLines={1}>
            {value || t("collect_picker.dataset_placeholder")}
          </Text>
          <Text style={s.fieldMeta} numberOfLines={1}>{meta}</Text>
        </View>
        <MaterialIcons name="unfold-more" size={24} color={colors.primary} style={s.fieldChevron} />
      </Pressable>

      <BottomSheet visible={open} onClose={close} title={t("collect_picker.choose_dataset")} closeLabel={t("collect_picker.close")}>
        {showSearch && (
          <View style={s.search}>
            <MaterialIcons name="search" size={20} color={colors.text.muted} />
            <TextInput
              style={s.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={canCreate ? t("collect_picker.search_or_create_dataset") : t("collect_picker.search_dataset")}
              placeholderTextColor={colors.text.secondary}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (visible.length === 1) choose(visible[0]);
                else if (byName.has(typed)) choose(typed);
                else if (showCreate) choose(typed);
              }}
            />
          </View>
        )}

        {showCreate && (
          <Pressable style={s.createRow} onPress={() => choose(typed)} accessibilityRole="button">
            <MaterialIcons name="add" size={20} color={colors.primary} />
            <Text style={s.createText} numberOfLines={1}>{t("collect_picker.create", { name: typed })}</Text>
          </Pressable>
        )}

        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
          {visible.map((name) => {
            const d = byName.get(name);
            const selected = name === value;
            return (
              <Pressable
                key={name}
                onPress={() => choose(name)}
                style={({ pressed }) => [s.row, selected && s.rowSelected, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <MaterialIcons
                  name={(d?.feature_schema ?? "hands_v1") === "holistic_v1" ? "accessibility-new" : "back-hand"}
                  size={22}
                  color={selected ? colors.primary : colors.text.muted}
                />
                <View style={s.rowBody}>
                  <Text style={[s.rowTitle, selected && s.rowTitleSelected]} numberOfLines={1}>{name}</Text>
                  <Text style={s.rowMeta} numberOfLines={1}>{describe(d)}</Text>
                </View>
                {selected && <MaterialIcons name="check" size={22} color={colors.primary} />}
              </Pressable>
            );
          })}
          {datasets.length === 0 && <Text style={s.empty}>{t("collect_static.no_dataset")}</Text>}
          {datasets.length > 0 && visible.length === 0 && !showCreate && (
            <Text style={s.empty}>{t("collect_picker.no_match_dataset")}</Text>
          )}
        </ScrollView>
      </BottomSheet>
    </>
  );
}

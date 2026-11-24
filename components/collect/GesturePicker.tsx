import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { LayoutChangeEvent, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "@/context/ThemeContext";
import {
  filterLabels, gridColumns, LabelStats, lowSampleLabels, normalizeName, sortLabels, stepLabel,
} from "@/lib/gestureStats";
import { makeCollectPickerStyles, TILE_GAP } from "@/styles/collect-picker.styles";
import BottomSheet from "./BottomSheet";

type Props = {
  value: string;
  onChange: (label: string) => void;
  /** Amostras por gesto do dataset escolhido. */
  stats: LabelStats;
  loading: boolean;
  /** Sem dataset escolhido não há gestos para mostrar. */
  hasDataset: boolean;
  /** Trava a troca durante uma gravação em andamento. */
  locked?: boolean;
  /** Unidade das contagens: amostras (estática) ou sequências (dinâmica). */
  unit: "samples" | "sequences";
  datasetName?: string;
};

/**
 * Seletor de gesto da coleta.
 *
 * As setas trocam para o gesto vizinho sem abrir nada, que é o movimento mais
 * comum ao coletar o alfabeto em sequência. Tocar no nome abre a grade
 * completa, com a contagem de cada gesto e destaque para os que têm poucas
 * amostras, e com busca que também cria um gesto novo.
 */
export default function GesturePicker({
  value, onChange, stats, loading, hasDataset, locked = false, unit, datasetName,
}: Props) {
  const { colors } = useAppTheme();
  const s = useMemo(() => makeCollectPickerStyles(colors), [colors]);
  const { t, i18n } = useTranslation();
  const fmt = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [gridWidth, setGridWidth] = useState(0);

  const labels = useMemo(() => sortLabels(Object.keys(stats)), [stats]);
  const low = useMemo(() => lowSampleLabels(stats), [stats]);
  const visible = useMemo(() => filterLabels(labels, query), [labels, query]);
  const columns = gridColumns(labels);
  const tileWidth = gridWidth > 0 ? (gridWidth - TILE_GAP * (columns - 1)) / columns : undefined;

  const typed = normalizeName(query);
  const canCreate = typed.length > 0 && !labels.includes(typed);

  const countText = (n: number) => t(`collect_picker.${unit}`, { count: n, formatted: fmt.format(n) });

  const choose = (label: string) => {
    Haptics.selectionAsync().catch(() => {});
    onChange(label);
    setOpen(false);
    setQuery("");
  };

  const step = (direction: 1 | -1) => {
    const next = stepLabel(labels, value, direction);
    if (next) {
      Haptics.selectionAsync().catch(() => {});
      onChange(next);
    }
  };

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  // Linha de apoio do campo: o que falta fazer ou quanto o gesto já tem.
  let meta: string;
  let metaWarn = false;
  if (!hasDataset) meta = t("collect_picker.pick_dataset_first");
  else if (loading) meta = t("collect_picker.loading");
  else if (!value) meta = labels.length ? t("collect_picker.tap_to_choose") : t("collect_picker.tap_to_create");
  else if (value in stats) {
    meta = countText(stats[value]);
    if (low.has(value)) {
      meta += ` · ${t("collect_picker.low_short")}`;
      metaWarn = true;
    }
  } else meta = t("collect_picker.new_gesture");

  const canStep = hasDataset && labels.length > 0 && !locked;
  const canOpen = hasDataset && !locked;

  return (
    <>
      <Text style={s.fieldLabel}>{t("collect_picker.gesture_label")}</Text>
      <View style={[s.field, !canOpen && s.fieldDisabled]}>
        <Pressable
          style={s.stepBtn}
          onPress={() => step(-1)}
          disabled={!canStep}
          accessibilityRole="button"
          accessibilityLabel={t("collect_picker.prev_gesture")}
          accessibilityState={{ disabled: !canStep }}
        >
          <MaterialIcons name="chevron-left" size={30} color={canStep ? colors.primary : colors.text.secondary} />
        </Pressable>
        <View style={s.stepDivider} />

        <Pressable
          style={[s.fieldBody, s.fieldBodyCentered]}
          onPress={() => setOpen(true)}
          disabled={!canOpen}
          accessibilityRole="button"
          accessibilityLabel={`${t("collect_picker.gesture_label")}: ${value || t("collect_picker.none")}. ${meta}`}
          accessibilityHint={t("collect_picker.choose_gesture")}
        >
          <Text style={[s.fieldValue, s.fieldValueLarge, !value && s.fieldPlaceholder]} numberOfLines={1}>
            {value || t("collect_picker.gesture_placeholder")}
          </Text>
          <Text style={[s.fieldMeta, metaWarn && s.fieldMetaWarn]} numberOfLines={1}>{meta}</Text>
        </Pressable>

        <View style={s.stepDivider} />
        <Pressable
          style={s.stepBtn}
          onPress={() => step(1)}
          disabled={!canStep}
          accessibilityRole="button"
          accessibilityLabel={t("collect_picker.next_gesture")}
          accessibilityState={{ disabled: !canStep }}
        >
          <MaterialIcons name="chevron-right" size={30} color={canStep ? colors.primary : colors.text.secondary} />
        </Pressable>
      </View>

      <BottomSheet
        visible={open}
        onClose={close}
        title={t("collect_picker.choose_gesture")}
        subtitle={datasetName ? t("collect_picker.gesture_count", { count: labels.length, dataset: datasetName }) : undefined}
        closeLabel={t("collect_picker.close")}
      >
        <View style={s.search}>
          <MaterialIcons name="search" size={20} color={colors.text.muted} />
          <TextInput
            style={s.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={t("collect_picker.search_or_create")}
            placeholderTextColor={colors.text.secondary}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (visible.length === 1) choose(visible[0]);
              else if (labels.includes(typed)) choose(typed);
              else if (canCreate) choose(typed);
            }}
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel={t("collect_picker.clear_search")}>
              <MaterialIcons name="cancel" size={18} color={colors.text.muted} />
            </Pressable>
          ) : null}
        </View>

        {canCreate && (
          <Pressable style={s.createRow} onPress={() => choose(typed)} accessibilityRole="button">
            <MaterialIcons name="add" size={20} color={colors.primary} />
            <Text style={s.createText} numberOfLines={1}>{t("collect_picker.create", { name: typed })}</Text>
          </Pressable>
        )}

        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
          <View style={s.grid} onLayout={(e: LayoutChangeEvent) => setGridWidth(e.nativeEvent.layout.width)}>
            {visible.map((label) => {
              const selected = label === value;
              const isLow = low.has(label);
              const n = stats[label] ?? 0;
              return (
                <Pressable
                  key={label}
                  onPress={() => choose(label)}
                  style={({ pressed }) => [
                    s.tile,
                    tileWidth !== undefined && { width: tileWidth },
                    selected && s.tileSelected,
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${label}, ${countText(n)}${isLow ? `, ${t("collect_picker.low_short")}` : ""}`}
                >
                  <Text
                    style={[s.tileLabel, columns < 5 && s.tileLabelLong, selected && s.tileLabelSelected]}
                    numberOfLines={2}
                  >
                    {label}
                  </Text>
                  <View style={s.tileCountRow}>
                    {isLow && <View style={s.lowDot} />}
                    <Text style={[s.tileCount, isLow && s.tileCountLow]}>{fmt.format(n)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {labels.length === 0 && !loading && <Text style={s.empty}>{t("collect_picker.no_gestures")}</Text>}
          {loading && <Text style={s.empty}>{t("collect_picker.loading")}</Text>}
          {labels.length > 0 && visible.length === 0 && !canCreate && (
            <Text style={s.empty}>{t("collect_picker.no_match")}</Text>
          )}
        </ScrollView>

        {low.size > 0 && !query && (
          <View style={s.legend}>
            <View style={s.lowDot} />
            <Text style={s.legendText}>{t("collect_picker.low_legend")}</Text>
          </View>
        )}
      </BottomSheet>
    </>
  );
}

/**
 * Revisão da quarentena (admin).
 *
 * Amostras suspeitas ficam fora do treino (ver API collection_queue.py) até
 * alguém decidir. Para cada uma a tela mostra:
 *  - o gesto GRAVADO desenhado em pontos, ao lado de um exemplo TÍPICO do
 *    sinal escolhido no dataset — dá para ver na hora se é o mesmo gesto;
 *  - por que ela caiu na quarentena e quais sinais ela parece ser
 *    (sinal mais próximo no dataset e palpite do modelo);
 *  - aprovar (com o rótulo corrigido, se a pessoa gravou o gesto no sinal
 *    errado) ou descartar. Depois de decidir, já abre a próxima.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, TextInput, TouchableOpacity, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import Text from "@/components/TranslatableText";
import GesturePreview from "@/components/GesturePreview";
import { Alert } from "@/services/appAlert";
import { trainingService } from "@/services/trainingService";
import { useAppTheme } from "@/context/ThemeContext";
import { makeQuarantineStyles as makeStyles } from "@/styles/quarantine.styles";

type Reason = { code: string; message: string; severity: "error" | "suspect" | "info" };
type QuarantineItem = {
  id: string;
  dataset_id: string;
  label: string;
  kind: "static" | "dynamic";
  reasons: Reason[];
  scores: any;
  created_at: string;
  features?: number[];
};

/** Sinais sugeridos para a amostra: o mais parecido no dataset e o palpite do modelo. */
function suggestionsOf(item: QuarantineItem): string[] {
  const out: string[] = [];
  const near = item.scores?.similarity?.nearest_label;
  const pred = item.scores?.model?.predicted;
  for (const s of [near, pred]) if (s && s !== item.label && !out.includes(s)) out.push(s);
  return out;
}

export default function QuarantineScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [items, setItems] = useState<QuarantineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [datasetNames, setDatasetNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  const [current, setCurrent] = useState<QuarantineItem | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [example, setExample] = useState<unknown>(null);
  const [exampleLoading, setExampleLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Caches por sessão da tela: rótulos do dataset e exemplo típico de cada sinal.
  const labelsCache = useRef<Record<string, string[]>>({});
  const exampleCache = useRef<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [q, ds] = await Promise.all([trainingService.listQuarantine(), trainingService.getDatasets()]);
      if (!q.ok) throw new Error(q.error || "Falha ao carregar a quarentena.");
      const sorted: QuarantineItem[] = (q.items ?? []).sort(
        (a: QuarantineItem, b: QuarantineItem) => a.created_at.localeCompare(b.created_at),
      );
      setItems(sorted);
      const names: Record<string, string> = {};
      for (const d of ds?.datasets ?? []) names[d.id] = d.name;
      setDatasetNames(names);
    } catch (e: any) {
      setLoadError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () => (filter ? items.filter((i) => i.dataset_id === filter) : items),
    [items, filter],
  );
  const datasetsWithItems = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.dataset_id] = (counts[i.dataset_id] ?? 0) + 1;
    return Object.entries(counts);
  }, [items]);

  const safeIndex = Math.min(index, Math.max(visible.length - 1, 0));
  const selected = visible[safeIndex];

  // Abre o item: busca as features (a lista vem sem elas, por peso) e os
  // rótulos existentes do dataset.
  useEffect(() => {
    if (!selected) { setCurrent(null); return; }
    let cancelled = false;
    setCurrent({ ...selected });
    setTarget(selected.label);
    (async () => {
      try {
        const res = await trainingService.getQuarantineItem(selected.id);
        if (!cancelled && res.ok) setCurrent(res.item);
      } catch { /* a revisão segue sem o desenho */ }
      const ds = selected.dataset_id;
      if (!labelsCache.current[ds]) {
        try {
          const st = await trainingService.getDatasetStats(ds);
          labelsCache.current[ds] = Object.keys(st?.stats ?? {}).sort();
        } catch { labelsCache.current[ds] = []; }
      }
      if (!cancelled) setLabels(labelsCache.current[ds]);
    })();
    return () => { cancelled = true; };
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exemplo típico do sinal escolhido como destino.
  useEffect(() => {
    if (!selected || !target) { setExample(null); return; }
    const key = `${selected.dataset_id}|${target.toUpperCase()}`;
    if (key in exampleCache.current) { setExample(exampleCache.current[key]); return; }
    let cancelled = false;
    setExampleLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await trainingService.getLabelExample(selected.dataset_id, target);
        exampleCache.current[key] = res?.ok ? res.features : null;
      } catch { exampleCache.current[key] = null; }
      if (!cancelled) { setExample(exampleCache.current[key]); setExampleLoading(false); }
    }, 300); // espera o admin parar de digitar
    return () => { cancelled = true; clearTimeout(timer); setExampleLoading(false); };
  }, [selected?.dataset_id, target]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeCurrent = () => {
    if (!selected) return;
    setItems((prev) => prev.filter((i) => i.id !== selected.id));
    // O índice fica onde está: o próximo item "sobe" para esta posição.
  };

  const approve = async () => {
    if (!selected || busy) return;
    const finalLabel = target.trim().toUpperCase();
    if (!finalLabel) {
      Alert.alert("Rótulo vazio", "Escolha ou digite o sinal correto antes de aprovar.");
      return;
    }
    setBusy(true);
    try {
      const res = await trainingService.approveQuarantine(selected.id, finalLabel);
      if (!res.ok) throw new Error(res.error || "Falha ao aprovar.");
      // O sinal pode ter ganho uma amostra (e um novo rótulo): renova os caches.
      delete labelsCache.current[selected.dataset_id];
      removeCurrent();
    } catch (e: any) {
      Alert.alert("Erro", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    if (!selected || busy) return;
    Alert.alert("Descartar amostra", "Ela será apagada e não entra no treino.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Descartar",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            const res = await trainingService.discardQuarantine(selected.id);
            if (!res.ok) throw new Error(res.error || "Falha ao descartar.");
            removeCurrent();
          } catch (e: any) {
            Alert.alert("Erro", e?.message || String(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const relabeled = !!selected && target.trim().toUpperCase() !== selected.label;
  const suggestions = current ? suggestionsOf(current) : [];
  const labelChips = Array.from(new Set([...suggestions, ...(current ? [current.label] : []), ...labels]));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={28} color={colors.primary} />
        </TouchableOpacity>
        <Text translatable style={styles.title}>Revisar quarentena</Text>
        <TouchableOpacity onPress={load} disabled={loading}>
          <MaterialIcons name="refresh" size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text translatable style={styles.hint}>
          Amostras suspeitas ficam fora do treino até serem revisadas. Compare o gesto gravado com o
          exemplo típico do sinal e corrija o rótulo se a pessoa gravou no sinal errado.
        </Text>

        {datasetsWithItems.length > 1 && (
          <View style={styles.chipsRow}>
            <TouchableOpacity
              style={[styles.chip, !filter && styles.chipActive]}
              onPress={() => { setFilter(null); setIndex(0); }}
            >
              <Text style={[styles.chipText, !filter && styles.chipTextActive]}>Todos ({items.length})</Text>
            </TouchableOpacity>
            {datasetsWithItems.map(([id, n]) => (
              <TouchableOpacity
                key={id}
                style={[styles.chip, filter === id && styles.chipActive]}
                onPress={() => { setFilter(id); setIndex(0); }}
              >
                <Text style={[styles.chipText, filter === id && styles.chipTextActive]}>
                  {datasetNames[id] ?? "Dataset"} ({n})
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : loadError ? (
          <Text translatable style={styles.emptyText}>{loadError}</Text>
        ) : !current || !selected ? (
          <Text translatable style={styles.emptyText}>Nenhuma amostra aguardando revisão.</Text>
        ) : (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.recordedAs}>Gravado como</Text>
                <Text style={styles.recordedLabel}>{current.label}</Text>
                <Text style={styles.meta}>
                  {datasetNames[current.dataset_id] ?? "Dataset"} · {current.kind === "dynamic" ? "dinâmico" : "estático"} ·{" "}
                  {new Date(current.created_at).toLocaleString()}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 6 }}>
                <Text style={styles.counter}>{safeIndex + 1} / {visible.length}</Text>
                <View style={styles.navRow}>
                  <TouchableOpacity
                    style={styles.navBtn}
                    disabled={safeIndex === 0}
                    onPress={() => setIndex(safeIndex - 1)}
                  >
                    <MaterialIcons name="chevron-left" size={22} color={safeIndex === 0 ? "#555" : colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.navBtn}
                    disabled={safeIndex >= visible.length - 1}
                    onPress={() => setIndex(safeIndex + 1)}
                  >
                    <MaterialIcons
                      name="chevron-right"
                      size={22}
                      color={safeIndex >= visible.length - 1 ? "#555" : colors.primary}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View style={styles.previews}>
              <View style={styles.previewCol}>
                <GesturePreview features={current.features ?? null} caption="Gravado" accent={colors.accent.warning} />
                <Text style={styles.previewLabel}>{current.label}</Text>
              </View>
              <View style={styles.previewCol}>
                {exampleLoading ? (
                  <View style={{ width: 150, height: 150, alignItems: "center", justifyContent: "center" }}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                ) : (
                  <GesturePreview features={example} caption="Típico" accent={colors.primary} />
                )}
                <Text style={styles.previewLabel}>{target.trim().toUpperCase() || "—"}</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Por que está aqui</Text>
            {(current.reasons ?? []).map((r, i) => (
              <View key={i} style={styles.reason}>
                <MaterialIcons
                  name={r.severity === "info" ? "info-outline" : "warning"}
                  size={16}
                  color={r.severity === "info" ? colors.text.tertiary : colors.accent.warning}
                />
                <Text translatable style={r.severity === "info" ? styles.reasonInfo : styles.reasonText}>
                  {r.message}
                </Text>
              </View>
            ))}

            <Text style={styles.sectionTitle}>Sinal correto</Text>
            <View style={[styles.chipsRow, { marginBottom: 0 }]}>
              {labelChips.map((l) => {
                const active = target.trim().toUpperCase() === l;
                const suggested = suggestions.includes(l);
                return (
                  <TouchableOpacity
                    key={l}
                    style={[styles.chip, suggested && styles.chipSuggested, active && styles.chipActive]}
                    onPress={() => setTarget(l)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {l}{suggested ? " ★" : ""}{l === current.label ? " (gravado)" : ""}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={styles.input}
              value={target}
              onChangeText={setTarget}
              placeholder="Ou digite outro sinal"
              placeholderTextColor={colors.text.tertiary}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {suggestions.length > 0 && (
              <Text style={[styles.meta, { marginTop: 6 }]}>★ sugerido pelo dataset ou pelo modelo</Text>
            )}

            <View style={styles.actions}>
              <TouchableOpacity style={[styles.discardBtn, busy && styles.busy]} onPress={discard} disabled={busy}>
                <MaterialIcons name="delete" size={18} color="#fff" />
                <Text style={styles.discardText}>Descartar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.approveBtn, busy && styles.busy]} onPress={approve} disabled={busy}>
                <MaterialIcons name={relabeled ? "swap-horiz" : "check"} size={18} color="#000" />
                <Text style={styles.approveText}>
                  {relabeled ? `Aprovar como ${target.trim().toUpperCase()}` : "Aprovar"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

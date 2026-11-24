import { useCallback, useEffect, useRef, useState } from "react";
import { trainingService } from "@/services/trainingService";
import type { LabelStats } from "@/lib/gestureStats";

export type CollectDataset = {
  id: string;
  name: string;
  type: "static" | "dynamic";
  feature_schema?: string | null;
};

/**
 * Datasets de um tipo de coleta e as contagens do dataset escolhido.
 *
 * Centraliza o que as telas de coleta estática e dinâmica repetiam: listar os
 * datasets, carregar quantas amostras cada gesto tem e manter esses números em
 * dia a cada captura, sem precisar recarregar do servidor.
 */
export function useCollectDatasets(type: "static" | "dynamic", datasetName: string) {
  const [datasets, setDatasets] = useState<CollectDataset[]>([]);
  const [stats, setStats] = useState<LabelStats>({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [totals, setTotals] = useState<Record<string, number>>({});
  // Ids com total já pedido, para abrir a lista várias vezes sem repetir chamadas.
  const requested = useRef(new Set<string>());

  const loadDatasets = useCallback(async () => {
    try {
      const res = await trainingService.getDatasets();
      if (res?.datasets) setDatasets((res.datasets as CollectDataset[]).filter((d) => d.type === type));
    } catch (e) {
      console.log("Failed to load datasets", e);
    }
  }, [type]);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  const current = datasets.find((d) => d.name === datasetName);
  const currentId = current?.id;

  useEffect(() => {
    if (!currentId) {
      setStats({});
      return;
    }
    let alive = true;
    setStatsLoading(true);
    requested.current.add(currentId);
    trainingService
      .getDatasetStats(currentId)
      .then((res: any) => {
        if (!alive) return;
        setStats(res?.stats ?? {});
        if (typeof res?.total_samples === "number") {
          setTotals((t) => ({ ...t, [currentId]: res.total_samples }));
        }
      })
      .catch((e: unknown) => console.log("Failed to load labels", e))
      .finally(() => alive && setStatsLoading(false));
    return () => {
      alive = false;
    };
  }, [currentId]);

  /** Busca o total de amostras dos datasets que ainda não têm (ao abrir a lista). */
  const loadTotals = useCallback((ids: string[]) => {
    ids
      .filter((id) => !requested.current.has(id))
      .forEach((id) => {
        requested.current.add(id);
        trainingService
          .getDatasetStats(id)
          .then((res: any) => {
            if (typeof res?.total_samples === "number") setTotals((t) => ({ ...t, [id]: res.total_samples }));
            else requested.current.delete(id);
          })
          .catch(() => requested.current.delete(id));
      });
  }, []);

  /**
   * Registra a contagem que o servidor devolveu após uma captura (o total do
   * gesto no dataset). Um dataset criado agora só passa a existir na lista
   * depois da 1ª amostra, então a lista é recarregada nesse caso.
   */
  const recordCount = useCallback(
    (label: string, count: number) => {
      const before = stats[label] ?? 0;
      setStats((s) => ({ ...s, [label]: count }));
      if (currentId) {
        setTotals((t) => (t[currentId] === undefined ? t : { ...t, [currentId]: t[currentId] + (count - before) }));
      } else {
        loadDatasets();
      }
    },
    [stats, currentId, loadDatasets],
  );

  return { datasets, stats, statsLoading, totals, loadTotals, recordCount };
}

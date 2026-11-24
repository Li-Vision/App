import { apiRequest } from "@/lib/http";
import type { Dataset, DatasetStats } from "./types";

function normalize(value: string): string {
  return value.toUpperCase();
}

export const datasetService = {
  async getDatasets(): Promise<{ ok: boolean; datasets: Dataset[] }> {
    return apiRequest("/collect/datasets");
  },

  async getDatasetStats(datasetId: string): Promise<any> {
    return apiRequest(`/collect/datasets/${datasetId}/stats`);
  },

  async deleteDataset(datasetId: string, force: boolean = false): Promise<any> {
    const query = force ? "?force=true" : "";
    return apiRequest(`/collect/datasets/${datasetId}${query}`, { method: "DELETE" });
  },

  async renameDataset(datasetId: string, newName: string): Promise<any> {
    return apiRequest(`/collect/datasets/${datasetId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_name: newName }),
    });
  },

  async deleteLabel(datasetId: string, label: string): Promise<any> {
    return apiRequest(
      `/collect/datasets/${datasetId}/labels/${encodeURIComponent(label)}`,
      { method: "DELETE" }
    );
  },

  async renameLabel(datasetId: string, oldLabel: string, newLabel: string): Promise<any> {
    return apiRequest(
      `/collect/datasets/${datasetId}/labels/${encodeURIComponent(oldLabel)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_label: newLabel }),
      }
    );
  },

  async collectStatic(
    label: string,
    datasetName: string,
    landmarks: unknown
  ): Promise<any> {
    return apiRequest("/collect/static", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: normalize(label),
        dataset_name: normalize(datasetName),
        landmarks,
      }),
    });
  },

  /**
   * Veredito da validação assíncrona de uma amostra (ver collect_routes.py).
   * `wait` segura a resposta no servidor até o veredito sair (máx. 10s).
   */
  async getCollectTicket(ticketId: string, wait: number = 8): Promise<any> {
    return apiRequest(`/collect/tickets/${encodeURIComponent(ticketId)}?wait=${wait}`);
  },

  async collectDynamicStart(label: string, datasetName: string): Promise<any> {
    return apiRequest("/collect/dynamic/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: normalize(label),
        dataset_name: normalize(datasetName),
      }),
    });
  },

  async collectDynamicStop(): Promise<any> {
    return apiRequest("/collect/dynamic/stop", { method: "POST" });
  },
};

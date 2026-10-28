/**
 * Vault 管理與 DASH OUT / DASH IN 前端 API 模組 (vaultApi.ts)
 * 統一透過 apiClient 發送請求
 */

import { apiClient, API_BASE_URL } from './apiClient';
import type {
  VaultStats,
  VaultManifest,
  VaultItem,
  InspectZipResponse,
  ActiveVaultResponse,
  SwitchVaultResponse,
  CreateVaultResponse,
  RenameVaultResponse,
  DeleteVaultResponse,
  ImportVaultResponse,
} from '../types/vault';

// 重新匯出 Vault 領域型別供組件直接引用，保持向後相容
export type {
  VaultStats,
  VaultManifest,
  VaultItem,
  InspectZipResponse,
  ActiveVaultResponse,
  SwitchVaultResponse,
  CreateVaultResponse,
  RenameVaultResponse,
  DeleteVaultResponse,
  ImportVaultResponse,
};

export const vaultApi = {
  /** 取得所有 Vault 列表 */
  listVaults: () => apiClient.get<VaultItem[]>('/vaults'),

  /** 取得當前使用中 Vault 資訊與統計數據 */
  getActiveVault: () => apiClient.get<ActiveVaultResponse>('/vaults/active'),

  /** 熱切換使用中的 Vault */
  switchVault: (vaultName: string) =>
    apiClient.post<SwitchVaultResponse>('/vaults/switch', { vault_name: vaultName }),

  /** 建立全新空白 Vault 並自動切換 */
  createVault: (vaultName: string, description?: string) =>
    apiClient.post<CreateVaultResponse>('/vaults/create', { vault_name: vaultName, description: description || '' }),

  /** 重新命名 Vault */
  renameVault: (oldName: string, newName: string) =>
    apiClient.post<RenameVaultResponse>('/vaults/rename', { old_name: oldName, new_name: newName }),

  /** 刪除指定的非使用中 Vault */
  deleteVault: (vaultName: string) =>
    apiClient.delete<DeleteVaultResponse>(`/vaults/${encodeURIComponent(vaultName)}`),

  /** 取得當前使用中 Vault 之統計數據 */
  getVaultStats: () => apiClient.get<VaultStats>('/vault/stats'),

  /** DASH OUT 導出下載 URL */
  getExportUrl: () => `${API_BASE_URL}/vault/export`,

  /** 檢驗並解析上傳的 ZIP 描述檔 */
  inspectZip: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.upload<InspectZipResponse>('/vault/inspect-zip', formData);
  },

  /** DASH IN: 匯入 ZIP 並建立為全新獨立 Vault */
  importVault: (file: File, targetName?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    const query = targetName ? `?target_name=${encodeURIComponent(targetName)}` : '';
    return apiClient.upload<ImportVaultResponse>(`/vault/import${query}`, formData);
  },
};

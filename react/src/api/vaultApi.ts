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
import type {
  VaultMember,
  InviteCodeResponse,
  JoinVaultResponse,
} from '../types/auth';

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
  /** 取得當前使用者所屬之 Vault 列表 */
  listVaults: () => apiClient.get<VaultItem[]>('/vaults'),

  /** 取得當前使用中 Vault 資訊與統計數據 */
  getActiveVault: () => apiClient.get<ActiveVaultResponse>('/vaults/active'),

  /** 熱切換使用中的 Vault */
  switchVault: (vaultName: string) =>
    apiClient.post<SwitchVaultResponse>('/vaults/switch', { vault_name: vaultName }),

  /** 建立全新空白 Vault 並自動切換（將當前登入者設為 owner） */
  createVault: (vaultName: string, description?: string) =>
    apiClient.post<CreateVaultResponse>('/vaults/create', { vault_name: vaultName, description: description || '' }),

  /** 重新命名 Vault */
  renameVault: (oldName: string, newName: string) =>
    apiClient.post<RenameVaultResponse>('/vaults/rename', { old_name: oldName, new_name: newName }),

  /** 刪除指定的非使用中 Vault (需 owner 權限) */
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

  /** 建立邀請碼 (需 owner 或 admin 權限) */
  createInviteCode: (
    vaultName: string,
    defaultRole: 'admin' | 'user' = 'user',
    expiresInDays: number = 7,
    maxUses?: number
  ) =>
    apiClient.post<InviteCodeResponse>('/vaults/invite-code', {
      vault_name: vaultName,
      default_role: defaultRole,
      expires_in_days: expiresInDays,
      max_uses: maxUses || null,
    }),

  /** 憑邀請碼加入紀錄庫 */
  joinVault: (inviteCode: string) =>
    apiClient.post<JoinVaultResponse>('/vaults/join', { invite_code: inviteCode }),

  /** 取得紀錄庫成員名單 */
  getVaultMembers: (vaultName: string) =>
    apiClient.get<VaultMember[]>(`/vaults/${encodeURIComponent(vaultName)}/members`),

  /** 變更成員角色 (需 owner 權限，僅能設定為 admin 或 user) */
  updateMemberRole: (vaultName: string, userId: number, role: 'admin' | 'user') =>
    apiClient.patch<{ status: string; message: string; role: string }>(
      `/vaults/${encodeURIComponent(vaultName)}/members/${userId}/role`,
      { role }
    ),
};

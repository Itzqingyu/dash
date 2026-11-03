/**
 * 紀錄庫管理與多租戶成員 API 服務 (vaultApi.ts)
 */

import { apiClient } from './apiClient';
import {
  VaultStats,
  CreateVaultResponse,
  SwitchVaultResponse,
  ExportVaultResponse,
  ImportVaultResponse,
  RenameVaultResponse,
  DeleteVaultResponse,
  VaultItem,
} from '../types/vault';
import {
  VaultMember,
  InviteCodeResponse,
  VaultInvitationItem,
  JoinVaultResponse,
} from '../types/auth';

export const vaultApi = {
  /** 取得當前使用者所屬的所有 Vault 清單 */
  getUserVaults: () => apiClient.get<VaultItem[]>('/user/vaults'),

  /** 取得目前全局所有已註冊的 Vault 清單 (供備份或管理比對) */
  getVaults: () => apiClient.get<string[]>('/vaults'),

  /** 取得指定 Vault 的統計指標 (文件數、活動數、總容量) */
  getVaultStats: (vaultName: string) =>
    apiClient.get<VaultStats>(`/vaults/${encodeURIComponent(vaultName)}/stats`),

  /** 建立全新 Vault (可傳入指定初始名稱與顯示名稱) */
  createVault: (name?: string, displayName?: string) =>
    apiClient.post<CreateVaultResponse>('/vault/init', {
      name: name || undefined,
      display_name: displayName || undefined,
    }),

  /** 切換當前作用中的 Vault */
  switchVault: (vaultName: string) =>
    apiClient.post<SwitchVaultResponse>('/vault/switch', { vault_name: vaultName }),

  /** 重新命名當前作用中或指定 Vault */
  renameVault: (newName: string, targetVault?: string) =>
    apiClient.post<RenameVaultResponse>('/vault/rename', {
      new_name: newName,
      target_vault: targetVault || undefined,
    }),

  /** 刪除指定 Vault (物理刪除 Schema 與 Markdown 目錄) */
  deleteVault: (vaultName: string) =>
    apiClient.delete<DeleteVaultResponse>(`/vaults/${encodeURIComponent(vaultName)}`),

  /** 匯出指定 Vault 為標準備份 ZIP 檔 (觸發瀏覽器下載) */
  exportVault: async (vaultName: string, fileName?: string): Promise<Blob> => {
    return apiClient.download(
      `/vault/export?vault_name=${encodeURIComponent(vaultName)}`,
      fileName || `${vaultName}_backup.zip`
    );
  },

  /** 驗證外部 ZIP 是否為合法之 DASH 備份資料包 */
  verifyVaultZip: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.upload<{
      status: string;
      message: string;
      manifest?: any;
    }>('/vault/verify-zip', formData);
  },

  /** 匯入外部 ZIP 備份包為全新 Vault */
  importVault: (file: File, newVaultName?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    const query = newVaultName ? `?new_vault_name=${encodeURIComponent(newVaultName)}` : '';
    return apiClient.upload<ImportVaultResponse>(`/vault/import${query}`, formData);
  },

  /** 建立邀請碼 (需 owner 或 admin 權限，恆為單次使用) */
  createInviteCode: (
    vaultName: string,
    defaultRole: 'admin' | 'user' = 'user',
    expiresInDays: number = 7
  ) =>
    apiClient.post<InviteCodeResponse>('/vaults/invite-code', {
      vault_name: vaultName,
      default_role: defaultRole,
      expires_in_days: expiresInDays,
      max_uses: 1,
    }),

  /** 取得紀錄庫所有有效未使用的邀請碼清單 (需 owner 或 admin 權限) */
  getInviteCodes: (vaultId: string) =>
    apiClient.get<VaultInvitationItem[]>(`/vaults/${encodeURIComponent(vaultId)}/invitations`),

  /** 撤銷並刪除指定邀請碼 (需 owner 或 admin 權限) */
  revokeInviteCode: (vaultId: string, inviteId: number) =>
    apiClient.delete<{ status: string; message: string }>(
      `/vaults/${encodeURIComponent(vaultId)}/invitations/${inviteId}`
    ),

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

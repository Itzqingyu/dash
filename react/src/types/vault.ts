/**
 * Vault 儲存庫管理與 DASH IN / OUT 型別定義 (vault.ts)
 */

export interface VaultStats {
  vault_name?: string;
  activities_count: number;
  meetings_count: number;
  tasks_count: number;
  decisions_count: number;
  schedules_count: number;
  incidents_count: number;
  documents_count: number;
  chat_sessions_count: number;
  data_size_bytes: number;
  db_size_bytes: number;
  chroma_size_bytes: number;
  markdown_size_bytes: number;
  last_updated: string;
}

export interface VaultManifest {
  app: string;
  version: string;
  vault_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  description: string;
}

export interface VaultItem {
  name: string;
  display_name: string;
  vault_id: string;
  path?: string;
  created_at: string;
  updated_at: string;
  description: string;
  is_active: boolean;
  user_role?: 'owner' | 'admin' | 'user';
  joined_at?: string;
  stats: VaultStats;
}

export interface InspectZipResponse {
  status: string;
  manifest: VaultManifest;
  suggested_name: string;
}

export interface ActiveVaultResponse {
  active_vault: string;
  stats: VaultStats;
}

export interface SwitchVaultResponse {
  status: string;
  message: string;
  active_vault: string;
  stats: VaultStats;
}

export interface CreateVaultResponse {
  status: string;
  message: string;
  vault: unknown;
  stats: VaultStats;
}

export interface RenameVaultResponse {
  status: string;
  message: string;
  old_name: string;
  new_name: string;
}

export interface DeleteVaultResponse {
  status: string;
  message: string;
  deleted_vault: string;
}

export interface ImportVaultResponse {
  status: string;
  message: string;
  vault_name: string;
  manifest: VaultManifest;
  stats: VaultStats;
}

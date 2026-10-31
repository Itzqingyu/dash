/**
 * 使用者身分認證與權限模型 (auth.ts)
 */

export type VaultMemberRole = 'owner' | 'admin' | 'user';

export interface User {
  id: number;
  email: string;
  created_at?: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface VaultMember {
  id: number;
  user_id: number;
  email: string;
  role: VaultMemberRole;
  joined_at?: string;
}

export interface InviteCodeResponse {
  invite_code: string;
  vault_id?: string;
  vault_name: string;
  default_role: string;
  expires_at: string;
  max_uses?: number | null;
  used_count: number;
}

export interface JoinVaultResponse {
  status: string;
  message: string;
  vault_id?: string;
  vault_name: string;
  role: string;
}


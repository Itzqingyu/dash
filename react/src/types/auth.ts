/**
 * 使用者身分認證與權限模型 (auth.ts)
 */

export type VaultMemberRole = 'owner' | 'admin' | 'user' | 'bot';

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
  id: number | string;
  user_id?: number | null;
  email: string;
  role: VaultMemberRole;
  joined_at?: string;
  is_bot?: boolean;
  channel_id?: string;
  channel_name?: string;
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

export interface VaultInvitationItem {
  id: number;
  invite_code: string;
  vault_id: string;
  default_role: 'admin' | 'user';
  expires_at?: string;
  created_at?: string;
  creator_email: string;
}

export interface JoinVaultResponse {
  status: string;
  message: string;
  vault_id?: string;
  vault_name: string;
  role: string;
}

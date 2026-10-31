/**
 * 使用者身分認證 API 模組 (authApi.ts)
 */

import { apiClient, TOKEN_STORAGE_KEY } from './apiClient';
import type { AuthResponse, User } from '../types/auth';

export const authApi = {
  /** 註冊新使用者 */
  register: async (email: string, password: string): Promise<AuthResponse> => {
    const res = await apiClient.post<AuthResponse>('/auth/register', { email, password });
    if (res.access_token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, res.access_token);
    }
    return res;
  },

  /** 使用者登入 */
  login: async (email: string, password: string): Promise<AuthResponse> => {
    const res = await apiClient.post<AuthResponse>('/auth/login', { email, password });
    if (res.access_token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, res.access_token);
    }
    return res;
  },

  /** 取得當前登入者資訊 */
  getMe: async (): Promise<{ user: User }> => {
    return await apiClient.get<{ user: User }>('/auth/me');
  },

  /** 登出 */
  logout: () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  },
};


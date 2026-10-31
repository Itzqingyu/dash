/**
 * 對話與會話管理服務模組 (chatService.ts)
 * 負責串接 Python FastAPI 之 Chat & Session 相關端點
 */

import { apiClient } from './apiClient';
import {
  BackendSession,
  SessionDetailResponse,
  CreateSessionResponse,
  SendMessageResponse,
} from '../types/chat';

/**
 * 取得所有對話會話清單
 */
export async function fetchSessions(): Promise<BackendSession[]> {
  return await apiClient.get<BackendSession[]>('/sessions');
}

/**
 * 取得指定會話的詳細資訊與歷史訊息紀錄
 */
export async function fetchSessionDetail(
  sessionId: number
): Promise<SessionDetailResponse> {
  return await apiClient.get<SessionDetailResponse>(`/sessions/${sessionId}`);
}

/**
 * 建立新的對話會話
 */
export async function createNewSession(
  title?: string
): Promise<BackendSession> {
  const payload = title ? { title } : {};
  const response = await apiClient.post<CreateSessionResponse>(
    '/sessions',
    payload
  );
  return response.session;
}

/**
 * 更新會話標題
 */
export async function updateSessionTitle(
  sessionId: number,
  title: string
): Promise<void> {
  await apiClient.patch(`/sessions/${sessionId}`, { title });
}

/**
 * 刪除指定對話會話及其歷史訊息
 */
export async function deleteSessionById(sessionId: number): Promise<void> {
  await apiClient.delete(`/sessions/${sessionId}`);
}

/**
 * 發送訊息至指定會話並獲取 AI 回應
 * 支援普通對話模式 ('chat') 與歷史紀錄問答模式 ('rag')
 */
export async function sendChatMessage(
  sessionId: number,
  content: string,
  mode: 'chat' | 'rag',
  topK = 5
): Promise<SendMessageResponse> {
  return await apiClient.post<SendMessageResponse>(
    `/sessions/${sessionId}/messages`,
    {
      content,
      mode,
      top_k: topK,
    }
  );
}

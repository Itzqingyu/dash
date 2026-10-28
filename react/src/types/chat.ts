/**
 * 對話與檢索資料結構型別定義 (chat.ts)
 */

export interface RetrievedChunk {
  content: string;
  metadata?: {
    source?: string;
    [key: string]: unknown;
  };
}

export interface BackendSession {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface BackendMessage {
  id: number;
  session_id: number;
  role: 'user' | 'assistant';
  content: string;
  mode: 'chat' | 'rag';
  retrieved_chunks?: RetrievedChunk[] | string | null;
  created_at: string;
}

export interface SessionDetailResponse {
  status: string;
  session: BackendSession;
  messages: BackendMessage[];
}

export interface CreateSessionRequest {
  title?: string;
}

export interface CreateSessionResponse {
  status: string;
  session: BackendSession;
}

export interface SendMessageRequest {
  content: string;
  mode: 'chat' | 'rag';
  top_k?: number;
}

export interface SendMessageResponse {
  status: string;
  session_id: number;
  mode: 'chat' | 'rag';
  user_message: BackendMessage;
  assistant_message: BackendMessage;
  retrieved_chunks: RetrievedChunk[];
}


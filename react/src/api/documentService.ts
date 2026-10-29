/**
 * 歷史紀錄文件管理服務模組 (documentService.ts)
 * 負責串接 Python FastAPI 之 RAG Document 相關端點 (文檔列表、檔案上傳、檔案刪除與全文讀取)
 */

import { apiClient } from './apiClient';
import {
  BackendDocument,
  UploadDocumentResponse,
  DocumentContentResponse,
} from '../types/document';

/**
 * 取得已入庫的歷史紀錄文件列表
 */
export async function fetchDocuments(): Promise<BackendDocument[]> {
  return await apiClient.get<BackendDocument[]>('/documents');
}

/**
 * 讀取指定文件的 Markdown 原始全文內容
 */
export async function fetchDocumentContent(
  docId: number
): Promise<DocumentContentResponse> {
  return await apiClient.get<DocumentContentResponse>(`/documents/${docId}/content`);
}

/**
 * 上傳文件並觸發後端轉檔與向量化切片入庫
 * 支援格式：.md, .txt, .pdf, .docx
 */
export async function uploadDocument(
  file: File
): Promise<UploadDocumentResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return await apiClient.upload<UploadDocumentResponse>('/upload', formData);
}

/**
 * 刪除指定文件及其在向量資料庫中的所有切片
 * @param identifier 文件 ID (number) 或 檔案相對路徑 (string)
 */
export async function deleteDocumentByIdentifier(
  identifier: string | number
): Promise<void> {
  // 將路徑或 ID 進行編碼以傳遞給路徑參數
  const encoded = encodeURIComponent(String(identifier));
  await apiClient.delete(`/documents/${encoded}`);
}

/**
 * 檢查即將上傳之檔案主檔名是否與現有文件清單重複（不分副檔名與大小寫）
 * 範例：若現有清單中包含 "meeting.md"，上傳 "meeting.docx" 或 "meeting.pdf" 即會判定衝突。
 * @param uploadFileName 即將上傳的原始檔案名稱
 * @param existingNames 現有文件名稱清單（如 filename 或 name）
 * @returns 衝突的現存檔名，若無衝突則回傳 null
 */
export function checkDuplicateFileStem(
  uploadFileName: string,
  existingNames: string[]
): string | null {
  const uploadStem = uploadFileName.replace(/\.[^/.]+$/, '').trim().toLowerCase();
  for (const name of existingNames) {
    const base = name.split(/[\\/]/).pop() || name;
    const existingStem = base.replace(/\.[^/.]+$/, '').trim().toLowerCase();
    if (uploadStem === existingStem) {
      return base;
    }
  }
  return null;
}

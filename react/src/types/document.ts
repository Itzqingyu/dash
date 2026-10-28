/**
 * 歷史紀錄文件管理型別定義 (document.ts)
 */

export interface BackendDocument {
  id: number;
  filename: string;
  file_path: string;
  file_hash?: string;
  upload_date: string;
  chunk_count: number;
}

export interface UploadDocumentResponse {
  status: string;
  message: string;
  doc_id?: number | null;
  file_path?: string;
  chunks_added?: number;
}

export interface DeleteDocumentResponse {
  status: string;
  message: string;
}


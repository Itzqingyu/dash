/**
 * 獨立文件紀錄庫管理面板 (DocumentManagementPanel.tsx)
 * 職責：
 * 1. 託管並向量化會議與專案文件 (MD, TXT, PDF, DOCX)。
 * 2. 檔案拖曳與點擊上傳，具備同名主檔名衝突防呆提示。
 * 3. 完整文件清冊管理：全文檢索過濾、分塊數量檢視、全文閱讀抽屜/彈窗、安全刪除。
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText,
  UploadCloud,
  Trash2,
  Eye,
  Search,
  AlertCircle,
  CheckCircle2,
  X,
  Layers,
  FileSpreadsheet,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { VaultBreadcrumb } from '../../layout/VaultBreadcrumb';
import {
  fetchDocuments,
  uploadDocument,
  deleteDocumentByIdentifier,
  fetchDocumentContent,
  checkDuplicateFileStem,
} from '../../../api/documentService';
import type { BackendDocument, DocumentContentResponse } from '../../../types/document';
import './DocumentManagementPanel.css';

export interface DocumentManagementPanelProps {
  vaultName?: string;
  onNavigateToHome?: () => void;
  onNavigateToVaultHub?: () => void;
}

export const DocumentManagementPanel: React.FC<DocumentManagementPanelProps> = ({
  vaultName = 'default',
  onNavigateToHome,
  onNavigateToVaultHub,
}) => {
  const [documents, setDocuments] = useState<BackendDocument[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);

  // 通知橫幅狀態
  const [alertMessage, setAlertMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // 全文閱讀彈窗狀態
  const [readingDoc, setReadingDoc] = useState<DocumentContentResponse | null>(null);
  const [loadingContent, setLoadingContent] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 載入文件清冊
  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const docs = await fetchDocuments();
      setDocuments(docs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '取得文件清冊失敗';
      setAlertMessage({ type: 'error', text: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // 處理檔案上傳（含重複主檔名檢查）
  const handleUploadFile = async (file: File) => {
    setAlertMessage(null);

    // 格式校驗
    const validExts = ['.md', '.txt', '.pdf', '.docx'];
    const lowerName = file.name.toLowerCase();
    const isSupported = validExts.some((ext) => lowerName.endsWith(ext));
    if (!isSupported) {
      setAlertMessage({
        type: 'error',
        text: `不支援的檔案格式「${file.name}」，僅接受 .md, .txt, .pdf, .docx 檔案。`,
      });
      return;
    }

    // 重複主檔名防呆
    const existingNames = documents.map((d) => d.filename);
    const duplicate = checkDuplicateFileStem(file.name, existingNames);
    if (duplicate) {
      setAlertMessage({
        type: 'error',
        text: `紀錄庫中已存在相同主檔名之文件「${duplicate}」，系統禁止同名覆蓋。請更名後再行上傳。`,
      });
      return;
    }

    setUploading(true);
    try {
      const res = await uploadDocument(file);
      setAlertMessage({
        type: 'success',
        text: `成功上傳並解析「${file.name}」（新增 ${res.chunks_added ?? 0} 個向量分塊）`,
      });
      await loadDocuments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '上傳文件失敗';
      setAlertMessage({ type: 'error', text: msg });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFile(e.dataTransfer.files[0]);
    }
  };

  // 刪除文件
  const handleDelete = async (doc: BackendDocument) => {
    if (!window.confirm(`確定要自紀錄庫刪除「${doc.filename}」及其向量索引嗎？`)) {
      return;
    }

    try {
      await deleteDocumentByIdentifier(doc.id);
      setAlertMessage({
        type: 'success',
        text: `已成功自紀錄庫移除「${doc.filename}」`,
      });
      await loadDocuments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '刪除文件失敗';
      setAlertMessage({ type: 'error', text: msg });
    }
  };

  // 開啟全文閱讀
  const handleOpenReader = async (docId: number) => {
    setLoadingContent(true);
    try {
      const res = await fetchDocumentContent(docId);
      setReadingDoc(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '讀取文件全文失敗';
      setAlertMessage({ type: 'error', text: msg });
    } finally {
      setLoadingContent(false);
    }
  };

  // 搜尋過濾
  const filteredDocs = documents.filter((doc) =>
    doc.filename.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  return (
    <div className="doc-page-root">
      <div className="doc-container">
        {/* 1. 頂部麵包屑導航 */}
        <VaultBreadcrumb
          vaultName={vaultName}
          currentPageTitle="文件紀錄庫"
          onNavigateToHome={onNavigateToHome}
          onNavigateToVaultHub={onNavigateToVaultHub}
          onBack={onNavigateToVaultHub}
        />

        {/* 2. 頂部大卡片 */}
        <header className="doc-header-card">
          <div className="doc-header-row">
            <div className="doc-header-left">
              <div className="doc-icon-badge">
                <FileSpreadsheet size={28} />
              </div>
              <div className="doc-title-group">
                <h1 className="doc-header-title">文件紀錄庫管理</h1>
                <p className="doc-header-desc">
                  託管會議逐字稿、專案規章與活動企劃等歷史文件，系統自動解析 Markdown 並建立向量切片索引
                </p>
              </div>
            </div>

            <div className="doc-header-actions">
              <button
                type="button"
                className="doc-header-btn primary"
                onClick={() => fileInputRef.current?.click()}
                title="上傳新文件"
              >
                <UploadCloud size={16} />
                <span>上傳文件</span>
              </button>
              <div className="doc-stat-pill">
                <Layers size={15} />
                <span>總文件數：{documents.length}</span>
              </div>
            </div>
          </div>
        </header>

      {/* 提示訊息橫幅 */}
      {alertMessage && (
        <div className={`doc-alert-banner ${alertMessage.type}`}>
          {alertMessage.type === 'error' ? (
            <AlertCircle size={18} />
          ) : (
            <CheckCircle2 size={18} />
          )}
          <span>{alertMessage.text}</span>
          <button
            type="button"
            className="btn-close"
            style={{ marginLeft: 'auto' }}
            onClick={() => setAlertMessage(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* 拖曳上傳區塊 */}
      <div
        className={`doc-upload-card ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".md,.txt,.pdf,.docx"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleUploadFile(e.target.files[0]);
            }
          }}
        />
        <div className="upload-icon-circle">
          <UploadCloud size={26} />
        </div>
        <p className="upload-card-text">
          {uploading
            ? '檔案上傳與切片向量化中，請稍候...'
            : '點擊或將文件拖曳至此處上傳'}
        </p>
        <span className="upload-card-hint">
          支援格式：.md, .txt, .pdf, .docx（檔案大小上限 50MB，同主檔名嚴格防呆）
        </span>
      </div>

      {/* 文件清冊列表卡片 */}
      <div className="doc-list-card">
        <div className="doc-list-toolbar">
          <div className="doc-search-wrap">
            <Search size={16} className="doc-search-icon" />
            <input
              type="text"
              className="doc-search-input"
              placeholder="搜尋檔案名稱..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <span className="upload-card-hint">
            共 {filteredDocs.length} 份文件
          </span>
        </div>

        <div className="doc-table-wrap">
          {loading ? (
            <div className="doc-empty-state">
              <p>載入文件清單中...</p>
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="doc-empty-state">
              <FileText size={36} />
              <p>
                {searchQuery
                  ? '未找到符合關鍵字的文件'
                  : '紀錄庫尚無任何文件，請自上方拖曳或選取檔案上傳'}
              </p>
            </div>
          ) : (
            <table className="doc-table">
              <thead>
                <tr>
                  <th>檔案名稱</th>
                  <th>上傳時間</th>
                  <th>分塊切片</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <div className="doc-filename-cell">
                        <FileText size={18} className="doc-file-icon" />
                        <span>{doc.filename}</span>
                      </div>
                    </td>
                    <td>{doc.upload_date || '未知'}</td>
                    <td>
                      <span className="doc-chunk-badge">
                        {doc.chunk_count} chunks
                      </span>
                    </td>
                    <td>
                      <div className="doc-actions-cell">
                        <button
                          type="button"
                          className="btn-icon-action"
                          onClick={() => handleOpenReader(doc.id)}
                          disabled={loadingContent}
                          title="閱讀 Markdown 解析全文"
                        >
                          <Eye size={14} />
                          <span>閱讀全文</span>
                        </button>
                        <button
                          type="button"
                          className="btn-icon-action danger"
                          onClick={() => handleDelete(doc)}
                          title="刪除此文件與向量切片"
                        >
                          <Trash2 size={14} />
                          <span>刪除</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 全文閱讀彈窗 (Reader Modal) */}
      {readingDoc && (
        <div
          className="reader-modal-overlay"
          onClick={() => setReadingDoc(null)}
        >
          <div
            className="reader-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="reader-modal-header">
              <div className="reader-title-wrap">
                <FileText size={20} className="doc-file-icon" />
                <h3 className="reader-title">{readingDoc.filename}</h3>
              </div>
              <button
                type="button"
                className="btn-close"
                onClick={() => setReadingDoc(null)}
              >
                <X size={20} />
              </button>
            </div>

            <div className="reader-modal-body markdown-body">
              <ReactMarkdown>{readingDoc.content}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};


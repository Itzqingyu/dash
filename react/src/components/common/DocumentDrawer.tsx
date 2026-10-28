import React, { useRef } from 'react';
import { X, UploadCloud, FileText, Trash2, AlertCircle } from 'lucide-react';
import './DocumentDrawer.css';

/**
 * 歷史紀錄文件資料介面 (本機狀態使用)
 */
export interface DocumentItem {
  id: string;
  name: string;
  size: string;
  uploadedAt: string;
  chunkCount?: number;
}

interface DocumentDrawerProps {
  // 控制抽屜開關
  isOpen: boolean;
  // 關閉抽屜的回呼函式
  onClose: () => void;
  // 目前已導入的文件清單
  documents: DocumentItem[];
  // 上傳檔案回呼
  onUploadFile?: (file: File) => void;
  // 刪除檔案回呼
  onDeleteDocument?: (id: string) => void;
  // 是否正在上傳與向量化
  isUploading?: boolean;
  // 錯誤提示訊息
  errorMessage?: string | null;
  // 清除錯誤提示
  onClearError?: () => void;
}

/**
 * 歷史紀錄文檔管理抽屜組件 (Document Drawer)
 * 負責檢視已入庫的文檔清單，並提供上傳新文件的介面與極簡空狀態
 */
export const DocumentDrawer: React.FC<DocumentDrawerProps> = ({
  isOpen,
  onClose,
  documents,
  onUploadFile,
  onDeleteDocument,
  isUploading = false,
  errorMessage = null,
  onClearError,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 觸發原生檔案選擇器
  const handleTriggerUpload = () => {
    fileInputRef.current?.click();
  };

  // 處理檔案選擇事件
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      if (onUploadFile) {
        onUploadFile(selectedFile);
      }
      // 重設 input 避免重複選取同一檔案時無法觸發
      e.target.value = '';
    }
  };

  return (
    <>
      {/* 遮罩背景：點擊關閉抽屜 */}
      <div
        className={`drawer-backdrop ${isOpen ? 'active' : ''}`}
        hidden={!isOpen}
        onClick={onClose}
        aria-hidden={!isOpen}
      />

      {/* 抽屜主體 */}
      <aside
        className={`doc-drawer ${isOpen ? 'open' : ''}`}
        aria-label="歷史紀錄文檔管理"
        aria-hidden={!isOpen}
      >
        {/* 抽屜頂部 */}
        <div className="doc-drawer-head">
          <div>
            <p className="eyebrow">HISTORY RECORDS</p>
            <h2>歷史紀錄文檔</h2>
          </div>
          <button
            type="button"
            className="close-button"
            onClick={onClose}
            aria-label="關閉歷史紀錄抽屜"
          >
            <X size={18} />
          </button>
        </div>

        {/* 上傳區域 (Drag & Drop 骨架) */}
        <div className="doc-upload-box">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,.pdf,.docx"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <div
            className={`doc-upload-dropzone ${isUploading ? 'uploading' : ''}`}
            onClick={!isUploading ? handleTriggerUpload : undefined}
            role="button"
            tabIndex={0}
          >
            <UploadCloud size={28} className={`upload-icon ${isUploading ? 'spinning' : ''}`} />
            <strong>{isUploading ? '文件上傳與向量化處理中…' : '點擊或拖曳檔案至此上傳'}</strong>
            <small>支援 .md、.txt、.pdf、.docx</small>
          </div>
          {errorMessage ? (
            <div className="doc-error-banner" role="alert">
              <AlertCircle size={15} />
              <div className="doc-error-content">
                <span>{errorMessage}</span>
                {onClearError && (
                  <button type="button" className="doc-error-dismiss" onClick={onClearError}>
                    關閉
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="doc-upload-tip">
              <AlertCircle size={14} />
              <span>檔案上傳後將自動切片並建立向量索引</span>
            </div>
          )}
        </div>

        {/* 文件清單標題與數量統計 */}
        <div className="doc-list-head">
          <span className="doc-list-title">已入庫文件</span>
          <span className="doc-list-count">共 {documents.length} 份</span>
        </div>

        {/* 文件列表滾動區 */}
        <div className="doc-list-scroll">
          {documents.length === 0 ? (
            // 極簡空狀態：尚未上傳任何文件
            <div className="doc-empty-state">
              <FileText size={32} className="empty-icon" />
              <p>尚未上傳任何文件</p>
              <small>上傳文件後，AI 助手將可引用其中內容回答問題</small>
            </div>
          ) : (
            // 渲染文件清單
            <div className="doc-items-container">
              {documents.map((doc) => (
                <div key={doc.id} className="doc-item-card">
                  <div className="doc-item-icon">
                    <FileText size={20} />
                  </div>
                  <div className="doc-item-meta">
                    <strong className="doc-item-name" title={doc.name}>
                      {doc.name}
                    </strong>
                    <div className="doc-item-details">
                      <span>{doc.size}</span>
                      <span>•</span>
                      <span>{doc.uploadedAt}</span>
                      {doc.chunkCount !== undefined && (
                        <>
                          <span>•</span>
                          <span>{doc.chunkCount} 個切片</span>
                        </>
                      )}
                    </div>
                  </div>
                  {onDeleteDocument && (
                    <button
                      type="button"
                      className="doc-delete-btn"
                      title="刪除文檔"
                      onClick={() => onDeleteDocument(doc.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

export default DocumentDrawer;

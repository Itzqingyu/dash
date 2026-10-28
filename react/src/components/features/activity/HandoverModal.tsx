import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import html2pdf from 'html2pdf.js';
import { activityApi } from '../../../api/activityApi';
import type { Activity } from '../../../types/activity';
import './HandoverModal.css';

interface HandoverModalProps {
  isOpen: boolean;
  currentActivity: Activity | null;
  handoverSummary: string;
  onClose: () => void;
}

/**
 * 活動交接報告預覽與匯出彈窗 (HandoverModal)
 * 提供 Markdown 格式預覽、存入紀錄庫 (向量化) 與匯出 PDF 報表功能
 */
export const HandoverModal: React.FC<HandoverModalProps> = ({
  isOpen,
  currentActivity,
  handoverSummary,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pdfExportRef = useRef<HTMLDivElement>(null);

  const [handoverSaved, setHandoverSaved] = useState<boolean>(false);
  const [isSavingHandover, setIsSavingHandover] = useState<boolean>(false);
  const [handoverSaveMessage, setHandoverSaveMessage] = useState<string | null>(null);
  const [handoverSaveError, setHandoverSaveError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
      setHandoverSaved(false);
      setHandoverSaveMessage(null);
      setHandoverSaveError(null);
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [isOpen, handoverSummary]);

  // 存入紀錄庫處理函數
  const handleSaveHandoverToKnowledgeBase = async () => {
    if (!handoverSummary || isSavingHandover) return;
    setIsSavingHandover(true);
    setHandoverSaveMessage(null);
    setHandoverSaveError(null);

    try {
      const activityName = currentActivity?.name || '活動';
      const result = await activityApi.saveHandover({
        activity_id: currentActivity?.id,
        activity_name: activityName,
        content: handoverSummary,
      });
      setHandoverSaved(true);
      setHandoverSaveMessage(result.message || '已成功存入紀錄庫並完成向量化！');
    } catch (err: unknown) {
      setHandoverSaveError(err instanceof Error ? err.message : '存入紀錄庫失敗');
    } finally {
      setIsSavingHandover(false);
    }
  };

  // 匯出 PDF 邏輯
  const handleExportPDF = () => {
    const element = pdfExportRef.current;
    if (!element) return;

    // 1. 取得今天的日期 (格式：YYYYMMDD)
    const today = new Date();
    const dateString = `${today.getFullYear()}${(today.getMonth() + 1).toString().padStart(2, '0')}${today.getDate().toString().padStart(2, '0')}`;

    // 2. 取得活動名稱
    const activityName = currentActivity?.name || '活動';

    // 3. 組合動態檔名
    const dynamicFilename = `${activityName}_交接報告_${dateString}.pdf`;

    const opt = {
      margin: 15,
      filename: dynamicFilename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    };

    // @ts-ignore
    html2pdf().set(opt).from(element).save();
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      id="handover-modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form method="dialog" onSubmit={(e) => e.preventDefault()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">AI HANDOVER</p>
            <h2>交接摘要預覽</h2>
          </div>
          <button
            className="close-button"
            type="button"
            aria-label="關閉"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {handoverSaveMessage && (
          <div className="modal-banner success">{handoverSaveMessage}</div>
        )}
        {handoverSaveError && (
          <div className="modal-banner error">{handoverSaveError}</div>
        )}

        {/* PDF 報表渲染目標區域 */}
        <div ref={pdfExportRef} className="handover-modal-body">
          <h1 className="handover-report-title">
            活動交接摘要報告
          </h1>

          <div className="handover-report-markdown">
            {handoverSummary ? (
              <ReactMarkdown>{handoverSummary}</ReactMarkdown>
            ) : (
              <p className="handover-loading-text">載入中...</p>
            )}
          </div>
        </div>

        <div className="modal-actions" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
          <button
            className="button secondary"
            type="button"
            onClick={handleSaveHandoverToKnowledgeBase}
            disabled={isSavingHandover || handoverSaved || !handoverSummary}
          >
            {isSavingHandover ? '存入中...' : handoverSaved ? '已存入紀錄庫' : '存入紀錄庫'}
          </button>
          <button
            className="button primary"
            type="button"
            onClick={handleExportPDF}
            data-toast="交接摘要已匯出"
          >
            匯出為 PDF
          </button>
        </div>
      </form>
    </dialog>
  );
};

export default HandoverModal;


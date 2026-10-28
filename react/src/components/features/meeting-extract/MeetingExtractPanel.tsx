import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText,
  CheckCircle2,
  Calendar,
  Clock,
  MapPin,
  Users,
  ListTodo,
  AlertCircle,
  RefreshCw,
  Check,
  RotateCcw,
  Plus,
  Trash2,
  Upload,
  Building2,
  FolderPlus,
} from 'lucide-react';
import {
  fetchDocuments,
  uploadDocument,
  deleteDocumentByIdentifier,
  checkDuplicateFileStem,
} from '../../../api/documentService';
import { BackendDocument } from '../../../types/document';
import {
  extractMeetingSummary,
  commitMeetingSummary,
  fetchActivities,
  createActivity,
  BackendActivity,
  MeetingPreviewData,
} from '../../../api/meetingExtractService';
import DocumentDrawer, { DocumentItem } from '../../common/DocumentDrawer';
import ConfirmModal from '../../common/ConfirmModal';
import './MeetingExtractPanel.css';

/**
 * 格式化 ISO 時間字串為簡短展示文字
 */
const formatTimeString = (isoString?: string): string => {
  if (!isoString) {
    const now = new Date();
    return `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return isoString;
  }
};

/**
 * AI 會議紀錄整理面板 (Meeting Extract Panel)
 * 核心功能：
 * 1. 從已上傳的文件挑選一份會議紀錄 (支援快捷上傳與歷史紀錄抽屜管理)
 * 2. 呼叫 LLM 依據 System Prompt 提煉成標準化結構（會議摘要、決策、待辦）
 * 3. 呈現結構化標準表格並提供使用者確認
 * 4. 確認後一鍵寫入資料庫
 */
export interface MeetingExtractPanelProps {
  hidden?: boolean;
}

export const MeetingExtractPanel: React.FC<MeetingExtractPanelProps> = ({ hidden = false }) => {
  // 原生檔案選擇器參照 (快捷直上使用)
  const quickFileInputRef = useRef<HTMLInputElement>(null);

  // 已入庫文檔清單
  const [documents, setDocuments] = useState<BackendDocument[]>([]);
  // 當前選中的文檔 ID
  const [selectedDocId, setSelectedDocId] = useState<number | ''>('');

  // 歷史紀錄文檔抽屜開啟狀態
  const [isDocDrawerOpen, setIsDocDrawerOpen] = useState(false);
  // 文檔上傳中狀態
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  // 抽屜專屬錯誤訊息
  const [docDrawerError, setDocDrawerError] = useState<string | null>(null);

  // 活動關聯與建立狀態 (活動為會議與事項必填之外部關聯)
  const [activities, setActivities] = useState<BackendActivity[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<number | ''>('');
  const [activityMode, setActivityMode] = useState<'existing' | 'new'>('existing');
  const [newActivityData, setNewActivityData] = useState<{
    name: string;
    year: number;
    status: string;
    venue: string;
    activity_type: string;
  }>({
    name: '',
    year: new Date().getFullYear(),
    status: '籌備中',
    venue: '',
    activity_type: '會議',
  });
  const [isCreatingActivity, setIsCreatingActivity] = useState(false);
  const [activityNotice, setActivityNotice] = useState<string | null>(null);

  // 記錄當前預覽結果所關聯的來源文檔 ID 與檔名
  const [extractedDocId, setExtractedDocId] = useState<number | null>(null);
  const [extractedDocName, setExtractedDocName] = useState<string | null>(null);

  // 狀態管理
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isCommitted, setIsCommitted] = useState(false);

  // 提示與錯誤訊息
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // LLM 返回之標準化預覽資料
  const [previewData, setPreviewData] = useState<MeetingPreviewData | null>(null);

  // 全域防手殘確認對話框狀態
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => { },
  });

  /**
   * 將 BackendDocument[] 轉換為 DocumentDrawer 所需的 DocumentItem[] 介面
   */
  const drawerDocuments: DocumentItem[] = documents.map((doc) => ({
    id: String(doc.id),
    name: doc.filename,
    size: `${doc.chunk_count} 個切片`,
    uploadedAt: formatTimeString(doc.upload_date),
    chunkCount: doc.chunk_count,
  }));

  /**
   * 載入已上傳文件清單
   */
  const loadDocumentsList = useCallback(async () => {
    setIsLoadingDocs(true);
    setErrorMessage(null);
    try {
      const docs = await fetchDocuments();
      setDocuments(docs);
      if (docs.length > 0 && selectedDocId === '') {
        setSelectedDocId(docs[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`無法載入文檔清單：${msg}`);
    } finally {
      setIsLoadingDocs(false);
    }
  }, [selectedDocId]);

  /**
   * 載入後端所有活動清單
   */
  const loadActivitiesList = useCallback(async () => {
    try {
      const acts = await fetchActivities();
      setActivities(acts);
      if (acts.length > 0) {
        setSelectedActivityId((prev) => (prev === '' ? acts[0].id : prev));
      } else {
        setActivityMode('new');
      }
    } catch {
      // 靜默捕捉，不干擾初始化體驗
    }
  }, []);

  // 切換至本面板 (!hidden) 時自動從後端刷新文檔清單與活動清單
  useEffect(() => {
    if (!hidden) {
      loadDocumentsList();
      loadActivitiesList();
    }
  }, [hidden, loadDocumentsList, loadActivitiesList]);

  /**
   * 文檔真實上傳處理 (支援快捷按鈕與側邊抽屜上傳)
   * 具備前置主檔名防呆：若清單中已有相同主檔名之文件，直接中斷並提示錯誤，不發送網路請求。
   * 上傳並向量化成功後，自動更新列表並自動選中該新上傳之文件
   */
  const handleUploadFile = async (file: File) => {
    setDocDrawerError(null);
    setErrorMessage(null);

    // 前端前置主檔名重複防呆校驗
    const existingNames = documents.map((d) => d.filename || d.file_path);
    const duplicate = checkDuplicateFileStem(file.name, existingNames);
    if (duplicate) {
      const msg = `已存在相同主檔名之文件「${duplicate}」。系統不允許同名覆蓋，請先手動刪除舊文件或重新命名檔案後再行上傳。`;
      setDocDrawerError(msg);
      setErrorMessage(msg);
      return;
    }

    setIsUploadingDoc(true);
    try {
      const res = await uploadDocument(file);
      const freshDocs = await fetchDocuments();
      setDocuments(freshDocs);

      // 若後端有回傳 doc_id 則直接選中，否則比對檔名選中
      if (res.doc_id) {
        setSelectedDocId(res.doc_id);
      } else if (freshDocs.length > 0) {
        const matched = freshDocs.find((d) => d.filename === file.name);
        if (matched) {
          setSelectedDocId(matched.id);
        }
      }
      setSuccessMessage(`文檔「${file.name}」上傳成功，已自動載入並選中！`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDocDrawerError(`上傳檔案失敗：${msg}`);
      setErrorMessage(`上傳檔案失敗：${msg}`);
    } finally {
      setIsUploadingDoc(false);
    }
  };

  /**
   * 快捷檔案選擇器 Change 事件處理
   */
  const handleQuickFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      handleUploadFile(file);
      e.target.value = '';
    }
  };

  /**
   * 刪除指定文件 (呼叫 DELETE /documents/{id})
   * 若刪除之文件為當前選中項，自動重設選中狀態並清空預覽
   */
  const handleDeleteDocument = (id: string) => {
    const targetDoc = documents.find((d) => String(d.id) === id);
    const docName = targetDoc ? `「${targetDoc.filename}」` : '此文件';

    setConfirmDialog({
      isOpen: true,
      title: '確定要刪除歷史紀錄文檔？',
      message: `確定要自歷史紀錄中移除 ${docName} 嗎？這將會同步自磁碟物理刪除該 Markdown 文件與向量檢索索引。`,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          setDocDrawerError(null);
          await deleteDocumentByIdentifier(id);
          const freshDocs = await fetchDocuments();
          setDocuments(freshDocs);

          // 若刪除的是當前選中項，清空選中項與預覽資料
          if (String(selectedDocId) === id) {
            setSelectedDocId(freshDocs.length > 0 ? freshDocs[0].id : '');
            setPreviewData(null);
            setIsCommitted(false);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setDocDrawerError(`刪除文檔失敗：${msg}`);
        }
      },
    });
  };

  /**
   * 步驟 1：觸發 LLM 根據 system prompt 整理會議紀錄 (POST /extract_summary)
   */
  const handleExtract = async () => {
    if (!selectedDocId) {
      setErrorMessage('請先從下拉選單選擇欲整理的會議文件');
      return;
    }

    setIsExtracting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsCommitted(false);
    setActivityNotice(null);

    try {
      const res = await extractMeetingSummary(Number(selectedDocId));
      setPreviewData(res.preview_data);

      // 保存本次萃取來源文件之 ID 與檔名
      const currentDoc = documents.find((d) => d.id === selectedDocId);
      const effectiveDocId = res.doc_id ?? Number(selectedDocId);
      setExtractedDocId(effectiveDocId);
      setExtractedDocName(currentDoc?.filename ?? null);

      // 同步取得最新活動清單以供關聯
      const freshActs = await fetchActivities();
      setActivities(freshActs);
      if (freshActs.length > 0) {
        setActivityMode('existing');
        setSelectedActivityId((prev) => (prev !== '' ? prev : freshActs[0].id));
      } else {
        setActivityMode('new');
        setSelectedActivityId('');
      }

      // 依萃取出的會議內容預先填入建議的新活動欄位
      const parsedYear = res.preview_data.meeting.date
        ? parseInt(res.preview_data.meeting.date.slice(0, 4), 10) || new Date().getFullYear()
        : new Date().getFullYear();

      setNewActivityData({
        name: res.preview_data.meeting.name || '',
        year: parsedYear,
        status: '籌備中',
        venue: res.preview_data.meeting.location || '',
        activity_type: '會議',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`會議整理失敗：${msg}`);
    } finally {
      setIsExtracting(false);
    }
  };

  /**
   * 快速建立新活動 (POST /activities)
   */
  const handleCreateNewActivity = async (): Promise<BackendActivity | null> => {
    const trimmedName = newActivityData.name.trim();
    if (!trimmedName) {
      setErrorMessage('請填寫活動名稱（必填欄位）');
      return null;
    }
    if (!newActivityData.year || newActivityData.year <= 0) {
      setErrorMessage('請填寫合法的活動年份（必須為大於 0 之西元年份）');
      return null;
    }
    if (!newActivityData.status) {
      setErrorMessage('請指定活動狀態（必填欄位）');
      return null;
    }

    setIsCreatingActivity(true);
    setErrorMessage(null);
    try {
      const created = await createActivity({
        name: trimmedName,
        year: newActivityData.year,
        status: newActivityData.status,
        venue: newActivityData.venue.trim() || undefined,
        activity_type: newActivityData.activity_type.trim() || undefined,
      });

      const nextActs = [...activities, created];
      setActivities(nextActs);
      setSelectedActivityId(created.id);
      setActivityMode('existing');
      setActivityNotice(`已成功建立活動「${created.name}」並自動選取！`);
      setTimeout(() => setActivityNotice(null), 4000);
      return created;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`建立新活動失敗：${msg}`);
      return null;
    } finally {
      setIsCreatingActivity(false);
    }
  };

  /**
   * 步驟 2：使用者確認後，寫入資料庫 (POST /commit_summary)
   * 強調 Activity 必填防呆：若為現有模式必須選擇活動；若為新建模式則先建立活動再完成寫入。
   */
  const handleCommit = async () => {
    if (!previewData) return;

    setIsCommitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      let targetActivityId: number;

      if (activityMode === 'existing') {
        if (!selectedActivityId) {
          setErrorMessage('請先選擇要關聯的目標活動（此欄位為必填項目）。');
          setIsCommitting(false);
          return;
        }
        targetActivityId = Number(selectedActivityId);
      } else {
        // 快速建立新活動模式：若尚未單獨點擊「立即建立」，則在此處自動先行建立
        const created = await handleCreateNewActivity();
        if (!created) {
          setIsCommitting(false);
          return;
        }
        targetActivityId = created.id;
      }

      const docIdToCommit = extractedDocId ?? (typeof selectedDocId === 'number' ? selectedDocId : undefined);
      const selectedDoc =
        documents.find((d) => d.id === docIdToCommit) ||
        documents.find((d) => d.id === selectedDocId);

      const res = await commitMeetingSummary({
        activity_id: targetActivityId,
        doc_id: docIdToCommit,
        source_file: selectedDoc?.filename || extractedDocName || undefined,
        meeting: previewData.meeting,
        decisions: previewData.decisions,
        tasks: previewData.tasks,
      });

      const targetActName =
        activities.find((a) => a.id === targetActivityId)?.name || newActivityData.name;

      setIsCommitted(true);
      setSuccessMessage(
        `${res.message}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`寫入資料庫失敗：${msg}`);
    } finally {
      setIsCommitting(false);
    }
  };

  /**
   * 編輯會議摘要基本欄位
   */
  const handleUpdateMeetingField = (field: keyof typeof previewData.meeting, value: string) => {
    if (!previewData) return;
    setPreviewData({
      ...previewData,
      meeting: {
        ...previewData.meeting,
        [field]: value,
      },
    });
  };

  /**
   * 編輯關鍵決策欄位
   */
  const handleUpdateDecisionField = (index: number, field: string, value: string) => {
    if (!previewData) return;
    const updatedDecisions = [...previewData.decisions];
    updatedDecisions[index] = {
      ...updatedDecisions[index],
      [field]: value,
    };
    setPreviewData({
      ...previewData,
      decisions: updatedDecisions,
    });
  };

  /**
   * 刪除一筆決策 (先跳出全螢幕模糊確認視窗)
   */
  const handleDeleteDecision = (index: number) => {
    if (!previewData) return;
    const targetDecision = previewData.decisions[index];
    const decisionTopic = targetDecision?.problem ? `「${targetDecision.problem}」` : `第 ${index + 1} 項決策`;

    setConfirmDialog({
      isOpen: true,
      title: '確定要刪除此項決策？',
      message: `確定要從本次會議整理中移除決策 ${decisionTopic} 嗎？`,
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        setPreviewData((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            decisions: prev.decisions.filter((_, i) => i !== index),
          };
        });
      },
    });
  };

  /**
   * 新增一筆自訂決策
   */
  const handleAddDecision = () => {
    if (!previewData) return;
    const fallbackFilename = documents.find((d) => d.id === selectedDocId)?.filename || '會議紀錄全文';
    setPreviewData({
      ...previewData,
      decisions: [
        ...previewData.decisions,
        {
          problem: '',
          options: '[]',
          final_decision: '',
          reason: '',
          source: fallbackFilename,
        },
      ],
    });
  };

  /**
   * 編輯待辦清單欄位
   */
  const handleUpdateTaskField = (index: number, field: string, value: string) => {
    if (!previewData) return;
    const updatedTasks = [...previewData.tasks];
    updatedTasks[index] = {
      ...updatedTasks[index],
      [field]: value,
    };
    setPreviewData({
      ...previewData,
      tasks: updatedTasks,
    });
  };

  /**
   * 刪除一筆待辦事項 (先跳出全螢幕模糊確認視窗)
   */
  const handleDeleteTask = (index: number) => {
    if (!previewData) return;
    const targetTask = previewData.tasks[index];
    const taskContent = targetTask?.content ? `「${targetTask.content}」` : `第 ${index + 1} 項待辦事項`;

    setConfirmDialog({
      isOpen: true,
      title: '確定要刪除此項待辦？',
      message: `確定要從本次待辦清單中移除待辦 ${taskContent} 嗎？`,
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        setPreviewData((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            tasks: prev.tasks.filter((_, i) => i !== index),
          };
        });
      },
    });
  };

  /**
   * 新增一筆待辦事項
   */
  const handleAddTask = () => {
    if (!previewData) return;
    setPreviewData({
      ...previewData,
      tasks: [
        ...previewData.tasks,
        {
          content: '',
          assignee: '',
          due_date: '',
          priority: '中',
          status: 'pending',
        },
      ],
    });
  };

  /**
   * 重新整理或挑選其他文件
   */
  const handleReset = () => {
    setPreviewData(null);
    setIsCommitted(false);
    setSuccessMessage(null);
    setErrorMessage(null);
    setExtractedDocId(null);
    setExtractedDocName(null);
  };

  /**
   * 重新整理整個畫面：
   * 刷新後端最新文件清單、活動清單，並一併重置預覽資料、提示狀態與輸入。
   */
  const handleRefreshAll = async () => {
    handleReset();
    setActivityNotice(null);
    setDocDrawerError(null);
    setNewActivityData({
      name: '',
      year: new Date().getFullYear(),
      status: '籌備中',
      venue: '',
      activity_type: '會議',
    });
    await Promise.all([
      loadDocumentsList(),
      loadActivitiesList(),
    ]);
  };

  return (
    <div className="extract-panel-layout" hidden={hidden}>
      {/* 頂部標題列 */}
      <header className="extract-top-header">
        <div className="extract-header-title">
          <h2>DASH 會議紀錄整理</h2>
        </div>
        <div className="extract-header-actions">
          <button
            type="button"
            className="button secondary sm-btn"
            onClick={handleRefreshAll}
            disabled={isLoadingDocs || isExtracting || isCommitting || isUploadingDoc}
            title="重新整理畫面與預覽資料"
          >
            <RefreshCw size={14} className={isLoadingDocs ? 'spinning' : ''} />
            <span>重新整理</span>
          </button>
          <button
            type="button"
            className="button secondary sm-btn"
            onClick={() => setIsDocDrawerOpen(true)}
            title="開啟歷史紀錄文檔抽屜"
          >
            <FileText size={15} />
            <span>歷史紀錄 ({documents.length})</span>
          </button>
        </div>
      </header>

      {/* 錯誤警示列 */}
      {errorMessage && (
        <div className="extract-api-error-banner" role="alert">
          <div className="extract-api-error-info">
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            className="extract-api-error-dismiss"
            onClick={() => setErrorMessage(null)}
          >
            關閉
          </button>
        </div>
      )}

      {/* 主內容獨立滾動區 */}
      <div className="extract-content-scroll">
        {/* 1. 選擇已上傳文件區塊 */}
        <section className="extract-card">
          <div className="extract-card-head">
            <div className="extract-card-title">
              <FileText size={18} />
              <span>選擇會議紀錄文件</span>
            </div>
            <span className="extract-card-badge">已導入文檔</span>
          </div>

          <div className="doc-pick-row">
            <div className="doc-select-wrap">
              <select
                id="meeting-doc-picker"
                value={selectedDocId}
                onChange={(e) => setSelectedDocId(e.target.value ? Number(e.target.value) : '')}
                disabled={isExtracting || isCommitting || isUploadingDoc}
              >
                {documents.length === 0 ? (
                  <option value="">尚未有已入庫之文件</option>
                ) : (
                  documents.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.filename} ({doc.chunk_count} 個切片)
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* 快捷上傳按鈕 */}
            <button
              type="button"
              className="button secondary upload-shortcut-btn"
              onClick={() => quickFileInputRef.current?.click()}
              disabled={isExtracting || isCommitting || isUploadingDoc}
              title="上傳新會議文件"
            >
              <Upload size={14} className={isUploadingDoc ? 'spinning' : ''} />
              <span>{isUploadingDoc ? '上傳中…' : '上傳文件'}</span>
            </button>
            <input
              ref={quickFileInputRef}
              type="file"
              accept=".md,.txt,.pdf,.docx"
              style={{ display: 'none' }}
              onChange={handleQuickFileChange}
            />

            <button
              type="button"
              className="button extract-run-btn"
              onClick={handleExtract}
              disabled={isExtracting || !selectedDocId || documents.length === 0 || isUploadingDoc}
            >
              <span>{isExtracting ? 'LLM 整理分析中…' : '開始整理會議紀錄'}</span>
            </button>
          </div>
        </section>

        {/* 分析處理中狀態 */}
        {isExtracting && (
          <div className="extract-loading-box">
            <div className="extract-loading-spinner" />
            <strong>LLM 正在閱讀全文並整理標準會議架構…</strong>
            <p>自動提煉會議摘要、關鍵決策與待辦清單，請稍候。</p>
          </div>
        )}

        {/* 成功寫入提示 */}
        {successMessage && (
          <div className="extract-success-banner" role="status">
            <div className="extract-success-info">
              <CheckCircle2 size={20} />
              <span>{successMessage}</span>
            </div>
            <button
              type="button"
              className="button secondary sm-btn"
              onClick={handleReset}
            >
              <RotateCcw size={14} />
              <span>整理下一份會議</span>
            </button>
          </div>
        )}

        {/* 2. 呈現 LLM 返回的標準化架構表格 (供檢視、編輯與確認) */}
        {previewData && !isExtracting && (
          <>
            {/* 關聯目標活動卡片 (必填) */}
            <section className="extract-card activity-association-card">
              <div className="extract-card-head">
                <div className="extract-card-title">
                  <Building2 size={18} className="activity-head-icon" />
                  <span>關聯目標活動</span>
                  <span className="required-pill">必填</span>
                </div>
                <div className="activity-mode-toggle" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activityMode === 'existing'}
                    className={`activity-toggle-btn ${activityMode === 'existing' ? 'active' : ''}`}
                    onClick={() => setActivityMode('existing')}
                  >
                    選擇現有活動 {activities.length > 0 ? `(${activities.length})` : ''}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activityMode === 'new'}
                    className={`activity-toggle-btn ${activityMode === 'new' ? 'active' : ''}`}
                    onClick={() => setActivityMode('new')}
                  >
                    <FolderPlus size={14} />
                    <span>快速建立新活動</span>
                  </button>
                </div>
              </div>

              {activityNotice && (
                <div className="activity-notice-banner" role="status">
                  <Check size={14} />
                  <span>{activityNotice}</span>
                </div>
              )}

              {activityMode === 'existing' ? (
                <div className="activity-select-container">
                  {activities.length === 0 ? (
                    <div className="activity-empty-box">
                      <AlertCircle size={18} className="activity-empty-icon" />
                      <div className="activity-empty-text">
                        <strong>目前資料庫尚無任何活動紀錄</strong>
                        <p>所有會議紀錄、決策與待辦項目皆須歸屬於指定活動。請切換至「快速建立新活動」填寫並建立。</p>
                      </div>
                      <button
                        type="button"
                        className="button secondary sm-btn"
                        onClick={() => setActivityMode('new')}
                      >
                        <FolderPlus size={14} />
                        <span>切換至建立新活動</span>
                      </button>
                    </div>
                  ) : (
                    /* 採用與會議基本資訊一致的表格形式 */
                    <div className="standard-table-wrap">
                      <table className="standard-meeting-table editable">
                        <tbody>
                          <tr>
                            <th>歸屬活動</th>
                            <td>
                              <select
                                id="activity-select-input"
                                className="table-input"
                                value={selectedActivityId}
                                onChange={(e) => setSelectedActivityId(e.target.value ? Number(e.target.value) : '')}
                              >
                                <option value="">-- 請選擇欲關聯的活動（必填）--</option>
                                {activities.map((act) => (
                                  <option key={act.id} value={act.id}>
                                    {act.name} ({act.year ? `${act.year}年` : ''}{act.status ? ` • ${act.status}` : ''})
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                /* 快速建立新活動：改為一致的標準表格排版 */
                <div className="activity-create-container">
                  <div className="standard-table-wrap">
                    <table className="standard-meeting-table editable">
                      <tbody>
                        <tr>
                          <th>活動名稱</th>
                          <td colSpan={3}>
                            <input
                              type="text"
                              className="table-input title-input"
                              value={newActivityData.name}
                              onChange={(e) =>
                                setNewActivityData((prev) => ({ ...prev, name: e.target.value }))
                              }
                              placeholder="例如：2026 迎新宿營、第四季校園路跑"
                            />
                          </td>
                        </tr>
                        <tr>
                          <th>活動年份</th>
                          <td>
                            <input
                              type="number"
                              className="table-input"
                              value={newActivityData.year}
                              onChange={(e) =>
                                setNewActivityData((prev) => ({
                                  ...prev,
                                  year: parseInt(e.target.value, 10) || new Date().getFullYear(),
                                }))
                              }
                            />
                          </td>
                          <th>活動狀態</th>
                          <td>
                            <select
                              className="table-input"
                              value={newActivityData.status}
                              onChange={(e) =>
                                setNewActivityData((prev) => ({ ...prev, status: e.target.value }))
                              }
                            >
                              <option value="籌備中">籌備中</option>
                              <option value="進行中">進行中</option>
                              <option value="已結束">已結束</option>
                            </select>
                          </td>
                        </tr>
                        <tr>
                          <th>活動地點</th>
                          <td colSpan={3}>
                            <input
                              type="text"
                              className="table-input"
                              value={newActivityData.venue}
                              onChange={(e) =>
                                setNewActivityData((prev) => ({ ...prev, venue: e.target.value }))
                              }
                              placeholder="例如：活動中心 201 教室 (選填)"
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="activity-create-footer">
                    <span className="activity-create-hint">
                      填寫後可點擊立即建立，或直接點擊底部「確認存入資料庫」自動連帶建立入庫。
                    </span>
                    <button
                      type="button"
                      className="button secondary sm-btn"
                      onClick={handleCreateNewActivity}
                      disabled={isCreatingActivity}
                    >
                      <FolderPlus size={14} />
                      <span>{isCreatingActivity ? '建立中…' : '立即建立此活動'}</span>
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* 會議基本資訊表格 */}
            <section className="extract-card">
              <div className="extract-card-head">
                <div className="extract-card-title">
                  <Calendar size={18} />
                  <span>會議基本摘要</span>
                  {extractedDocName && (
                    <span className="source-doc-badge" title={`已關聯來源文檔 ID: ${extractedDocId}`}>
                      <FileText size={12} />
                      來源：{extractedDocName}
                    </span>
                  )}
                </div>
                <div className="extract-card-actions">
                  <span className="extract-card-hint">可直接點擊欄位進行修改</span>
                  <span className="extract-card-badge">會議概況</span>
                </div>
              </div>

              <div className="standard-table-wrap">
                <table className="standard-meeting-table editable">
                  <tbody>
                    <tr>
                      <th>會議名稱</th>
                      <td colSpan={3}>
                        <input
                          type="text"
                          className="table-input title-input"
                          value={previewData.meeting.name || ''}
                          onChange={(e) => handleUpdateMeetingField('name', e.target.value)}
                          placeholder="例如：迎新宿營第一次籌備會"
                        />
                      </td>
                    </tr>
                    <tr>
                      <th>開會日期</th>
                      <td>
                        <input
                          type="text"
                          className="table-input"
                          value={previewData.meeting.date || ''}
                          onChange={(e) => handleUpdateMeetingField('date', e.target.value)}
                          placeholder="例如：2026-09-20"
                        />
                      </td>
                      <th>時間範圍</th>
                      <td>
                        <div className="table-dual-input">
                          <input
                            type="text"
                            className="table-input"
                            value={previewData.meeting.start_time || ''}
                            onChange={(e) => handleUpdateMeetingField('start_time', e.target.value)}
                            placeholder="開始時間 (如 14:00)"
                          />
                          <span className="input-sep">-</span>
                          <input
                            type="text"
                            className="table-input"
                            value={previewData.meeting.end_time || ''}
                            onChange={(e) => handleUpdateMeetingField('end_time', e.target.value)}
                            placeholder="結束時間 (如 16:30)"
                          />
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <th>會議地點</th>
                      <td>
                        <input
                          type="text"
                          className="table-input"
                          value={previewData.meeting.location || ''}
                          onChange={(e) => handleUpdateMeetingField('location', e.target.value)}
                          placeholder="例如：活動中心 201 會議室"
                        />
                      </td>
                      <th>參與成員</th>
                      <td>
                        <input
                          type="text"
                          className="table-input"
                          value={previewData.meeting.participants || ''}
                          onChange={(e) => handleUpdateMeetingField('participants', e.target.value)}
                          placeholder="例如：王小明, 李大華, 張小芳"
                        />
                      </td>
                    </tr>
                    <tr>
                      <th>討論摘要</th>
                      <td colSpan={3} className="content-cell">
                        <textarea
                          className="table-textarea"
                          rows={3}
                          value={previewData.meeting.content || ''}
                          onChange={(e) => handleUpdateMeetingField('content', e.target.value)}
                          placeholder="輸入或調整會議整體討論概述…"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* 關鍵決策事項 (Decisions) 表格 */}
            <section className="extract-card">
              <div className="extract-card-head">
                <div className="extract-card-title">
                  <CheckCircle2 size={18} />
                  <span>關鍵決策事項 ({previewData.decisions.length} 項)</span>
                </div>
                <div className="extract-card-actions">
                  <button
                    type="button"
                    className="button secondary sm-btn"
                    onClick={handleAddDecision}
                    title="新增一項決策"
                  >
                    <Plus size={14} />
                    <span>新增決策</span>
                  </button>
                  <span className="extract-card-badge">Decisions</span>
                </div>
              </div>

              {previewData.decisions.length === 0 ? (
                <div className="no-data-action-wrap">
                  <p className="no-data-note">此份會議紀錄中未識別出明確決策項目。</p>
                  <button
                    type="button"
                    className="button secondary sm-btn"
                    onClick={handleAddDecision}
                  >
                    <Plus size={14} />
                    <span>新增第一筆決策</span>
                  </button>
                </div>
              ) : (
                <div className="standard-table-wrap">
                  <table className="standard-data-table editable">
                    <thead>
                      <tr>
                        <th style={{ width: '45px' }}>編號</th>
                        <th style={{ width: '25%' }}>討論議題 / 問題</th>
                        <th style={{ width: '25%' }}>最終決策結論</th>
                        <th style={{ width: '25%' }}>考量理由</th>
                        <th style={{ width: '15%' }}>資料來源</th>
                        <th style={{ width: '50px', textAlign: 'center' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.decisions.map((dec, idx) => (
                        <tr key={idx}>
                          <td className="index-cell">{idx + 1}</td>
                          <td>
                            <textarea
                              className="table-cell-textarea topic-area"
                              rows={2}
                              value={dec.problem}
                              onChange={(e) =>
                                handleUpdateDecisionField(idx, 'problem', e.target.value)
                              }
                              placeholder="討論的問題或議題…"
                            />
                          </td>
                          <td>
                            <textarea
                              className="table-cell-textarea decision-area"
                              rows={2}
                              value={dec.final_decision}
                              onChange={(e) =>
                                handleUpdateDecisionField(idx, 'final_decision', e.target.value)
                              }
                              placeholder="最終定案結論…"
                            />
                          </td>
                          <td>
                            <textarea
                              className="table-cell-textarea reason-area"
                              rows={2}
                              value={dec.reason || ''}
                              onChange={(e) =>
                                handleUpdateDecisionField(idx, 'reason', e.target.value)
                              }
                              placeholder="決策考量之理由或背景…"
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="table-cell-input source-area"
                              value={
                                dec.source !== undefined
                                  ? dec.source
                                  : documents.find((d) => d.id === selectedDocId)?.filename || ''
                              }
                              onChange={(e) =>
                                handleUpdateDecisionField(idx, 'source', e.target.value)
                              }
                              placeholder="如：檔名或章節"
                            />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="table-row-delete-btn"
                              onClick={() => handleDeleteDecision(idx)}
                              title="刪除此項決策"
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 行動待辦清單 (Tasks) 表格 */}
            <section className="extract-card">
              <div className="extract-card-head">
                <div className="extract-card-title">
                  <ListTodo size={18} />
                  <span>行動待辦清單 ({previewData.tasks.length} 項)</span>
                </div>
                <div className="extract-card-actions">
                  <button
                    type="button"
                    className="button secondary sm-btn"
                    onClick={handleAddTask}
                    title="新增一項待辦"
                  >
                    <Plus size={14} />
                    <span>新增待辦</span>
                  </button>
                  <span className="extract-card-badge">Tasks</span>
                </div>
              </div>

              {previewData.tasks.length === 0 ? (
                <div className="no-data-action-wrap">
                  <p className="no-data-note">此份會議紀錄中未識別出待辦執行項目。</p>
                  <button
                    type="button"
                    className="button secondary sm-btn"
                    onClick={handleAddTask}
                  >
                    <Plus size={14} />
                    <span>新增第一筆待辦</span>
                  </button>
                </div>
              ) : (
                <div className="standard-table-wrap">
                  <table className="standard-data-table editable">
                    <thead>
                      <tr>
                        <th style={{ width: '45px' }}>編號</th>
                        <th>待辦執行項目</th>
                        <th style={{ width: '130px' }}>指派人</th>
                        <th style={{ width: '130px' }}>完成期限</th>
                        <th style={{ width: '100px' }}>優先級</th>
                        <th style={{ width: '50px', textAlign: 'center' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.tasks.map((tsk, idx) => (
                        <tr key={idx}>
                          <td className="index-cell">{idx + 1}</td>
                          <td>
                            <input
                              type="text"
                              className="table-cell-input"
                              value={tsk.content}
                              onChange={(e) =>
                                handleUpdateTaskField(idx, 'content', e.target.value)
                              }
                              placeholder="待辦工作內容…"
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="table-cell-input person-input"
                              value={tsk.assignee || ''}
                              onChange={(e) =>
                                handleUpdateTaskField(idx, 'assignee', e.target.value)
                              }
                              placeholder="負責人"
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="table-cell-input date-input"
                              value={tsk.due_date || ''}
                              onChange={(e) =>
                                handleUpdateTaskField(idx, 'due_date', e.target.value)
                              }
                              placeholder="如：2026-09-30"
                            />
                          </td>
                          <td>
                            <select
                              className={`priority-select ${tsk.priority === '高'
                                ? 'high'
                                : tsk.priority === '低'
                                  ? 'low'
                                  : 'mid'
                                }`}
                              value={tsk.priority || '中'}
                              onChange={(e) =>
                                handleUpdateTaskField(idx, 'priority', e.target.value)
                              }
                            >
                              <option value="高">高優先</option>
                              <option value="中">中優先</option>
                              <option value="低">低優先</option>
                            </select>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="table-row-delete-btn"
                              onClick={() => handleDeleteTask(idx)}
                              title="刪除此項待辦"
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* 底部確認寫入操作區 */}
      {previewData && !isExtracting && (
        <div className="extract-bottom-dock">
          <button
            type="button"
            className="button secondary"
            onClick={handleReset}
            disabled={isCommitting}
          >
            重新選擇文件
          </button>

          <button
            type="button"
            className="button commit-btn"
            onClick={handleCommit}
            disabled={isCommitting || isCommitted}
          >
            <Check size={16} />
            <span>
              {isCommitted
                ? '已成功存入資料庫'
                : isCommitting
                  ? '存入資料庫中…'
                  : '確認存入資料庫'}
            </span>
          </button>
        </div>
      )}

      {/* 歷史紀錄文檔抽屜 */}
      <DocumentDrawer
        isOpen={isDocDrawerOpen}
        onClose={() => setIsDocDrawerOpen(false)}
        documents={drawerDocuments}
        onUploadFile={handleUploadFile}
        onDeleteDocument={handleDeleteDocument}
        isUploading={isUploadingDoc}
        errorMessage={docDrawerError}
        onClearError={() => setDocDrawerError(null)}
      />

      {/* 全域模糊防手殘確認對話框 */}
      <ConfirmModal
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default MeetingExtractPanel;

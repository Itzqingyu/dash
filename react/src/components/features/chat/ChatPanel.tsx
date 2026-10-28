import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Paperclip,
  Bot,
  User,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  FileText,
  BookOpen,
  AlertCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import SessionSidebar, { SessionItem } from './SessionSidebar';
import DocumentDrawer, { DocumentItem } from '../../common/DocumentDrawer';
import ConfirmModal from '../../common/ConfirmModal';
import RenameModal from '../../common/RenameModal';
import {
  fetchSessions,
  fetchSessionDetail,
  createNewSession,
  updateSessionTitle,
  deleteSessionById,
  sendChatMessage,
} from '../../../api/chatService';
import {
  fetchDocuments,
  uploadDocument,
  deleteDocumentByIdentifier,
  checkDuplicateFileStem,
} from '../../../api/documentService';
import { RetrievedChunk } from '../../../types/chat';
import './ChatPanel.css';

/**
 * 前端訊息氣泡介面定義
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode?: 'chat' | 'rag';
  createdAt: string;
  // 檢索切片引用來源清單
  retrievedChunks?: Array<{
    content: string;
    source?: string;
  }>;
  // 是否為呼叫失敗的錯誤提示氣泡
  isError?: boolean;
}

/**
 * 格式化 ISO 日期字串為易讀時間格式 (例如 "14:30" 或 "09-17 14:30")
 */
function formatTimeString(isoString?: string): string {
  if (!isoString) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoString;
  }
}

/**
 * LLM 聊天面板主組件 (Chat Panel)
 * 整合：
 * 1. 雙欄佈局 (會話清單邊欄 + 聊天串流主區)
 * 2. 模式切換 Toggle Pill (普通對話 vs 歷史紀錄問答)
 * 3. 完整接入 Python FastAPI 後端端點，無任何假資料或模擬回覆
 * 4. 後端連線異常或處理失敗時即時返回真實錯誤狀態
 * 5. 浮動歷史紀錄文檔抽屜 (支援真實上傳切片與刪除)
 */
export const ChatPanel: React.FC = () => {
  // 會話列表狀態 (來源為後端 /sessions)
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  // 當前選中的會話 ID (以 string 儲存對齊組件 props)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // 當前對話模式：'chat' (普通對話) 或 'rag' (歷史紀錄問答)
  const [currentMode, setCurrentMode] = useState<'chat' | 'rag'>('chat');

  // 訊息串流狀態 (各會話的歷史訊息快取)
  const [sessionMessages, setSessionMessages] = useState<Record<string, ChatMessage[]>>({});

  // 輸入框文字狀態
  const [input, setInput] = useState('');
  // 訊息發送與後端 LLM 推理中的 Loading 狀態
  const [loading, setLoading] = useState(false);

  // 全域/頂部 API 連線或操作錯誤訊息
  const [apiError, setApiError] = useState<string | null>(null);

  // 歷史紀錄文檔抽屜開啟狀態
  const [isDocDrawerOpen, setIsDocDrawerOpen] = useState(false);
  // 歷史紀錄文件清單狀態 (來源為後端 /documents)
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  // 歷史紀錄文件上傳中狀態
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  // 歷史紀錄抽屜專屬錯誤訊息
  const [docDrawerError, setDocDrawerError] = useState<string | null>(null);

  // 編輯會話名稱彈窗狀態 (霧化背景彈窗)
  const [renameModal, setRenameModal] = useState<{
    isOpen: boolean;
    sessionId: string;
    currentTitle: string;
  }>({
    isOpen: false,
    sessionId: '',
    currentTitle: '',
  });

  // 參考切片折疊狀態 (key: messageId, value: boolean)
  const [expandedChunks, setExpandedChunks] = useState<Record<string, boolean>>({});

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

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自動向下滾動至最新訊息
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const currentMessages = activeSessionId ? sessionMessages[activeSessionId] || [] : [];

  useEffect(() => {
    scrollToBottom();
  }, [currentMessages, loading]);

  /**
   * 從後端獲取文件清單
   */
  const loadDocuments = useCallback(async () => {
    try {
      const backendDocs = await fetchDocuments();
      const mappedDocs: DocumentItem[] = backendDocs.map((doc) => ({
        id: String(doc.id),
        name: doc.filename,
        size: `${doc.chunk_count} 個切片`,
        uploadedAt: formatTimeString(doc.upload_date),
        chunkCount: doc.chunk_count,
      }));
      setDocuments(mappedDocs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDocDrawerError(`無法載入歷史紀錄文檔：${msg}`);
    }
  }, []);

  /**
   * 從後端獲取會話清單
   */
  const loadSessions = useCallback(async () => {
    try {
      const backendSessions = await fetchSessions();
      const mappedSessions: SessionItem[] = backendSessions.map((s) => ({
        id: String(s.id),
        title: s.title || '對話會話',
        createdAt: formatTimeString(s.created_at || s.updated_at),
      }));
      setSessions(mappedSessions);

      // 若目前尚未選擇會話且有歷史會話，預設選取最新一個
      if (mappedSessions.length > 0 && !activeSessionId) {
        setActiveSessionId(mappedSessions[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setApiError(`無法載入會話清單：${msg}`);
    }
  }, [activeSessionId]);

  /**
   * 載入指定會話的歷史訊息
   */
  const loadSessionHistory = useCallback(async (sessionIdStr: string) => {
    const numId = Number(sessionIdStr);
    if (isNaN(numId)) return;

    try {
      const detail = await fetchSessionDetail(numId);
      const mappedMessages: ChatMessage[] = (detail.messages || []).map((m) => {
        // 解析檢索切片格式 (相容 SQLite 字串儲存或 Python 物件)
        let parsedChunks: Array<{ content: string; source?: string }> = [];
        if (m.retrieved_chunks) {
          try {
            const raw =
              typeof m.retrieved_chunks === 'string'
                ? JSON.parse(m.retrieved_chunks)
                : m.retrieved_chunks;
            if (Array.isArray(raw)) {
              parsedChunks = raw.map((c: RetrievedChunk | Record<string, unknown>) => ({
                content: (c as { content?: string }).content || '',
                source:
                  (c as { metadata?: { source?: string } }).metadata?.source ||
                  (c as { source?: string }).source ||
                  '歷史紀錄文件',
              }));
            }
          } catch {
            // 若切片解析異常則略過
          }
        }

        return {
          id: String(m.id),
          role: m.role,
          content: m.content,
          mode: m.mode,
          createdAt: formatTimeString(m.created_at),
          retrievedChunks: parsedChunks.length > 0 ? parsedChunks : undefined,
        };
      });

      setSessionMessages((prev) => ({
        ...prev,
        [sessionIdStr]: mappedMessages,
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setApiError(`無法載入會話歷史：${msg}`);
    }
  }, []);

  // 組件載入時，從後端取得會話與文件資料
  useEffect(() => {
    loadSessions();
    loadDocuments();
  }, [loadSessions, loadDocuments]);

  // 當切換會話且該會話歷史尚未載入時，觸發取得
  useEffect(() => {
    if (activeSessionId && !sessionMessages[activeSessionId]) {
      loadSessionHistory(activeSessionId);
    }
  }, [activeSessionId, sessionMessages, loadSessionHistory]);

  /**
   * 新增對話會話 (呼叫後端 POST /sessions)
   */
  const handleCreateSession = async () => {
    try {
      setApiError(null);
      const newSession = await createNewSession('新對話');
      const newSessionItem: SessionItem = {
        id: String(newSession.id),
        title: newSession.title || '新對話',
        createdAt: formatTimeString(newSession.created_at),
      };

      setSessions((prev) => [newSessionItem, ...prev]);
      setActiveSessionId(newSessionItem.id);
      setSessionMessages((prev) => ({
        ...prev,
        [newSessionItem.id]: [],
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setApiError(`建立新對話失敗：${msg}`);
    }
  };

  /**
   * 刪除指定會話 (先跳出全螢幕模糊確認視窗，確認後呼叫後端 DELETE /sessions/{id})
   */
  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const numId = Number(id);
    if (isNaN(numId)) return;

    const targetSession = sessions.find((s) => s.id === id);
    const sessionTitle = targetSession ? `「${targetSession.title}」` : '此對話會話';

    setConfirmDialog({
      isOpen: true,
      title: '確定要刪除對話？',
      message: `確定要刪除 ${sessionTitle} 嗎？刪除後所有歷史對話訊息將無法復原。`,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          setApiError(null);
          await deleteSessionById(numId);

          // 本機狀態同步移除
          setSessions((prev) => prev.filter((s) => s.id !== id));
          setSessionMessages((prev) => {
            const updated = { ...prev };
            delete updated[id];
            return updated;
          });

          if (activeSessionId === id) {
            const remaining = sessions.filter((s) => s.id !== id);
            setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setApiError(`刪除會話失敗：${msg}`);
        }
      },
    });
  };

  /**
   * 編輯/重命名對話會話名稱 (呼叫 PATCH /sessions/{id})
   * 同步更新後端 SQLite 資料庫與本地會話列表
   */
  const handleRenameSession = async (id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    const numId = Number(id);
    if (isNaN(numId)) return;

    try {
      setApiError(null);
      await updateSessionTitle(numId, trimmed);
      // 本地狀態同步更新
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: trimmed } : s))
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setApiError(`更新對話名稱失敗：${msg}`);
    }
  };

  /**
   * 開啟重新命名對話框
   */
  const handleOpenRenameModal = (id: string, currentTitle: string) => {
    setRenameModal({
      isOpen: true,
      sessionId: id,
      currentTitle,
    });
  };

  /**
   * 確認並儲存新會話名稱
   */
  const handleConfirmRename = async (newTitle: string) => {
    const targetId = renameModal.sessionId;
    setRenameModal((prev) => ({ ...prev, isOpen: false }));
    if (targetId) {
      await handleRenameSession(targetId, newTitle);
    }
  };

  /**
   * 發送訊息至後端 (呼叫 POST /sessions/{id}/messages)
   * 絕不使用假資料模擬，後端異常則顯示真實錯誤
   */
  const handleSendMessage = async () => {
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput('');
    setApiError(null);

    let targetSessionId = activeSessionId;

    // 1. 若當前尚未有選中的會話，先向後端請求建立一個
    if (!targetSessionId) {
      try {
        const newSession = await createNewSession(userText.slice(0, 16));
        const newSessionItem: SessionItem = {
          id: String(newSession.id),
          title: newSession.title || userText.slice(0, 16),
          createdAt: formatTimeString(newSession.created_at),
        };
        setSessions((prev) => [newSessionItem, ...prev]);
        targetSessionId = newSessionItem.id;
        setActiveSessionId(newSessionItem.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setApiError(`無法自動建立對話會話：${msg}`);
        return;
      }
    }

    const sessionIdNum = Number(targetSessionId);
    if (isNaN(sessionIdNum)) {
      setApiError('會話 ID 無效');
      return;
    }

    // 2. 在前端即時插入使用者輸入氣泡 (樂觀更新)
    const tempUserMsgId = `temp-user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: tempUserMsgId,
      role: 'user',
      content: userText,
      mode: currentMode,
      createdAt: formatTimeString(),
    };

    setSessionMessages((prev) => ({
      ...prev,
      [targetSessionId as string]: [...(prev[targetSessionId as string] || []), userMsg],
    }));

    setLoading(true);

    // 3. 呼叫後端 API 發送訊息
    try {
      const response = await sendChatMessage(sessionIdNum, userText, currentMode, 5);

      // 解析後端檢索切片來源
      const rawChunks = response.retrieved_chunks || [];
      const parsedChunks = rawChunks.map((c) => ({
        content: c.content,
        source: c.metadata?.source || '歷史紀錄文件',
      }));

      // 構建後端真實回傳之助手訊息
      const assistantMsg: ChatMessage = {
        id: String(response.assistant_message.id),
        role: 'assistant',
        content: response.assistant_message.content,
        mode: response.assistant_message.mode,
        createdAt: formatTimeString(response.assistant_message.created_at),
        retrievedChunks: parsedChunks.length > 0 ? parsedChunks : undefined,
      };

      // 將臨時使用者訊息以真實後端紀錄取代，並附加助理回覆
      setSessionMessages((prev) => {
        const currentList = prev[targetSessionId as string] || [];
        const filteredList = currentList.filter((m) => m.id !== tempUserMsgId);
        const realUserMsg: ChatMessage = {
          id: String(response.user_message.id),
          role: 'user',
          content: response.user_message.content,
          mode: response.user_message.mode,
          createdAt: formatTimeString(response.user_message.created_at),
        };
        return {
          ...prev,
          [targetSessionId as string]: [...filteredList, realUserMsg, assistantMsg],
        };
      });

      // 同步更新側邊欄會話標題 (若後端自動命名)
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === targetSessionId && (s.title === '新對話' || s.title === '對話會話')) {
            return { ...s, title: userText.slice(0, 16) };
          }
          return s;
        })
      );
    } catch (err: unknown) {
      // 後端無回應或執行失敗時，嚴格返回真實錯誤訊息，絕不假裝回覆
      const msg = err instanceof Error ? err.message : String(err);
      setApiError(`後端服務處理失敗：${msg}`);

      const errorBubble: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `**對話服務發生錯誤**\n\n${msg}`,
        mode: currentMode,
        createdAt: formatTimeString(),
        isError: true,
      };

      setSessionMessages((prev) => ({
        ...prev,
        [targetSessionId as string]: [...(prev[targetSessionId as string] || []), errorBubble],
      }));
    } finally {
      setLoading(false);
    }
  };

  /**
   * 鍵盤 Enter 鍵發送處理 (Shift+Enter 為換行)
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  /**
   * 切換切片折疊展開狀態
   */
  const toggleChunkExpand = (messageId: string) => {
    setExpandedChunks((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  /**
   * 歷史紀錄文件真實上傳 (呼叫 POST /upload)
   * 具備前置主檔名防呆：若清單中已有相同主檔名之文件，直接中斷並提示錯誤，不發送網路請求。
   */
  const handleUploadFile = async (file: File) => {
    setDocDrawerError(null);

    // 前端前置主檔名重複防呆校驗
    const duplicate = checkDuplicateFileStem(file.name, documents.map((d) => d.name));
    if (duplicate) {
      setDocDrawerError(
        `已存在相同主檔名之文件「${duplicate}」。系統不允許同名覆蓋，請先手動刪除舊文件或重新命名檔案後再行上傳。`
      );
      return;
    }

    setIsUploadingDoc(true);
    try {
      await uploadDocument(file);
      // 上傳完成後重新獲取文檔列表
      await loadDocuments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDocDrawerError(`上傳檔案失敗：${msg}`);
    } finally {
      setIsUploadingDoc(false);
    }
  };

  /**
   * 歷史紀錄文件真實刪除 (先跳出全螢幕模糊確認視窗，確認後呼叫後端 DELETE /documents/{id})
   */
  const handleDeleteDocument = (id: string) => {
    const targetDoc = documents.find((d) => d.id === id);
    const docName = targetDoc ? `「${targetDoc.name}」` : '此文件';

    setConfirmDialog({
      isOpen: true,
      title: '確定要刪除歷史紀錄文檔？',
      message: `確定要自歷史紀錄中移除 ${docName} 嗎？這將會同步自磁碟物理刪除該 Markdown 文件與向量檢索索引。`,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          setDocDrawerError(null);
          await deleteDocumentByIdentifier(id);
          await loadDocuments();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setDocDrawerError(`刪除文檔失敗：${msg}`);
        }
      },
    });
  };

  const activeSessionTitle =
    sessions.find((s) => s.id === activeSessionId)?.title || '未選擇對話';

  return (
    <div className="chat-panel-layout">
      {/* 1. 左側：會話歷史側邊欄 */}
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={(id) => setActiveSessionId(id)}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        onOpenRenameModal={handleOpenRenameModal}
      />

      {/* 2. 右側：聊天主區域 */}
      <section className="chat-main-area">
        {/* 頂部資訊列 */}
        <header className="chat-top-header">
          <div className="chat-header-title">
            <h2>{activeSessionId ? activeSessionTitle : 'DASH Agent'}</h2>
          </div>
          <div className="chat-header-actions">
            <button
              type="button"
              className="button secondary sm-btn"
              onClick={() => setIsDocDrawerOpen(true)}
            >
              <FileText size={15} />
              <span>歷史紀錄 ({documents.length})</span>
            </button>
          </div>
        </header>

        {/* 全域 API 異常提示列 (後端未連線或報錯時顯示) */}
        {apiError && (
          <div className="chat-api-error-banner" role="alert">
            <div className="chat-api-error-info">
              <AlertCircle size={16} />
              <span>{apiError}</span>
            </div>
            <button
              type="button"
              className="chat-api-error-dismiss"
              onClick={() => setApiError(null)}
            >
              關閉
            </button>
          </div>
        )}

        {/* 聊天串流訊息滾動區 */}
        <div className="chat-stream-container">
          {currentMessages.length === 0 ? (
            // 極簡空狀態：簡潔文字與操作提示
            <div className="chat-empty-state">
              <h3>尚無訊息</h3>
              <p>在下方輸入訊息開始對話</p>
            </div>
          ) : (
            // 渲染訊息氣泡列表
            <div className="chat-messages-flow">
              {currentMessages.map((msg) => {
                const isUser = msg.role === 'user';
                const hasChunks = msg.retrievedChunks && msg.retrievedChunks.length > 0;
                const isExpanded = !!expandedChunks[msg.id];
                const isErrorBubble = !!msg.isError;

                return (
                  <div
                    key={msg.id}
                    className={`chat-bubble-row ${isUser ? 'user-row' : 'assistant-row'}`}
                  >
                    {/* 頭像 */}
                    <div
                      className={`chat-avatar ${isUser
                        ? 'user-avatar'
                        : isErrorBubble
                          ? 'assistant-avatar error-avatar'
                          : 'assistant-avatar'
                        }`}
                    >
                      {isUser ? (
                        <User size={18} />
                      ) : isErrorBubble ? (
                        <AlertCircle size={18} />
                      ) : (
                        <Bot size={18} />
                      )}
                    </div>

                    {/* 氣泡內容 */}
                    <div className="chat-bubble-wrapper">
                      <div className="chat-bubble-meta">
                        <span className="bubble-author">
                          {isUser ? '你' : isErrorBubble ? '系統提示' : 'AI 助手'}
                        </span>
                        <span className="bubble-time">{msg.createdAt}</span>
                        {msg.mode && (
                          <span className={`bubble-mode-tag ${msg.mode}`}>
                            {msg.mode === 'rag' ? '歷史紀錄問答' : '普通對話'}
                          </span>
                        )}
                      </div>

                      <div
                        className={`chat-bubble-body ${isUser
                          ? 'user-body'
                          : isErrorBubble
                            ? 'assistant-body error-body'
                            : 'assistant-body'
                          }`}
                      >
                        <div className="chat-markdown-content">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>

                        {/* RAG 參考來源折疊卡片 */}
                        {hasChunks && (
                          <div className="rag-chunk-card">
                            <button
                              type="button"
                              className="rag-chunk-header"
                              onClick={() => toggleChunkExpand(msg.id)}
                            >
                              <div className="rag-chunk-title">
                                <Paperclip size={14} />
                                <strong>參考來源 ({msg.retrievedChunks!.length} 筆切片)</strong>
                              </div>
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>

                            {isExpanded && (
                              <div className="rag-chunk-content-list">
                                {msg.retrievedChunks!.map((chunk, idx) => (
                                  <div key={idx} className="rag-chunk-item">
                                    <div className="rag-chunk-source">
                                      <span>來源：</span>
                                      <em>{chunk.source || '上傳文件'}</em>
                                    </div>
                                    <p className="rag-chunk-text">{chunk.content}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* 發送中的 Loading 骨架 */}
              {loading && (
                <div className="chat-bubble-row assistant-row">
                  <div className="chat-avatar assistant-avatar">
                    <Bot size={18} />
                  </div>
                  <div className="chat-bubble-wrapper">
                    <div className="chat-bubble-body assistant-body loading-bubble">
                      <span className="loading-dot"></span>
                      <span className="loading-dot"></span>
                      <span className="loading-dot"></span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 底部輸入區域 */}
        <div className="chat-bottom-dock">
          {/* 模式切換 Toggle Pill */}
          <div className="mode-toggle-bar">
            <div className="mode-toggle-pill">
              <button
                type="button"
                className={`mode-toggle-option ${currentMode === 'chat' ? 'active' : ''}`}
                onClick={() => setCurrentMode('chat')}
              >
                <MessageSquare size={14} />
                <strong>普通對話</strong>
              </button>
              <button
                type="button"
                className={`mode-toggle-option ${currentMode === 'rag' ? 'active' : ''}`}
                onClick={() => setCurrentMode('rag')}
              >
                <BookOpen size={14} />
                <strong>歷史紀錄問答</strong>
              </button>
            </div>
            {/* <span className="mode-tip-text">
              {currentMode === 'rag'
                ? '檢索已導入之文件向量切片輔助回答'
                : '無需檢索文件，由 AI 自由推理與歷史上下文記憶對話'}
            </span> */}
          </div>

          {/* 輸入框與發送按鈕組 */}
          <div className="chat-input-wrapper">
            <textarea
              className="chat-textarea"
              placeholder={
                currentMode === 'rag'
                  ? '輸入想從歷史紀錄查詢的問題…'
                  : '與 DASH Agent 對話…'
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />

            <button
              type="button"
              className="chat-input-btn send-btn"
              disabled={!input.trim() || loading}
              onClick={handleSendMessage}
              title="發送訊息"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </section>

      {/* 3. 浮動/抽屜式歷史紀錄文檔管理 */}
      <DocumentDrawer
        isOpen={isDocDrawerOpen}
        onClose={() => setIsDocDrawerOpen(false)}
        documents={documents}
        onUploadFile={handleUploadFile}
        onDeleteDocument={handleDeleteDocument}
        isUploading={isUploadingDoc}
        errorMessage={docDrawerError}
        onClearError={() => setDocDrawerError(null)}
      />

      {/* 4. 全域模糊防手殘確認對話框 */}
      <ConfirmModal
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* 5. 編輯對話名稱彈窗 (背景霧化) */}
      <RenameModal
        isOpen={renameModal.isOpen}
        initialValue={renameModal.currentTitle}
        onConfirm={handleConfirmRename}
        onCancel={() => setRenameModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};

export default ChatPanel;

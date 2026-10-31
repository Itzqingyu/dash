/**
 * LLM 智能對話面板 (ChatPanel.tsx)
 * 職責：
 * 1. 雙層容器包覆（滿版 canvas 底色 + 1200px 置中容器）。
 * 2. 頂部麵包屑導航與標準大卡片（智能對話）。
 * 3. 聊天主區頂部 Session 下拉選單（切換會話與新增對話）、三點操作選單（重新命名、刪除）與右側模式切換。
 * 4. 移除獨立側邊欄，內部自適應高度獨立滾動。
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Bot,
  User,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  FileText,
  BookOpen,
  AlertCircle,
  Plus,
  MoreVertical,
  Edit2,
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { VaultBreadcrumb } from '../../layout/VaultBreadcrumb';
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
} from '../../../api/documentService';
import { RetrievedChunk } from '../../../types/chat';
import './ChatPanel.css';

export interface SessionItem {
  id: string;
  title: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode?: 'chat' | 'rag';
  createdAt: string;
  retrievedChunks?: Array<{
    content: string;
    source?: string;
  }>;
  isError?: boolean;
}

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

export interface ChatPanelProps {
  vaultName?: string;
  onNavigateToHome?: () => void;
  onNavigateToVaultHub?: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  vaultName = 'default',
  onNavigateToHome,
  onNavigateToVaultHub,
}) => {
  // 會話列表狀態
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // 下拉選單與選單開關
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 當前對話模式：'chat' (普通對話) 或 'rag' (歷史紀錄問答)
  const [currentMode, setCurrentMode] = useState<'chat' | 'rag'>('chat');

  // 訊息串流狀態
  const [sessionMessages, setSessionMessages] = useState<Record<string, ChatMessage[]>>({});

  // 輸入框文字與 Loading
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // 錯誤提示
  const [apiError, setApiError] = useState<string | null>(null);

  // 文件抽屜狀態
  const [isDocDrawerOpen, setIsDocDrawerOpen] = useState(false);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [docDrawerError, setDocDrawerError] = useState<string | null>(null);

  // 編輯會話名稱彈窗
  const [renameModal, setRenameModal] = useState<{
    isOpen: boolean;
    sessionId: string;
    currentTitle: string;
  }>({
    isOpen: false,
    sessionId: '',
    currentTitle: '',
  });

  // 參考切片折疊
  const [expandedChunks, setExpandedChunks] = useState<Record<string, boolean>>({});

  // 確認對話框
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const currentMessages = activeSessionId ? sessionMessages[activeSessionId] || [] : [];

  useEffect(() => {
    scrollToBottom();
  }, [currentMessages, loading]);

  // 點擊外部自動收合下拉選單與三點操作選單
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSessionDropdownOpen(false);
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSessionMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 從後端獲取文件清單
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

  // 從後端獲取會話清單
  const loadSessions = useCallback(async () => {
    try {
      const backendSessions = await fetchSessions();
      const mappedSessions: SessionItem[] = backendSessions.map((s) => ({
        id: String(s.id),
        title: s.title || '對話會話',
        createdAt: formatTimeString(s.created_at || s.updated_at),
      }));
      setSessions(mappedSessions);

      if (mappedSessions.length > 0 && !activeSessionId) {
        setActiveSessionId(mappedSessions[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setApiError(`無法載入會話清單：${msg}`);
    }
  }, [activeSessionId]);

  // 載入指定會話的歷史訊息
  const loadSessionHistory = useCallback(async (sessionIdStr: string) => {
    const numId = Number(sessionIdStr);
    if (isNaN(numId)) return;

    try {
      const detail = await fetchSessionDetail(numId);
      const mappedMessages: ChatMessage[] = (detail.messages || []).map((m) => {
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
            // 切片解析異常則略過
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

  useEffect(() => {
    loadSessions();
    loadDocuments();
  }, [loadSessions, loadDocuments]);

  useEffect(() => {
    if (activeSessionId && !sessionMessages[activeSessionId]) {
      loadSessionHistory(activeSessionId);
    }
  }, [activeSessionId, sessionMessages, loadSessionHistory]);

  // 新增對話會話
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

  // 刪除指定會話
  const handleDeleteSession = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
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

  // 重命名對話會話名稱
  const handleRenameSession = async (id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    const numId = Number(id);
    if (isNaN(numId)) return;

    try {
      setApiError(null);
      await updateSessionTitle(numId, trimmed);
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: trimmed } : s))
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setApiError(`更新對話名稱失敗：${msg}`);
    }
  };

  const handleOpenRenameModal = (id: string, currentTitle: string) => {
    setRenameModal({
      isOpen: true,
      sessionId: id,
      currentTitle,
    });
  };

  const handleConfirmRename = (newTitle: string) => {
    if (renameModal.sessionId) {
      handleRenameSession(renameModal.sessionId, newTitle);
    }
    setRenameModal((prev) => ({ ...prev, isOpen: false }));
  };

  // 發送訊息
  const handleSendMessage = async () => {
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput('');
    setApiError(null);

    let targetSessionId = activeSessionId;
    if (!targetSessionId) {
      try {
        const newSession = await createNewSession(userText.slice(0, 16) || '新對話');
        targetSessionId = String(newSession.id);
        const newSessionItem: SessionItem = {
          id: targetSessionId,
          title: newSession.title || '新對話',
          createdAt: formatTimeString(newSession.created_at),
        };
        setSessions((prev) => [newSessionItem, ...prev]);
        setActiveSessionId(targetSessionId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setApiError(`建立對話階段失敗：${msg}`);
        return;
      }
    }

    const tempUserMsgId = `temp-${Date.now()}`;
    const optimisticUserMsg: ChatMessage = {
      id: tempUserMsgId,
      role: 'user',
      content: userText,
      mode: currentMode,
      createdAt: formatTimeString(),
    };

    setSessionMessages((prev) => ({
      ...prev,
      [targetSessionId as string]: [
        ...(prev[targetSessionId as string] || []),
        optimisticUserMsg,
      ],
    }));

    setLoading(true);

    try {
      const response = await sendChatMessage(Number(targetSessionId), userText, currentMode);

      let parsedChunks: Array<{ content: string; source?: string }> = [];
      if (response.assistant_message.retrieved_chunks) {
        try {
          const raw =
            typeof response.assistant_message.retrieved_chunks === 'string'
              ? JSON.parse(response.assistant_message.retrieved_chunks)
              : response.assistant_message.retrieved_chunks;
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
          // 略過切片解析異常
        }
      }

      const assistantMsg: ChatMessage = {
        id: String(response.assistant_message.id),
        role: 'assistant',
        content: response.assistant_message.content,
        mode: response.assistant_message.mode,
        createdAt: formatTimeString(response.assistant_message.created_at),
        retrievedChunks: parsedChunks.length > 0 ? parsedChunks : undefined,
      };

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

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === targetSessionId && (s.title === '新對話' || s.title === '對話會話')) {
            return { ...s, title: userText.slice(0, 16) };
          }
          return s;
        })
      );
    } catch (err: unknown) {
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const toggleChunkExpand = (messageId: string) => {
    setExpandedChunks((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  const handleUploadFile = async (file: File) => {
    setDocDrawerError(null);
    setIsUploadingDoc(true);
    try {
      await uploadDocument(file);
      await loadDocuments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDocDrawerError(`上傳失敗：${msg}`);
    } finally {
      setIsUploadingDoc(false);
    }
  };

  const handleDeleteDocument = async (docIdStr: string) => {
    const docToDelete = documents.find((d) => d.id === docIdStr);
    const fileName = docToDelete ? `「${docToDelete.name}」` : '此文檔';

    setConfirmDialog({
      isOpen: true,
      title: '確定要刪除歷史紀錄文檔？',
      message: `確定要刪除 ${fileName} 嗎？刪除後對應的向量切片與全文將被移除。`,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          await deleteDocumentByIdentifier(Number(docIdStr));
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
    <div className="chat-page-root">
      <div className="chat-container">
        {/* 1. 頂部麵包屑導航 */}
        <VaultBreadcrumb
          vaultName={vaultName}
          currentPageTitle="智能對話"
          onNavigateToHome={onNavigateToHome}
          onNavigateToVaultHub={onNavigateToVaultHub}
          onBack={onNavigateToVaultHub}
        />

        {/* 2. 頂部大卡片 */}
        <header className="chat-header-card">
          <div className="chat-header-row">
            <div className="chat-header-left">
              <div className="chat-icon-badge">
                <MessageSquare size={28} />
              </div>
              <div className="chat-title-group">
                <h1 className="chat-header-title">智能對話</h1>
                <p className="chat-header-desc">
                  針對紀錄庫所有文件與歷史決策進行多輪對話與語意檢索問答
                </p>
              </div>
            </div>

            <div className="chat-header-actions">
              <button
                type="button"
                className="chat-header-btn"
                onClick={() => setIsDocDrawerOpen(true)}
                title="開啟歷史紀錄文檔抽屜"
              >
                <FileText size={15} />
                <span>歷史紀錄文檔 ({documents.length})</span>
              </button>
            </div>
          </div>
        </header>

        {/* 3. 聊天主區塊 (滿版聊天卡片) */}
        <div className="chat-card-area">
          {/* 卡片頂部功能列 */}
          <div className="chat-card-topbar">
            {/* 左側：Session 下拉選單 + 三點操作按鈕 */}
            <div className="chat-session-selector-group">
              <div className="chat-session-dropdown-wrap" ref={dropdownRef}>
                <button
                  type="button"
                  className="chat-session-select-btn"
                  onClick={() => {
                    setSessionDropdownOpen((v) => !v);
                    setSessionMenuOpen(false);
                  }}
                  title="切換對話會話"
                >
                  <MessageSquare size={15} className="session-btn-icon" />
                  <span className="session-current-title">{activeSessionTitle}</span>
                  <ChevronDown
                    size={14}
                    className={`session-dropdown-chevron ${sessionDropdownOpen ? 'open' : ''}`}
                  />
                </button>

                {sessionDropdownOpen && (
                  <div className="chat-session-dropdown-menu">
                    <button
                      type="button"
                      className="dropdown-new-chat-btn"
                      onClick={() => {
                        handleCreateSession();
                        setSessionDropdownOpen(false);
                      }}
                    >
                      <Plus size={15} />
                      <span>+ 新增對話</span>
                    </button>
                    <div className="dropdown-divider" />
                    <div className="dropdown-session-list">
                      {sessions.length === 0 ? (
                        <div className="dropdown-empty-text">尚無歷史對話</div>
                      ) : (
                        sessions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className={`dropdown-session-item ${s.id === activeSessionId ? 'active' : ''}`}
                            onClick={() => {
                              setActiveSessionId(s.id);
                              setSessionDropdownOpen(false);
                            }}
                          >
                            <span className="dropdown-item-title">{s.title}</span>
                            <span className="dropdown-item-time">{s.createdAt}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 三個點選項 icon 收合 (僅對當前切換到的 session 操作) */}
              {activeSessionId && (
                <div className="chat-session-menu-wrap" ref={menuRef}>
                  <button
                    type="button"
                    className="chat-session-more-btn"
                    onClick={() => {
                      setSessionMenuOpen((v) => !v);
                      setSessionDropdownOpen(false);
                    }}
                    title="會話設定"
                  >
                    <MoreVertical size={16} />
                  </button>

                  {sessionMenuOpen && (
                    <div className="chat-session-action-menu">
                      <button
                        type="button"
                        className="action-menu-item"
                        onClick={() => {
                          setSessionMenuOpen(false);
                          handleOpenRenameModal(activeSessionId, activeSessionTitle);
                        }}
                      >
                        <Edit2 size={14} />
                        <span>重新命名</span>
                      </button>
                      <button
                        type="button"
                        className="action-menu-item danger"
                        onClick={(e) => {
                          setSessionMenuOpen(false);
                          handleDeleteSession(activeSessionId, e);
                        }}
                      >
                        <Trash2 size={14} />
                        <span>刪除對話</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 右側：普通對話 / 歷史紀錄問答切換藥丸 */}
            <div className="chat-mode-toggle-pill">
              <button
                type="button"
                className={`chat-mode-btn ${currentMode === 'chat' ? 'active' : ''}`}
                onClick={() => setCurrentMode('chat')}
              >
                <MessageSquare size={13} />
                <span>普通對話</span>
              </button>
              <button
                type="button"
                className={`chat-mode-btn ${currentMode === 'rag' ? 'active' : ''}`}
                onClick={() => setCurrentMode('rag')}
              >
                <BookOpen size={13} />
                <span>歷史紀錄問答</span>
              </button>
            </div>
          </div>

          {/* 全域 API 異常提示列 */}
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
              <div className="chat-empty-state">
                <div className="empty-icon-wrapper">
                  <Bot size={32} />
                </div>
                <h3>尚無對話訊息</h3>
                <p>在下方輸入問題或想法，隨時展開智能對話</p>
              </div>
            ) : (
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
                      <div
                        className={`chat-avatar ${
                          isUser
                            ? 'user-avatar'
                            : isErrorBubble
                            ? 'assistant-avatar error-avatar'
                            : 'assistant-avatar'
                        }`}
                      >
                        {isUser ? <User size={18} /> : <Bot size={18} />}
                      </div>

                      <div className="chat-bubble-wrapper">
                        <div className="chat-bubble-meta">
                          <span className="bubble-author">{isUser ? '您' : 'DASH Agent'}</span>
                          <span className="bubble-time">{msg.createdAt}</span>
                          {msg.mode && (
                            <span className={`bubble-mode-tag ${msg.mode}`}>
                              {msg.mode === 'rag' ? '紀錄庫檢索' : '普通對話'}
                            </span>
                          )}
                        </div>

                        <div
                          className={`chat-bubble-body ${
                            isUser ? 'user-body' : isErrorBubble ? 'error-body' : 'assistant-body'
                          }`}
                        >
                          <div className="chat-markdown-content">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>

                          {hasChunks && (
                            <div className="retrieved-sources-section">
                              <button
                                type="button"
                                className="source-toggle-btn"
                                onClick={() => toggleChunkExpand(msg.id)}
                              >
                                <span className="source-toggle-title">
                                  參考來源 ({msg.retrievedChunks!.length} 個切片)
                                </span>
                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>

                              {isExpanded && (
                                <div className="sources-collapse-content">
                                  {msg.retrievedChunks!.map((chunk, idx) => (
                                    <div key={idx} className="source-chunk-card">
                                      <div className="chunk-header">
                                        <span className="chunk-badge">切片 #{idx + 1}</span>
                                        {chunk.source && (
                                          <span className="chunk-source-name">{chunk.source}</span>
                                        )}
                                      </div>
                                      <div className="chunk-text">{chunk.content}</div>
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

          {/* 底部釘選輸入框 */}
          <div className="chat-bottom-dock">
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
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* 4. 浮動/抽屜式歷史紀錄文檔管理 */}
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

        {/* 5. 全域防手殘確認對話框 */}
        <ConfirmModal
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
        />

        {/* 6. 編輯對話名稱彈窗 */}
        <RenameModal
          isOpen={renameModal.isOpen}
          initialValue={renameModal.currentTitle}
          onConfirm={handleConfirmRename}
          onCancel={() => setRenameModal((prev) => ({ ...prev, isOpen: false }))}
        />
      </div>
    </div>
  );
};

export default ChatPanel;

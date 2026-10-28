import React, { useState, useEffect } from 'react';
import { Plus, MessageSquare, Trash2, Pencil, MoreVertical } from 'lucide-react';
import './SessionSidebar.css';

/**
 * 會話項目資料介面 (本機狀態使用)
 */
export interface SessionItem {
  id: string;
  title: string;
  createdAt: string;
}

interface SessionSidebarProps {
  // 目前所有會話清單
  sessions: SessionItem[];
  // 當前選中的會話 ID
  activeSessionId: string | null;
  // 切換會話的回呼函式
  onSelectSession: (id: string) => void;
  // 建立新會話的回呼函式
  onCreateSession: () => void;
  // 刪除會話的回呼函式
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  // 開啟重命名對話框的回呼函式
  onOpenRenameModal: (id: string, currentTitle: string) => void;
}

/**
 * 會話側邊欄組件 (Session Sidebar)
 * 負責展示使用者歷史會話、提供新增、切換會話，以及三點選單（編輯名稱與刪除對話）
 */
export const SessionSidebar: React.FC<SessionSidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onOpenRenameModal,
}) => {
  // 當前展開操作選單的會話 ID
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // 點擊頁面其他區域時自動收起三點下拉選單
  useEffect(() => {
    const handleGlobalClick = () => {
      setActiveMenuId(null);
    };

    if (activeMenuId !== null) {
      document.addEventListener('click', handleGlobalClick);
    }
    return () => {
      document.removeEventListener('click', handleGlobalClick);
    };
  }, [activeMenuId]);

  return (
    <aside className="chat-session-sidebar" aria-label="會話列表">
      {/* 頂部操作區：新增對話按鈕 */}
      <div className="chat-session-header">
        <button
          type="button"
          className="button primary new-chat-btn"
          onClick={onCreateSession}
          aria-label="新增對話"
        >
          <Plus size={16} />
          <span>新對話</span>
        </button>
      </div>

      {/* 會話歷史清單展示區 */}
      <div className="chat-session-list">
        {sessions.length === 0 ? (
          // 極簡空狀態：尚無歷史會話
          <div className="chat-session-empty">
            <MessageSquare size={20} className="empty-icon" />
            <p>尚無歷史對話</p>
            <small>點擊上方按鈕建立新對話</small>
          </div>
        ) : (
          // 渲染會話項目列表
          sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isMenuOpen = session.id === activeMenuId;

            return (
              <div
                key={session.id}
                className={`chat-session-item ${isActive ? 'active' : ''}`}
                onClick={() => onSelectSession(session.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectSession(session.id);
                  }
                }}
              >
                <div className="session-item-icon">
                  <MessageSquare size={16} />
                </div>

                <div className="session-item-info">
                  <strong className="session-item-title">{session.title}</strong>
                  <span className="session-item-time">{session.createdAt}</span>
                </div>

                {/* 滑鼠懸停顯示三點按鈕與下拉選單 */}
                <div
                  className="session-menu-wrapper"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className={`session-more-btn ${isMenuOpen ? 'open' : ''}`}
                    title="更多選項"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenuId((prev) => (prev === session.id ? null : session.id));
                    }}
                  >
                    <MoreVertical size={16} />
                  </button>

                  {isMenuOpen && (
                    <div className="session-dropdown-menu">
                      <button
                        type="button"
                        className="session-dropdown-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuId(null);
                          onOpenRenameModal(session.id, session.title);
                        }}
                      >
                        <Pencil size={14} />
                        <span>編輯名稱</span>
                      </button>
                      <button
                        type="button"
                        className="session-dropdown-item danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuId(null);
                          onDeleteSession(session.id, e);
                        }}
                      >
                        <Trash2 size={14} />
                        <span>刪除對話</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};

export default SessionSidebar;

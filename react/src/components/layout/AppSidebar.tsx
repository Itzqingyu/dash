import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  Bot,
  MessageSquare,
  FileScan,
  Archive,
  FileText,
  Home,
  LogOut,
  User as UserIcon,
} from 'lucide-react';
import VaultManagerBar from './VaultManagerBar';
import { useAuth } from '../../context/AuthContext';
import './AppSidebar.css';

interface AppSidebarProps {
  currentView: string;
  isOpen: boolean;
  onToggle: () => void;
  onNavigate: (view: string) => void;
  onVaultChanged: () => void;
}

/**
 * 全域主側邊導航欄組件 (AppSidebar)
 * 負責應用頂層導航 (首頁、活動工作台、文件紀錄庫、DASH Agent、DASH Out) 與 Vault 管理
 */
export const AppSidebar: React.FC<AppSidebarProps> = ({
  currentView,
  isOpen,
  onToggle,
  onNavigate,
  onVaultChanged,
}) => {
  const { user, logout } = useAuth();
  // 控制 DASH Agent 下拉分組選單展開/收合 (預設展開)
  const [isAiNavOpen, setIsAiNavOpen] = useState(true);

  return (
    <>
      <aside className="sidebar" id="primary-sidebar" aria-label="主選單">
        {/* 品牌標誌與回首頁連結 */}
        <a
          className="brand"
          href="#home"
          data-route="home"
          aria-label="回到系統首頁"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('home');
          }}
        >
          <span className="brand-mark" aria-hidden="true">D</span>
          <span>
            <strong>DASH</strong>
            <small>活動歷程與決策工作台</small>
          </span>
        </a>

        {/* 側邊欄邊緣小半圓箭頭收合/展開按鈕 */}
        <button
          className="sidebar-tab-toggle"
          id="sidebar-toggle"
          type="button"
          aria-label={isOpen ? '收合側邊欄' : '展開側邊欄'}
          title={isOpen ? '收合側邊欄' : '展開側邊欄'}
          onClick={onToggle}
        >
          {isOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* 主導航清單 */}
        <nav className="main-nav">
          {/* 1. 系統主頁 */}
          <a
            className={`nav-item ${currentView === 'home' ? 'active' : ''}`}
            href="#home"
            data-route="home"
            aria-current={currentView === 'home' ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              onNavigate('home');
            }}
          >
            <span className="nav-icon" aria-hidden="true">
              <Home size={16} />
            </span>
            <span>系統主頁</span>
          </a>

          {/* 2. 活動總覽連結 */}
          <a
            className={`nav-item ${currentView === 'activities' ? 'active' : ''}`}
            href="#activities"
            data-route="activities"
            aria-current={currentView === 'activities' ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              onNavigate('activities');
            }}
          >
            <span className="nav-icon" aria-hidden="true">
              <LayoutGrid size={16} />
            </span>
            <span>活動工作台</span>
          </a>

          {/* 3. 獨立文件紀錄庫 */}
          <a
            className={`nav-item ${currentView === 'documents' ? 'active' : ''}`}
            href="#documents"
            data-route="documents"
            aria-current={currentView === 'documents' ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              onNavigate('documents');
            }}
          >
            <span className="nav-icon" aria-hidden="true">
              <FileText size={16} />
            </span>
            <span>文件紀錄庫</span>
          </a>

          {/* 4. AI 功能折疊分組 (DASH Agent) */}
          <div className="nav-group">
            <button
              type="button"
              className={`nav-group-toggle ${['chat', 'extract'].includes(currentView) ? 'active' : ''}`}
              onClick={() => setIsAiNavOpen((prev) => !prev)}
              aria-expanded={isAiNavOpen}
            >
              <div className="nav-group-left">
                <span className="nav-icon" aria-hidden="true">
                  <Bot size={16} />
                </span>
                <span>DASH Agent</span>
              </div>
              <span className="nav-group-arrow">
                {isAiNavOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </span>
            </button>

            {isAiNavOpen && (
              <div className="nav-sub-list">
                {/* 子選項 1：AI 對話 */}
                <button
                  type="button"
                  className={`nav-sub-item ${currentView === 'chat' ? 'active' : ''}`}
                  onClick={() => onNavigate('chat')}
                >
                  <MessageSquare size={14} />
                  <span>智能對話</span>
                </button>

                {/* 子選項 2：會議紀錄整理 */}
                <button
                  type="button"
                  className={`nav-sub-item ${currentView === 'extract' ? 'active' : ''}`}
                  onClick={() => onNavigate('extract')}
                >
                  <FileScan size={14} />
                  <span>會議提煉</span>
                </button>
              </div>
            )}
          </div>

          {/* 5. DASH OUT 全量交接導出項目 */}
          <a
            className={`nav-item ${currentView === 'vault' ? 'active' : ''}`}
            href="#vault"
            data-route="vault"
            aria-current={currentView === 'vault' ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              onNavigate('vault');
            }}
          >
            <span className="nav-icon" aria-hidden="true">
              <Archive size={16} />
            </span>
            <span>紀錄庫備份</span>
          </a>
        </nav>

        {/* 側邊欄底部 Vault 控制列 */}
        <VaultManagerBar onVaultChanged={onVaultChanged} />

        {/* 使用者身分與登出列 */}
        {user && (
          <div className="sidebar-user-card">
            <div className="sidebar-user-info" title={user.email}>
              <UserIcon size={14} color="var(--cyan)" />
              <span className="sidebar-user-email">{user.email}</span>
            </div>
            <button
              type="button"
              className="sidebar-logout-btn"
              onClick={logout}
              title="登出帳號"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </aside>

      {/* 手機/窄螢幕下遮罩背景 */}
      <button
        className="nav-backdrop"
        id="nav-backdrop"
        type="button"
        aria-label="關閉選單"
        tabIndex={-1}
        hidden={!isOpen}
        onClick={onToggle}
      />
    </>
  );
};

export default AppSidebar;

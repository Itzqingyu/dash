/**
 * Vault 專屬操作入口面板 (VaultHubPage.tsx)
 * 職責：
 * Level 2 架構之核心中樞：
 * 1. 頂部極簡麵包屑導航 (首頁 > 當前紀錄庫)。
 * 2. 大大 Vault 名稱、角色身分標籤與當前專案簡述。
 * 3. 專屬管理操作：成員名單與邀請碼生成、紀錄庫更名與刪除 (Owner 專屬)。
 * 4. 五大核心業務前往卡片：活動工作台、文件紀錄庫、智能對話、會議提煉、紀錄庫備份導出。
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Users,
  Settings,
  Trash2,
  LayoutGrid,
  FileText,
  MessageSquare,
  FileScan,
  Archive,
  ArrowRight,
  ChevronRight,
  Copy,
  AlertCircle,
  X,
  Edit2,
  Home,
  ChevronLeft,
} from 'lucide-react';
import { vaultApi, VaultItem } from '../../../api/vaultApi';
import type { VaultMember, InviteCodeResponse } from '../../../types/auth';
import { useAuth } from '../../../context/AuthContext';
import ConfirmModal from '../../common/ConfirmModal';
import './VaultHubPage.css';

interface VaultHubPageProps {
  vaultName: string;
  onNavigateToHome: () => void;
  onNavigateToView: (view: string) => void;
  onVaultRenamed?: (newName: string) => void;
  onVaultDeleted?: () => void;
}

export const VaultHubPage: React.FC<VaultHubPageProps> = ({
  vaultName,
  onNavigateToHome,
  onNavigateToView,
  onVaultRenamed,
  onVaultDeleted,
}) => {
  const { user } = useAuth();

  const [vaultInfo, setVaultInfo] = useState<VaultItem | null>(null);
  const [loadingInfo, setLoadingInfo] = useState<boolean>(true);

  // 彈窗狀態
  const [membersModalOpen, setMembersModalOpen] = useState<boolean>(false);
  const [members, setMembers] = useState<VaultMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState<boolean>(false);
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user');
  const [createdInvite, setCreatedInvite] = useState<InviteCodeResponse | null>(null);
  const [creatingInvite, setCreatingInvite] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  const [renameModalOpen, setRenameModalOpen] = useState<boolean>(false);
  const [renameValue, setRenameValue] = useState<string>('');
  const [renaming, setRenaming] = useState<boolean>(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 載入該 Vault 資訊
  const loadVaultData = useCallback(async () => {
    setLoadingInfo(true);
    try {
      const list = await vaultApi.listVaults();
      const current = list.find((v) => v.name === vaultName);
      if (current) {
        setVaultInfo(current);
        setRenameValue(current.display_name || current.name);
      }
    } catch {
      // 保持靜默
    } finally {
      setLoadingInfo(false);
    }
  }, [vaultName]);

  useEffect(() => {
    loadVaultData();
  }, [loadVaultData]);

  const userRole = vaultInfo?.user_role || 'user';
  const isOwner = userRole === 'owner';
  const isOwnerOrAdmin = isOwner || userRole === 'admin';

  // 載入成員清單
  const handleOpenMembersModal = async () => {
    setCreatedInvite(null);
    setErrorMessage(null);
    setMembersModalOpen(true);
    setLoadingMembers(true);
    try {
      const list = await vaultApi.getVaultMembers(vaultName);
      setMembers(list);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : '載入成員名單失敗');
    } finally {
      setLoadingMembers(false);
    }
  };

  // 產生邀請碼
  const handleCreateInvite = async () => {
    setCreatingInvite(true);
    setCopySuccess(false);
    setErrorMessage(null);
    try {
      const res = await vaultApi.createInviteCode(vaultName, inviteRole, 7);
      setCreatedInvite(res);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : '建立邀請碼失敗');
    } finally {
      setCreatingInvite(false);
    }
  };

  // 複製邀請碼
  const handleCopyInviteCode = () => {
    if (!createdInvite) return;
    navigator.clipboard.writeText(createdInvite.invite_code);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // 晉升 / 降級成員
  const handleToggleMemberRole = async (member: VaultMember) => {
    const nextRole = member.role === 'admin' ? 'user' : 'admin';
    const actionName = nextRole === 'admin' ? '提升為 Admin' : '降級為 User';
    if (!window.confirm(`確定要將成員「${member.email}」${actionName}嗎？`)) {
      return;
    }

    try {
      await vaultApi.updateMemberRole(vaultName, member.user_id, nextRole);
      const list = await vaultApi.getVaultMembers(vaultName);
      setMembers(list);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '變更權限失敗');
    }
  };

  // 重新命名
  const handleConfirmRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameValue.trim() || renaming) return;
    setRenaming(true);
    setErrorMessage(null);
    try {
      await vaultApi.renameVault(vaultName, renameValue.trim());
      setRenameModalOpen(false);
      onVaultRenamed?.(renameValue.trim());
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : '重新命名失敗');
    } finally {
      setRenaming(false);
    }
  };

  // 刪除紀錄庫 (Owner 專屬)
  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await vaultApi.deleteVault(vaultName);
      setDeleteModalOpen(false);
      onVaultDeleted?.();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '刪除紀錄庫失敗');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="vault-hub-container">
      {/* 頂部極簡麵包屑導航 */}
      <nav className="vault-hub-nav-bar" aria-label="麵包屑導航">
        <button
          type="button"
          className="hub-back-btn"
          onClick={onNavigateToHome}
          title="回到首頁"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="hub-crumb-link"
          onClick={onNavigateToHome}
        >
          <Home size={14} />
          <span>首頁</span>
        </button>
        <span className="hub-crumb-separator">/</span>
        <span className="hub-crumb-active">{vaultInfo?.display_name || vaultName}</span>
      </nav>

      {/* 中央主視覺 Header */}
      <header className="vault-hub-header">
        <div className="vault-hub-title-row">
          <div className="vault-hub-title-left">
            <div className="vault-hub-icon-badge">
              <Database size={28} />
            </div>
            <div className="vault-hub-title-group">
              <div className="vault-hub-name-wrap">
                <h1 className="vault-hub-title">{vaultInfo?.display_name || vaultName}</h1>
                <span className={`role-badge role-${userRole}`}>
                  {userRole.toUpperCase()}
                </span>
              </div>
              <p className="vault-hub-desc">
                {vaultInfo?.description || '專案決策、歷程會議與規章紀錄庫'}
              </p>
            </div>
          </div>

          {/* 紀錄庫管理操作群 */}
          <div className="vault-hub-actions">
            <button
              type="button"
              className="hub-btn"
              onClick={handleOpenMembersModal}
            >
              <Users size={16} />
              <span>成員與邀請碼</span>
            </button>

            {isOwner && (
              <>
                <button
                  type="button"
                  className="hub-btn"
                  onClick={() => {
                    setErrorMessage(null);
                    setRenameModalOpen(true);
                  }}
                  title="重新命名紀錄庫"
                >
                  <Edit2 size={16} />
                  <span>更名</span>
                </button>
                <button
                  type="button"
                  className="hub-btn danger"
                  onClick={() => setDeleteModalOpen(true)}
                  title="永久刪除紀錄庫 (Owner 專屬)"
                >
                  <Trash2 size={16} />
                  <span>刪除</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 五大核心功能前往卡片網格 */}
      <div className="vault-hub-grid">
        {/* 1. 活動工作台 */}
        <div
          className="hub-card"
          onClick={() => onNavigateToView('activities')}
          role="button"
          tabIndex={0}
        >
          <div className="hub-card-top">
            <div className="hub-card-icon">
              <LayoutGrid size={22} />
            </div>
            <div className="hub-card-info">
              <h3 className="hub-card-title">活動工作台</h3>
              <p className="hub-card-desc">
                管理籌備活動、流程日程、待辦事項追蹤與關鍵決策歷程
              </p>
            </div>
          </div>
          <div className="hub-card-bottom">
            <span>{vaultInfo?.stats?.activities_count ?? 0} 項籌備活動</span>
            <span className="hub-card-enter-btn">
              <span>前往</span>
              <ChevronRight size={16} />
            </span>
          </div>
        </div>

        {/* 2. 文件紀錄庫 */}
        <div
          className="hub-card"
          onClick={() => onNavigateToView('documents')}
          role="button"
          tabIndex={0}
        >
          <div className="hub-card-top">
            <div className="hub-card-icon">
              <FileText size={22} />
            </div>
            <div className="hub-card-info">
              <h3 className="hub-card-title">文件紀錄庫</h3>
              <p className="hub-card-desc">
                託管會議逐字稿、組織規章與企劃，並自動向量切片索引
              </p>
            </div>
          </div>
          <div className="hub-card-bottom">
            <span>{vaultInfo?.stats?.documents_count ?? 0} 份託管文件</span>
            <span className="hub-card-enter-btn">
              <span>前往</span>
              <ChevronRight size={16} />
            </span>
          </div>
        </div>

        {/* 3. 智能對話 */}
        <div
          className="hub-card"
          onClick={() => onNavigateToView('chat')}
          role="button"
          tabIndex={0}
        >
          <div className="hub-card-top">
            <div className="hub-card-icon">
              <MessageSquare size={22} />
            </div>
            <div className="hub-card-info">
              <h3 className="hub-card-title">智能對話</h3>
              <p className="hub-card-desc">
                針對紀錄庫所有文件與歷史決策進行多輪對話與檢索問答
              </p>
            </div>
          </div>
          <div className="hub-card-bottom">
            <span>{vaultInfo?.stats?.chat_sessions_count ?? 0} 個對話會話</span>
            <span className="hub-card-enter-btn">
              <span>前往</span>
              <ChevronRight size={16} />
            </span>
          </div>
        </div>

        {/* 4. 會議提煉 */}
        <div
          className="hub-card"
          onClick={() => onNavigateToView('extract')}
          role="button"
          tabIndex={0}
        >
          <div className="hub-card-top">
            <div className="hub-card-icon">
              <FileScan size={22} />
            </div>
            <div className="hub-card-info">
              <h3 className="hub-card-title">會議提煉</h3>
              <p className="hub-card-desc">
                AI 會議紀錄 1-shot 結構化抽取與 Preview-Commit 寫入工作流
              </p>
            </div>
          </div>
          <div className="hub-card-bottom">
            <span>結構化自動匯入</span>
            <span className="hub-card-enter-btn">
              <span>前往</span>
              <ChevronRight size={16} />
            </span>
          </div>
        </div>

        {/* 5. 紀錄庫備份 */}
        <div
          className="hub-card"
          onClick={() => onNavigateToView('vault')}
          role="button"
          tabIndex={0}
        >
          <div className="hub-card-top">
            <div className="hub-card-icon">
              <Archive size={22} />
            </div>
            <div className="hub-card-info">
              <h3 className="hub-card-title">紀錄庫備份</h3>
              <p className="hub-card-desc">
                全量封裝打包當前紀錄庫為標準 .zip 備份包，支援交接保存
              </p>
            </div>
          </div>
          <div className="hub-card-bottom">
            <span>DASH OUT 備份</span>
            <span className="hub-card-enter-btn">
              <span>前往</span>
              <ChevronRight size={16} />
            </span>
          </div>
        </div>
      </div>

      {/* 成員管理與邀請碼彈窗 */}
      {membersModalOpen && (
        <div className="hub-modal-overlay" onClick={() => setMembersModalOpen(false)}>
          <div className="hub-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="hub-modal-header">
              <h3 className="hub-modal-title">成員名單與邀請碼（{vaultName}）</h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setMembersModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="hub-modal-body">
              <label className="form-label">成員清單（共 {members.length} 人）</label>
              {loadingMembers ? (
                <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>讀取成員中...</p>
              ) : (
                <div className="vault-members-list">
                  {members.map((m) => {
                    const isSelf = m.user_id === user?.id;
                    const isTargetOwner = m.role === 'owner';
                    return (
                      <div key={m.id} className="vault-member-row">
                        <div className="vault-member-left">
                          <Users size={14} />
                          <span className="vault-member-email">{m.email}</span>
                        </div>
                        <div className="vault-member-actions">
                          <span className={`role-badge role-${m.role}`}>
                            {m.role.toUpperCase()}
                          </span>
                          {isOwner && !isSelf && !isTargetOwner && (
                            <button
                              type="button"
                              className="vault-member-role-btn"
                              onClick={() => handleToggleMemberRole(m)}
                              title={m.role === 'admin' ? '降級為 User' : '升級為 Admin'}
                            >
                              {m.role === 'admin' ? '降為 User' : '升為 Admin'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 邀請碼產生區塊 (限 Owner 或 Admin) */}
              {isOwnerOrAdmin && (
                <div className="vault-invite-box">
                  <label className="form-label">建立邀請碼</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {isOwner ? (
                      <select
                        className="form-input"
                        style={{ width: 'auto', padding: '6px 10px' }}
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as 'admin' | 'user')}
                      >
                        <option value="user">邀請為 User (一般成員)</option>
                        <option value="admin">邀請為 Admin (管理員)</option>
                      </select>
                    ) : (
                      <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                        預設邀請身分：User (一般成員)
                      </span>
                    )}

                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleCreateInvite}
                      disabled={creatingInvite}
                    >
                      {creatingInvite ? '生成中...' : '生成邀請碼'}
                    </button>
                  </div>

                  {createdInvite && (
                    <div className="vault-invite-code-row">
                      <div>
                        <span className="vault-invite-code-text">
                          {createdInvite.invite_code}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block' }}>
                          角色：{createdInvite.default_role} · 有效期 7 天
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleCopyInviteCode}
                        style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Copy size={12} />
                        <span>{copySuccess ? '已複製！' : '複製'}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {errorMessage && (
                <div className="auth-error-banner">
                  <AlertCircle size={16} />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>

            <div className="hub-modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setMembersModalOpen(false)}
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重新命名彈窗 */}
      {renameModalOpen && (
        <div className="hub-modal-overlay" onClick={() => setRenameModalOpen(false)}>
          <div className="hub-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="hub-modal-header">
              <h3 className="hub-modal-title">重新命名紀錄庫</h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setRenameModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleConfirmRename}>
              <div className="hub-modal-body">
                <label className="form-label" htmlFor="rename-input">
                  新紀錄庫名稱
                </label>
                <input
                  id="rename-input"
                  type="text"
                  className="form-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  required
                  autoFocus
                />
                {errorMessage && (
                  <div className="auth-error-banner">
                    <AlertCircle size={16} />
                    <span>{errorMessage}</span>
                  </div>
                )}
              </div>
              <div className="hub-modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setRenameModalOpen(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={renaming || !renameValue.trim()}
                >
                  {renaming ? '儲存中...' : '確認更名'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 刪除確認彈窗 */}
      <ConfirmModal
        isOpen={deleteModalOpen}
        title="確認刪除紀錄庫"
        message={`確定要永久刪除紀錄庫「${vaultName}」嗎？此動作將物理刪除所有活動、會議、待辦、決策、日程與文件，且無法復原。`}
        confirmText={deleting ? '刪除中...' : '確認刪除'}
        cancelText="取消"
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteModalOpen(false)}
      />
    </div>
  );
};


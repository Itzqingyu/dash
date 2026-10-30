/**
 * DASH 全局系統主頁 (HomePage.tsx)
 * 職責：
 * 已登入使用者的首頁儀表板：
 * 1. 歡迎總覽與當前紀錄庫顯示。
 * 2. 我的紀錄庫清單 (含 Owner/Admin/User 角色標籤、活動與文件數據)。
 * 3. 快速進入工作台、建立新紀錄庫、輸入邀請碼加入既有紀錄庫、切換與刪除紀錄庫。
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Layers,
  FolderPlus,
  Ticket,
  LogOut,
  ArrowRight,
  Trash2,
  Users,
  AlertCircle,
  FileText,
  Activity,
  X,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { vaultApi, VaultItem } from '../../../api/vaultApi';
import './HomePage.css';

interface HomePageProps {
  activeVaultName: string;
  onEnterWorkspace: () => void;
  onVaultChange: (vaultName: string) => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  activeVaultName,
  onEnterWorkspace,
  onVaultChange,
}) => {
  const { user, logout } = useAuth();

  // 紀錄庫清單狀態
  const [vaults, setVaults] = useState<VaultItem[]>([]);
  const [loadingVaults, setLoadingVaults] = useState(false);

  // 彈窗狀態
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newVaultName, setNewVaultName] = useState('');
  const [newVaultDesc, setNewVaultDesc] = useState('');
  const [creatingVault, setCreatingVault] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [showJoinModal, setShowJoinModal] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joiningVault, setJoiningVault] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [deletingVaultName, setDeletingVaultName] = useState<string | null>(null);

  // 載入當前使用者的紀錄庫清單
  const loadVaults = useCallback(async () => {
    if (!user) {
      setVaults([]);
      return;
    }
    setLoadingVaults(true);
    try {
      const list = await vaultApi.listVaults();
      setVaults(list);
    } catch {
      setVaults([]);
    } finally {
      setLoadingVaults(false);
    }
  }, [user]);

  useEffect(() => {
    loadVaults();
  }, [loadVaults, activeVaultName]);

  // 建立新紀錄庫
  const handleCreateVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVaultName.trim()) return;
    setCreateError(null);
    setCreatingVault(true);

    try {
      const res = await vaultApi.createVault(newVaultName.trim(), newVaultDesc.trim());
      setShowCreateModal(false);
      setNewVaultName('');
      setNewVaultDesc('');
      await loadVaults();
      if (res.vault && typeof res.vault === 'object' && 'name' in res.vault) {
        onVaultChange(String(res.vault.name));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '建立紀錄庫失敗';
      setCreateError(msg);
    } finally {
      setCreatingVault(false);
    }
  };

  // 憑邀請碼加入紀錄庫
  const handleJoinVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    setJoinError(null);
    setJoiningVault(true);

    try {
      const res = await vaultApi.joinVault(inviteCode.trim());
      setShowJoinModal(false);
      setInviteCode('');
      await loadVaults();
      if (res.vault_name) {
        onVaultChange(res.vault_name);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '加入紀錄庫失敗，請確認邀請碼正確性與時效';
      setJoinError(msg);
    } finally {
      setJoiningVault(false);
    }
  };

  // 刪除紀錄庫 (限 owner)
  const handleDeleteVault = async (targetName: string) => {
    if (!window.confirm(`確定要徹底刪除紀錄庫「${targetName}」嗎？此操作不可還原。`)) {
      return;
    }
    setDeletingVaultName(targetName);
    try {
      await vaultApi.deleteVault(targetName);
      await loadVaults();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '刪除紀錄庫失敗');
    } finally {
      setDeletingVaultName(null);
    }
  };

  // 切換使用中紀錄庫
  const handleSwitchVault = async (targetName: string) => {
    try {
      await vaultApi.switchVault(targetName);
      onVaultChange(targetName);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '切換紀錄庫失敗');
    }
  };

  const getRoleLabel = (role?: string) => {
    switch (role) {
      case 'owner':
        return '建立者 (Owner)';
      case 'admin':
        return '管理員 (Admin)';
      case 'user':
      default:
        return '成員 (User)';
    }
  };

  const getRoleClass = (role?: string) => {
    switch (role) {
      case 'owner':
        return 'role-owner';
      case 'admin':
        return 'role-admin';
      case 'user':
      default:
        return 'role-user';
    }
  };

  return (
    <div className="home-container">
      {/* 頂部導航列 */}
      <header className="home-header">
        <div className="home-brand">
          <div className="home-logo-badge">
            <Layers size={22} />
          </div>
          <div>
            <h1 className="home-brand-title">DASH</h1>
            <p className="home-brand-sub">團隊決策歷程與會議交接系統</p>
          </div>
        </div>

        <div className="home-nav-actions">
          {user && (
            <>
              <div className="home-user-pill">
                <Users size={16} />
                <span>{user.email}</span>
              </div>
              {vaults.length > 0 && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={onEnterWorkspace}
                >
                  <span>進入工作台</span>
                  <ArrowRight size={16} />
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={logout}
                title="登出目前帳號"
              >
                <LogOut size={16} />
                <span>登出</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* 主體區塊 */}
      <main className="home-main">
        <div className="user-dashboard">
          <div className="dashboard-hero-banner">
            <div className="dashboard-greeting">
              <h2 className="dashboard-greeting-title">
                歡迎回來，{user?.email}
              </h2>
              <p className="dashboard-greeting-sub">
                當前使用中紀錄庫：<strong>{activeVaultName || '未選取'}</strong>
              </p>
            </div>

            <div className="dashboard-actions-row">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowJoinModal(true)}
              >
                <Ticket size={16} />
                <span>輸入邀請碼加入</span>
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setShowCreateModal(true)}
              >
                <FolderPlus size={16} />
                <span>建立新紀錄庫</span>
              </button>
            </div>
          </div>

          {/* 紀錄庫區域 */}
          <div className="vaults-section">
            <div className="vaults-section-header">
              <div className="section-title-wrap">
                <h3 className="section-title">我的紀錄庫</h3>
                <span className="section-count-badge">{vaults.length}</span>
              </div>
            </div>

            {loadingVaults ? (
              <p>讀取紀錄庫中...</p>
            ) : vaults.length === 0 ? (
              /* 新用戶導引 (Onboarding) */
              <div className="onboarding-card">
                <div className="onboarding-icon-wrap">
                  <Database size={28} />
                </div>
                <h4 className="onboarding-title">您尚未加入任何紀錄庫</h4>
                <p className="onboarding-desc">
                  您可以立即建立全新的空白紀錄庫作為唯一 Owner，或是輸入團隊 Admin 提供的邀請碼加入既有紀錄庫。
                </p>
                <div className="onboarding-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setShowCreateModal(true)}
                  >
                    <FolderPlus size={16} />
                    <span>建立新紀錄庫</span>
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowJoinModal(true)}
                  >
                    <Ticket size={16} />
                    <span>輸入邀請碼</span>
                  </button>
                </div>
              </div>
            ) : (
              /* 紀錄庫卡片列表 */
              <div className="vaults-grid">
                {vaults.map((v) => {
                  const isCurrent = v.name === activeVaultName;
                  const isOwner = v.user_role === 'owner';

                  return (
                    <div
                      key={v.name}
                      className={`vault-card ${isCurrent ? 'active-vault' : ''}`}
                    >
                      <div className="vault-card-header">
                        <h4 className="vault-card-title">{v.display_name || v.name}</h4>
                        <span className={`role-badge ${getRoleClass(v.user_role)}`}>
                          {getRoleLabel(v.user_role)}
                        </span>
                      </div>

                      <p className="vault-card-desc">
                        {v.description || '無描述說明'}
                      </p>

                      <div className="vault-stats-row">
                        <div className="vault-stat-item">
                          <Activity size={14} />
                          <span>{v.stats?.activities_count || 0} 項活動</span>
                        </div>
                        <div className="vault-stat-item">
                          <FileText size={14} />
                          <span>{v.stats?.documents_count || 0} 份文件</span>
                        </div>
                      </div>

                      <div className="vault-card-footer">
                        {isCurrent ? (
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={onEnterWorkspace}
                          >
                            <span>進入工作台</span>
                            <ArrowRight size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => handleSwitchVault(v.name)}
                          >
                            <span>切換為目前</span>
                          </button>
                        )}

                        {isOwner && !isCurrent && (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => handleDeleteVault(v.name)}
                            disabled={deletingVaultName === v.name}
                            title="刪除紀錄庫 (Owner 專屬)"
                          >
                            <Trash2 size={14} />
                            <span>刪除</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 建立新紀錄庫彈窗 */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">建立全新紀錄庫</h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setShowCreateModal(false)}
              >
                <X size={20} />
              </button>
            </div>

            {createError && (
              <div className="auth-error-banner">
                <AlertCircle size={16} />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateVault} className="auth-form">
              <div className="form-group">
                <label className="form-label" htmlFor="vault-name-input">
                  紀錄庫名稱 (英文代號或中文名稱)
                </label>
                <input
                  id="vault-name-input"
                  type="text"
                  className="form-input"
                  placeholder="例如：annual_gala_2026"
                  value={newVaultName}
                  onChange={(e) => setNewVaultName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="vault-desc-input">
                  描述備註 (選填)
                </label>
                <input
                  id="vault-desc-input"
                  type="text"
                  className="form-input"
                  placeholder="例如：2026 年度籌備會專案紀錄"
                  value={newVaultDesc}
                  onChange={(e) => setNewVaultDesc(e.target.value)}
                />
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={creatingVault || !newVaultName.trim()}
                >
                  {creatingVault ? '建立中...' : '確認建立'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 輸入邀請碼加入紀錄庫彈窗 */}
      {showJoinModal && (
        <div className="modal-overlay" onClick={() => setShowJoinModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">加入既有紀錄庫</h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setShowJoinModal(false)}
              >
                <X size={20} />
              </button>
            </div>

            {joinError && (
              <div className="auth-error-banner">
                <AlertCircle size={16} />
                <span>{joinError}</span>
              </div>
            )}

            <form onSubmit={handleJoinVault} className="auth-form">
              <div className="form-group">
                <label className="form-label" htmlFor="invite-code-input">
                  邀請碼 (由 Owner 或 Admin 提供)
                </label>
                <input
                  id="invite-code-input"
                  type="text"
                  className="form-input"
                  placeholder="例如：DASH-7A3B9C1E"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required
                />
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowJoinModal(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={joiningVault || !inviteCode.trim()}
                >
                  {joiningVault ? '驗證加入中...' : '加入紀錄庫'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

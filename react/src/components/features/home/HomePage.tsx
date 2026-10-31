/**
 * DASH 根層級主頁 (HomePage.tsx)
 * 職責：
 * Level 1 全局根層級儀表板：
 * 1. 無 Header、無 Sidebar、無 Footer。
 * 2. 頂部精緻帳戶狀態條 (Email、登出、＋建立新紀錄庫、輸入邀請碼、匯入備份包 DASH IN)。
 * 3. 我的紀錄庫清單：點擊特定卡片直接進入 Level 2 的 VaultHubPage。
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Database,
  FolderPlus,
  Ticket,
  FolderInput,
  LogOut,
  Users,
  AlertCircle,
  FileText,
  Activity,
  X,
  ChevronRight,
  Home,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { vaultApi, VaultItem } from '../../../api/vaultApi';
import './HomePage.css';

interface HomePageProps {
  activeVaultName: string;
  onEnterVaultHub: (vaultName: string) => void;
  onVaultListChanged: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  activeVaultName,
  onEnterVaultHub,
  onVaultListChanged,
}) => {
  const { user, logout } = useAuth();

  const [vaults, setVaults] = useState<VaultItem[]>([]);
  const [loadingVaults, setLoadingVaults] = useState(false);

  // 彈窗狀態：新建紀錄庫
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newVaultName, setNewVaultName] = useState('');
  const [newVaultDesc, setNewVaultDesc] = useState('');
  const [creatingVault, setCreatingVault] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // 彈窗狀態：輸入邀請碼
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joiningVault, setJoiningVault] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // 彈窗狀態：DASH IN 匯入備份包
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedZipFile, setSelectedZipFile] = useState<File | null>(null);
  const [importVaultName, setImportVaultName] = useState('');
  const [importOriginalName, setImportOriginalName] = useState('');
  const [importIsDuplicate, setImportIsDuplicate] = useState(false);
  const [importingVault, setImportingVault] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 載入紀錄庫清單
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

  // 點擊卡片直接進入該 Vault 的 Hub
  const handleSelectVault = async (targetVaultName: string) => {
    try {
      await vaultApi.switchVault(targetVaultName);
      onEnterVaultHub(targetVaultName);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '切換紀錄庫失敗');
    }
  };

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
      onVaultListChanged();
      if (res.vault && typeof res.vault === 'object' && 'name' in res.vault) {
        onEnterVaultHub(String(res.vault.name));
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
      onVaultListChanged();
      if (res.vault_name) {
        await vaultApi.switchVault(res.vault_name);
        onEnterVaultHub(res.vault_name);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '加入失敗，請確認邀請碼正確性與效期';
      setJoinError(msg);
    } finally {
      setJoiningVault(false);
    }
  };

  // 觸發選取 DASH IN 檔案
  const handleTriggerImport = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // 檔案選取後校驗 ZIP
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.zip')) {
      alert('請選取副檔名為 .zip 的資料包檔案');
      return;
    }

    try {
      const inspectRes = await vaultApi.inspectZip(file);
      setSelectedZipFile(file);
      setImportOriginalName(inspectRes.manifest.name);
      setImportVaultName(inspectRes.suggested_name);
      const isDup = vaults.some((v) => v.name.toLowerCase() === inspectRes.manifest.name.toLowerCase());
      setImportIsDuplicate(isDup);
      setImportError(null);
      setShowImportModal(true);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '解析資料包失敗');
    }
  };

  // 確認匯入 ZIP
  const handleConfirmImport = async () => {
    if (!selectedZipFile || !importVaultName.trim() || importingVault) return;
    setImportingVault(true);
    setImportError(null);
    try {
      const res = await vaultApi.importVault(selectedZipFile, importVaultName.trim());
      setShowImportModal(false);
      setSelectedZipFile(null);
      await loadVaults();
      onVaultListChanged();
      if (res.vault_name) {
        onEnterVaultHub(res.vault_name);
      }
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : '匯入資料包失敗');
    } finally {
      setImportingVault(false);
    }
  };

  return (
    <div className="home-container">
      {/* 隱藏的 ZIP 檔案選取器 */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".zip"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      {/* 頂部極簡導航欄 (與 Vault Hub 導航欄位置樣式一致) */}
      <nav className="home-nav-bar" aria-label="首頁導航">
        <span className="home-crumb-active">
          <Home size={14} />
          <span>首頁</span>
        </span>
      </nav>

      {/* 中央主視覺 DASH 基本資料卡片 (與 Vault Hub 基本資料卡片位置與規格完全一致) */}
      <header className="home-dash-header">
        <div className="home-dash-title-row">
          <div className="home-dash-title-left">
            <div className="home-dash-icon-badge">
              <Activity size={28} />
            </div>
            <div className="home-dash-title-group">
              <div className="home-dash-name-wrap">
                <h1 className="home-dash-title">DASH</h1>
                <div className="home-user-pill">
                  <Users size={13} />
                  <span>{user?.email}</span>
                </div>
              </div>
              <p className="home-dash-desc">
                團隊決策、活動歷程、流程規劃與紀錄庫中樞
              </p>
            </div>
          </div>

          {/* 帳號與全局操作群 */}
          <div className="home-dash-actions">
            <button
              type="button"
              className="home-btn"
              onClick={handleTriggerImport}
            >
              <FolderInput size={15} />
              <span>匯入備份包 (DASH IN)</span>
            </button>
            <button
              type="button"
              className="home-btn"
              onClick={() => {
                setInviteCode('');
                setJoinError(null);
                setShowJoinModal(true);
              }}
            >
              <Ticket size={15} />
              <span>輸入邀請碼</span>
            </button>
            <button
              type="button"
              className="home-btn primary"
              onClick={() => {
                setNewVaultName('');
                setNewVaultDesc('');
                setCreateError(null);
                setShowCreateModal(true);
              }}
            >
              <FolderPlus size={15} />
              <span>建立新紀錄庫</span>
            </button>
            <button
              type="button"
              className="home-btn danger"
              onClick={logout}
              title="登出目前帳號"
            >
              <LogOut size={15} />
              <span>登出</span>
            </button>
          </div>
        </div>
      </header>

      {/* 主體區塊：我的紀錄庫清單 */}
      <main className="home-main">
        <section className="vaults-section">
          <div className="vaults-section-header">
            <div className="section-title-wrap">
              <h2 className="section-title">我的紀錄庫</h2>
              <span className="section-count-badge">{vaults.length}</span>
            </div>
          </div>

          {loadingVaults ? (
            <p style={{ color: 'var(--muted)' }}>讀取紀錄庫中...</p>
          ) : vaults.length === 0 ? (
            /* 無紀錄庫引導卡片 */
            <div className="onboarding-card">
              <div className="onboarding-icon-wrap">
                <Database size={30} />
              </div>
              <h3 className="onboarding-title">您尚未加入任何紀錄庫</h3>
              <p className="onboarding-desc">
                您可以立即建立全新的空白紀錄庫成為唯一 Owner，或輸入團隊 Admin 提供的邀請碼加入既有專案。
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
            /* 紀錄庫卡片網格 (點擊直接進入 Vault Hub) */
            <div className="vaults-grid">
              {vaults.map((v) => {
                const isActive = v.name === activeVaultName;
                const role = v.user_role || 'user';

                return (
                  <div
                    key={v.name}
                    className={`vault-entry-card ${isActive ? 'is-active' : ''}`}
                    onClick={() => handleSelectVault(v.name)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="vault-card-header">
                      <h3 className="vault-card-title">{v.display_name || v.name}</h3>
                      <span className={`role-badge role-${role}`}>
                        {role.toUpperCase()}
                      </span>
                    </div>

                    <div className="vault-card-footer">
                      <div className="vault-card-stats">
                        <div className="vault-card-stat-item">
                          <Activity size={14} />
                          <span>{v.stats?.activities_count || 0} 項活動</span>
                        </div>
                        <div className="vault-card-stat-item">
                          <FileText size={14} />
                          <span>{v.stats?.documents_count || 0} 份文件</span>
                        </div>
                      </div>

                      <div className="vault-card-enter-btn">
                        <span>進入操作</span>
                        <ChevronRight size={16} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
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
                <X size={18} />
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
                  autoFocus
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
                <X size={18} />
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
                  autoFocus
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

      {/* DASH IN: 匯入 ZIP 確認建立新 Vault 對話框 */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">DASH IN 備份包匯入確認</h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setShowImportModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="hub-modal-body">
              <p style={{ fontSize: '0.875rem', color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                系統將為這份備份包建立一個「全新獨立的紀錄庫」，絕不會覆蓋任何現有資料。
              </p>
              {importIsDuplicate && (
                <div className="auth-error-banner">
                  <AlertCircle size={16} />
                  <span>本地已存在同名紀錄庫「{importOriginalName}」，已自動建議後綴名稱以防衝突。</span>
                </div>
              )}
              <div className="form-group">
                <label className="form-label" htmlFor="import-name-input">
                  新紀錄庫名稱
                </label>
                <input
                  id="import-name-input"
                  type="text"
                  className="form-input"
                  value={importVaultName}
                  onChange={(e) => setImportVaultName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              {importError && (
                <div className="auth-error-banner">
                  <AlertCircle size={16} />
                  <span>{importError}</span>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowImportModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!importVaultName.trim() || importingVault}
                onClick={handleConfirmImport}
              >
                {importingVault ? '匯入中...' : '確認匯入並開啟'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

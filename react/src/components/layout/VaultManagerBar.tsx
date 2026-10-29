/**
 * 側邊欄底部 Vault 管理列 (VaultManagerBar.tsx)
 * 提供目前使用中 Vault 的常駐顯示、清單切換、新建空白 Vault、
 * 重新命名、刪除防呆確認、成員名單檢視、邀請碼生成、憑碼加入，以及 DASH IN 匯入備份包功能。
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Database,
  ChevronUp,
  ChevronDown,
  Check,
  Plus,
  FolderInput,
  Edit2,
  Trash2,
  X,
  Users,
  Ticket,
  Copy,
  Shield,
  AlertCircle,
} from 'lucide-react';
import { vaultApi, VaultItem } from '../../api/vaultApi';
import type { VaultMember, InviteCodeResponse } from '../../types/auth';
import { useAuth } from '../../context/AuthContext';
import ConfirmModal from '../common/ConfirmModal';
import './VaultManagerBar.css';

interface VaultManagerBarProps {
  onVaultChanged: () => void;
}

export default function VaultManagerBar({ onVaultChanged }: VaultManagerBarProps) {
  const { user } = useAuth();
  const [vaults, setVaults] = useState<VaultItem[]>([]);
  const [activeVault, setActiveVault] = useState<string>('default');
  const [isPopoverOpen, setIsPopoverOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // 當前使用者的身分角色
  const currentVaultItem = vaults.find((v) => v.name === activeVault);
  const currentUserRole = currentVaultItem?.user_role || 'user';
  const isOwnerOrAdmin = currentUserRole === 'owner' || currentUserRole === 'admin';
  const isOwner = currentUserRole === 'owner';

  // 彈窗狀態控制
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [newVaultName, setNewVaultName] = useState<string>('');
  const [newVaultDesc, setNewVaultDesc] = useState<string>('');

  const [renameModalOpen, setRenameModalOpen] = useState<boolean>(false);
  const [targetRenameVault, setTargetRenameVault] = useState<string>('');
  const [renameValue, setRenameValue] = useState<string>('');

  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
  const [targetDeleteVault, setTargetDeleteVault] = useState<string>('');

  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [selectedZipFile, setSelectedZipFile] = useState<File | null>(null);
  const [importVaultName, setImportVaultName] = useState<string>('');
  const [importOriginalName, setImportOriginalName] = useState<string>('');
  const [importIsDuplicate, setImportIsDuplicate] = useState<boolean>(false);

  // 成員管理與邀請碼彈窗
  const [membersModalOpen, setMembersModalOpen] = useState<boolean>(false);
  const [members, setMembers] = useState<VaultMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState<boolean>(false);
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user');
  const [createdInvite, setCreatedInvite] = useState<InviteCodeResponse | null>(null);
  const [creatingInvite, setCreatingInvite] = useState<boolean>(false);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  // 加入紀錄庫彈窗
  const [joinModalOpen, setJoinModalOpen] = useState<boolean>(false);
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [joiningVault, setJoiningVault] = useState<boolean>(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const popoverRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 載入 Vault 清單
  const fetchVaults = async () => {
    try {
      const list = await vaultApi.listVaults();
      setVaults(list);
      const active = list.find((v) => v.is_active);
      if (active) {
        setActiveVault(active.name);
      }
    } catch {
      // 保持靜默
    }
  };

  useEffect(() => {
    fetchVaults();
  }, [user]);

  // 點擊外部自動收合浮層選單
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsPopoverOpen(false);
      }
    };
    if (isPopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPopoverOpen]);

  // 切換 Vault
  const handleSwitch = async (name: string) => {
    if (name === activeVault || isLoading) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await vaultApi.switchVault(name);
      setActiveVault(name);
      setIsPopoverOpen(false);
      await fetchVaults();
      onVaultChanged();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : '切換 Vault 失敗');
    } finally {
      setIsLoading(false);
    }
  };

  // 開啟新建空白 Vault 彈窗
  const handleOpenCreateModal = () => {
    setIsPopoverOpen(false);
    setNewVaultName('');
    setNewVaultDesc('');
    setErrorMsg(null);
    setCreateModalOpen(true);
  };

  // 送出新建空白 Vault
  const handleConfirmCreate = async () => {
    if (!newVaultName.trim() || isLoading) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await vaultApi.createVault(newVaultName.trim(), newVaultDesc.trim());
      setCreateModalOpen(false);
      await fetchVaults();
      if (res.vault && typeof res.vault === 'object' && 'name' in res.vault) {
        setActiveVault(String(res.vault.name));
      }
      onVaultChanged();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : '建立 Vault 失敗');
    } finally {
      setIsLoading(false);
    }
  };

  // 開啟更名彈窗
  const handleOpenRename = (e: React.MouseEvent, vault: VaultItem) => {
    e.stopPropagation();
    setIsPopoverOpen(false);
    setTargetRenameVault(vault.name);
    setRenameValue(vault.display_name || vault.name);
    setErrorMsg(null);
    setRenameModalOpen(true);
  };

  // 確認更名
  const handleConfirmRename = async () => {
    if (!renameValue.trim() || isLoading) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await vaultApi.renameVault(targetRenameVault, renameValue.trim());
      setRenameModalOpen(false);
      await fetchVaults();
      if (activeVault === targetRenameVault) {
        setActiveVault(renameValue.trim());
      }
      onVaultChanged();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : '重新命名 Vault 失敗');
    } finally {
      setIsLoading(false);
    }
  };

  // 開啟刪除對話框
  const handleOpenDelete = (e: React.MouseEvent, vault: VaultItem) => {
    e.stopPropagation();
    if (vault.is_active) return;
    setIsPopoverOpen(false);
    setTargetDeleteVault(vault.name);
    setDeleteModalOpen(true);
  };

  // 確認刪除 Vault
  const handleConfirmDelete = async () => {
    if (!targetDeleteVault || isLoading) return;
    setIsLoading(true);
    try {
      await vaultApi.deleteVault(targetDeleteVault);
      setDeleteModalOpen(false);
      await fetchVaults();
      onVaultChanged();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '刪除 Vault 失敗');
    } finally {
      setIsLoading(false);
    }
  };

  // 觸發 DASH IN 檔案上傳
  const handleTriggerImport = () => {
    setIsPopoverOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // 當使用者選取 ZIP 檔
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.zip')) {
      alert('請選取副檔名為 .zip 的資料包檔案');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    try {
      const inspectRes = await vaultApi.inspectZip(file);
      setSelectedZipFile(file);
      setImportOriginalName(inspectRes.manifest.name);
      setImportVaultName(inspectRes.suggested_name);
      const isDup = vaults.some((v) => v.name.toLowerCase() === inspectRes.manifest.name.toLowerCase());
      setImportIsDuplicate(isDup);
      setImportModalOpen(true);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '解析資料包失敗');
    } finally {
      setIsLoading(false);
    }
  };

  // 確認匯入 ZIP
  const handleConfirmImport = async () => {
    if (!selectedZipFile || !importVaultName.trim() || isLoading) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await vaultApi.importVault(selectedZipFile, importVaultName.trim());
      setImportModalOpen(false);
      setSelectedZipFile(null);
      await fetchVaults();
      setActiveVault(res.vault_name);
      onVaultChanged();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : '匯入資料包失敗');
    } finally {
      setIsLoading(false);
    }
  };

  // 開啟成員管理彈窗
  const handleOpenMembersModal = async () => {
    setIsPopoverOpen(false);
    setCreatedInvite(null);
    setErrorMsg(null);
    setMembersModalOpen(true);
    setLoadingMembers(true);
    try {
      const list = await vaultApi.getVaultMembers(activeVault);
      setMembers(list);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : '取得成員名單失敗');
    } finally {
      setLoadingMembers(false);
    }
  };

  // 產生邀請碼
  const handleCreateInvite = async () => {
    setCreatingInvite(true);
    setCopySuccess(false);
    setErrorMsg(null);
    try {
      const res = await vaultApi.createInviteCode(activeVault, inviteRole, 7);
      setCreatedInvite(res);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : '建立邀請碼失敗');
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
      await vaultApi.updateMemberRole(activeVault, member.user_id, nextRole);
      const list = await vaultApi.getVaultMembers(activeVault);
      setMembers(list);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : '變更權限失敗');
    }
  };

  // 憑碼加入紀錄庫
  const handleJoinWithCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim() || joiningVault) return;
    setJoiningVault(true);
    setErrorMsg(null);
    try {
      const res = await vaultApi.joinVault(joinCodeInput.trim());
      setJoinModalOpen(false);
      setJoinCodeInput('');
      await fetchVaults();
      if (res.vault_name) {
        await vaultApi.switchVault(res.vault_name);
        setActiveVault(res.vault_name);
        onVaultChanged();
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : '加入紀錄庫失敗');
    } finally {
      setJoiningVault(false);
    }
  };

  return (
    <div className="vault-bar-container" ref={popoverRef}>
      {/* 隱藏的 ZIP 檔案選取器 */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".zip"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      {/* 常駐底部之觸發列按鈕 */}
      <button
        type="button"
        className="vault-trigger-btn"
        onClick={() => setIsPopoverOpen((prev) => !prev)}
        aria-expanded={isPopoverOpen}
        title="切換或管理紀錄庫 (Vault)"
      >
        <div className="vault-trigger-left">
          <span className="vault-trigger-icon">
            <Database size={16} />
          </span>
          <div className="vault-trigger-text">
            <span className="vault-trigger-label">Active Vault ({currentUserRole})</span>
            <span className="vault-trigger-name">{activeVault}</span>
          </div>
        </div>
        <span className="vault-trigger-arrow">
          {isPopoverOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </span>
      </button>

      {/* 浮層選單 */}
      {isPopoverOpen && (
        <div className="vault-popover">
          <div className="vault-popover-head">
            <span className="vault-popover-title">紀錄庫列表</span>
            <span className="vault-popover-count">{vaults.length} 個</span>
          </div>

          <div className="vault-list">
            {vaults.map((vault) => {
              const vaultIsOwner = vault.user_role === 'owner';
              return (
                <div
                  key={vault.name}
                  className={`vault-item ${vault.is_active ? 'active' : ''}`}
                  onClick={() => handleSwitch(vault.name)}
                >
                  <div className="vault-item-left">
                    <span className="vault-item-icon">
                      {vault.is_active ? <Check size={14} /> : <Database size={14} />}
                    </span>
                    <div className="vault-item-info">
                      <span className="vault-item-name">{vault.display_name || vault.name}</span>
                      <span className="vault-item-sub">
                        {vault.user_role || 'user'} · {vault.stats?.activities_count ?? 0} 活動
                      </span>
                    </div>
                  </div>

                  <div className="vault-item-actions">
                    <button
                      type="button"
                      className="vault-item-btn"
                      title="重新命名"
                      onClick={(e) => handleOpenRename(e, vault)}
                    >
                      <Edit2 size={12} />
                    </button>
                    {vaultIsOwner && (
                      <button
                        type="button"
                        className="vault-item-btn delete"
                        title={vault.is_active ? '使用中無法刪除' : '刪除此 Vault (Owner 專屬)'}
                        disabled={vault.is_active}
                        onClick={(e) => handleOpenDelete(e, vault)}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="vault-popover-divider" />

          <div className="vault-popover-actions">
            <button
              type="button"
              className="vault-action-btn"
              onClick={handleOpenMembersModal}
            >
              <Users size={14} />
              <span>成員與邀請碼</span>
            </button>
            <button
              type="button"
              className="vault-action-btn"
              onClick={() => {
                setIsPopoverOpen(false);
                setJoinCodeInput('');
                setErrorMsg(null);
                setJoinModalOpen(true);
              }}
            >
              <Ticket size={14} />
              <span>輸入邀請碼加入</span>
            </button>
            <button
              type="button"
              className="vault-action-btn primary"
              onClick={handleOpenCreateModal}
            >
              <Plus size={14} />
              <span>新建空白 Vault</span>
            </button>
            <button
              type="button"
              className="vault-action-btn"
              onClick={handleTriggerImport}
            >
              <FolderInput size={14} />
              <span>匯入備份包 (DASH IN)</span>
            </button>
          </div>
        </div>
      )}

      {/* 1. 成員名單與邀請碼彈窗 */}
      {membersModalOpen && (
        <div className="vault-modal-backdrop">
          <div className="vault-modal-card wide">
            <div className="vault-modal-header">
              <h3>紀錄庫成員與邀請碼（{activeVault}）</h3>
              <button
                type="button"
                className="vault-modal-close-btn"
                onClick={() => setMembersModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="vault-modal-body">
              <label>成員清單（共 {members.length} 人）</label>
              {loadingMembers ? (
                <p className="vault-modal-note">讀取成員中...</p>
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
                  <label>建立邀請碼</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {isOwner ? (
                      <select
                        className="vault-modal-input"
                        style={{ width: 'auto', padding: '6px 10px' }}
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as 'admin' | 'user')}
                      >
                        <option value="user">邀請為 User (一般成員)</option>
                        <option value="admin">邀請為 Admin (管理員)</option>
                      </select>
                    ) : (
                      <span className="vault-modal-note">邀請預設身分：User (一般成員)</span>
                    )}

                    <button
                      type="button"
                      className="vault-btn-primary"
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
                        className="vault-btn-secondary"
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

              {errorMsg && <p className="vault-modal-note danger">{errorMsg}</p>}
            </div>

            <div className="vault-modal-actions">
              <button
                type="button"
                className="vault-btn-secondary"
                onClick={() => setMembersModalOpen(false)}
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. 輸入邀請碼加入既有紀錄庫彈窗 */}
      {joinModalOpen && (
        <div className="vault-modal-backdrop">
          <div className="vault-modal-card">
            <div className="vault-modal-header">
              <h3>憑邀請碼加入紀錄庫</h3>
              <button
                type="button"
                className="vault-modal-close-btn"
                onClick={() => setJoinModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleJoinWithCode}>
              <div className="vault-modal-body">
                <label>邀請碼</label>
                <input
                  type="text"
                  className="vault-modal-input"
                  placeholder="例如：DASH-A1B2C3D4"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                  autoFocus
                />
                <p className="vault-modal-note">
                  請輸入紀錄庫 Owner 或 Admin 產生的專屬邀請碼加入團隊。
                </p>
                {errorMsg && <p className="vault-modal-note danger">{errorMsg}</p>}
              </div>
              <div className="vault-modal-actions">
                <button
                  type="button"
                  className="vault-btn-secondary"
                  onClick={() => setJoinModalOpen(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="vault-btn-primary"
                  disabled={!joinCodeInput.trim() || joiningVault}
                >
                  {joiningVault ? '加入中...' : '確認加入'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. 新建空白 Vault 對話框 */}
      {createModalOpen && (
        <div className="vault-modal-backdrop">
          <div className="vault-modal-card">
            <div className="vault-modal-header">
              <h3>新建空白 Vault</h3>
              <button
                type="button"
                className="vault-modal-close-btn"
                onClick={() => setCreateModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="vault-modal-body">
              <label>Vault 名稱</label>
              <input
                type="text"
                className="vault-modal-input"
                placeholder="例如：2026學生會"
                value={newVaultName}
                onChange={(e) => setNewVaultName(e.target.value)}
                autoFocus
              />
              <label>說明備註 (選填)</label>
              <input
                type="text"
                className="vault-modal-input"
                placeholder="例如：本年度活動與交接專用"
                value={newVaultDesc}
                onChange={(e) => setNewVaultDesc(e.target.value)}
              />
              <p className="vault-modal-note">
                建立完成後將自動成為該紀錄庫唯一 Owner 並切換載入。
              </p>
              {errorMsg && <p className="vault-modal-note danger">{errorMsg}</p>}
            </div>
            <div className="vault-modal-actions">
              <button
                type="button"
                className="vault-btn-secondary"
                onClick={() => setCreateModalOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="vault-btn-primary"
                disabled={!newVaultName.trim() || isLoading}
                onClick={handleConfirmCreate}
              >
                {isLoading ? '建立中...' : '確認建立'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. 重新命名 Vault 對話框 */}
      {renameModalOpen && (
        <div className="vault-modal-backdrop">
          <div className="vault-modal-card">
            <div className="vault-modal-header">
              <h3>重新命名 Vault</h3>
              <button
                type="button"
                className="vault-modal-close-btn"
                onClick={() => setRenameModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="vault-modal-body">
              <label>原名稱：{targetRenameVault}</label>
              <input
                type="text"
                className="vault-modal-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
              />
              {errorMsg && <p className="vault-modal-note danger">{errorMsg}</p>}
            </div>
            <div className="vault-modal-actions">
              <button
                type="button"
                className="vault-btn-secondary"
                onClick={() => setRenameModalOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="vault-btn-primary"
                disabled={!renameValue.trim() || isLoading}
                onClick={handleConfirmRename}
              >
                {isLoading ? '更新中...' : '儲存更名'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. 刪除 Vault 確認對話框 */}
      <ConfirmModal
        isOpen={deleteModalOpen}
        title="確認刪除 Vault"
        message={`確定要永久刪除 Vault「${targetDeleteVault}」嗎？此動作將實體移除所有活動、行程、決策與文件，且只有 Owner 可進行此操作。`}
        confirmText={isLoading ? '刪除中...' : '確定永久刪除'}
        cancelText="取消"
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteModalOpen(false)}
      />

      {/* 6. DASH IN: 匯入 ZIP 確認建立新 Vault 對話框 */}
      {importModalOpen && (
        <div className="vault-modal-backdrop">
          <div className="vault-modal-card">
            <div className="vault-modal-header">
              <h3>DASH IN 資料包匯入確認</h3>
              <button
                type="button"
                className="vault-modal-close-btn"
                onClick={() => setImportModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="vault-modal-body">
              <p className="vault-modal-note">
                系統將會為這份資料包建立一個「全新獨立的 Vault」，不會覆蓋任何現有資料。
              </p>
              {importIsDuplicate && (
                <p className="vault-modal-note danger">
                  提示：本地已存在同名 Vault「{importOriginalName}」，已自動建議後綴名稱以防衝突。
                </p>
              )}
              <label>新 Vault 名稱</label>
              <input
                type="text"
                className="vault-modal-input"
                value={importVaultName}
                onChange={(e) => setImportVaultName(e.target.value)}
                autoFocus
              />
              {errorMsg && <p className="vault-modal-note danger">{errorMsg}</p>}
            </div>
            <div className="vault-modal-actions">
              <button
                type="button"
                className="vault-btn-secondary"
                onClick={() => setImportModalOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="vault-btn-primary"
                disabled={!importVaultName.trim() || isLoading}
                onClick={handleConfirmImport}
              >
                {isLoading ? '匯入中...' : '確認匯入並切換'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

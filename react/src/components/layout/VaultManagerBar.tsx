/**
 * VaultManagerBar.tsx - 側邊欄底部 Vault 控制元件
 *
 * 提供目前使用中 Vault 的常駐顯示、清單切換、新建空白 Vault、
 * 重新命名、刪除防呆確認，以及 DASH IN (匯入 ZIP 建立全新 Vault) 功能。
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
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { vaultApi, VaultItem } from '../../api/vaultApi';
import ConfirmModal from '../common/ConfirmModal';
import './VaultManagerBar.css';

interface VaultManagerBarProps {
  onVaultChanged: () => void;
}

export default function VaultManagerBar({ onVaultChanged }: VaultManagerBarProps) {
  const [vaults, setVaults] = useState<VaultItem[]>([]);
  const [activeVault, setActiveVault] = useState<string>('default');
  const [isPopoverOpen, setIsPopoverOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

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
    } catch (err: any) {
      console.error('載入 Vault 清單失敗:', err);
    }
  };

  useEffect(() => {
    fetchVaults();
  }, []);

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
    } catch (err: any) {
      setErrorMsg(err.message || '切換 Vault 失敗');
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
      await vaultApi.createVault(newVaultName.trim(), newVaultDesc.trim());
      setCreateModalOpen(false);
      await fetchVaults();
      onVaultChanged();
    } catch (err: any) {
      setErrorMsg(err.message || '建立 Vault 失敗');
    } finally {
      setIsLoading(false);
    }
  };

  // 開啟重新命名彈窗
  const handleOpenRename = (e: React.MouseEvent, vault: VaultItem) => {
    e.stopPropagation();
    setIsPopoverOpen(false);
    setTargetRenameVault(vault.name);
    setRenameValue(vault.display_name || vault.name);
    setErrorMsg(null);
    setRenameModalOpen(true);
  };

  // 送出重新命名
  const handleConfirmRename = async () => {
    if (!renameValue.trim() || isLoading) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await vaultApi.renameVault(targetRenameVault, renameValue.trim());
      setRenameModalOpen(false);
      await fetchVaults();
      onVaultChanged();
    } catch (err: any) {
      setErrorMsg(err.message || '重新命名失敗');
    } finally {
      setIsLoading(false);
    }
  };

  // 開啟刪除確認彈窗
  const handleOpenDelete = (e: React.MouseEvent, vault: VaultItem) => {
    e.stopPropagation();
    if (vault.is_active) return;
    setIsPopoverOpen(false);
    setTargetDeleteVault(vault.name);
    setErrorMsg(null);
    setDeleteModalOpen(true);
  };

  // 送出刪除 Vault
  const handleConfirmDelete = async () => {
    if (!targetDeleteVault || isLoading) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await vaultApi.deleteVault(targetDeleteVault);
      setDeleteModalOpen(false);
      await fetchVaults();
    } catch (err: any) {
      setErrorMsg(err.message || '刪除 Vault 失敗');
    } finally {
      setIsLoading(false);
    }
  };

  // DASH IN 觸發：開啟檔案選取器
  const handleTriggerImport = () => {
    setIsPopoverOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // DASH IN 檔案選取後：檢驗 ZIP 並彈窗確認名稱
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setErrorMsg(null);
    try {
      const inspectRes = await vaultApi.inspectZip(file);
      setSelectedZipFile(file);
      const originalName = inspectRes.suggested_name || 'imported_vault';
      setImportOriginalName(originalName);

      // 檢查是否與既有 Vault 同名
      const isDup = vaults.some((v) => v.name.toLowerCase() === originalName.toLowerCase());
      setImportIsDuplicate(isDup);
      setImportVaultName(isDup ? `${originalName}_1` : originalName);
      setImportModalOpen(true);
    } catch (err: any) {
      alert(`資料包檢驗失敗：${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // DASH IN 確認匯入
  const handleConfirmImport = async () => {
    if (!selectedZipFile || !importVaultName.trim() || isLoading) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await vaultApi.importVault(selectedZipFile, importVaultName.trim());
      setImportModalOpen(false);
      setSelectedZipFile(null);
      await fetchVaults();
      onVaultChanged();
    } catch (err: any) {
      setErrorMsg(err.message || '匯入資料包失敗');
    } finally {
      setIsLoading(false);
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
            <span className="vault-trigger-label">Active Vault</span>
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
            {vaults.map((vault) => (
              <div
                key={vault.name}
                className={`vault-item ${vault.is_active ? 'active' : ''}`}
                onClick={() => handleSwitch(vault.name)}
                title={`路徑: ${vault.path}`}
              >
                <div className="vault-item-left">
                  <span className="vault-item-icon">
                    {vault.is_active ? <Check size={14} /> : <Database size={14} />}
                  </span>
                  <div className="vault-item-info">
                    <span className="vault-item-name">{vault.display_name || vault.name}</span>
                    <span className="vault-item-sub">
                      {vault.stats?.activities_count ?? 0} 活動 ·{' '}
                      {Math.round((vault.stats?.data_size_bytes ?? 0) / 1024)} KB
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
                  <button
                    type="button"
                    className="vault-item-btn delete"
                    title={vault.is_active ? '使用中無法刪除' : '刪除此 Vault'}
                    disabled={vault.is_active}
                    onClick={(e) => handleOpenDelete(e, vault)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="vault-popover-divider" />

          <div className="vault-popover-actions">
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
              <span>匯入資料包 (DASH IN)</span>
            </button>
          </div>
        </div>
      )}

      {/* 1. 新建空白 Vault 對話框 */}
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
                建立完成後自動切換載入。
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

      {/* 2. 重新命名 Vault 對話框 */}
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
              <p className="vault-modal-note">
                此動作將同步變更資料夾名稱、dash_manifest.json 身分證與系統設定。
              </p>
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

      {/* 3. 刪除 Vault 確認對話框 (使用系統通用 ConfirmModal，支援自動換行與精緻居中毛玻璃效果) */}
      <ConfirmModal
        isOpen={deleteModalOpen}
        title="確認刪除 Vault"
        message={`確定要永久刪除 Vault「${targetDeleteVault}」嗎？此動作將實體移除該目錄下的所有活動、行程、決策、向量切片與文件，且無法復原。`}
        confirmText={isLoading ? '刪除中...' : '確定永久刪除'}
        cancelText="取消"
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteModalOpen(false)}
      />

      {/* 4. DASH IN: 匯入 ZIP 確認建立新 Vault 對話框 */}
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
                已成功檢驗 dash_manifest.json 專屬身分證！
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

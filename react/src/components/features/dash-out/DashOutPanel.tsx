/**
 * DASH OUT 全量資料導出專用面板 (DashOutPanel.tsx)
 * 專注呈現當前使用中紀錄庫之數據概況卡片，並提供一鍵導出標準備份包。
 */

import React, { useState, useEffect } from 'react';
import {
  Download,
  Database,
  RefreshCw,
  Info,
  Archive,
} from 'lucide-react';
import { VaultBreadcrumb } from '../../layout/VaultBreadcrumb';
import { vaultApi, VaultStats } from '../../../api/vaultApi';
import './DashOutPanel.css';

export interface DashOutPanelProps {
  vaultName?: string;
  onNavigateToHome?: () => void;
  onNavigateToVaultHub?: () => void;
}

export default function DashOutPanel({
  vaultName,
  onNavigateToHome,
  onNavigateToVaultHub,
}: DashOutPanelProps) {
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [activeVaultName, setActiveVaultName] = useState<string>('default');
  const [isLoadingStats, setIsLoadingStats] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [bannerMessage, setBannerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchStats = async () => {
    setIsLoadingStats(true);
    try {
      const activeRes = await vaultApi.getActiveVault();
      setActiveVaultName(activeRes.active_vault);
      setStats(activeRes.stats);
    } catch {
      // 保持靜默或保留既有狀態
    } finally {
      setIsLoadingStats(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const handleExport = async () => {
    setIsExporting(true);
    setBannerMessage(null);
    try {
      const exportUrl = vaultApi.getExportUrl();
      const response = await fetch(exportUrl);
      if (!response.ok) {
        throw new Error(`導出失敗 (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `dash_${activeVaultName}_backup.zip`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename=["']?([^"']+)["']?/);
        if (match && match[1]) {
          filename = decodeURIComponent(match[1]);
        }
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setBannerMessage({
        type: 'success',
        text: `已成功將紀錄庫「${activeVaultName}」打包導出為「${filename}」！`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '導出備份包時發生錯誤';
      setBannerMessage({
        type: 'error',
        text: msg,
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="dash-out-page-root">
      <div className="dash-out-container">
        {/* 1. 麵包屑導航 */}
        <VaultBreadcrumb
          vaultName={vaultName || activeVaultName}
          currentPageTitle="紀錄庫備份"
          onNavigateToHome={onNavigateToHome}
          onNavigateToVaultHub={onNavigateToVaultHub}
          onBack={onNavigateToVaultHub}
        />

        {/* 2. 頂部大卡片 */}
        <header className="dash-out-header-card">
          <div className="dash-out-header-row">
            <div className="dash-out-header-left">
              <div className="dash-out-icon-badge">
                <Archive size={28} />
              </div>
              <div className="dash-out-title-group">
                <h1 className="dash-out-header-title">紀錄庫備份與導出</h1>
                <p className="dash-out-header-desc">
                  將當前紀錄庫「{activeVaultName}」的所有活動紀錄、會議歷程與託管文件完整封裝為標準備份包
                </p>
              </div>
            </div>

            <div className="dash-out-header-actions">
              <button
                className="dash-out-header-btn secondary"
                type="button"
                onClick={fetchStats}
                disabled={isLoadingStats}
                title="重新整理統計數據"
              >
                <RefreshCw size={15} className={isLoadingStats ? 'spin' : ''} />
                <span>重新整理</span>
              </button>
            </div>
          </div>
        </header>

      {/* 訊息橫幅 */}
      {bannerMessage && (
        <div className={`dash-out-banner ${bannerMessage.type}`}>
          <span>{bannerMessage.text}</span>
          <button
            type="button"
            className="close-button"
            onClick={() => setBannerMessage(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* 主卡片：當前紀錄庫概況與導出 */}
      <div className="dash-out-card">
        <div className="dash-out-card-head">
          <h2>
            <Database size={20} color="var(--cyan)" />
            <span>當前紀錄庫：{activeVaultName}</span>
          </h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            統計時間：{stats?.last_updated ? new Date(stats.last_updated).toLocaleTimeString() : '--'}
          </span>
        </div>

        <p className="dash-out-card-desc">
          包含此專案內所有的活動企劃、會議決策、待辦事項、流程行程、突發事件以及所有託管的文件資料。
        </p>

        {/* 筆數統計網格 */}
        <div className="dash-out-stats-grid">
          <div className="dash-out-stat-box">
            <span className="dash-out-stat-label">籌備活動</span>
            <span className="dash-out-stat-value">{stats?.activities_count ?? 0}</span>
          </div>
          <div className="dash-out-stat-box">
            <span className="dash-out-stat-label">會議紀錄</span>
            <span className="dash-out-stat-value">{stats?.meetings_count ?? 0}</span>
          </div>
          <div className="dash-out-stat-box">
            <span className="dash-out-stat-label">決策項目</span>
            <span className="dash-out-stat-value">{stats?.decisions_count ?? 0}</span>
          </div>
          <div className="dash-out-stat-box">
            <span className="dash-out-stat-label">待辦任務</span>
            <span className="dash-out-stat-value">{stats?.tasks_count ?? 0}</span>
          </div>
          <div className="dash-out-stat-box">
            <span className="dash-out-stat-label">流程行程</span>
            <span className="dash-out-stat-value">{stats?.schedules_count ?? 0}</span>
          </div>
          <div className="dash-out-stat-box">
            <span className="dash-out-stat-label">託管文件</span>
            <span className="dash-out-stat-value">{stats?.documents_count ?? 0}</span>
          </div>
        </div>

        {/* 空間容量分佈 */}
        <div className="dash-out-storage-list">
          <div className="dash-out-storage-item">
            <span className="dash-out-storage-dot" />
            <span>託管文件容量：{formatBytes(stats?.markdown_size_bytes ?? 0)}</span>
          </div>
          <div className="dash-out-storage-item" style={{ marginLeft: 'auto', fontWeight: 600 }}>
            <span>紀錄庫總計容量：{formatBytes(stats?.data_size_bytes ?? 0)}</span>
          </div>
        </div>

        {/* 導出按鈕操作區塊 */}
        <div className="dash-out-action-box">
          <div className="dash-out-action-info">
            <span className="dash-out-action-title">打包下載專案備份檔 (.zip)</span>
            <span className="dash-out-action-sub">
              導出的壓縮備份檔可隨時交接給下一屆團隊成員，或在其他部署節點隨時還原匯入。
            </span>
          </div>
          <button
            type="button"
            className="dash-out-btn-primary"
            onClick={handleExport}
            disabled={isExporting}
          >
            <Download size={16} />
            <span>{isExporting ? '打包備份中...' : '下載紀錄庫備份包 (.zip)'}</span>
          </button>
        </div>
      </div>

      {/* 底部說明卡片 */}
      <div className="dash-out-tip-card">
        <Info size={18} className="dash-out-tip-icon" />
        <div className="dash-out-tip-content">
          <span className="dash-out-tip-title">如何還原或匯入備份包 (DASH IN)？</span>
          <span className="dash-out-tip-desc">
            若需載入先前的備份包，可自首頁紀錄庫管理進行備份包匯入。
            系統將會校驗完整性並將其建立為全新專案，絕不會覆蓋您現有的任何資料。
          </span>
        </div>
      </div>
      </div>
    </div>
  );
}

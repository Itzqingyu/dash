/**
 * DashOutPanel.tsx - DASH OUT 全量資料導出專用面板
 *
 * 專注呈現當前使用中 Vault 之數據概況卡片，並提供一鍵導出標準 .zip 資料包。
 */

import React, { useState, useEffect } from 'react';
import {
  Download,
  Database,
  RefreshCw,
  FileText,
  Calendar,
  ListTodo,
  CheckSquare,
  AlertTriangle,
  Bot,
  Info,
} from 'lucide-react';
import { vaultApi, VaultStats } from '../../../api/vaultApi';
import './DashOutPanel.css';

export default function DashOutPanel() {
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
    } catch (err: any) {
      console.error('載入 Vault 統計失敗:', err);
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
        throw new Error(`導出失敗 (${response.status})`);
      }
      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `dash_${activeVaultName}_export.zip`;
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
        text: `已成功將 Vault「${activeVaultName}」打包導出為「${filename}」！`,
      });
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err.message || '導出資料包時發生錯誤',
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="dash-out-page">
      {/* 頂部 Header */}
      <div className="dash-out-header">
        <div>
          <span className="eyebrow">DASH OUT</span>
          <h1>全量資料導出</h1>
          <p>
            將當前 Vault「{activeVaultName}」完整封裝為標準 ZIP 資料包，支援跨電腦移轉與交接備存。
          </p>
        </div>
        <button
          className="button secondary"
          type="button"
          onClick={fetchStats}
          disabled={isLoadingStats}
          title="重新整理統計數據"
        >
          <RefreshCw size={14} className={isLoadingStats ? 'spin' : ''} />
          <span>重新整理</span>
        </button>
      </div>

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

      {/* 主卡片：當前 Vault 概況與導出 */}
      <div className="dash-out-card">
        <div className="dash-out-card-head">
          <h2>
            <Database size={20} color="var(--cyan)" />
            <span>當前使用中紀錄庫：{activeVaultName}</span>
          </h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            最後統計時間：{stats?.last_updated ? new Date(stats.last_updated).toLocaleTimeString() : '--'}
          </span>
        </div>

        <p className="dash-out-card-desc">
          包含此 Vault 內所有的結構化業務資料表（活動、行程、決策、突發事件）、AI 向量檢索索引切塊庫、
          託管 Markdown 文件以及專屬 dash_manifest.json 身分識別檔。
        </p>

        {/* 筆數統計網格 */}
        <div className="dash-out-stats-grid">
          <div className="dash-out-stat-box">
            <span className="dash-out-stat-label">活動總數</span>
            <span className="dash-out-stat-value">{stats?.activities_count ?? 0}</span>
          </div>
          <div className="dash-out-stat-box">
            <span className="dash-out-stat-label">流程行程</span>
            <span className="dash-out-stat-value">{stats?.schedules_count ?? 0}</span>
          </div>
          <div className="dash-out-stat-box">
            <span className="dash-out-stat-label">會議決策</span>
            <span className="dash-out-stat-value">{stats?.decisions_count ?? 0}</span>
          </div>
          <div className="dash-out-stat-box">
            <span className="dash-out-stat-label">突發事件</span>
            <span className="dash-out-stat-value">{stats?.incidents_count ?? 0}</span>
          </div>
          <div className="dash-out-stat-box">
            <span className="dash-out-stat-label">託管文件</span>
            <span className="dash-out-stat-value">{stats?.documents_count ?? 0}</span>
          </div>
          <div className="dash-out-stat-box">
            <span className="dash-out-stat-label">對話會話</span>
            <span className="dash-out-stat-value">{stats?.chat_sessions_count ?? 0}</span>
          </div>
        </div>

        {/* 空間容量分佈 */}
        <div className="dash-out-storage-list">
          <div className="dash-out-storage-item">
            <span className="dash-out-storage-dot" />
            <span>SQLite 資料庫：{formatBytes(stats?.db_size_bytes ?? 0)}</span>
          </div>
          <div className="dash-out-storage-item">
            <span className="dash-out-storage-dot chroma" />
            <span>Chroma 向量庫：{formatBytes(stats?.chroma_size_bytes ?? 0)}</span>
          </div>
          <div className="dash-out-storage-item">
            <span className="dash-out-storage-dot markdown" />
            <span>Markdown 檔案庫：{formatBytes(stats?.markdown_size_bytes ?? 0)}</span>
          </div>
          <div className="dash-out-storage-item" style={{ marginLeft: 'auto', fontWeight: 600 }}>
            <span>Vault 總計容量：{formatBytes(stats?.data_size_bytes ?? 0)}</span>
          </div>
        </div>

        {/* 導出按鈕操作區塊 */}
        <div className="dash-out-action-box">
          <div className="dash-out-action-info">
            <span className="dash-out-action-title">封裝此 Vault 為 .zip</span>
            <span className="dash-out-action-sub">
              導出的 ZIP 檔案包含標準 dash_manifest.json 簽名，可直接交給下一屆或匯入至其他 DASH 軟體中。
            </span>
          </div>
          <button
            type="button"
            className="dash-out-btn-primary"
            onClick={handleExport}
            disabled={isExporting}
          >
            <Download size={16} />
            <span>{isExporting ? '打包導出中...' : '打包導出當前 Vault (.zip)'}</span>
          </button>
        </div>
      </div>

      {/* 底部說明卡片 */}
      <div className="dash-out-tip-card">
        <Info size={18} className="dash-out-tip-icon" />
        <div className="dash-out-tip-content">
          <span className="dash-out-tip-title">如何匯入資料包 (DASH IN)？</span>
          <span className="dash-out-tip-desc">
            若需將他人分享的 .zip 資料包匯入至系統，請使用左下角側邊欄底部的 Vault 選單，點擊「匯入資料包 (DASH IN)」。
            系統將會嚴格驗證身分證，並將其建立為一個全新獨立的 Vault，不會覆蓋您任何現有資料。
          </span>
        </div>
      </div>
    </div>
  );
}

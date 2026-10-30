/**
 * 極簡麵包屑導航組件 (VaultBreadcrumb.tsx)
 * 職責：
 * 在 Level 3 業務面板頂部呈現清晰的樹狀返回路徑：
 * 首頁 > [Vault 名稱] > [當前功能名稱]
 */

import React from 'react';
import { Home } from 'lucide-react';
import './VaultBreadcrumb.css';

interface VaultBreadcrumbProps {
  vaultName: string;
  currentPageTitle: string;
  onNavigateToHome: () => void;
  onNavigateToVaultHub: () => void;
}

export const VaultBreadcrumb: React.FC<VaultBreadcrumbProps> = ({
  vaultName,
  currentPageTitle,
  onNavigateToHome,
  onNavigateToVaultHub,
}) => {
  return (
    <nav className="vault-breadcrumb-bar" aria-label="專案麵包屑導航">
      <button
        type="button"
        className="crumb-nav-btn"
        onClick={onNavigateToHome}
        title="返回所有紀錄庫首頁"
      >
        <Home size={14} />
        <span>首頁</span>
      </button>

      <span className="crumb-separator">/</span>

      <button
        type="button"
        className="crumb-nav-btn"
        onClick={onNavigateToVaultHub}
        title={`返回「${vaultName}」操作介面`}
      >
        <span>{vaultName}</span>
      </button>

      <span className="crumb-separator">/</span>

      <span className="crumb-current-title">{currentPageTitle}</span>
    </nav>
  );
};

export default VaultBreadcrumb;

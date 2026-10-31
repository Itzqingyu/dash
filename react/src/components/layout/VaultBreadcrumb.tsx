/**
/**
 * 全域麵包屑導航組件 (VaultBreadcrumb.tsx)
 * 職責：
 * 在各面板第二層容器頂部呈現清晰的樹狀返回路徑：
 * [<] 首頁 > [Vault 名稱] > [當前功能名稱]（支援多層級擴充）
 */

import React from 'react';
import { Home, ChevronLeft } from 'lucide-react';
import './VaultBreadcrumb.css';

export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
  isActive?: boolean;
}

export interface VaultBreadcrumbProps {
  vaultName?: string;
  currentPageTitle?: string;
  onNavigateToHome?: () => void;
  onNavigateToVaultHub?: () => void;
  onBack?: () => void;
  items?: BreadcrumbItem[];
}

export const VaultBreadcrumb: React.FC<VaultBreadcrumbProps> = ({
  vaultName,
  currentPageTitle,
  onNavigateToHome,
  onNavigateToVaultHub,
  onBack,
  items,
}) => {
  // 如果提供了客製化的 items，直接依照 items 渲染
  if (items && items.length > 0) {
    return (
      <nav className="vault-breadcrumb-nav" aria-label="麵包屑導航">
        {onBack && (
          <button
            type="button"
            className="crumb-back-btn"
            onClick={onBack}
            title="回到上一層級"
          >
            <ChevronLeft size={16} />
          </button>
        )}
        {items.map((item, index) => {
          const isLast = index === items.length - 1 || item.isActive;
          return (
            <React.Fragment key={`${item.label}-${index}`}>
              {index > 0 && <span className="crumb-separator">/</span>}
              {isLast || !item.onClick ? (
                <span className="crumb-current-title">{item.label}</span>
              ) : (
                <button
                  type="button"
                  className="crumb-nav-btn"
                  onClick={item.onClick}
                >
                  {index === 0 && <Home size={14} />}
                  <span>{item.label}</span>
                </button>
              )}
            </React.Fragment>
          );
        })}
      </nav>
    );
  }

  // 預設標準三級麵包屑：[<] 首頁 / [Vault名稱] / [當前功能名稱]
  const handleBack = onBack || onNavigateToVaultHub || onNavigateToHome;

  return (
    <nav className="vault-breadcrumb-nav" aria-label="麵包屑導航">
      {handleBack && (
        <button
          type="button"
          className="crumb-back-btn"
          onClick={handleBack}
          title="回到上一層級"
        >
          <ChevronLeft size={16} />
        </button>
      )}

      {onNavigateToHome && (
        <button
          type="button"
          className="crumb-nav-btn"
          onClick={onNavigateToHome}
          title="返回所有紀錄庫首頁"
        >
          <Home size={14} />
          <span>首頁</span>
        </button>
      )}

      {vaultName && (
        <>
          <span className="crumb-separator">/</span>
          {onNavigateToVaultHub ? (
            <button
              type="button"
              className="crumb-nav-btn"
              onClick={onNavigateToVaultHub}
              title={`返回「${vaultName}」操作主頁`}
            >
              <span>{vaultName}</span>
            </button>
          ) : (
            <span className="crumb-current-title">{vaultName}</span>
          )}
        </>
      )}

      {currentPageTitle && (
        <>
          <span className="crumb-separator">/</span>
          <span className="crumb-current-title">{currentPageTitle}</span>
        </>
      )}
    </nav>
  );
};

export default VaultBreadcrumb;

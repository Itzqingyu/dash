import React from 'react';
import './BreadcrumbNav.css';

interface BreadcrumbNavProps {
  activityName: string;
  currentView: string;
  onNavigate: (view: string) => void;
}

interface CrumbItem {
  label: string;
  view?: string;
  isCurrent?: boolean;
}

export default function BreadcrumbNav({ activityName, currentView, onNavigate }: BreadcrumbNavProps) {
  // 建立動態導航層級
  const crumbs: CrumbItem[] = [
    { label: '活動工作台', view: 'activities' },
  ];

  if (currentView === 'overview') {
    crumbs.push({ label: activityName, isCurrent: true });
  } else {
    // 中間層級：點擊活動名稱切換回總覽
    crumbs.push({ label: activityName, view: 'overview' });

    if (currentView === 'before') {
      crumbs.push({ label: '活動前', isCurrent: true });
    } else if (currentView === 'meeting') {
      crumbs.push({ label: '活動前', view: 'before' });
      crumbs.push({ label: '籌備會議', isCurrent: true });
    } else if (currentView === 'tasks') {
      crumbs.push({ label: '活動前', view: 'before' });
      crumbs.push({ label: '待辦事項', isCurrent: true });
    } else if (currentView === 'decisions') {
      crumbs.push({ label: '活動前', view: 'before' });
      crumbs.push({ label: '決策', isCurrent: true });
    } else if (currentView === 'schedule') {
      crumbs.push({ label: '活動前', view: 'before' });
      crumbs.push({ label: '流程規劃', isCurrent: true });
    } else if (currentView === 'source-record') {
      crumbs.push({ label: '活動前', view: 'before' });
      crumbs.push({ label: '決策', view: 'decisions' });
      crumbs.push({ label: '歷史完整決策紀錄', isCurrent: true });
    } else if (currentView === 'during') {
      crumbs.push({ label: '活動中', isCurrent: true });
    } else if (currentView === 'after') {
      crumbs.push({ label: '活動後', isCurrent: true });
    } else {
      crumbs.push({ label: currentView, isCurrent: true });
    }
  }

  return (
    <nav className="breadcrumb-nav" aria-label="麵包屑導航">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;

        return (
          <React.Fragment key={`${crumb.label}-${index}`}>
            {index > 0 && (
              <span className="breadcrumb-separator" aria-hidden="true">
                &gt;
              </span>
            )}
            {isLast || !crumb.view ? (
              <span className="breadcrumb-item current" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <button
                type="button"
                className="breadcrumb-item link"
                onClick={() => {
                  if (crumb.view) onNavigate(crumb.view);
                }}
              >
                {crumb.label}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

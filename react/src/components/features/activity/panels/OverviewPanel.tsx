import React from 'react';
import type { Activity } from '../../../../types/activity';
import './OverviewPanel.css';

interface OverviewPanelProps {
  currentActivity: Activity;
  currentView: string;
  setCurrentView: (view: string) => void;
  onEdit: () => void;
  onDelete: () => Promise<void> | void;
  deleting: boolean;
  deleteError: string | null;
}

const STATUS_ORDER = ['未開始', '準備中', '進行中', '已完成'];

function formatBudget(value: number | null): string {
  return value == null ? '尚未填寫' : `NT$ ${new Intl.NumberFormat('zh-TW').format(value)}`;
}

function formatDateRange(activity: Activity): string {
  if (!activity.start_date && !activity.end_date) return '日期未定';
  if (activity.start_date === activity.end_date || !activity.end_date) return activity.start_date || activity.end_date || '日期未定';
  return `${activity.start_date || '未定'} ～ ${activity.end_date}`;
}

export default function OverviewPanel({
  currentActivity,
  currentView,
  setCurrentView,
  onEdit,
  onDelete,
  deleting,
  deleteError,
}: OverviewPanelProps) {
  const currentStep = Math.max(0, STATUS_ORDER.indexOf(currentActivity.status));

  return (
    <section className={`view-panel ${currentView === 'overview' ? 'active' : ''}`} data-panel="overview">
      <div className="section-heading compact">
        <div><p className="eyebrow">OVERVIEW</p><h2>活動總覽</h2></div>
        <div className="heading-actions">
          <button className="button secondary" type="button" onClick={onEdit}>編輯活動</button>
          <button className="button danger" type="button" onClick={() => void onDelete()} disabled={deleting}>
            {deleting ? '刪除中…' : '刪除活動'}
          </button>
        </div>
      </div>

      {deleteError && <div className="api-message error" role="alert">{deleteError}</div>}

      <div className="lifecycle-card">
        <div className="lifecycle-head"><strong>活動進度</strong><span>{currentActivity.status}</span></div>
        <div className="lifecycle-track" aria-label={`活動進度：${currentActivity.status}`}>
          {['建立活動', '準備中', '活動執行', '成果檢討'].map((label, index) => (
            <React.Fragment key={label}>
              {index > 0 && <div className={`life-line ${index <= currentStep ? 'done' : ''}`}></div>}
              <div className={`life-step ${index < currentStep ? 'done' : index === currentStep ? 'current' : ''}`}>
                <i>{index < currentStep ? '✓' : index + 1}</i><span>{label}</span>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="info-grid">
        <article className="info-card wide">
          <div className="card-title"><h3>基本資訊</h3><button className="text-button" type="button" onClick={onEdit}>編輯</button></div>
          <dl className="facts">
            <div><dt>年度</dt><dd>{currentActivity.year}</dd></div>
            <div><dt>活動日期</dt><dd>{formatDateRange(currentActivity)}</dd></div>
            <div><dt>地點</dt><dd>{currentActivity.venue || '尚未填寫'}</dd></div>
            <div><dt>活動類型</dt><dd>{currentActivity.activity_type || '尚未填寫'}</dd></div>
            <div><dt>總召</dt><dd>{currentActivity.coordinator || '尚未填寫'}</dd></div>
            <div><dt>預計人數</dt><dd>{currentActivity.expected_attendees == null ? '尚未填寫' : `${currentActivity.expected_attendees} 人`}</dd></div>
            <div><dt>預算</dt><dd>{formatBudget(currentActivity.budget)}</dd></div>
            <div><dt>最後更新</dt><dd>{new Date(currentActivity.updated_at).toLocaleString('zh-TW')}</dd></div>
          </dl>
        </article>

        <article className="info-card progress-card">
          <div className="card-title"><h3>快速操作</h3></div>
          <div className="overview-actions">
            <button className="button secondary" type="button" onClick={() => setCurrentView('meeting')}>管理會議</button>
            <button className="button secondary" type="button" onClick={() => setCurrentView('tasks')}>管理待辦</button>
          </div>
        </article>
      </div>
    </section>
  );
}

import React, { useState } from 'react';
import { RefreshCw, Calendar } from 'lucide-react';
import { VaultBreadcrumb } from '../../layout/VaultBreadcrumb';
import type { Activity } from '../../../types/activity';
import './ActivityListView.css';

const GLYPH_COLORS = ['cyan', 'violet', 'orange', 'pink'];

function getStatusClass(status: string): string {
  if (status === '已完成') return 'completed';
  if (status === '進行中') return 'ongoing';
  if (status === '準備中') return 'preparing';
  return 'not-started';
}

function formatActivityDate(activity: Activity): string {
  if (!activity.start_date && !activity.end_date) return '日期未定';
  if (!activity.end_date || activity.start_date === activity.end_date) {
    return activity.start_date || activity.end_date || '日期未定';
  }
  return `${activity.start_date || '未定'} ～ ${activity.end_date}`;
}

export interface ActivityListViewProps {
  activities: Activity[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelectActivity: (activityId: number) => void;
  onCreateActivity: () => void;
  onOpenQuickAdd: () => void;
  vaultName?: string;
  onNavigateToHome?: () => void;
  onNavigateToVaultHub?: () => void;
}

/**
 * 活動工作台主列表頁面 (ActivityListView)
 * 提供活動總覽統計卡片、即時搜尋過濾、活動列表瀏覽與新增入口
 */
export const ActivityListView: React.FC<ActivityListViewProps> = ({
  activities,
  loading,
  error,
  onRefresh,
  onSelectActivity,
  onCreateActivity,
  onOpenQuickAdd,
  vaultName = 'default',
  onNavigateToHome,
  onNavigateToVaultHub,
}) => {
  const [searchKeyword, setSearchKeyword] = useState('');

  // 搜尋過濾邏輯
  const visibleActivities = activities.filter((activity) => {
    const keyword = searchKeyword.trim().toLocaleLowerCase('zh-TW');
    return !keyword || [activity.name, activity.activity_type, activity.coordinator, activity.venue]
      .some((value) => value?.toLocaleLowerCase('zh-TW').includes(keyword));
  });

  // 統計指標
  const activeCount = activities.filter((activity) => ['準備中', '進行中'].includes(activity.status)).length;
  const completedCount = activities.filter((activity) => activity.status === '已完成').length;
  const archivedCount = completedCount;

  const MIN_ROWS = 6;
  const emptyRowsCount = Math.max(1, MIN_ROWS - visibleActivities.length);

  return (
    <div className="activity-page-root" id="activity-list-view">
      <div className="activity-container">
        {/* 1. 麵包屑導航 */}
        <VaultBreadcrumb
          vaultName={vaultName}
          currentPageTitle="活動工作台"
          onNavigateToHome={onNavigateToHome}
          onNavigateToVaultHub={onNavigateToVaultHub}
          onBack={onNavigateToVaultHub}
        />

        {/* 2. 頂部大卡片 */}
        <header className="activity-header-card">
          <div className="activity-header-row">
            <div className="activity-header-left">
              <div className="activity-icon-badge">
                <Calendar size={28} />
              </div>
              <div className="activity-title-group">
                <h1 className="activity-header-title">活動工作台</h1>
                <p className="activity-header-desc">
                  從籌備、執行到檢討，把每一屆的經驗留下來
                </p>
              </div>
            </div>

            <div className="activity-header-actions">
              <button
                className="activity-header-btn secondary"
                type="button"
                onClick={onRefresh}
                disabled={loading}
                title="重新整理活動清單"
              >
                <RefreshCw size={15} className={loading ? 'spin' : ''} />
                <span>重新整理</span>
              </button>
              <button
                className="activity-header-btn secondary"
                type="button"
                onClick={onOpenQuickAdd}
              >
                + 新增紀錄
              </button>
              <button
                className="activity-header-btn primary"
                id="open-new-activity"
                type="button"
                onClick={onCreateActivity}
              >
                + 新增活動
              </button>
            </div>
          </div>
        </header>

        {/* 3. 活動狀態摘要條 */}
        <div className="summary-strip" aria-label="活動摘要">
          <article>
            <span>全部活動</span>
            <strong>{activities.length}</strong>
            <small>SQLite 中的真實資料</small>
          </article>
          <article>
            <span>正在處理</span>
            <strong>{activeCount}</strong>
            <small>準備中或進行中</small>
          </article>
          <article>
            <span>已完成</span>
            <strong>{completedCount}</strong>
            <small>可進入活動後檢討</small>
          </article>
          <article className="accent-card">
            <span>AI 紀錄庫累積</span>
            <strong>{archivedCount} 份已完成報告</strong>
            <small>成功轉化為組織決策記憶</small>
          </article>
        </div>

        {/* 4. 活動表格與搜尋欄 */}
        <div className="surface">
          <div className="toolbar">
            <div className="year-switch" aria-label="資料來源">
              <strong>全部年度</strong>
            </div>
            <label className="search-field">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder="搜尋活動"
                aria-label="搜尋活動"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
              />
            </label>
          </div>

          {error && <div className="api-message error" role="alert">{error}</div>}
          {loading && <div className="api-state">載入活動中…</div>}
          {!loading && !error && visibleActivities.length === 0 && (
            <div className="api-state empty">
              <h3>沒有活動資料</h3>
              <p>建立第一個活動後即可開始管理會議與待辦。</p>
              <button className="button primary" type="button" onClick={onCreateActivity}>
                新增活動
              </button>
            </div>
          )}

          <div className="table-wrap" hidden={loading || visibleActivities.length === 0}>
            <table className="activity-table">
              <thead>
                <tr>
                  <th>活動</th>
                  <th>日期</th>
                  <th>狀態</th>
                  <th>地點/預算</th>
                  <th>負責人</th>
                  <th><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleActivities.map((activity, index) => (
                  <tr
                    key={activity.id}
                    className="activity-row"
                    tabIndex={0}
                    onClick={() => onSelectActivity(activity.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        onSelectActivity(activity.id);
                      }
                    }}
                  >
                    <td>
                      <span className={`activity-glyph ${GLYPH_COLORS[index % GLYPH_COLORS.length]}`}>
                        {activity.name.charAt(0)}
                      </span>
                      <span>
                        <strong>{activity.name}</strong>
                        <small>
                          {activity.activity_type || '未分類'}・
                          {activity.expected_attendees == null ? '人數未定' : `${activity.expected_attendees} 人`}
                        </small>
                      </span>
                    </td>
                    <td>{formatActivityDate(activity)}</td>
                    <td>
                      <span className={`status ${getStatusClass(activity.status)}`}>
                        {activity.status}
                      </span>
                    </td>
                    <td>
                      <strong>{activity.venue || '地點未定'}</strong>
                      <small>
                        預算 {activity.budget == null ? '未填寫' : new Intl.NumberFormat('zh-TW').format(activity.budget)}
                      </small>
                    </td>
                    <td>
                      <span className="person">{(activity.coordinator || '?').charAt(0)}</span>
                      {activity.coordinator || '未指定'}
                    </td>
                    <td>›</td>
                  </tr>
                ))}

                {Array.from({ length: emptyRowsCount }).map((_, index) => (
                  <tr
                    key={`empty-${index}`}
                    className="activity-row empty-row"
                    aria-hidden="true"
                  >
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActivityListView;

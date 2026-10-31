import React from 'react';
import { Calendar } from 'lucide-react';
import type { Activity } from '../../../types/activity';
import { VaultBreadcrumb, type BreadcrumbItem } from '../../layout/VaultBreadcrumb';
import OverviewPanel from './panels/OverviewPanel';
import BeforePanel from './panels/BeforePanel';
import MeetingPanel from './panels/MeetingPanel';
import TasksPanel from './panels/TasksPanel';
import DecisionsPanel from './panels/DecisionsPanel';
import SchedulePanel from './panels/SchedulePanel';
import DuringPanel from './panels/DuringPanel';
import AfterPanel from './panels/AfterPanel';
import SourceRecordPanel from './panels/SourceRecordPanel';
import './ActivityWorkspace.css';

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

export interface ActivityWorkspaceProps {
  currentActivity: Activity;
  currentView: string;
  meetingVersion: number;
  scheduleVersion: number;
  activityDeleting: boolean;
  activityDeleteError: string | null;
  onNavigate: (view: string) => void;
  onEditActivity: () => void;
  onDeleteActivity: () => void;
  onMeetingsChanged: () => void;
  onSchedulesChanged: () => void;
  onOpenHandover: (aiText: string) => void;
  vaultName?: string;
  onNavigateToHome?: () => void;
  onNavigateToVaultHub?: () => void;
}

/**
 * 單一活動工作台主工作區容器 (ActivityWorkspace)
 * 整合活動詳細資訊頭部、四階段標籤導航、階段子面板渲染與右側模塊快捷導航
 */
export const ActivityWorkspace: React.FC<ActivityWorkspaceProps> = ({
  currentActivity,
  currentView,
  meetingVersion,
  scheduleVersion,
  activityDeleting,
  activityDeleteError,
  onNavigate,
  onEditActivity,
  onDeleteActivity,
  onMeetingsChanged,
  onSchedulesChanged,
  onOpenHandover,
  vaultName = 'default',
  onNavigateToHome,
  onNavigateToVaultHub,
}) => {
  // 動態多級麵包屑：首頁 / [Vault名稱] / 活動工作台 / [活動名稱] / [階段名稱]
  const breadcrumbItems: BreadcrumbItem[] = [
    {
      label: '首頁',
      onClick: onNavigateToHome,
    },
    {
      label: vaultName,
      onClick: onNavigateToVaultHub,
    },
    {
      label: '活動工作台',
      onClick: () => onNavigate('activities'),
    },
  ];

  if (currentView === 'overview') {
    breadcrumbItems.push({
      label: currentActivity.name,
      isActive: true,
    });
  } else {
    breadcrumbItems.push({
      label: currentActivity.name,
      onClick: () => onNavigate('overview'),
    });

    if (currentView === 'before') {
      breadcrumbItems.push({ label: '活動前', isActive: true });
    } else if (['meeting', 'tasks', 'decisions', 'schedule', 'source-record'].includes(currentView)) {
      breadcrumbItems.push({
        label: '活動前',
        onClick: () => onNavigate('before'),
      });
      const subLabels: Record<string, string> = {
        meeting: '籌備會議',
        tasks: '待辦事項',
        decisions: '決策',
        schedule: '流程規劃',
        'source-record': '歷史完整決策紀錄',
      };
      breadcrumbItems.push({
        label: subLabels[currentView] || currentView,
        isActive: true,
      });
    } else if (currentView === 'during') {
      breadcrumbItems.push({ label: '活動中', isActive: true });
    } else if (currentView === 'after') {
      breadcrumbItems.push({ label: '活動後', isActive: true });
    } else {
      breadcrumbItems.push({ label: currentView, isActive: true });
    }
  }

  // 階層式逐級返回
  const handleBack = () => {
    if (['meeting', 'tasks', 'decisions', 'schedule', 'source-record'].includes(currentView)) {
      onNavigate('before');
    } else if (['before', 'during', 'after'].includes(currentView)) {
      onNavigate('overview');
    } else {
      onNavigate('activities');
    }
  };

  return (
    <div className="workspace-page-root" id="activity-workspace">
      <div className="workspace-container">
        {/* 1. 頂部多層級麵包屑導航 */}
        <VaultBreadcrumb
          items={breadcrumbItems}
          onBack={handleBack}
        />

        {/* 2. 頂部大卡片 */}
        <header className="workspace-header-card">
          <div className="workspace-header-row">
            <div className="workspace-header-left">
              <div className="workspace-icon-badge">
                <Calendar size={28} />
              </div>
              <div className="workspace-title-group">
                <div className="workspace-title-row">
                  <h1 className="workspace-header-title">{currentActivity.name}</h1>
                  <span className={`status ${getStatusClass(currentActivity.status)}`}>
                    {currentActivity.status}
                  </span>
                </div>
                <p className="workspace-header-desc">
                  {currentActivity.year} 年度・{formatActivityDate(currentActivity)}・{currentActivity.venue || '地點未定'}・負責人：{currentActivity.coordinator || '未指定'}
                </p>
              </div>
            </div>

            <div className="workspace-header-actions">
              <button
                type="button"
                className="workspace-header-btn secondary"
                onClick={onEditActivity}
              >
                編輯活動
              </button>
              <button
                type="button"
                className="workspace-header-btn danger"
                onClick={onDeleteActivity}
                disabled={activityDeleting}
              >
                刪除活動
              </button>
            </div>
          </div>
        </header>

        {/* 3. 四階段頂部標籤導航 */}
        <nav className="stage-tabs" aria-label="活動階段">
          <button
            className={`stage-tab ${currentView === 'overview' ? 'active' : ''}`}
            type="button"
            onClick={() => onNavigate('overview')}
          >
            <span>01</span>總覽
          </button>
          <button
            className={`stage-tab ${currentView === 'before' ? 'active' : ''}`}
            type="button"
            onClick={() => onNavigate('before')}
          >
            <span>02</span>活動前
          </button>
          <button
            className={`stage-tab ${currentView === 'during' ? 'active' : ''}`}
            type="button"
            onClick={() => onNavigate('during')}
          >
            <span>03</span>活動中
          </button>
          <button
            className={`stage-tab ${currentView === 'after' ? 'active' : ''}`}
            type="button"
            onClick={() => onNavigate('after')}
          >
            <span>04</span>活動後
          </button>
        </nav>

        {/* 4. 工作區內容與右側快捷欄 */}
        <div className="workspace-main">
          <div className="workspace-content">
            {/* 01 總覽 */}
            {currentView === 'overview' && (
              <OverviewPanel
                currentActivity={currentActivity}
                currentView={currentView}
                setCurrentView={onNavigate}
                onEdit={onEditActivity}
                onDelete={onDeleteActivity}
                deleting={activityDeleting}
                deleteError={activityDeleteError}
              />
            )}

            {/* 02 活動前 - 主畫面 */}
            {currentView === 'before' && (
              <BeforePanel
                currentActivity={currentActivity}
                currentView={currentView}
                setCurrentView={onNavigate}
              />
            )}

            {/* 02 活動前 - 籌備會議 */}
            {currentView === 'meeting' && (
              <MeetingPanel
                key={`meeting-${currentActivity.id}`}
                activityId={currentActivity.id}
                activityName={currentActivity.name}
                currentView={currentView}
                setCurrentView={onNavigate}
                onMeetingsChanged={onMeetingsChanged}
              />
            )}

            {/* 02 活動前 - 待辦事項 */}
            {currentView === 'tasks' && (
              <TasksPanel
                key={`tasks-${currentActivity.id}`}
                activityId={currentActivity.id}
                currentView={currentView}
                meetingVersion={meetingVersion}
              />
            )}

            {/* 02 活動前 - 決策 */}
            {currentView === 'decisions' && (
              <DecisionsPanel
                key={`decisions-${currentActivity.id}`}
                activityId={currentActivity.id}
                currentView={currentView}
                meetingVersion={meetingVersion}
              />
            )}

            {/* 02 活動前 - 流程規劃 */}
            {currentView === 'schedule' && (
              <SchedulePanel
                key={`schedule-${currentActivity.id}`}
                activityId={currentActivity.id}
                currentView={currentView}
                meetingVersion={meetingVersion}
                onSchedulesChanged={onSchedulesChanged}
              />
            )}

            {/* 03 活動中 */}
            {currentView === 'during' && (
              <DuringPanel
                key={`during-${currentActivity.id}`}
                activityId={currentActivity.id}
                currentView={currentView}
                setCurrentView={onNavigate}
                scheduleVersion={scheduleVersion}
              />
            )}

            {/* 04 活動後 */}
            {currentView === 'after' && (
              <>
                <AfterPanel
                  currentView={currentView}
                  activityId={currentActivity?.id}
                  scheduleVersion={scheduleVersion}
                  onOpenHandover={onOpenHandover}
                />
                <SourceRecordPanel
                  currentView={currentView}
                  setCurrentView={onNavigate}
                />
              </>
            )}
          </div>

          {/* 右側模塊快捷導航 */}
          <aside className="module-nav" id="activity-module-nav">
            <div className="module-nav-head">
              <p>活動內容</p>
              <button className="module-nav-toggle" id="module-nav-toggle" type="button">›</button>
            </div>
            <button
              className={`module-link ${currentView === 'overview' ? 'active' : ''}`}
              type="button"
              onClick={() => onNavigate('overview')}
            >
              <span>⌂</span><em>總覽</em>
            </button>
            <button
              className={`module-link ${['before', 'meeting', 'tasks', 'decisions', 'schedule'].includes(currentView) ? 'active' : ''}`}
              type="button"
              onClick={() => onNavigate('before')}
            >
              <span>◫</span><em>活動前</em>
            </button>
            <div
              className="module-subnav"
              hidden={!['before', 'meeting', 'tasks', 'decisions', 'schedule'].includes(currentView)}
            >
              <button
                className={currentView === 'meeting' ? 'active' : ''}
                type="button"
                onClick={() => onNavigate('meeting')}
              >
                籌備會議
              </button>
              <button
                className={currentView === 'tasks' ? 'active' : ''}
                type="button"
                onClick={() => onNavigate('tasks')}
              >
                待辦事項
              </button>
              <button
                className={currentView === 'decisions' ? 'active' : ''}
                type="button"
                onClick={() => onNavigate('decisions')}
              >
                決策
              </button>
              <button
                className={currentView === 'schedule' ? 'active' : ''}
                type="button"
                onClick={() => onNavigate('schedule')}
              >
                流程規劃
              </button>
            </div>
            <button
              className={`module-link ${currentView === 'during' ? 'active' : ''}`}
              type="button"
              onClick={() => onNavigate('during')}
            >
              <span>▶</span><em>活動中</em>
            </button>
            <button
              className={`module-link ${currentView === 'after' ? 'active' : ''}`}
              type="button"
              onClick={() => onNavigate('after')}
            >
              <span>◎</span><em>活動後</em>
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default ActivityWorkspace;

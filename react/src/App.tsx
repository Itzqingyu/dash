/**
 * DASH 應用頂層根組件 (App.tsx)
 * 職責：
 * 1. 認證守衛 (Auth Guard)：未登入時自動分發至 HomePage 登入卡片。
 * 2. 視圖路由分發：主頁 (home)、活動列表 (activities)、活動工作區 (overview/stages)、
 *    獨立文件紀錄庫 (documents)、AI 對話 (chat)、會議提煉 (extract)、資料備份 (vault)。
 * 3. 全域資料同步與狀態管理。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { activityApi } from './api/activityApi';
import { vaultApi } from './api/vaultApi';
import { useAuth } from './context/AuthContext';
import type { Activity, ActivityInput } from './types/activity';

// 佈局組件
import AppSidebar from './components/layout/AppSidebar';

// 業務視圖組件
import { HomePage } from './components/features/home/HomePage';
import ActivityListView from './components/features/activity/ActivityListView';
import ActivityWorkspace from './components/features/activity/ActivityWorkspace';
import { DocumentManagementPanel } from './components/features/document-management/DocumentManagementPanel';
import ChatPanel from './components/features/chat/ChatPanel';
import MeetingExtractPanel from './components/features/meeting-extract/MeetingExtractPanel';
import DashOutPanel from './components/features/dash-out/DashOutPanel';

// 彈窗組件
import ActivityFormModal from './components/features/activity/ActivityFormModal';
import ConfirmModal from './components/common/ConfirmModal';
import QuickAddModal from './components/features/activity/QuickAddModal';
import HandoverModal from './components/features/activity/HandoverModal';

export default function App() {
  const { user, isLoading: authLoading } = useAuth();

  // 畫面路由切換 (預設為 activities 活動列表；若切換回首頁則為 home)
  const [currentView, setCurrentView] = useState('activities');
  const [activeVaultName, setActiveVaultName] = useState<string>('default');

  // 活動清單與選取狀態
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<number | null>(null);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);

  // 側邊欄開合狀態
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // 活動編輯/新增彈窗狀態
  const [activityFormOpen, setActivityFormOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [activityFormError, setActivityFormError] = useState<string | null>(null);
  const [activitySaving, setActivitySaving] = useState(false);

  // 活動刪除確認狀態
  const [deleteActivityConfirmOpen, setDeleteActivityConfirmOpen] = useState(false);
  const [activityDeleting, setActivityDeleting] = useState(false);
  const [activityDeleteError, setActivityDeleteError] = useState<string | null>(null);

  // 快速新增紀錄彈窗狀態
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // 交接摘要報告預覽彈窗狀態
  const [handoverModalOpen, setHandoverModalOpen] = useState(false);
  const [handoverSummary, setHandoverSummary] = useState('');

  // 跨子面板資料版本同步計數器
  const [meetingVersion, setMeetingVersion] = useState(0);
  const [scheduleVersion, setScheduleVersion] = useState(0);

  const currentActivity = activities.find((activity) => activity.id === selectedActivityId) ?? null;

  // 載入當前使用中 Vault 資訊
  const loadActiveVault = useCallback(async () => {
    try {
      const res = await vaultApi.getActiveVault();
      if (res.active_vault) {
        setActiveVaultName(res.active_vault);
      }
    } catch {
      // 保持靜默
    }
  }, []);

  // 載入活動清單
  const loadActivities = useCallback(() => {
    if (!user) {
      setActivities([]);
      setActivitiesLoading(false);
      return;
    }
    setActivitiesLoading(true);
    setActivitiesError(null);
    activityApi
      .listActivities()
      .then((rows) => {
        setActivities(rows);
        setSelectedActivityId((current) =>
          current != null && rows.some((item) => item.id === current) ? current : null
        );
      })
      .catch((requestError: Error) => {
        setActivitiesError(requestError.message);
      })
      .finally(() => {
        setActivitiesLoading(false);
      });
  }, [user]);

  useEffect(() => {
    if (user) {
      loadActiveVault();
      loadActivities();
    }
  }, [user, loadActiveVault, loadActivities]);

  // 當切換回活動工作台或總覽時，重新載入活動清單確保狀態最新
  useEffect(() => {
    if (user && (currentView === 'activities' || currentView === 'overview')) {
      loadActivities();
    }
  }, [currentView, user, loadActivities]);

  // 封裝切換畫面小函式：點擊切換頁面時自動收起側邊欄
  const handleSetView = (view: string, activityId?: number) => {
    if (activityId !== undefined) {
      setSelectedActivityId(activityId);
    }
    setCurrentView(view);
    setIsSidebarOpen(false);
  };

  // 切換或重設 Vault 後更新狀態
  const handleVaultChanged = () => {
    setSelectedActivityId(null);
    loadActiveVault();
    loadActivities();
    setScheduleVersion((v) => v + 1);
    setMeetingVersion((v) => v + 1);
  };

  // 點擊選擇活動並進入總覽
  const handleSelectActivity = (activityId: number) => {
    setSelectedActivityId(activityId);
    setActivityFormOpen(false);
    setEditingActivity(null);
    setActivityFormError(null);
    setActivityDeleteError(null);
    handleSetView('overview', activityId);
  };

  // 開啟建立活動彈窗
  const openCreateActivity = () => {
    setEditingActivity(null);
    setActivityFormError(null);
    setActivityFormOpen(true);
  };

  // 開啟編輯活動彈窗
  const openEditActivity = () => {
    if (!currentActivity) return;
    setEditingActivity(currentActivity);
    setActivityFormError(null);
    setActivityFormOpen(true);
  };

  // 儲存活動 (新增或更新)
  const saveActivity = async (payload: ActivityInput) => {
    setActivitySaving(true);
    setActivityFormError(null);
    try {
      if (editingActivity) {
        const updated = await activityApi.updateActivity(editingActivity.id, payload);
        setActivities((current) =>
          current.map((activity) => (activity.id === updated.id ? updated : activity))
        );
      } else {
        const created = await activityApi.createActivity(payload);
        setActivities((current) => [created, ...current]);
        setSelectedActivityId(created.id);
        setCurrentView('overview');
      }
      setActivityFormOpen(false);
      setEditingActivity(null);
    } catch (requestError) {
      setActivityFormError(
        requestError instanceof Error ? requestError.message : '活動儲存失敗'
      );
    } finally {
      setActivitySaving(false);
    }
  };

  // 確認刪除當前活動
  const handleConfirmDeleteActivity = async () => {
    if (!currentActivity) return;
    setDeleteActivityConfirmOpen(false);
    setActivityDeleting(true);
    setActivityDeleteError(null);
    try {
      await activityApi.deleteActivity(currentActivity.id);
      setActivities((current) =>
        current.filter((activity) => activity.id !== currentActivity.id)
      );
      setSelectedActivityId(null);
      setCurrentView('activities');
    } catch (requestError) {
      setActivityDeleteError(
        requestError instanceof Error ? requestError.message : '活動刪除失敗'
      );
    } finally {
      setActivityDeleting(false);
    }
  };

  // 處理快速新增目標跳轉
  const handleQuickAddTarget = (activityId: number, targetView: string) => {
    setSelectedActivityId(activityId);
    setCurrentView(targetView);
  };

  // 處理開啟交接摘要預覽
  const handleOpenHandover = (aiText: string) => {
    setHandoverSummary(aiText);
    setHandoverModalOpen(true);
  };

  // 判定是否為活動專屬工作台（階段導航）
  const isWorkspaceActive =
    currentActivity != null &&
    !['home', 'activities', 'documents', 'chat', 'extract', 'vault'].includes(currentView);

  // 1. 若系統正在確認登入狀態，顯示簡約載入畫面
  if (authLoading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--canvas)',
          color: 'var(--ink-soft)',
          fontWeight: 600,
        }}
      >
        <span>載入 DASH 系統認證中...</span>
      </div>
    );
  }

  // 2. 若使用者尚未登入，一律顯示 HomePage 進行身分驗證
  if (!user) {
    return (
      <HomePage
        activeVaultName={activeVaultName}
        onEnterWorkspace={() => handleSetView('activities')}
        onVaultChange={(newVault) => {
          setActiveVaultName(newVault);
          handleVaultChanged();
        }}
      />
    );
  }

  // 3. 使用者已登入且選擇造訪主頁視圖
  if (currentView === 'home') {
    return (
      <HomePage
        activeVaultName={activeVaultName}
        onEnterWorkspace={() => handleSetView('activities')}
        onVaultChange={(newVault) => {
          setActiveVaultName(newVault);
          handleVaultChanged();
        }}
      />
    );
  }

  // 4. 使用者已登入並進入工作台 Shell
  return (
    <>
      <div className={`app-shell ${!isSidebarOpen ? 'sidebar-closed' : ''}`}>
        {/* 全域導航側邊欄 */}
        <AppSidebar
          currentView={currentView}
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen((prev) => !prev)}
          onNavigate={(view) => handleSetView(view)}
          onVaultChanged={handleVaultChanged}
        />

        {/* 主工作內容區 */}
        <main
          className={`main ${['chat', 'extract'].includes(currentView) ? 'chat-mode' : ''}`}
          id="main-content"
        >
          {/* 4.1 活動列表工作台首頁 */}
          {currentView === 'activities' && (
            <ActivityListView
              activities={activities}
              loading={activitiesLoading}
              error={activitiesError}
              onRefresh={loadActivities}
              onSelectActivity={handleSelectActivity}
              onCreateActivity={openCreateActivity}
              onOpenQuickAdd={() => setQuickAddOpen(true)}
            />
          )}

          {/* 4.2 活動詳細四階段工作區 */}
          {isWorkspaceActive && (
            <ActivityWorkspace
              currentActivity={currentActivity}
              currentView={currentView}
              meetingVersion={meetingVersion}
              scheduleVersion={scheduleVersion}
              activityDeleting={activityDeleting}
              activityDeleteError={activityDeleteError}
              onNavigate={(view) => setCurrentView(view)}
              onEditActivity={openEditActivity}
              onDeleteActivity={() => setDeleteActivityConfirmOpen(true)}
              onMeetingsChanged={() => setMeetingVersion((v) => v + 1)}
              onSchedulesChanged={() => setScheduleVersion((v) => v + 1)}
              onOpenHandover={handleOpenHandover}
            />
          )}

          {/* 4.3 獨立文件紀錄庫管理視圖 */}
          {currentView === 'documents' && <DocumentManagementPanel />}

          {/* 4.4 LLM 聊天大面板視圖 */}
          {currentView === 'chat' && <ChatPanel />}

          {/* 4.5 AI 會議紀錄整理視圖 (常駐掛載避免切換面板時預覽資料遺失) */}
          <MeetingExtractPanel hidden={currentView !== 'extract'} />

          {/* 4.6 DASH OUT 本地交接導出視圖 */}
          {currentView === 'vault' && <DashOutPanel />}
        </main>
      </div>

      {/* 活動建立/編輯彈窗 */}
      {activityFormOpen && (
        <ActivityFormModal
          activity={editingActivity}
          submitting={activitySaving}
          error={activityFormError}
          onCancel={() => {
            if (!activitySaving) setActivityFormOpen(false);
          }}
          onSubmit={saveActivity}
        />
      )}

      {/* 快速新增紀錄彈窗 */}
      <QuickAddModal
        isOpen={quickAddOpen}
        activities={activities}
        onClose={() => setQuickAddOpen(false)}
        onSelectTarget={handleQuickAddTarget}
      />

      {/* 交接摘要預覽彈窗 */}
      <HandoverModal
        isOpen={handoverModalOpen}
        currentActivity={currentActivity}
        handoverSummary={handoverSummary}
        onClose={() => setHandoverModalOpen(false)}
      />

      {/* 刪除活動確認對話框 */}
      <ConfirmModal
        isOpen={deleteActivityConfirmOpen}
        title="確認刪除活動"
        message={`確定刪除「${currentActivity?.name}」？有會議或待辦時後端會拒絕刪除。`}
        confirmText="確認刪除"
        cancelText="取消"
        isDanger={true}
        onConfirm={handleConfirmDeleteActivity}
        onCancel={() => setDeleteActivityConfirmOpen(false)}
      />

      <div className="toast" id="toast" role="status" aria-live="polite" />
    </>
  );
}

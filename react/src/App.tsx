/**
 * DASH 應用頂層根組件 (App.tsx)
 * 職責：
 * 全新階層化路由分發與全域狀態管理：
 * 1. 認證守衛 (Level 0)：未登入時分發至極簡置中的 AuthPage。
 * 2. 根層級 (Level 1)：登入後一律首頁 (home) 開局，展示帳戶條與 Vault 卡片。
 * 3. Vault 入口層 (Level 2)：點擊卡片進入 VaultHubPage，展示大大 Vault 名稱、成員設定與 5 大功能前往按鈕。
 * 4. 業務面板層 (Level 3)：活動工作台、文件紀錄庫、智能對話、會議提煉、紀錄庫備份。
 *    頂部嵌入極簡 VaultBreadcrumb 麵包屑導航，隨時一鍵返回 Vault Hub 或根首頁。
 *    全域徹底移除 Sidebar、Header 與 Footer。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { activityApi } from './api/activityApi';
import { vaultApi } from './api/vaultApi';
import { useAuth } from './context/AuthContext';
import type { Activity, ActivityInput } from './types/activity';

// 認證層與導覽組件
import { AuthPage } from './components/features/auth/AuthPage';
import { HomePage } from './components/features/home/HomePage';
import { VaultHubPage } from './components/features/vault-hub/VaultHubPage';

// Level 3 業務面板組件
import ActivityListView from './components/features/activity/ActivityListView';
import ActivityWorkspace from './components/features/activity/ActivityWorkspace';
import { DocumentManagementPanel } from './components/features/document-management/DocumentManagementPanel';
import ChatPanel from './components/features/chat/ChatPanel';
import MeetingExtractPanel from './components/features/meeting-extract/MeetingExtractPanel';
import DashOutPanel from './components/features/dash-out/DashOutPanel';

// 活動相關彈窗組件
import ActivityFormModal from './components/features/activity/ActivityFormModal';
import ConfirmModal from './components/common/ConfirmModal';
import QuickAddModal from './components/features/activity/QuickAddModal';
import HandoverModal from './components/features/activity/HandoverModal';

export default function App() {
  const { user, isLoading: authLoading } = useAuth();

  // 畫面路由切換 (初始一律首頁 home 開局，絕不預設進入上次工作台)
  const [currentView, setCurrentView] = useState<string>('home');
  const [activeVaultName, setActiveVaultName] = useState<string>('default');
  const [activeVaultId, setActiveVaultId] = useState<string>('v_default');

  // 活動清單與選取狀態
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<number | null>(null);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);

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
        setActiveVaultName(res.display_name || res.active_vault);
      }
      if (res.vault_id) {
        setActiveVaultId(res.vault_id);
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

  // 切換或重設 Vault 後更新狀態
  const handleVaultChanged = useCallback(() => {
    setSelectedActivityId(null);
    loadActiveVault();
    loadActivities();
    setScheduleVersion((v) => v + 1);
    setMeetingVersion((v) => v + 1);
  }, [loadActiveVault, loadActivities]);

  // 當切換回活動工作台或總覽時，重新載入活動清單確保狀態最新
  useEffect(() => {
    if (user && (currentView === 'activities' || currentView === 'overview')) {
      loadActivities();
    }
  }, [currentView, user, loadActivities]);

  // 監聽紀錄庫被刪除事件，強制正在使用該紀錄庫的使用者退回首頁
  useEffect(() => {
    const handleVaultKicked = (e: Event) => {
      if (currentView !== 'home') {
        const customEvt = e as CustomEvent<{ message?: string }>;
        const msg = customEvt.detail?.message || '您正在瀏覽的紀錄庫已被刪除，系統將返回首頁。';
        alert(msg);
        setActiveVaultName('default');
        setActiveVaultId('v_default');
        handleVaultChanged();
        setCurrentView('home');
      }
    };
    window.addEventListener('dash:vault-kicked', handleVaultKicked);
    return () => window.removeEventListener('dash:vault-kicked', handleVaultKicked);
  }, [currentView, handleVaultChanged]);

  // 定期檢測當前紀錄庫存續狀態（每 4 秒或視窗重新獲得焦點時），若被其他使用者刪除則強制退出
  useEffect(() => {
    if (!user || currentView === 'home' || activeVaultId === 'v_default') {
      return;
    }

    const checkVaultSurvival = async () => {
      try {
        const list = await vaultApi.listVaults();
        const exists = list.some((v) => v.vault_id === activeVaultId);
        if (!exists) {
          alert('您正在使用的紀錄庫已被刪除，系統已強制退出並返回首頁。');
          setActiveVaultName('default');
          setActiveVaultId('v_default');
          handleVaultChanged();
          setCurrentView('home');
        }
      } catch {
        // 保持靜默
      }
    };

    const intervalId = setInterval(checkVaultSurvival, 4000);
    window.addEventListener('focus', checkVaultSurvival);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', checkVaultSurvival);
    };
  }, [user, currentView, activeVaultId, handleVaultChanged]);

  // 切換畫面
  const handleSetView = (view: string, activityId?: number) => {
    if (activityId !== undefined) {
      setSelectedActivityId(activityId);
    }
    setCurrentView(view);
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
    !['home', 'vault-hub', 'activities', 'documents', 'chat', 'extract', 'vault'].includes(currentView);



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

  // 2. Level 0 認證守衛：若使用者尚未登入，顯示純淨專屬的 AuthPage
  if (!user) {
    return <AuthPage />;
  }

  // 3. Level 1 根層級：首頁儀表板 (HomePage)
  if (currentView === 'home') {
    return (
      <HomePage
        activeVaultName={activeVaultName}
        activeVaultId={activeVaultId}
        onEnterVaultHub={(targetVaultId, targetVaultName) => {
          setActiveVaultId(targetVaultId);
          setActiveVaultName(targetVaultName || targetVaultId);
          handleVaultChanged();
          setCurrentView('vault-hub');
        }}
        onVaultListChanged={handleVaultChanged}
      />
    );
  }

  // 4. Level 2 Vault 入口層：特定紀錄庫專屬操作中樞 (VaultHubPage)
  if (currentView === 'vault-hub') {
    return (
      <VaultHubPage
        vaultName={activeVaultName}
        vaultId={activeVaultId}
        onNavigateToHome={() => setCurrentView('home')}
        onNavigateToView={(view) => handleSetView(view)}
        onVaultRenamed={(newName) => {
          setActiveVaultName(newName);
          handleVaultChanged();
        }}
        onVaultDeleted={() => {
          setActiveVaultName('default');
          setActiveVaultId('v_default');
          handleVaultChanged();
          setCurrentView('home');
        }}
      />
    );
  }

  // 5. Level 3 具體業務面板層 (各面板自帶置中兩側留白與專屬麵包屑導航)
  return (
    <>
      <div className="app-shell" style={{ display: 'flex', flexDirection: 'column' }}>
        <main
          className="main"
          id="main-content"
          style={{ flex: 1 }}
        >
          {/* 5.1 活動列表工作台 */}
          {currentView === 'activities' && (
            <ActivityListView
              activities={activities}
              loading={activitiesLoading}
              error={activitiesError}
              onRefresh={loadActivities}
              onSelectActivity={handleSelectActivity}
              onCreateActivity={openCreateActivity}
              onOpenQuickAdd={() => setQuickAddOpen(true)}
              vaultName={activeVaultName}
              onNavigateToHome={() => setCurrentView('home')}
              onNavigateToVaultHub={() => setCurrentView('vault-hub')}
            />
          )}

          {/* 5.2 活動詳細四階段工作區 */}
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
              vaultName={activeVaultName}
              onNavigateToHome={() => setCurrentView('home')}
              onNavigateToVaultHub={() => setCurrentView('vault-hub')}
            />
          )}

          {/* 5.3 獨立文件紀錄庫管理視圖 */}
          {currentView === 'documents' && (
            <DocumentManagementPanel
              vaultName={activeVaultName}
              onNavigateToHome={() => setCurrentView('home')}
              onNavigateToVaultHub={() => setCurrentView('vault-hub')}
            />
          )}

          {/* 5.4 LLM 聊天大面板視圖 */}
          {currentView === 'chat' && (
            <ChatPanel
              vaultName={activeVaultName}
              onNavigateToHome={() => setCurrentView('home')}
              onNavigateToVaultHub={() => setCurrentView('vault-hub')}
            />
          )}

          {/* 5.5 AI 會議紀錄整理視圖 (常駐掛載避免切換面板時預覽資料遺失) */}
          <MeetingExtractPanel
            hidden={currentView !== 'extract'}
            vaultName={activeVaultName}
            onNavigateToHome={() => setCurrentView('home')}
            onNavigateToVaultHub={() => setCurrentView('vault-hub')}
          />

          {/* 5.6 DASH OUT 本地交接導出視圖 */}
          {currentView === 'vault' && (
            <DashOutPanel
              vaultName={activeVaultName}
              onNavigateToHome={() => setCurrentView('home')}
              onNavigateToVaultHub={() => setCurrentView('vault-hub')}
            />
          )}
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

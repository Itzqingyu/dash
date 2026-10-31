import React, { useEffect, useMemo, useState } from 'react';
import { activityApi } from '../../../../api/activityApi';
import type { Meeting, Task, TaskInput, TaskPriority, TaskStatus } from '../../../../types/activity';
import ConfirmModal from '../../../common/ConfirmModal';
import './TasksPanel.css';

interface TasksPanelProps {
  activityId: number;
  currentView: string;
  meetingVersion: number;
}

interface TaskFormState {
  content: string;
  assignee: string;
  due_date: string;
  priority: TaskPriority;
  status: TaskStatus;
  meeting_id: string;
}

const EMPTY_FORM: TaskFormState = {
  content: '',
  assignee: '',
  due_date: '',
  priority: '中',
  status: 'pending',
  meeting_id: '',
};

function formFromTask(task: Task): TaskFormState {
  return {
    content: task.content,
    assignee: task.assignee,
    due_date: task.due_date,
    priority: task.priority,
    status: task.status,
    meeting_id: task.meeting_id == null ? '' : String(task.meeting_id),
  };
}

function priorityClass(priority: TaskPriority): string {
  if (priority === '高') return 'high';
  if (priority === '中') return 'medium';
  return 'low';
}

export default function TasksPanel({ activityId, currentView, meetingVersion }: TasksPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [filter, setFilter] = useState<'all' | TaskStatus>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);
  const priorityWeight: Record<string, number> = { '高': 3, '中': 2, '低': 1 };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setTasks([]);
    setMeetings([]);
    setFormMode(null);
    setEditingTaskId(null);
    setForm(EMPTY_FORM);

    Promise.all([activityApi.listTasks(activityId), activityApi.listMeetings(activityId)])
      .then(([taskRows, meetingRows]) => {
        if (!active) return;
        setTasks(taskRows);
        setMeetings(meetingRows);
      })
      .catch((requestError: Error) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [activityId, meetingVersion]);

  const meetingNames = useMemo(
    () => new Map(meetings.map((meeting) => [meeting.id, meeting.name])),
    [meetings],
  );
  const visibleTasks = filter === 'all' ? tasks : tasks.filter((task) => task.status === filter);
  const pendingTasks = visibleTasks.filter((task) => task.status === 'pending');
  const completedTasks = visibleTasks.filter((task) => task.status === 'completed');

  const closeForm = () => {
    if (saving) return;
    setFormMode(null);
    setEditingTaskId(null);
    setFormError(null);
    setForm(EMPTY_FORM);
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingTaskId(null);
    setFormError(null);
    setFormMode('create');
  };

  const openEdit = (task: Task) => {
    setForm(formFromTask(task));
    setEditingTaskId(task.id);
    setFormError(null);
    setFormMode('edit');
  };

  const setField = <K extends keyof TaskFormState>(field: K, value: TaskFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    const payload: TaskInput = {
      activity_id: activityId,
      meeting_id: form.meeting_id ? Number(form.meeting_id) : null,
      content: form.content.trim(),
      assignee: form.assignee.trim(),
      due_date: form.due_date,
      priority: form.priority,
      status: form.status,
    };

    try {
      if (formMode === 'edit' && editingTaskId != null) {
        const updated = await activityApi.updateTask(editingTaskId, payload);
        setTasks((current) => current.map((task) => task.id === updated.id ? updated : task));
      } else {
        const created = await activityApi.createTask(payload);
        setTasks((current) => [created, ...current]);
      }
      setFormMode(null);
      setEditingTaskId(null);
      setForm(EMPTY_FORM);
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : '待辦儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (task: Task) => {
    const nextStatus: TaskStatus = task.status === 'completed' ? 'pending' : 'completed';
    setBusyTaskId(task.id);
    setError(null);
    try {
      const updated = await activityApi.updateTask(task.id, { status: nextStatus });
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '狀態更新失敗');
    } finally {
      setBusyTaskId(null);
    }
  };

  const [taskPendingDelete, setTaskPendingDelete] = useState<Task | null>(null);

  const handleDelete = (task: Task) => {
    setTaskPendingDelete(task);
  };

  const handleConfirmDelete = async () => {
    if (!taskPendingDelete) return;
    const task = taskPendingDelete;
    setTaskPendingDelete(null);
    setBusyTaskId(task.id);
    setError(null);
    try {
      await activityApi.deleteTask(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '待辦刪除失敗');
    } finally {
      setBusyTaskId(null);
    }
  };

  const renderTask = (task: Task) => (
    <div className={`task-card ${task.status === 'completed' ? 'completed' : ''}`} data-status={task.status} key={task.id}>
      <div>
        <span className={`priority ${priorityClass(task.priority)}`}>{task.priority}</span>
        <button className={`task-check ${task.status === 'completed' ? 'checked' : ''}`} type="button" aria-label={task.status === 'completed' ? '標記為未完成' : '標記完成'} onClick={() => void toggleStatus(task)} disabled={busyTaskId === task.id}></button>
      </div>
      <h3>{task.content}</h3>
      <p>{task.assignee || '未指定負責人'}{task.due_date ? `・期限 ${task.due_date}` : '・無期限'}</p>
      <small>來源：{task.meeting_id == null ? '未綁定會議' : meetingNames.get(task.meeting_id) || `會議 #${task.meeting_id}`}</small>
      <div className="card-actions"><button className="text-button" type="button" onClick={() => openEdit(task)}>編輯</button><button className="text-button danger-text" type="button" onClick={() => void handleDelete(task)} disabled={busyTaskId === task.id}>刪除</button></div>
    </div>
  );

  // 把這段邏輯放在 return (...) 之前
  const sortedPendingTasks = [...pendingTasks].sort((a, b) => {
    // --- 第 1 關：比較時限 ---
    // 寫一個小幫手來處理日期：如果是空值、"無期限"或無法解析，就給它無限大(Infinity)排到最後面
    const getTime = (dateStr?: string | null) => {
      if (!dateStr || dateStr === '無期限') return Infinity;
      const time = new Date(dateStr).getTime();
      return isNaN(time) ? Infinity : time;
    };

    const timeA = getTime(a.due_date);
    const timeB = getTime(b.due_date);

    // 如果兩者的期限不同天，就直接依期限由近到遠排 (升冪)
    if (timeA !== timeB) {
      return timeA - timeB; 
    }

    // --- 第 2 關：時限同一天時，比較重要性 ---
    const weightA = priorityWeight[a.priority] || 0;
    const weightB = priorityWeight[b.priority] || 0;
    
    // 重要性分數高的排前面 (降冪，所以是 B - A)
    return weightB - weightA;
  });

  return (
    <section className={`view-panel ${currentView === 'tasks' ? 'active' : ''}`} data-panel="tasks">
      <div className="section-heading"><div><p className="eyebrow">TASKS</p><h2>待辦事項</h2><p className="task-header-desc">待辦只顯示目前 Activity 的資料，會議關聯可留空。</p></div><button className="button primary task-add-btn" type="button" onClick={openCreate}>＋ 新增待辦</button></div>
      {error && <div className="api-message error" role="alert">{error}</div>}
      {loading && <div className="api-state">載入待辦中…</div>}

      {!loading && (
        <>
          <div className="filter-row">
            <button className={`filter ${filter === 'all' ? 'active' : ''}`} type="button" onClick={() => setFilter('all')}>全部 {tasks.length}</button>
            <button className={`filter ${filter === 'pending' ? 'active' : ''}`} type="button" onClick={() => setFilter('pending')}>未完成 {tasks.filter((task) => task.status === 'pending').length}</button>
            <button className={`filter ${filter === 'completed' ? 'active' : ''}`} type="button" onClick={() => setFilter('completed')}>已完成 {tasks.filter((task) => task.status === 'completed').length}</button>
          </div>

          {visibleTasks.length === 0 ? (
            <div className="api-state empty"><h3>目前沒有符合條件的待辦</h3><p>新增待辦後會顯示在這裡。</p></div>
          ) : (
            <div className="task-board two-columns">
              {(filter === 'all' || filter === 'pending') && (
                <article className="task-column">
                  <div className="column-title">
                    {/* 注意：這裡的總數還是用 pendingTasks.length 沒問題 */}
                    <span>未完成</span><b>{pendingTasks.length}</b>
                  </div>
                  {/* 👇 關鍵修改：把它換成排好序的陣列 👇 */}
                  {sortedPendingTasks.map(renderTask)}
                </article>
              )}
              
              {(filter === 'all' || filter === 'completed') && (
                <article className="task-column">
                  <div className="column-title">
                    <span>已完成</span><b>{completedTasks.length}</b>
                  </div>
                  {/* (如果「已完成」的區塊你也想排序，也可以依樣畫葫蘆做一個 sortedCompletedTasks 放進來) */}
                  {completedTasks.map(renderTask)}
                </article>
              )}
            </div>
          )}
        </>
      )}

      {formMode && (
        <div className="activity-modal-backdrop" role="presentation" onMouseDown={closeForm}>
          <section className="activity-data-modal" role="dialog" aria-modal="true" aria-labelledby="task-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <form onSubmit={handleSubmit}>
              <div className="modal-head"><div><p className="eyebrow">TASK</p><h2 id="task-form-title">{formMode === 'create' ? '新增待辦' : '編輯待辦'}</h2></div><button className="close-button" type="button" onClick={closeForm}>×</button></div>
              {formError && <div className="api-message error" role="alert">{formError}</div>}
              <label className="field"><span>待辦內容</span><input value={form.content} onChange={(event) => setField('content', event.target.value)} required /></label>
              <div className="two-fields"><label className="field"><span>負責人</span><input value={form.assignee} onChange={(event) => setField('assignee', event.target.value)} /></label><label className="field"><span>期限</span><input type="date" value={form.due_date} onChange={(event) => setField('due_date', event.target.value)} /></label></div>
              <div className="two-fields">
                <label className="field"><span>優先級</span><select value={form.priority} onChange={(event) => setField('priority', event.target.value as TaskPriority)}><option value="高">高</option><option value="中">中</option><option value="低">低</option></select></label>
                <label className="field"><span>狀態</span><select value={form.status} onChange={(event) => setField('status', event.target.value as TaskStatus)}><option value="pending">未完成</option><option value="completed">已完成</option></select></label>
              </div>
              <label className="field"><span>所屬會議（選填）</span><select value={form.meeting_id} onChange={(event) => setField('meeting_id', event.target.value)}><option value="">不綁定會議</option>{meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.name}{meeting.date ? `・${meeting.date}` : ''}</option>)}</select></label>
              <div className="modal-actions"><button className="button secondary" type="button" onClick={closeForm}>取消</button><button className="button primary" type="submit" disabled={saving}>{saving ? '儲存中…' : '儲存待辦'}</button></div>
            </form>
          </section>
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(taskPendingDelete)}
        title="確認刪除待辦"
        message={`確定刪除待辦「${taskPendingDelete?.content}」？`}
        confirmText="確認刪除"
        cancelText="取消"
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setTaskPendingDelete(null)}
      />
    </section>
  );
}

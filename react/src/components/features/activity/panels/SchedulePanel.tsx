import React, { useEffect, useMemo, useState } from 'react';
import { activityApi } from '../../../../api/activityApi';
import type { Meeting, Schedule, ScheduleInput } from '../../../../types/activity';
import ConfirmModal from '../../../common/ConfirmModal';
import './SchedulePanel.css';

interface SchedulePanelProps {
  activityId: number;
  currentView: string;
  meetingVersion: number;
  onSchedulesChanged: () => void;
}

interface ScheduleFormState {
  meeting_id: string;
  name: string;
  start_time: string;
  end_time: string;
  location: string;
  owner: string;
  notes: string;
  category: string;
}

const EMPTY_FORM: ScheduleFormState = {
  meeting_id: '',
  name: '',
  start_time: '',
  end_time: '',
  location: '',
  owner: '',
  notes: '',
  category: '',
};

function toDateTimeInput(value: string | null): string {
  return value ? value.replace(' ', 'T').slice(0, 16) : '';
}

function formFromSchedule(schedule: Schedule): ScheduleFormState {
  return {
    meeting_id: schedule.meeting_id == null ? '' : String(schedule.meeting_id),
    name: schedule.name,
    start_time: toDateTimeInput(schedule.start_time),
    end_time: toDateTimeInput(schedule.end_time),
    location: schedule.location,
    owner: schedule.owner,
    notes: schedule.notes,
    category: schedule.category,
  };
}

export default function SchedulePanel({ activityId, currentView, meetingVersion, onSchedulesChanged }: SchedulePanelProps) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ScheduleFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setSchedules([]);
    setMeetings([]);
    setFormMode(null);
    setEditingId(null);
    setForm(EMPTY_FORM);

    Promise.all([activityApi.listSchedules(activityId), activityApi.listMeetings(activityId)])
      .then(([scheduleRows, meetingRows]) => {
        if (!active) return;
        setSchedules(scheduleRows);
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

  const closeForm = () => {
    if (saving) return;
    setFormMode(null);
    setEditingId(null);
    setFormError(null);
    setForm(EMPTY_FORM);
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
    setFormMode('create');
  };

  const openEdit = (schedule: Schedule) => {
    setForm(formFromSchedule(schedule));
    setEditingId(schedule.id);
    setFormError(null);
    setFormMode('edit');
  };

  const setField = (field: keyof ScheduleFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    const payload: ScheduleInput = {
      activity_id: activityId,
      meeting_id: form.meeting_id ? Number(form.meeting_id) : null,
      name: form.name.trim(),
      start_time: form.start_time,
      end_time: form.end_time || null,
      location: form.location.trim(),
      owner: form.owner.trim(),
      notes: form.notes.trim(),
      category: form.category.trim(),
    };

    try {
      if (formMode === 'edit' && editingId != null) {
        const updated = await activityApi.updateSchedule(editingId, payload);
        setSchedules((current) => current.map((schedule) => schedule.id === updated.id ? updated : schedule));
      } else {
        const created = await activityApi.createSchedule(payload);
        setSchedules((current) => [...current, created].sort((a, b) => a.start_time.localeCompare(b.start_time)));
      }
      onSchedulesChanged();
      setFormMode(null);
      setEditingId(null);
      setForm(EMPTY_FORM);
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : '流程儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const [schedulePendingDelete, setSchedulePendingDelete] = useState<Schedule | null>(null);

  const handleDelete = (schedule: Schedule) => {
    setSchedulePendingDelete(schedule);
  };

  const handleConfirmDelete = async () => {
    if (!schedulePendingDelete) return;
    const schedule = schedulePendingDelete;
    setSchedulePendingDelete(null);
    setDeletingId(schedule.id);
    setError(null);
    try {
      await activityApi.deleteSchedule(schedule.id);
      setSchedules((current) => current.filter((item) => item.id !== schedule.id));
      onSchedulesChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '流程刪除失敗');
    } finally {
      setDeletingId(null);
    }
  };

  const sortedSchedules = [...schedules].sort((a, b) => {
    // 第 1 關：比較 start_time
    const startA = new Date(a.start_time || '').getTime() || Infinity;
    const startB = new Date(b.start_time || '').getTime() || Infinity;

    if (startA !== startB) {
      return startA - startB; // 升冪：越早開始的排越上面
    }

    // 第 2 關：如果開始時間一模一樣，就比較 end_time
    const endA = new Date(a.end_time || '').getTime() || Infinity;
    const endB = new Date(b.end_time || '').getTime() || Infinity;
    
    return endA - endB; // 升冪：越早結束的排越上面
  });

  // 處理開始時間：回傳帶有換行標籤 (<br />) 的 React 結構
  const formatStartTime = (timeStr?: string | null) => {
    if (!timeStr) return '時間未定';
    const datePart = timeStr.substring(5, 10); // 擷取 09-24
    const timePart = timeStr.substring(11, 16); // 擷取 23:30
    
    return (
      <>
        {datePart}T<br />
        {timePart}
      </>
    );
  };

  const formatEndTime = (timeStr?: string | null) => {
    if (!timeStr) return '';
    // 擷取 09-24T23:30 後，把 'T' 替換成 'T '
    return timeStr.substring(5, 16).replace('T', 'T ');
  };

  return (
    <section className={`view-panel ${currentView === 'schedule' ? 'active' : ''}`} data-panel="schedule">
      <div className="section-heading">
        <div><p className="eyebrow">SCHEDULE</p><h2>活動流程規劃</h2><p style={{ marginTop: '4px', marginBottom: '8px' }}>只顯示目前 Activity 的流程。</p></div>
        <button className="button primary" type="button" style={{ marginBottom: '16px' }} onClick={openCreate}>＋ 新增流程</button>
      </div>

      {error && <div className="api-message error" role="alert">{error}</div>}
      {loading && <div className="api-state">載入流程中…</div>}
      {!loading && schedules.length === 0 && <div className="api-state empty"><h3>目前沒有活動流程</h3><p>新增流程後會顯示在這裡。</p></div>}

      {schedules.length > 0 && <div className="timeline">
        {/* 👇 1. 把 schedules 改成 sortedSchedules */}
        {sortedSchedules.map((schedule) => (
          <article key={schedule.id}>
            
            {/* 👇 2. 用 formatTime 把落落長的字串變短 */}
            <time>{formatStartTime(schedule.start_time)}</time>
            
            <i></i>
            <div>
              <span className="category activity">{schedule.category}</span>
              <h3>{schedule.name}</h3>
              <p>{schedule.location}・負責人：{schedule.owner}</p>
              <div className="detail-tags">
                
                {/* 👇 3. 結束時間順便一起變短 */}
                {schedule.end_time && <span>結束：{formatEndTime(schedule.end_time)}</span>}
                
                <span>{schedule.meeting_id == null ? '未綁定會議' : meetingNames.get(schedule.meeting_id) || `會議 #${schedule.meeting_id}`}</span>
                {schedule.notes && <span>{schedule.notes}</span>}
              </div>
              <div className="heading-actions">
                <button className="button secondary" type="button" onClick={() => openEdit(schedule)}>編輯</button>
                <button className="button danger" type="button" onClick={() => void handleDelete(schedule)} disabled={deletingId === schedule.id}>{deletingId === schedule.id ? '刪除中…' : '刪除'}</button>
              </div>
            </div>
          </article>
        ))}
      </div>}

      {formMode && <div className="activity-modal-backdrop" role="presentation" onMouseDown={closeForm}>
        <section className="activity-data-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-form-title" onMouseDown={(event) => event.stopPropagation()}>
          <form onSubmit={handleSubmit}>
            <div className="modal-head"><div><p className="eyebrow">SCHEDULE</p><h2 id="schedule-form-title">{formMode === 'create' ? '新增流程' : '編輯流程'}</h2></div><button className="close-button" type="button" onClick={closeForm}>×</button></div>
            {formError && <div className="api-message error" role="alert">{formError}</div>}
            <div className="two-fields"><label className="field"><span>流程名稱</span><input value={form.name} onChange={(event) => setField('name', event.target.value)} required /></label><label className="field"><span>分類</span><input value={form.category} onChange={(event) => setField('category', event.target.value)} required /></label></div>
            <div className="two-fields"><label className="field"><span>開始時間</span><input type="datetime-local" value={form.start_time} onChange={(event) => setField('start_time', event.target.value)} required /></label><label className="field"><span>結束時間（選填）</span><input type="datetime-local" value={form.end_time} onChange={(event) => setField('end_time', event.target.value)} /></label></div>
            <div className="two-fields"><label className="field"><span>地點</span><input value={form.location} onChange={(event) => setField('location', event.target.value)} required /></label><label className="field"><span>負責人</span><input value={form.owner} onChange={(event) => setField('owner', event.target.value)} required /></label></div>
            <label className="field"><span>所屬會議（選填）</span><select value={form.meeting_id} onChange={(event) => setField('meeting_id', event.target.value)}><option value="">不綁定會議</option>{meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.name}</option>)}</select></label>
            <label className="field"><span>備註</span><textarea rows={4} value={form.notes} onChange={(event) => setField('notes', event.target.value)} required /></label>
            <div className="modal-actions"><button className="button secondary" type="button" onClick={closeForm}>取消</button><button className="button primary" type="submit" disabled={saving}>{saving ? '儲存中…' : '儲存流程'}</button></div>
          </form>
        </section>
      </div>}

      <ConfirmModal
        isOpen={Boolean(schedulePendingDelete)}
        title="確認刪除流程"
        message={`確定刪除「${schedulePendingDelete?.name}」？相關事件會保留，但 schedule_id 將清空。`}
        confirmText="確認刪除"
        cancelText="取消"
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setSchedulePendingDelete(null)}
      />
    </section>
  );
}

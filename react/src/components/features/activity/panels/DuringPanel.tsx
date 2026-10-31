import React, { useEffect, useMemo, useState } from 'react';
import { activityApi } from '../../../../api/activityApi';
import type { Incident, IncidentInput, Schedule } from '../../../../types/activity';
import ConfirmModal from '../../../common/ConfirmModal';
import './DuringPanel.css';

interface DuringPanelProps {
  activityId: number;
  currentView: string;
  setCurrentView: (view: string) => void;
  scheduleVersion: number;
}

interface IncidentFormState {
  schedule_id: string;
  content: string;
  occurred_at: string;
  cause: string;
  suggestion: string;
}

const EMPTY_FORM: IncidentFormState = {
  schedule_id: '',
  content: '',
  occurred_at: '',
  cause: '',
  suggestion: '',
};

function toDateTimeInput(value: string): string {
  return value ? value.replace(' ', 'T').slice(0, 16) : '';
}

function formFromIncident(incident: Incident): IncidentFormState {
  return {
    schedule_id: incident.schedule_id == null ? '' : String(incident.schedule_id),
    content: incident.content,
    occurred_at: toDateTimeInput(incident.occurred_at),
    cause: incident.cause ?? '',
    suggestion: incident.suggestion ?? '',
  };
}

export default function DuringPanel({ activityId, currentView, setCurrentView, scheduleVersion }: DuringPanelProps) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<IncidentFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setIncidents([]);
    setSchedules([]);
    setFormMode(null);
    setEditingId(null);
    setForm(EMPTY_FORM);

    Promise.all([activityApi.listIncidents(activityId), activityApi.listSchedules(activityId)])
      .then(([incidentRows, scheduleRows]) => {
        if (!active) return;
        setIncidents(incidentRows);
        setSchedules(scheduleRows);
      })
      .catch((requestError: Error) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [activityId, scheduleVersion]);

  const scheduleNames = useMemo(
    () => new Map(schedules.map((schedule) => [schedule.id, schedule.name])),
    [schedules],
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

  const openEdit = (incident: Incident) => {
    setForm(formFromIncident(incident));
    setEditingId(incident.id);
    setFormError(null);
    setFormMode('edit');
  };

  const setField = (field: keyof IncidentFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    const payload: IncidentInput = {
      activity_id: activityId,
      schedule_id: form.schedule_id ? Number(form.schedule_id) : null,
      content: form.content.trim(),
      occurred_at: form.occurred_at,
      cause: form.cause.trim() || null,
      suggestion: form.suggestion.trim() || null,
    };

    try {
      if (formMode === 'edit' && editingId != null) {
        const updated = await activityApi.updateIncident(editingId, payload);
        setIncidents((current) => current.map((incident) => incident.id === updated.id ? updated : incident));
      } else {
        const created = await activityApi.createIncident(payload);
        setIncidents((current) => [created, ...current]);
      }
      setFormMode(null);
      setEditingId(null);
      setForm(EMPTY_FORM);
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : '事件儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const [incidentPendingDelete, setIncidentPendingDelete] = useState<Incident | null>(null);

  const handleDelete = (incident: Incident) => {
    setIncidentPendingDelete(incident);
  };

  const handleConfirmDelete = async () => {
    if (!incidentPendingDelete) return;
    const incident = incidentPendingDelete;
    setIncidentPendingDelete(null);
    setDeletingId(incident.id);
    setError(null);
    try {
      await activityApi.deleteIncident(incident.id);
      setIncidents((current) => current.filter((item) => item.id !== incident.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '事件刪除失敗');
    } finally {
      setDeletingId(null);
    }
  };

  // 1. 將紀錄依照時間先後排序 (升冪：越舊的排越上面)
  const sortedIncidents = [...incidents].sort((a, b) => {
    // ⚠️ 假設你的時間欄位叫做 a.time，如果實際叫 a.timestamp 或 a.created_at 請記得改！
    const timeA = new Date(a.occurred_at || '').getTime() || Infinity;
    const timeB = new Date(b.occurred_at || '').getTime() || Infinity;
    return timeA - timeB; 
  });

  const formatIncidentTime = (timeStr?: string | null) => {
    if (!timeStr) return '時間未定';
    
    // 擷取前 16 個字元 (2026-09-26T16:25)，並把 'T' 替換成 'T '
    return timeStr.substring(0, 16).replace('T', 'T ');
    
    // 💡 如果你後來想改回「換行版」，就把上面的 return 刪掉，改成這行：
    // return <>{timeStr.substring(0, 10)}T<br />{timeStr.substring(11, 16)}</>;
  };

  return (
    <section className={`view-panel ${currentView === 'during' ? 'active' : ''}`} data-panel="during">
      <div className="section-heading">
        <div><p className="eyebrow">DURING EVENT</p><h2>活動中紀錄</h2><p style = {{ marginTop: '4px', marginBottom: '8px'}}>集中記下目前 Activity 的突發狀況。</p></div>
        <button className="button primary" type="button" style = {{ marginBottom: '8px'}} onClick={openCreate}>＋ 新增突發事件</button>
      </div>

      <div className="during-summary">
        <article style={{ marginBottom: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span>活動中紀錄</span>
          <strong className="during-count">{incidents.length} 筆</strong>
        </article>
        <article style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span>原訂流程</span>
          <button className="text-button" type="button" onClick={() => setCurrentView('schedule')}>
            查看活動流程 ›
          </button>
        </article>
      </div>

      {error && <div className="api-message error" role="alert">{error}</div>}
      {loading && <div className="api-state">載入活動中紀錄…</div>}
      {!loading && incidents.length === 0 && <div className="api-state empty"><h3>目前沒有活動中紀錄</h3><p>新增臨時事件後會顯示在這裡。</p></div>}

      {incidents.length > 0 && <article className="info-card execution-log" style = {{ marginTop: '4px'}}>
        <div className="card-title"><h3>執行紀錄</h3><span className="updated">依時間排序</span></div>
        <div className="record-timeline">
          {sortedIncidents.map((incident) => <section key={incident.id} className="meeting-content">
            <div className="card-title"><div><span style={{ color: 'var(--muted)', fontSize: '0.8rem', fontWeight: 800 }}>{formatIncidentTime(incident.occurred_at)}</span><h3 style={{ wordBreak: 'break-all' }}>{incident.content}</h3></div><div className="heading-actions" style={{ flexShrink: 0 }}><button className="button secondary" type="button" onClick={() => openEdit(incident)}>編輯</button><button className="button danger" type="button" onClick={() => void handleDelete(incident)} disabled={deletingId === incident.id}>{deletingId === incident.id ? '刪除中…' : '刪除'}</button></div></div>
            <p>對應流程：{incident.schedule_id == null ? '未綁定' : scheduleNames.get(incident.schedule_id) || `流程 #${incident.schedule_id}`}</p>
            {incident.cause && <p>原因：{incident.cause}</p>}
            {incident.suggestion && <p>改善建議：{incident.suggestion}</p>}
          </section>)}
        </div>
      </article>}

      {formMode && <div className="activity-modal-backdrop" role="presentation" onMouseDown={closeForm}>
        <section className="activity-data-modal" role="dialog" aria-modal="true" aria-labelledby="incident-form-title" onMouseDown={(event) => event.stopPropagation()}>
          <form onSubmit={handleSubmit}>
            <div className="modal-head"><div><p className="eyebrow">INCIDENT</p><h2 id="incident-form-title">{formMode === 'create' ? '新增活動中紀錄' : '編輯活動中紀錄'}</h2></div><button className="close-button" type="button" onClick={closeForm}>×</button></div>
            {formError && <div className="api-message error" role="alert">{formError}</div>}
            <label className="field"><span>發生時間</span><input type="datetime-local" value={form.occurred_at} onChange={(event) => setField('occurred_at', event.target.value)} required /></label>
            <label className="field"><span>事件內容</span><textarea rows={4} value={form.content} onChange={(event) => setField('content', event.target.value)} required /></label>
            <label className="field"><span>對應流程（選填）</span><select value={form.schedule_id} onChange={(event) => setField('schedule_id', event.target.value)}><option value="">不綁定流程</option>{schedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.name}</option>)}</select></label>
            <label className="field"><span>發生原因（選填）</span><textarea rows={3} value={form.cause} onChange={(event) => setField('cause', event.target.value)} /></label>
            <label className="field"><span>下次建議（選填）</span><textarea rows={3} value={form.suggestion} onChange={(event) => setField('suggestion', event.target.value)} /></label>
            <div className="modal-actions"><button className="button secondary" type="button" onClick={closeForm}>取消</button><button className="button primary" type="submit" disabled={saving}>{saving ? '儲存中…' : '儲存紀錄'}</button></div>
          </form>
        </section>
      </div>}

      <ConfirmModal
        isOpen={Boolean(incidentPendingDelete)}
        title="確認刪除紀錄"
        message="確定刪除這筆活動中紀錄？"
        confirmText="確認刪除"
        cancelText="取消"
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setIncidentPendingDelete(null)}
      />
    </section>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { activityApi } from '../../../../api/activityApi';
import type { Meeting, MeetingInput } from '../../../../types/activity';
import ConfirmModal from '../../../common/ConfirmModal';
import './MeetingPanel.css';

interface MeetingPanelProps {
  activityId: number;
  activityName: string;
  currentView: string;
  setCurrentView: (view: string) => void;
  onMeetingsChanged: () => void;
}

interface MeetingFormState {
  name: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  participants: string;
  content: string;
}

const EMPTY_FORM: MeetingFormState = {
  name: '',
  date: '',
  start_time: '',
  end_time: '',
  location: '',
  participants: '',
  content: '',
};

function toDateTimeInput(value: string): string {
  return value ? value.replace(' ', 'T').slice(0, 16) : '';
}

function toApiDateTime(value: string): string {
  return value ? value.replace('T', ' ') : '';
}

function formFromMeeting(meeting: Meeting): MeetingFormState {
  return {
    name: meeting.name,
    date: meeting.date,
    start_time: toDateTimeInput(meeting.start_time),
    end_time: toDateTimeInput(meeting.end_time),
    location: meeting.location,
    participants: meeting.participants,
    content: meeting.content,
  };
}

export default function MeetingPanel({ activityId, activityName, currentView, setCurrentView, onMeetingsChanged }: MeetingPanelProps) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState<MeetingFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selectedMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === selectedMeetingId) ?? null,
    [meetings, selectedMeetingId],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setMeetings([]);
    setSelectedMeetingId(null);
    setFormMode(null);
    setForm(EMPTY_FORM);

    activityApi.listMeetings(activityId)
      .then((rows) => {
        if (!active) return;
        setMeetings(rows);
        setSelectedMeetingId(rows[0]?.id ?? null);
      })
      .catch((requestError: Error) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [activityId]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormMode('create');
  };

  const openEdit = () => {
    if (!selectedMeeting) return;
    setForm(formFromMeeting(selectedMeeting));
    setFormError(null);
    setFormMode('edit');
  };

  const closeForm = () => {
    if (saving) return;
    setFormMode(null);
    setFormError(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    const payload: MeetingInput = {
      activity_id: activityId,
      name: form.name.trim(),
      date: form.date,
      start_time: toApiDateTime(form.start_time),
      end_time: toApiDateTime(form.end_time),
      location: form.location.trim(),
      participants: form.participants.trim(),
      content: form.content.trim(),
    };

    try {
      if (formMode === 'edit' && selectedMeeting) {
        const updated = await activityApi.updateMeeting(selectedMeeting.id, payload);
        setMeetings((current) => current.map((meeting) => meeting.id === updated.id ? updated : meeting));
      } else {
        const created = await activityApi.createMeeting(payload);
        setMeetings((current) => [created, ...current]);
        setSelectedMeetingId(created.id);
      }
      onMeetingsChanged();
      closeForm();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : '會議儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const handleDelete = () => {
    if (!selectedMeeting) return;
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!selectedMeeting) return;
    setDeleteConfirmOpen(false);
    setDeleting(true);
    setError(null);
    try {
      await activityApi.deleteMeeting(selectedMeeting.id);
      const remaining = meetings.filter((meeting) => meeting.id !== selectedMeeting.id);
      setMeetings(remaining);
      setSelectedMeetingId(remaining[0]?.id ?? null);
      onMeetingsChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '會議刪除失敗');
    } finally {
      setDeleting(false);
    }
  };

  const setField = (field: keyof MeetingFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  return (
    <section className={`view-panel ${currentView === 'meeting' ? 'active' : ''}`} data-panel="meeting">
      <div className="detail-toolbar">
        <button className="back-link" type="button" onClick={() => setCurrentView('before')}>← 回到活動前</button>
        <button className="button primary" type="button" onClick={openCreate}>＋ 新增會議</button>
      </div>

      <div className="section-heading" style={{ marginTop: '24px' }}>
        <div><p className="eyebrow">MEETINGS</p>
          <h2>{activityName}・籌備會議</h2>
          <p style={{ marginTop: '6px', marginBottom: '12px'}}>
          只顯示目前活動的會議紀錄。
        </p>
        </div>
      </div>

      {error && <div className="api-message error" role="alert">{error}</div>}
      {loading && <div className="api-state">載入會議中…</div>}

      {!loading && meetings.length === 0 && (
        <div className="api-state empty"><h3>尚無會議</h3><p>建立第一場籌備會議，後續待辦就能選擇來源。</p><button className="button primary" type="button" onClick={openCreate}>新增會議</button></div>
      )}

      {meetings.length > 0 && (
        <div className="meeting-tabs-container" aria-label="選擇會議">
          {/* 👇 加上 [...meetings].sort(...) 來依照時間排序 */}
          {[...meetings]
            .sort((a, b) => {
              // 將日期字串轉為時間戳，進行相減來升冪排序 (越早發生的排越前面)
              const dateA = new Date(a.date || '').getTime();
              const dateB = new Date(b.date || '').getTime();
              return dateA - dateB; 
            })
            .map((meeting, index) => (
              <button 
                key={meeting.id} 
                className={`meeting-tab ${meeting.id === selectedMeetingId ? 'active' : ''}`} 
                type="button" 
                onClick={() => setSelectedMeetingId(meeting.id)}
              >
                <div className="tab-header">
                  <span className="tab-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="tab-date">{meeting.date || '日期未定'}</span>
                </div>
                <strong className="tab-name">{meeting.name}</strong>
              </button>
          ))}
        </div>
      )}

      {selectedMeeting && (
        <article className="meeting-detail-card">
          <div className="card-title">
            <div><p className="eyebrow">MEETING DETAIL</p><h3 style={{ wordBreak: 'break-all' }}>{selectedMeeting.name}</h3></div>
            <div className="heading-actions" style={{ flexShrink: 0, display: 'flex', gap: '8px' }}>
              <button className="button secondary" type="button" onClick={openEdit}>編輯</button>
              <button className="button danger" type="button" onClick={() => void handleDelete()} disabled={deleting}>{deleting ? '刪除中…' : '刪除'}</button>
            </div>
          </div>
          <dl className="facts">
            <div><dt>日期</dt><dd>{selectedMeeting.date || '未填寫'}</dd></div>
            <div><dt>時間</dt><dd>{selectedMeeting.start_time || '未填寫'}{selectedMeeting.end_time ? ` ～ ${selectedMeeting.end_time}` : ''}</dd></div>
            <div><dt>地點</dt><dd>{selectedMeeting.location || '未填寫'}</dd></div>
            <div><dt>參與人員</dt><dd>{selectedMeeting.participants || '未填寫'}</dd></div>
          </dl>
          <div className="meeting-content"><span>會議內容</span><p>{selectedMeeting.content || '尚未填寫會議內容。'}</p></div>
        </article>
      )}

      {formMode && (
        <div className="activity-modal-backdrop" role="presentation" onMouseDown={closeForm}>
          <section className="activity-data-modal" role="dialog" aria-modal="true" aria-labelledby="meeting-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <form onSubmit={handleSubmit}>
              <div className="modal-head"><div><p className="eyebrow">MEETING</p><h2 id="meeting-form-title">{formMode === 'create' ? '新增會議' : '編輯會議'}</h2></div><button className="close-button" type="button" onClick={closeForm}>×</button></div>
              {formError && <div className="api-message error" role="alert">{formError}</div>}
              <label className="field"><span>會議名稱</span><input value={form.name} onChange={(event) => setField('name', event.target.value)} required /></label>
              <div className="two-fields"><label className="field"><span>日期</span><input type="date" value={form.date} onChange={(event) => setField('date', event.target.value)} /></label><label className="field"><span>地點</span><input value={form.location} onChange={(event) => setField('location', event.target.value)} /></label></div>
              <div className="two-fields"><label className="field"><span>開始時間</span><input type="datetime-local" value={form.start_time} onChange={(event) => setField('start_time', event.target.value)} /></label><label className="field"><span>結束時間</span><input type="datetime-local" value={form.end_time} onChange={(event) => setField('end_time', event.target.value)} /></label></div>
              <label className="field"><span>參與人員</span><input value={form.participants} onChange={(event) => setField('participants', event.target.value)} placeholder="以逗號分隔" /></label>
              <label className="field"><span>會議內容</span><textarea rows={6} value={form.content} onChange={(event) => setField('content', event.target.value)} /></label>
              <div className="modal-actions"><button className="button secondary" type="button" onClick={closeForm}>取消</button><button className="button primary" type="submit" disabled={saving}>{saving ? '儲存中…' : '儲存會議'}</button></div>
            </form>
          </section>
        </div>
      )}

      <ConfirmModal
        isOpen={deleteConfirmOpen}
        title="確認刪除會議"
        message={`確定刪除「${selectedMeeting?.name}」？關聯資料會保留，但 meeting_id 將清空。`}
        confirmText="確認刪除"
        cancelText="取消"
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </section>
  );
}

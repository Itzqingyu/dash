import React, { useEffect, useMemo, useState } from 'react';
import { activityApi } from '../../../../api/activityApi';
import type { ConfirmationStatus, Decision, DecisionInput, Meeting } from '../../../../types/activity';
import ConfirmModal from '../../../common/ConfirmModal';
import './DecisionsPanel.css';

interface DecisionsPanelProps {
  activityId: number;
  currentView: string;
  meetingVersion: number;
}

interface DecisionFormState {
  meeting_id: string;
  problem: string;
  options: string[];
  final_decision: string;
  reason: string;
  source: string;
  confirmation_status: ConfirmationStatus;
}

const EMPTY_FORM: DecisionFormState = {
  meeting_id: '', problem: '', options: [''], final_decision: '', reason: '', source: '', confirmation_status: 'pending',
};

function parseOptions(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function formFromDecision(decision: Decision): DecisionFormState {
  const options = parseOptions(decision.options);
  return {
    meeting_id: decision.meeting_id == null ? '' : String(decision.meeting_id),
    problem: decision.problem,
    options: options.length > 0 ? options : [''],
    final_decision: decision.final_decision,
    reason: decision.reason,
    source: decision.source,
    confirmation_status: decision.confirmation_status,
  };
}

export default function DecisionsPanel({ activityId, currentView, meetingVersion }: DecisionsPanelProps) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState<DecisionFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setDecisions([]); setMeetings([]); setSelectedId(null); setFormMode(null); setForm(EMPTY_FORM);
    Promise.all([activityApi.listDecisions(activityId), activityApi.listMeetings(activityId)])
      .then(([decisionRows, meetingRows]) => {
        if (!active) return;
        setDecisions(decisionRows); setMeetings(meetingRows); setSelectedId(decisionRows[0]?.id ?? null);
      })
      .catch((requestError: Error) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [activityId, meetingVersion]);

  const activeDecision = useMemo(() => decisions.find((decision) => decision.id === selectedId) ?? null, [decisions, selectedId]);
  const meetingNames = useMemo(() => new Map(meetings.map((meeting) => [meeting.id, meeting.name])), [meetings]);

  const closeForm = () => { if (!saving) { setFormMode(null); setFormError(null); setForm(EMPTY_FORM); } };
  const setField = <K extends keyof DecisionFormState>(field: K, value: DecisionFormState[K]) => setForm((current) => ({ ...current, [field]: value }));
  const setOption = (index: number, value: string) => setForm((current) => ({ ...current, options: current.options.map((option, optionIndex) => optionIndex === index ? value : option) }));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const options = form.options.map((option) => option.trim()).filter(Boolean);
    if (options.length === 0) { setFormError('至少需要一個選項'); return; }
    setSaving(true); setFormError(null);
    const payload: DecisionInput = {
      activity_id: activityId,
      meeting_id: form.meeting_id ? Number(form.meeting_id) : null,
      problem: form.problem.trim(), options: JSON.stringify(options), final_decision: form.final_decision.trim(),
      reason: form.reason.trim(), source: form.source.trim(), confirmation_status: form.confirmation_status,
    };
    try {
      if (formMode === 'edit' && activeDecision) {
        const updated = await activityApi.updateDecision(activeDecision.id, payload);
        setDecisions((current) => current.map((decision) => decision.id === updated.id ? updated : decision));
      } else {
        const created = await activityApi.createDecision(payload);
        setDecisions((current) => [created, ...current]); setSelectedId(created.id);
      }
      setFormMode(null); setForm(EMPTY_FORM);
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : '決策儲存失敗');
    } finally { setSaving(false); }
  };

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const handleDelete = () => {
    if (!activeDecision) return;
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!activeDecision) return;
    setDeleteConfirmOpen(false);
    setDeleting(true); setError(null);
    try {
      await activityApi.deleteDecision(activeDecision.id);
      const remaining = decisions.filter((decision) => decision.id !== activeDecision.id);
      setDecisions(remaining); setSelectedId(remaining[0]?.id ?? null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '決策刪除失敗');
    } finally { setDeleting(false); }
  };

  return (
    <section className={`view-panel ${currentView === 'decisions' ? 'active' : ''}`} data-panel="decisions">
      <div className="section-heading"><div><p className="eyebrow">DECISIONS</p><h2>決策紀錄</h2><p style={{ marginTop: '4px', marginBottom: '12px' }}>只顯示目前 Activity 的決策。</p></div><button className="button primary" type="button" style={{ marginBottom: '12px' }} onClick={() => { setForm(EMPTY_FORM); setFormError(null); setFormMode('create'); }}>＋ 新增決策</button></div>
      {error && <div className="api-message error" role="alert">{error}</div>}
      {loading && <div className="api-state">載入決策中…</div>}
      {!loading && decisions.length === 0 && <div className="api-state empty"><h3>目前沒有決策紀錄</h3><p>新增決策後會顯示在這裡。</p></div>}
      {decisions.length > 0 && <div className="decision-layout">
        <div className="decision-list" role="listbox" aria-label="決策列表">{decisions.map((decision) => <button key={decision.id} className={`decision-list-item ${selectedId === decision.id ? 'active' : ''}`} type="button" onClick={() => setSelectedId(decision.id)}><span className={`decision-state ${decision.confirmation_status === 'confirmed' ? 'confirmed' : 'review'}`}>{decision.confirmation_status}</span><strong>{decision.problem}</strong><small>{decision.meeting_id == null ? '未綁定會議' : meetingNames.get(decision.meeting_id) || `會議 #${decision.meeting_id}`}</small></button>)}</div>
        {activeDecision && <article className="decision-detail"><div className="decision-detail-head"><div><span className={`decision-state ${activeDecision.confirmation_status === 'confirmed' ? 'confirmed' : 'review'}`}>{activeDecision.confirmation_status}</span><h3>{activeDecision.problem}</h3></div><div className="heading-actions"><button className="button secondary" type="button" onClick={() => { setForm(formFromDecision(activeDecision)); setFormError(null); setFormMode('edit'); }}>編輯</button><button className="button danger" type="button" onClick={() => void handleDelete()} disabled={deleting}>{deleting ? '刪除中…' : '刪除'}</button></div></div><div className="decision-section"><span>考慮選項</span><ol>{parseOptions(activeDecision.options).map((option, index) => <li key={`${option}-${index}`}>{option}</li>)}</ol></div><div className="decision-answer"><span>最終決定</span><strong>{activeDecision.final_decision}</strong><p>{activeDecision.reason}</p></div><div className="decision-meta"><div><span>來源</span><strong>{activeDecision.source}</strong></div><div><span>會議</span><strong>{activeDecision.meeting_id == null ? '未綁定' : meetingNames.get(activeDecision.meeting_id) || `#${activeDecision.meeting_id}`}</strong></div></div></article>}
      </div>}
      {formMode && <div className="activity-modal-backdrop" role="presentation" onMouseDown={closeForm}><section className="activity-data-modal" role="dialog" aria-modal="true" aria-labelledby="decision-form-title" onMouseDown={(event) => event.stopPropagation()}><form onSubmit={handleSubmit}><div className="modal-head"><div><p className="eyebrow">DECISION</p><h2 id="decision-form-title">{formMode === 'create' ? '新增決策' : '編輯決策'}</h2></div><button className="close-button" type="button" onClick={closeForm}>×</button></div>{formError && <div className="api-message error" role="alert">{formError}</div>}<label className="field"><span>問題</span><input value={form.problem} onChange={(event) => setField('problem', event.target.value)} required /></label><label className="field"><span>考慮選項</span>{form.options.map((option, index) => <span className="two-fields" key={index}><input value={option} onChange={(event) => setOption(index, event.target.value)} required /><button className="button secondary" type="button" onClick={() => setField('options', form.options.filter((_, optionIndex) => optionIndex !== index))} disabled={form.options.length === 1}>移除</button></span>)}<button className="text-button" type="button" onClick={() => setField('options', [...form.options, ''])}>＋ 新增選項</button></label><label className="field"><span>最終決定</span><input value={form.final_decision} onChange={(event) => setField('final_decision', event.target.value)} required /></label><label className="field"><span>原因</span><textarea rows={3} value={form.reason} onChange={(event) => setField('reason', event.target.value)} required /></label><div className="two-fields"><label className="field"><span>來源</span><input value={form.source} onChange={(event) => setField('source', event.target.value)} required /></label><label className="field"><span>確認狀態</span><select value={form.confirmation_status} onChange={(event) => setField('confirmation_status', event.target.value as ConfirmationStatus)}><option value="pending">pending</option><option value="confirmed">confirmed</option></select></label></div><label className="field"><span>所屬會議（選填）</span><select value={form.meeting_id} onChange={(event) => setField('meeting_id', event.target.value)}><option value="">不綁定會議</option>{meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.name}</option>)}</select></label><div className="modal-actions"><button className="button secondary" type="button" onClick={closeForm}>取消</button><button className="button primary" type="submit" disabled={saving}>{saving ? '儲存中…' : '儲存決策'}</button></div></form></section></div>}

      <ConfirmModal
        isOpen={deleteConfirmOpen}
        title="確認刪除決策"
        message={`確定刪除「${activeDecision?.problem}」？`}
        confirmText="確認刪除"
        cancelText="取消"
        isDanger={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </section>
  );
}

import React, { useState } from 'react';
import type { Activity, ActivityInput } from '../../../types/activity';
import './ActivityFormModal.css';

interface ActivityFormModalProps {
  activity: Activity | null;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (payload: ActivityInput) => Promise<void>;
}

const STATUS_OPTIONS = ['未開始', '準備中', '進行中', '已完成'];

function optionalNumber(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

export default function ActivityFormModal({
  activity,
  submitting,
  error,
  onCancel,
  onSubmit,
}: ActivityFormModalProps) {
  const [name, setName] = useState(activity?.name ?? '');
  const [year, setYear] = useState(String(activity?.year ?? new Date().getFullYear()));
  const [status, setStatus] = useState(activity?.status ?? '未開始');
  const [startDate, setStartDate] = useState(activity?.start_date ?? '');
  const [endDate, setEndDate] = useState(activity?.end_date ?? '');
  const [venue, setVenue] = useState(activity?.venue ?? '');
  const [activityType, setActivityType] = useState(activity?.activity_type ?? '');
  const [coordinator, setCoordinator] = useState(activity?.coordinator ?? '');
  const [expectedAttendees, setExpectedAttendees] = useState(
    activity?.expected_attendees == null ? '' : String(activity.expected_attendees),
  );
  const [budget, setBudget] = useState(activity?.budget == null ? '' : String(activity.budget));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit({
      name: name.trim(),
      year: Number(year),
      status,
      start_date: startDate || null,
      end_date: endDate || null,
      venue: venue.trim() || null,
      activity_type: activityType.trim() || null,
      coordinator: coordinator.trim() || null,
      expected_attendees: optionalNumber(expectedAttendees),
      budget: optionalNumber(budget),
    });
  };

  return (
    <div className="activity-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="activity-data-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-form-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div className="modal-head">
            <div>
              <p className="eyebrow">ACTIVITY</p>
              <h2 id="activity-form-title">{activity ? '編輯活動' : '新增活動'}</h2>
            </div>
            <button className="close-button" type="button" onClick={onCancel} aria-label="關閉">×</button>
          </div>

          {error && <div className="api-message error" role="alert">{error}</div>}

          <label className="field">
            <span>活動名稱</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <div className="two-fields">
            <label className="field">
              <span>年度</span>
              <input type="number" min="1" value={year} onChange={(event) => setYear(event.target.value)} required />
            </label>
            <label className="field">
              <span>狀態</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                {STATUS_OPTIONS.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
          </div>
          <div className="two-fields">
            <label className="field"><span>開始日期</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="field"><span>結束日期</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          </div>
          <div className="two-fields">
            <label className="field"><span>活動類型</span><input value={activityType} onChange={(event) => setActivityType(event.target.value)} /></label>
            <label className="field"><span>地點</span><input value={venue} onChange={(event) => setVenue(event.target.value)} /></label>
          </div>
          <div className="two-fields">
            <label className="field"><span>總召</span><input value={coordinator} onChange={(event) => setCoordinator(event.target.value)} /></label>
            <label className="field"><span>預計人數</span><input type="number" min="0" value={expectedAttendees} onChange={(event) => setExpectedAttendees(event.target.value)} /></label>
          </div>
          <label className="field"><span>預算</span><input type="number" min="0" value={budget} onChange={(event) => setBudget(event.target.value)} /></label>

          <div className="modal-actions">
            <button className="button secondary" type="button" onClick={onCancel}>取消</button>
            <button className="button primary" type="submit" disabled={submitting}>
              {submitting ? '儲存中…' : activity ? '儲存修改' : '建立活動'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

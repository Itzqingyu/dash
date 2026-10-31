import React, { useState, useEffect, useRef } from 'react';
import type { Activity } from '../../../types/activity';
import './QuickAddModal.css';

interface QuickAddModalProps {
  isOpen: boolean;
  activities: Activity[];
  onClose: () => void;
  onSelectTarget: (activityId: number, targetView: string) => void;
}

interface QuickAddButtonProps {
  label: string;
  targetView: string;
  activityId: string;
  onAction: (view: string) => void;
}

/**
 * 快速新增按鈕單元
 */
const QuickAddButton: React.FC<QuickAddButtonProps> = ({
  label,
  targetView,
  activityId,
  onAction,
}) => (
  <button
    type="button"
    disabled={!activityId}
    onClick={() => onAction(targetView)}
  >
    <strong>{label}</strong>
  </button>
);

/**
 * 快速新增紀錄彈窗 (QuickAddModal)
 * 允許使用者指定活動並快速跳轉至會議、待辦、決策或流程視圖
 */
export const QuickAddModal: React.FC<QuickAddModalProps> = ({
  isOpen,
  activities,
  onClose,
  onSelectTarget,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [targetActivityId, setTargetActivityId] = useState<string>('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
      // 若尚未選擇且有活動，預設選取第一個活動
      if (!targetActivityId && activities.length > 0) {
        setTargetActivityId(String(activities[0].id));
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [isOpen, activities]);

  const handleJump = (targetView: string) => {
    if (!targetActivityId) return;
    onSelectTarget(Number(targetActivityId), targetView);
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      id="record-modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form method="dialog" onSubmit={(e) => e.preventDefault()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">QUICK ADD</p>
            <h2>新增紀錄</h2>
          </div>
          <button
            className="close-button"
            type="button"
            aria-label="關閉"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* 活動選擇下拉選單 */}
        <label className="field">
          <span>選擇所屬活動</span>
          <select
            id="record-activity-select"
            value={targetActivityId}
            onChange={(e) => setTargetActivityId(e.target.value)}
          >
            <option value="" disabled>請選擇活動...</option>
            {activities.map((activity) => (
              <option key={activity.id} value={activity.id}>
                {activity.name}
              </option>
            ))}
          </select>
        </label>

        <p className="modal-copy">要新增哪一種紀錄加入此活動？</p>

        {/* 四種紀錄快速導航按鈕 */}
        <div className="record-options">
          <QuickAddButton
            label="籌備會議"
            targetView="meeting"
            activityId={targetActivityId}
            onAction={handleJump}
          />
          <QuickAddButton
            label="待辦事項"
            targetView="tasks"
            activityId={targetActivityId}
            onAction={handleJump}
          />
          <QuickAddButton
            label="決策"
            targetView="decisions"
            activityId={targetActivityId}
            onAction={handleJump}
          />
          <QuickAddButton
            label="流程規劃"
            targetView="schedule"
            activityId={targetActivityId}
            onAction={handleJump}
          />
        </div>
      </form>
    </dialog>
  );
};

export default QuickAddModal;


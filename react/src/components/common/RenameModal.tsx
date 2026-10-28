import React, { useState, useEffect, useRef } from 'react';
import { Pencil } from 'lucide-react';
import './RenameModal.css';

export interface RenameModalProps {
  isOpen: boolean;
  initialValue: string;
  onConfirm: (newTitle: string) => void;
  onCancel: () => void;
}

/**
 * 對話重命名彈出對話框 (RenameModal)
 * 特性：
 * 1. 彈出覆蓋全螢幕的 Backdrop，套用高階毛玻璃模糊 (backdrop-filter: blur)
 * 2. 自動聚焦並全選文字，提供直覺編輯體驗
 * 3. 支援鍵盤 Enter 儲存、Escape 取消
 */
export const RenameModal: React.FC<RenameModalProps> = ({
  isOpen,
  initialValue,
  onConfirm,
  onCancel,
}) => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  // 追蹤滑鼠按下時是否為遮罩層本身，防止在 modal 內選字或拖曳到外面放開時誤觸關閉
  const isMouseDownOnOverlay = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
      // 稍微延遲以確保 DOM 渲染完畢後能正確聚焦並選取
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialValue]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      onConfirm(trimmed);
    } else {
      onCancel();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isMouseDownOnOverlay.current = e.target === e.currentTarget;
  };

  const handleOverlayMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isMouseDownOnOverlay.current && e.target === e.currentTarget) {
      onCancel();
    }
    isMouseDownOnOverlay.current = false;
  };

  // 確保在所有 Hooks 宣告完成後才進行條件提前返回，嚴格遵守 Rules of Hooks
  if (!isOpen) return null;

  return (
    <div
      className="rename-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-modal-title"
      onMouseDown={handleOverlayMouseDown}
      onMouseUp={handleOverlayMouseUp}
    >
      <div className="rename-modal-card">
        <div className="rename-modal-header">
          <div className="rename-modal-icon">
            <Pencil size={20} />
          </div>
          <div className="rename-modal-title-area">
            <h3 id="rename-modal-title">編輯對話名稱</h3>
            <p>請為此會話輸入新的標題名稱</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="rename-modal-body">
            <input
              ref={inputRef}
              type="text"
              className="rename-modal-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={50}
              placeholder="請輸入對話名稱…"
            />
          </div>

          <div className="rename-modal-actions">
            <button
              type="button"
              className="button secondary rename-cancel-btn"
              onClick={onCancel}
            >
              取消
            </button>
            <button
              type="submit"
              className="button primary rename-confirm-btn"
              disabled={!value.trim()}
            >
              儲存名稱
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RenameModal;

/**
 * DASH 身分驗證頁面 (AuthPage.tsx)
 * 職責：
 * 未登入時的專屬登入與註冊入口，無多餘敘述或 Header，大字體 DASH 與登入卡片居中呈現。
 */

import React, { useState } from 'react';
import { LogIn, UserPlus, AlertCircle } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import './AuthPage.css';

export const AuthPage: React.FC = () => {
  const { login, register } = useAuth();

  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setSubmitting(true);

    try {
      if (authTab === 'login') {
        await login(email, password);
      } else {
        await register(email, password);
      }
      setEmail('');
      setPassword('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '身分驗證失敗，請檢查輸入內容';
      setAuthError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page-container">
      {/* 大大的 DASH 品牌名稱 */}
      <div className="auth-brand-block">
        <h1 className="auth-brand-title">DASH</h1>
      </div>

      {/* 登入 / 註冊卡片 */}
      <div className="auth-card">
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab-btn ${authTab === 'login' ? 'active' : ''}`}
            onClick={() => {
              setAuthTab('login');
              setAuthError(null);
            }}
          >
            使用者登入
          </button>
          <button
            type="button"
            className={`auth-tab-btn ${authTab === 'register' ? 'active' : ''}`}
            onClick={() => {
              setAuthTab('register');
              setAuthError(null);
            }}
          >
            註冊新帳號
          </button>
        </div>

        {authError && (
          <div className="auth-error-banner">
            <AlertCircle size={16} />
            <span>{authError}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="auth-email">
              電子郵件 (Email)
            </label>
            <input
              id="auth-email"
              type="email"
              className="form-input"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="auth-password">
              密碼 (Password)
            </label>
            <input
              id="auth-password"
              type="password"
              className="form-input"
              placeholder="請輸入密碼 (至少 6 個字元)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn-auth-submit"
            disabled={submitting}
          >
            {submitting ? (
              <span>處理中...</span>
            ) : authTab === 'login' ? (
              <>
                <LogIn size={18} />
                <span>立即登入</span>
              </>
            ) : (
              <>
                <UserPlus size={18} />
                <span>建立帳號並登入</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};


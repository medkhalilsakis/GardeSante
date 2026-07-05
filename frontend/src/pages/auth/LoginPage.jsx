import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore, useUIStore } from '../../store';
import { authAPI } from '../../api';
import { useTranslation } from '../../utils/helpers';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { setAuth } = useAuthStore();
  const { language, setLanguage } = useUIStore();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authAPI.login(email, password);
      const { user, accessToken, refreshToken } = res.data.data;
      // Merge permissions from /me (loaded after login)
      const meRes = await import('../../api').then(m => m.authAPI.me());
      setAuth(
        { ...user, permissions: meRes.data.data.permissions, departments: meRes.data.data.departments },
        accessToken,
        refreshToken
      );
      toast.success(t('auth.welcome_back'));
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Identifiants incorrects');
    } finally {
      setLoading(false);
    }
  };

  const demoAccounts = [
    { label: 'Super Admin', email: 'admin@gardesante.dz', role: 'super_admin' },
    { label: 'Chef de Service', email: 'chef.urg@hca.dz', role: 'department_head' },
    { label: 'Surveillant', email: 'surv.general@hca.dz', role: 'general_supervisor' },
    { label: 'Directeur', email: 'directeur@hca.dz', role: 'director' },
    { label: 'Médecin', email: 'dr.sofiane@hca.dz', role: 'senior_doctor' },
    { label: 'Résident', email: 'res.lyes@hca.dz', role: 'resident' },
  ];

  return (
    <div className="login-page">
      <div className="login-bg">
        <div className="login-bg-orb orb-1" />
        <div className="login-bg-orb orb-2" />
        <div className="login-bg-orb orb-3" />
      </div>

      <div className="login-container">
        {/* Logo + Branding */}
        <div className="login-brand">
          <div className="login-logo">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <div>
            <h1 className="login-app-name">GardeSante</h1>
            <p className="login-app-sub">{t('auth.platform_desc')}</p>
          </div>
          {/* Toggle langue */}
          <button
            className="lang-toggle"
            onClick={() => setLanguage(language === 'fr' ? 'ar' : 'fr')}
            title="Changer la langue / تغيير اللغة"
          >
            {language === 'fr' ? 'العربية' : 'Français'}
          </button>
        </div>

        {/* Carte login */}
        <div className="login-card glass-card">
          <div className="login-card-header">
            <h2 className="login-title">{t('auth.welcome_back')}</h2>
            <p className="login-subtitle">{t('auth.login')}</p>
          </div>

          <form className="login-form" onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label" htmlFor="email">{t('auth.email')}</label>
              <div className="input-icon-wrapper">
                <svg className="input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                </svg>
                <input
                  id="email"
                  type="email"
                  className="form-control with-icon"
                  placeholder="votre@email.dz"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">{t('auth.password')}</label>
              <div className="input-icon-wrapper">
                <svg className="input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-control with-icon"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="input-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-full btn-login" disabled={loading}>
              {loading ? (
                <span className="btn-loading">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                    <path d="M21 12a9 9 0 11-6.219-8.56"/>
                  </svg>
                  {t('auth.signing_in')}
                </span>
              ) : t('auth.sign_in')}
            </button>
          </form>

          {/* Comptes de démonstration */}
          <div className="demo-section">
            <p className="demo-title">Comptes de démonstration <span>(mot de passe: Admin@123)</span></p>
            <div className="demo-grid">
              {demoAccounts.map((acc) => (
                <button
                  key={acc.email}
                  className="demo-btn"
                  onClick={() => { setEmail(acc.email); setPassword('Admin@123'); }}
                >
                  <span className="demo-role">{acc.label}</span>
                  <span className="demo-email">{acc.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="login-footer">
          GardeSante v1.0 · Plateforme nationale de gestion des gardes hospitalières
        </p>
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-base);
          padding: var(--space-4);
          position: relative;
          overflow: hidden;
        }
        .login-bg { position: fixed; inset: 0; pointer-events: none; }
        .login-bg-orb {
          position: absolute; border-radius: 50%;
          filter: blur(80px); opacity: 0.12;
        }
        .orb-1 {
          width: 600px; height: 600px;
          background: var(--color-primary);
          top: -200px; left: -200px;
          animation: float 8s ease-in-out infinite;
        }
        .orb-2 {
          width: 400px; height: 400px;
          background: var(--color-secondary);
          bottom: -100px; right: -100px;
          animation: float 10s ease-in-out infinite reverse;
        }
        .orb-3 {
          width: 300px; height: 300px;
          background: var(--color-info);
          top: 50%; left: 60%;
          animation: float 12s ease-in-out infinite;
        }
        @keyframes float {
          0%,100% { transform: translate(0,0) scale(1); }
          33%      { transform: translate(20px,-20px) scale(1.05); }
          66%      { transform: translate(-15px,15px) scale(0.95); }
        }
        .login-container {
          width: 100%;
          max-width: 480px;
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
          position: relative;
          z-index: 1;
        }
        .login-brand {
          display: flex;
          align-items: center;
          gap: var(--space-4);
        }
        .login-logo {
          width: 52px; height: 52px;
          background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));
          border-radius: 14px;
          display: flex; align-items: center; justify-content: center;
          color: #fff;
          box-shadow: 0 8px 24px rgba(27,79,202,0.5);
          flex-shrink: 0;
        }
        .login-app-name {
          font-size: var(--font-3xl); font-weight: 800;
          background: linear-gradient(135deg, #fff, var(--color-secondary));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .login-app-sub { font-size: var(--font-xs); color: var(--text-muted); }
        .lang-toggle {
          margin-left: auto;
          background: var(--bg-elevated);
          border: 1px solid var(--border-default);
          border-radius: var(--border-radius-full);
          color: var(--text-secondary);
          font-size: var(--font-sm);
          font-weight: 600;
          padding: 6px 14px;
          cursor: pointer;
          transition: all var(--transition-fast);
          font-family: inherit;
        }
        .lang-toggle:hover { border-color: var(--color-primary); color: var(--color-primary-light); }
        .login-card {
          padding: 0;
          overflow: hidden;
        }
        .login-card-header {
          padding: var(--space-8) var(--space-8) var(--space-6);
          background: linear-gradient(135deg, var(--color-primary-10), transparent);
          border-bottom: 1px solid var(--border-subtle);
        }
        .login-title {
          font-size: var(--font-3xl); font-weight: 800;
          color: var(--text-primary);
          margin-bottom: var(--space-1);
        }
        .login-subtitle { color: var(--text-muted); font-size: var(--font-sm); }
        .login-form {
          padding: var(--space-6) var(--space-8);
          display: flex; flex-direction: column; gap: var(--space-4);
        }
        .input-icon-wrapper { position: relative; }
        .input-icon {
          position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
          color: var(--text-muted); pointer-events: none;
        }
        .form-control.with-icon { padding-left: 42px; }
        .input-toggle-btn {
          position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
          background: none; border: none; color: var(--text-muted);
          cursor: pointer; padding: 4px;
          transition: color var(--transition-fast);
        }
        .input-toggle-btn:hover { color: var(--text-secondary); }
        .btn-login { height: 46px; font-size: var(--font-md); font-weight: 600; justify-content: center; margin-top: var(--space-2); }
        .btn-loading { display: flex; align-items: center; gap: var(--space-2); }
        .demo-section {
          padding: var(--space-5) var(--space-8) var(--space-8);
          border-top: 1px solid var(--border-subtle);
        }
        .demo-title {
          font-size: var(--font-xs); font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase; letter-spacing: 0.06em;
          margin-bottom: var(--space-3);
        }
        .demo-title span { font-weight: 400; text-transform: none; }
        .demo-grid {
          display: grid; grid-template-columns: repeat(2,1fr); gap: var(--space-2);
        }
        .demo-btn {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--border-radius-sm);
          padding: var(--space-2) var(--space-3);
          cursor: pointer;
          display: flex; flex-direction: column; gap: 2px;
          text-align: left;
          transition: all var(--transition-fast);
          font-family: inherit;
        }
        .demo-btn:hover { border-color: var(--color-primary); background: var(--color-primary-10); }
        .demo-role { font-size: var(--font-xs); font-weight: 600; color: var(--text-primary); }
        .demo-email { font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .login-footer { text-align: center; font-size: var(--font-xs); color: var(--text-muted); }
      `}</style>
    </div>
  );
}

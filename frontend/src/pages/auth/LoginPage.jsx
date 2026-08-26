import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mail, Lock, Eye, EyeOff, Loader2, ShieldCheck, ArrowRight, AlertCircle,
  Sun, Moon, Languages, CalendarDays, Repeat2, RadioTower, ScrollText, Activity,
} from 'lucide-react';
import { useAuthStore, useUIStore } from '../../store';
import { authAPI } from '../../api';
import { useTranslation } from '../../utils/helpers';
import toast from 'react-hot-toast';
import './LoginPage.css';

// Redirection selon le rôle
function getDashboardByRole(roleCode) {
  switch (roleCode) {
    case 'super_admin':
    case 'hospital_admin':
      return '/dashboard';
    case 'director':
      return '/director';
    case 'general_supervisor':
      return '/schedules';
    case 'department_head':
    case 'service_supervisor':
      return '/schedules';
    default:
      return '/dashboard';
  }
}

// Ce que la plateforme fait réellement — volet d'identité
const PLATFORM_FEATURES = [
  { icon: CalendarDays, title: 'Tableurs de garde',   desc: 'Du brouillon à la mise en marche' },
  { icon: Repeat2,      title: 'Remplacements',       desc: 'En surcouche, sans réécrire le planning' },
  { icon: RadioTower,   title: 'Suivi en direct',     desc: 'Appel du jour et gardes en cours' },
  { icon: ScrollText,   title: 'Traçabilité',         desc: 'Historique constant, non modifiable' },
];

// Accès rapide — un seul compte : le Super Admin de la plateforme
const QUICK_ACCOUNT = {
  label: 'Super Admin',
  email: 'admin@gardesante.tn',
  password: 'Admin@123',
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [quickLoading, setQuickLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [error, setError] = useState('');
  const { setAuth, updateUser } = useAuthStore();
  const { language, setLanguage, theme, setTheme, toggleTheme } = useUIStore();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Le thème persisté n'est appliqué au document que par le store : sur un
  // chargement direct de /login, l'attribut manque et le thème sombre choisi
  // précédemment n'apparaît pas. On le réapplique ici, sans rien changer ailleurs.
  useEffect(() => { setTheme(theme); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fonction centrale de connexion — utilisée par le formulaire ET l'accès rapide
  const doLogin = async (loginEmail, loginPassword) => {
    setLoading(true);
    setError('');
    try {
      const res = await authAPI.login(loginEmail, loginPassword);
      const { user, accessToken, refreshToken } = res.data.data;

      // Important: stocker d'abord les tokens pour que /auth/me envoie Authorization.
      setAuth(
        { ...user, permissions: user.permissions || [], departments: user.departments || [] },
        accessToken,
        refreshToken
      );

      // Enrichir ensuite le profil; ne pas bloquer la redirection si /me échoue.
      try {
        const meRes = await authAPI.me();
        updateUser({
          permissions: meRes.data?.data?.permissions || [],
          departments: meRes.data?.data?.departments || [],
        });
      } catch {
        // La session est déjà créée via /login, on continue sans bloquer l'accès.
      }

      toast.success(`Bienvenue, ${user.firstName} ${user.lastName} !`);
      // Redirection selon le rôle
      navigate(getDashboardByRole(user.roleCode), { replace: true });
    } catch (err) {
      const message = err.response?.data?.message || 'Identifiants incorrects';
      setError(message);
      toast.error(message);
      setQuickLoading(false);
    } finally {
      setLoading(false);
    }
  };

  // Soumission du formulaire manuel
  const handleLogin = async (e) => {
    e.preventDefault();
    await doLogin(email, password);
  };

  // Accès rapide Super Admin → connexion immédiate
  const handleQuickLogin = async () => {
    if (loading) return;
    setQuickLoading(true);
    setEmail(QUICK_ACCOUNT.email);
    setPassword(QUICK_ACCOUNT.password);
    await doLogin(QUICK_ACCOUNT.email, QUICK_ACCOUNT.password);
  };

  // Détection du verrouillage majuscules pendant la saisie du mot de passe
  const handleCapsCheck = (e) => {
    if (typeof e.getModifierState === 'function') {
      setCapsOn(e.getModifierState('CapsLock'));
    }
  };

  const isDark = theme === 'dark';

  return (
    <div className="lp-page">
      {/* ─── Volet d'identité ─────────────────────────────────
          `data-theme='dark'` n'est pas une coquille : ce volet est sombre quel
          que soit le thème de la page — c'est un choix de mise en page. Il
          portait pour cela sa propre palette de bleus marine ; l'attribut fait
          descendre les jetons du thème sombre depuis leur unique déclaration,
          si bien qu'il n'y a plus de seconde palette à maintenir. L'attribut
          n'est lu que par le CSS ; le store continue de piloter celui du
          document, sans interférence. */}
      <aside className="lp-aside" data-theme="dark">
        <div className="lp-brand">
          <div className="lp-brand-mark" aria-hidden="true">
            <Activity size={24} strokeWidth={2.5} />
          </div>
          <div>
            <div className="lp-brand-name">GardeSante</div>
            <div className="lp-brand-tag">{t('auth.platform_desc')}</div>
          </div>
        </div>

        <div className="lp-hero">
          <span className="lp-hero-eyebrow">
            <ShieldCheck size={13} aria-hidden="true" />
            Plateforme nationale
          </span>
          <h1 className="lp-hero-title">
            Les gardes hospitalières,<br />
            <em>d'un seul tenant.</em>
          </h1>
          <p className="lp-hero-text">
            Établissements, services, plannings et remplacements dans un même espace —
            chaque action tracée, chaque changement visible immédiatement par tous.
          </p>
        </div>

        <ul className="lp-features">
          {PLATFORM_FEATURES.map(({ icon: Icon, title, desc }) => (
            <li key={title} className="lp-feature">
              <span className="lp-feature-icon" aria-hidden="true"><Icon size={17} /></span>
              <span>
                <span className="lp-feature-title">{title}</span>
                <span className="lp-feature-desc">{desc}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="lp-aside-foot">
          GardeSante v1.0 · Gestion des gardes hospitalières · Tunisie
        </p>
      </aside>

      {/* ─── Volet de connexion ───────────────────────────── */}
      <main className="lp-main">
        <div className="lp-toolbar">
          <button
            type="button"
            className="lp-chip"
            onClick={() => setLanguage(language === 'fr' ? 'ar' : 'fr')}
            title="Changer la langue / تغيير اللغة"
          >
            <Languages size={14} aria-hidden="true" />
            {language === 'fr' ? 'العربية' : 'Français'}
          </button>
          <button
            type="button"
            className="lp-chip"
            onClick={toggleTheme}
            title={isDark ? 'Thème clair' : 'Thème sombre'}
            aria-label={isDark ? 'Passer au thème clair' : 'Passer au thème sombre'}
          >
            {isDark ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
            {isDark ? 'Clair' : 'Sombre'}
          </button>
        </div>

        <div className="lp-form-wrap lp-rise">
          <div className="lp-head">
            <h2>{t('auth.welcome_back')}</h2>
            <p>Connectez-vous pour accéder à votre espace de travail.</p>
          </div>

          <form className="lp-form" onSubmit={handleLogin}>
            <div className="lp-field">
              <label className="lp-label" htmlFor="email">{t('auth.email')}</label>
              <div className="lp-input-shell">
                <span className="lp-input-icon"><Mail size={17} aria-hidden="true" /></span>
                <input
                  id="email"
                  type="email"
                  className="lp-input"
                  placeholder="votre@email.tn"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            <div className="lp-field">
              <label className="lp-label" htmlFor="password">{t('auth.password')}</label>
              <div className="lp-input-shell">
                <span className="lp-input-icon"><Lock size={17} aria-hidden="true" /></span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="lp-input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  onKeyUp={handleCapsCheck}
                  onKeyDown={handleCapsCheck}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="lp-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              {capsOn && (
                <span className="lp-caps">
                  <AlertCircle size={13} aria-hidden="true" />
                  Verrouillage des majuscules activé
                </span>
              )}
            </div>

            {error && (
              <div className="lp-error" role="alert">
                <AlertCircle size={16} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="lp-submit" disabled={loading}>
              {loading && !quickLoading ? (
                <>
                  <Loader2 size={17} className="lp-spin" aria-hidden="true" />
                  {t('auth.signing_in')}
                </>
              ) : (
                <>
                  {t('auth.sign_in')}
                  <ArrowRight size={17} aria-hidden="true" />
                </>
              )}
            </button>
          </form>

          {/* Accès rapide — Super Admin uniquement */}
          <div className="lp-quick">
            <p className="lp-quick-label">Connexion rapide</p>
            <button
              type="button"
              className="lp-quick-btn"
              onClick={handleQuickLogin}
              disabled={loading}
            >
              <span className="lp-quick-icon" aria-hidden="true">
                <ShieldCheck size={19} />
              </span>
              <span className="lp-quick-text">
                <span className="lp-quick-role">{QUICK_ACCOUNT.label}</span>
                <span className="lp-quick-mail">{QUICK_ACCOUNT.email}</span>
              </span>
              {quickLoading
                ? <Loader2 size={17} className="lp-spin lp-quick-arrow" aria-hidden="true" />
                : <ArrowRight size={17} className="lp-quick-arrow" aria-hidden="true" />}
            </button>
          </div>

          <p className="lp-foot">
            Accès réservé au personnel habilité · Toute connexion est enregistrée.
          </p>
        </div>
      </main>
    </div>
  );
}

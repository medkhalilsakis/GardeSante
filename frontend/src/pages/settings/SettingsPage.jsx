import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Languages,
  LockKeyhole,
  MonitorCog,
  Moon,
  Settings2,
  ShieldCheck,
  Sun,
  UserRound,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { profileAPI } from '../../api';
import Avatar from '../../components/common/Avatar';
import { GsBadge, GsPageHeader, GsPanel, GsTabRail } from '../../components/gs';
import { useAuthStore, useUIStore } from '../../store';
import { useTranslation } from '../../utils/helpers';
import './settings.css';

const TABS = [
  { id: 'account', label: 'Compte', icon: <UserRound size={15} aria-hidden="true" /> },
  { id: 'security', label: 'Sécurité', icon: <ShieldCheck size={15} aria-hidden="true" /> },
  { id: 'preferences', label: 'Préférences', icon: <Settings2 size={15} aria-hidden="true" /> },
];

function Field({ label, required = false, hint, children }) {
  return (
    <label className="gsset-field">
      <span>{label}{required ? <b aria-hidden="true">*</b> : null}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function AccountTab({ user, roleLabel, onOpenProfile }) {
  const facts = [
    ['Adresse email', user?.email],
    ['Matricule', user?.matricule],
    ['Rôle', roleLabel],
    ['Grade', user?.grade],
    ['Établissement', user?.establishmentName],
    ['Service principal', user?.departments?.find((department) => department.isPrimary)?.name || user?.departments?.[0]?.name],
  ];

  return (
    <div className="gsset-account-grid">
      <GsPanel title="Dossier de compte" sub="Résumé des informations utilisées par la plateforme." icon={<UserRound size={18} aria-hidden="true" />}>
        <div className="gsset-account-card">
          <Avatar avatarUrl={user?.avatarUrl} firstName={user?.firstName} lastName={user?.lastName} size="xl" />
          <div>
            <span className="gs-eyebrow">Compte connecté</span>
            <h2>{user?.firstName} {user?.lastName}</h2>
            <p>{roleLabel}</p>
          </div>
          <GsBadge tone="duty" dot>Session active</GsBadge>
        </div>
        <dl className="gsset-facts">
          {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}
        </dl>
      </GsPanel>

      <GsPanel title="Informations personnelles" sub="Les modifications suivent le circuit d’approbation et restent traçables." icon={<MonitorCog size={18} aria-hidden="true" />}>
        <div className="gsset-profile-link">
          <div>
            <strong>Ouvrir le dossier de profil</strong>
            <p>Photo, coordonnées, identité, fonction déclarée et historique des demandes.</p>
          </div>
          <button type="button" className="gs-btn is-primary" onClick={onOpenProfile}>
            Gérer mon profil <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      </GsPanel>
    </div>
  );
}

function SecurityTab() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);

  const changePassword = useMutation({
    mutationFn: (data) => profileAPI.updateCredentials(data),
    onSuccess: () => {
      toast.success('Mot de passe modifié avec succès');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
    onError: (error) => toast.error(error.response?.data?.message || 'Mot de passe actuel incorrect'),
  });

  const checks = [
    { label: '8 caractères minimum', ok: form.newPassword.length >= 8 },
    { label: 'une majuscule', ok: /[A-Z]/.test(form.newPassword) },
    { label: 'un chiffre', ok: /[0-9]/.test(form.newPassword) },
    { label: 'un caractère spécial', ok: /[^A-Za-z0-9]/.test(form.newPassword) },
  ];

  const submit = (event) => {
    event.preventDefault();
    if (form.newPassword !== form.confirmPassword) return toast.error('Les mots de passe ne correspondent pas');
    if (form.newPassword.length < 8) return toast.error('Le mot de passe doit contenir au moins 8 caractères');
    changePassword.mutate({ currentPassword: form.currentPassword, newPassword: form.newPassword });
  };

  return (
    <GsPanel title="Changer le mot de passe" sub="La nouvelle valeur doit être unique et ne jamais être partagée." icon={<LockKeyhole size={18} aria-hidden="true" />} className="gsset-security-panel">
      <form className="gsset-security-form" onSubmit={submit}>
        <Field label="Mot de passe actuel" required>
          <div className="gsset-password-input">
            <input type={showPassword ? 'text' : 'password'} value={form.currentPassword} onChange={(event) => setForm((current) => ({ ...current, currentPassword: event.target.value }))} autoComplete="current-password" />
            <button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Masquer les mots de passe' : 'Afficher les mots de passe'}>
              {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>
        </Field>
        <Field label="Nouveau mot de passe" required><input type={showPassword ? 'text' : 'password'} value={form.newPassword} onChange={(event) => setForm((current) => ({ ...current, newPassword: event.target.value }))} autoComplete="new-password" /></Field>
        <Field label="Confirmation" required><input type={showPassword ? 'text' : 'password'} value={form.confirmPassword} onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))} autoComplete="new-password" /></Field>

        {form.newPassword ? (
          <ul className="gsset-password-rules">
            {checks.map((check) => <li key={check.label} data-valid={check.ok ? 'true' : 'false'}>{check.ok ? <Check size={13} aria-hidden="true" /> : <span aria-hidden="true" />}{check.label}</li>)}
          </ul>
        ) : null}

        <div className="gsset-security-actions">
          <span>La mise à jour révoque les jetons de renouvellement existants.</span>
          <button type="submit" className="gs-btn is-danger" disabled={changePassword.isPending || !form.currentPassword || !form.newPassword || form.newPassword !== form.confirmPassword}>
            <KeyRound size={15} aria-hidden="true" /> {changePassword.isPending ? 'Modification…' : 'Modifier le mot de passe'}
          </button>
        </div>
      </form>
    </GsPanel>
  );
}

function PreferencesTab({ user }) {
  const { language, setLanguage, theme, setTheme } = useUIStore();
  const updateUser = useAuthStore((state) => state.updateUser);

  const saveLanguage = useMutation({
    mutationFn: (preferredLanguage) => profileAPI.updatePreferences({ preferredLanguage }),
    onSuccess: (_response, preferredLanguage) => {
      setLanguage(preferredLanguage);
      updateUser({ preferredLanguage });
      toast.success(preferredLanguage === 'fr' ? 'Interface en français' : 'تم تغيير لغة الواجهة');
    },
    onError: (error) => toast.error(error.response?.data?.message || 'Impossible d’enregistrer la langue'),
  });

  const languages = [
    { id: 'fr', name: 'Français', detail: 'Lecture de gauche à droite' },
    { id: 'ar', name: 'العربية', detail: 'واجهة من اليمين إلى اليسار' },
  ];

  const themes = [
    { id: 'light', name: 'Clair', detail: 'Papier clair et encre sombre', icon: Sun },
    { id: 'dark', name: 'Sombre', detail: 'Papier sombre et encre claire', icon: Moon },
  ];

  return (
    <div className="gsset-preference-grid">
      <GsPanel title="Langue de l’interface" sub="La préférence est liée à votre compte et suit votre prochaine session." icon={<Languages size={18} aria-hidden="true" />}>
        <div className="gsset-option-list">
          {languages.map((option) => (
            <button key={option.id} type="button" aria-pressed={language === option.id} onClick={() => saveLanguage.mutate(option.id)} disabled={saveLanguage.isPending}>
              <Globe2 size={18} aria-hidden="true" />
              <span><strong>{option.name}</strong><small>{option.detail}</small></span>
              {language === option.id ? <Check size={17} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </GsPanel>

      <GsPanel title="Apparence" sub="Le thème agit immédiatement sur ce navigateur." icon={<MonitorCog size={18} aria-hidden="true" />}>
        <div className="gsset-option-list">
          {themes.map((option) => {
            const Icon = option.icon;
            return (
              <button key={option.id} type="button" aria-pressed={theme === option.id} onClick={() => setTheme(option.id)}>
                <Icon size={18} aria-hidden="true" />
                <span><strong>{option.name}</strong><small>{option.detail}</small></span>
                {theme === option.id ? <Check size={17} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </GsPanel>

      <GsPanel title="Informations de session" sub="Repères techniques utiles au support, sans donnée secrète." icon={<ShieldCheck size={18} aria-hidden="true" />} className="gsset-system-panel">
        <dl className="gsset-system-list">
          <div><dt>Plateforme</dt><dd>GardeSante</dd></div>
          <div><dt>Établissement</dt><dd>{user?.establishmentName || 'Non renseigné'}</dd></div>
          <div><dt>Identifiant établissement</dt><dd className="gs-num">{user?.establishmentId ? `${user.establishmentId.slice(0, 8)}…` : '—'}</dd></div>
          <div><dt>Authentification</dt><dd>Session sécurisée</dd></div>
        </dl>
      </GsPanel>
    </div>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { t } = useTranslation();
  const [tab, setTab] = useState('account');
  const roleLabel = t(`roles.${user?.roleCode}`, user?.roleName || user?.roleCode || 'Rôle non renseigné');

  return (
    <div className="gsset-page">
      <GsPageHeader
        eyebrow="Mon espace"
        title="Paramètres"
        subtitle="Réglez votre compte, sa sécurité et l’affichage de la plateforme."
        meta={[{ label: 'Compte', value: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email }, { label: 'Établissement', value: user?.establishmentName || 'Non renseigné' }]}
      >
        <GsTabRail tabs={TABS} value={tab} onChange={setTab} label="Sections des paramètres" />
      </GsPageHeader>

      <div className="gsset-content">
        {tab === 'account' ? <AccountTab user={user} roleLabel={roleLabel} onOpenProfile={() => navigate('/profile')} /> : null}
        {tab === 'security' ? <SecurityTab /> : null}
        {tab === 'preferences' ? <PreferencesTab user={user} /> : null}
      </div>
    </div>
  );
}

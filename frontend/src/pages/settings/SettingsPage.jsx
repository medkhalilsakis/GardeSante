import React, { useState } from 'react';
import { useAuthStore, useUIStore } from '../../store';
import { authAPI, usersAPI } from '../../api';
import { useTranslation } from '../../utils/helpers';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { user, updateUser } = useAuthStore();
  const { language, setLanguage } = useUIStore();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState('profile');
  const [profileForm, setProfileForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    phone: user?.phone || '',
    speciality: user?.speciality || '',
  });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await usersAPI.update(user.id, profileForm);
      updateUser(res.data.data);
      toast.success('Profil mis à jour');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur');
    } finally { setSaving(false); }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      return toast.error('Les mots de passe ne correspondent pas');
    }
    if (passwordForm.newPassword.length < 8) {
      return toast.error('Le mot de passe doit contenir au moins 8 caractères');
    }
    setSaving(true);
    try {
      await authAPI.changePassword({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword });
      toast.success('Mot de passe modifié avec succès');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Mot de passe actuel incorrect');
    } finally { setSaving(false); }
  };

  const tabs = [
    { id: 'profile', label: 'Mon profil', icon: '👤' },
    { id: 'security', label: 'Sécurité', icon: '🔐' },
    { id: 'preferences', label: 'Préférences', icon: '⚙️' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Paramètres</h1>
          <p className="page-subtitle">Gérer votre compte et vos préférences</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 'var(--space-6)' }}>
        {/* Sidebar onglets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px',
                borderRadius: 'var(--border-radius-sm)',
                border: 'none',
                background: activeTab === tab.id ? 'var(--color-primary-10)' : 'transparent',
                color: activeTab === tab.id ? 'var(--color-primary-light)' : 'var(--text-secondary)',
                fontWeight: activeTab === tab.id ? 600 : 400,
                fontSize: 'var(--font-sm)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                transition: 'all var(--transition-fast)',
                borderLeft: activeTab === tab.id ? '2px solid var(--color-primary)' : '2px solid transparent',
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}

          {/* Avatar */}
          <div style={{ marginTop: 24, padding: 16, textAlign: 'center' }}>
            <div className="avatar avatar-xl" style={{
              background: 'var(--color-primary-10)', color: 'var(--color-primary-light)',
              fontWeight: 800, margin: '0 auto 12px',
              fontSize: 'var(--font-3xl)',
            }}>
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 'var(--font-sm)' }}>
              {user?.firstName} {user?.lastName}
            </p>
            <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
              {t(`roles.${user?.roleCode}`)}
            </p>
            <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 4 }}>
              {user?.establishmentName}
            </p>
          </div>
        </div>

        {/* Contenu onglet */}
        <div>
          {/* Profil */}
          {activeTab === 'profile' && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Informations personnelles</h3>
              </div>
              <form onSubmit={handleSaveProfile}>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Prénom</label>
                      <input className="form-control" value={profileForm.firstName} onChange={e => setProfileForm(f => ({ ...f, firstName: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Nom</label>
                      <input className="form-control" value={profileForm.lastName} onChange={e => setProfileForm(f => ({ ...f, lastName: e.target.value }))} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input className="form-control" value={user?.email} disabled style={{ opacity: 0.5 }} />
                    <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>L'email ne peut pas être modifié</span>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Téléphone</label>
                      <input className="form-control" value={profileForm.phone} onChange={e => setProfileForm(f => ({ ...f, phone: e.target.value }))} placeholder="+213..." />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Spécialité</label>
                      <input className="form-control" value={profileForm.speciality} onChange={e => setProfileForm(f => ({ ...f, speciality: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, padding: 16, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                    {[
                      { label: 'Matricule', value: user?.matricule },
                      { label: 'Grade', value: user?.grade },
                      { label: 'Rôle', value: t(`roles.${user?.roleCode}`) },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginBottom: 2 }}>{label}</p>
                        <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 'var(--font-sm)' }}>{value || '—'}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Sauvegarde...' : 'Enregistrer les modifications'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Sécurité */}
          {activeTab === 'security' && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">🔐 Changer le mot de passe</h3>
              </div>
              <form onSubmit={handleChangePassword}>
                <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 420 }}>
                  <div className="form-group">
                    <label className="form-label">Mot de passe actuel *</label>
                    <input type="password" className="form-control" value={passwordForm.currentPassword}
                      onChange={e => setPasswordForm(f => ({ ...f, currentPassword: e.target.value }))} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nouveau mot de passe *</label>
                    <input type="password" className="form-control" value={passwordForm.newPassword}
                      onChange={e => setPasswordForm(f => ({ ...f, newPassword: e.target.value }))} required minLength={8} />
                    <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>Minimum 8 caractères avec majuscule, chiffre et symbole</span>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Confirmer le mot de passe *</label>
                    <input type="password" className="form-control" value={passwordForm.confirmPassword}
                      onChange={e => setPasswordForm(f => ({ ...f, confirmPassword: e.target.value }))} required />
                    {passwordForm.newPassword && passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword && (
                      <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-danger)' }}>Les mots de passe ne correspondent pas</span>
                    )}
                  </div>
                </div>
                <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Modification...' : 'Modifier le mot de passe'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Préférences */}
          {activeTab === 'preferences' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">🌐 Langue & Direction</h3>
                </div>
                <div className="card-body">
                  <p style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', marginBottom: 16 }}>
                    Choisissez la langue d'affichage de l'interface. Le mode arabe activera automatiquement le sens RTL.
                  </p>
                  <div style={{ display: 'flex', gap: 12 }}>
                    {[
                      { lang: 'fr', label: '🇫🇷 Français', sublabel: 'Interface en français (LTR)' },
                      { lang: 'ar', label: '🇩🇿 العربية', sublabel: 'واجهة عربية (RTL)' },
                    ].map(({ lang, label, sublabel }) => (
                      <button
                        key={lang}
                        onClick={() => { setLanguage(lang); toast.success(lang === 'fr' ? 'Interface passée en français' : 'تم تغيير اللغة إلى العربية'); }}
                        style={{
                          flex: 1, padding: '16px 20px',
                          background: language === lang ? 'var(--color-primary-10)' : 'var(--bg-elevated)',
                          border: `2px solid ${language === lang ? 'var(--color-primary)' : 'var(--border-default)'}`,
                          borderRadius: 10, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                          transition: 'all var(--transition-fast)',
                        }}
                      >
                        <p style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{label}</p>
                        <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{sublabel}</p>
                        {language === lang && <p style={{ fontSize: 'var(--font-xs)', color: 'var(--color-success)', marginTop: 4 }}>✓ Langue actuelle</p>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">ℹ️ Informations système</h3>
                </div>
                <div className="card-body">
                  <div style={{ display: 'grid', gap: 10 }}>
                    {[
                      { label: 'Version', value: 'GardeSante v1.0.0' },
                      { label: 'Établissement ID', value: user?.establishmentId?.substring(0, 8) + '...' },
                      { label: 'Session', value: 'JWT · Expire dans 24h' },
                      { label: 'Navigateur', value: navigator.userAgent.split(' ').slice(-1)[0] },
                    ].map(({ label, value }) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{label}</span>
                        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

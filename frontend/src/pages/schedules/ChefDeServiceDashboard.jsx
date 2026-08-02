import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store';
import { departmentsAPI, schedulesAPI, absencesAPI, scheduleBuilderAPI, shiftsAPI } from '../../api';
import SmartSpreadsheet from './components/SmartSpreadsheet';
import VisualCalendar from './components/VisualCalendar';
import ImportModal from './components/ImportModal';
import HospitalStaffPicker from './components/HospitalStaffPicker';
import toast from 'react-hot-toast';

// ─── Icons ────────────────────────────────────────────────────
const Svg = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const IconCalendar = () => <Svg d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />;
const IconPlus     = () => <Svg d="M12 5v14M5 12h14" />;
const IconUsers    = () => <Svg d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />;
const IconClip     = () => <Svg d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />;
const IconCheck    = () => <Svg d="M20 6L9 17l-5-5" />;
const IconAlert    = () => <Svg d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" />;
const IconSend     = () => <Svg d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />;
const IconRight    = () => <Svg d="M9 18l6-6-6-6" />;
const IconStar     = () => <Svg d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17 5.8 21.3l2.4-7.4L2 9.4h7.6z" />;
const IconTable    = () => <Svg d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" />;
const IconGrid     = () => <Svg d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />;

// ─── Status Badge ─────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const map = {
    draft:        { label: 'Brouillon',   bg: '#F3F4F6', color: '#6B7280' },
    submitted:    { label: 'Soumis',      bg: '#EFF6FF', color: '#3B82F6' },
    under_review: { label: 'En revision', bg: '#FFFBEB', color: '#F59E0B' },
    approved:     { label: 'Approuve',    bg: '#ECFDF5', color: '#10B981' },
    rejected:     { label: 'Rejete',      bg: '#FEF2F2', color: '#EF4444' },
    active:       { label: 'Actif',       bg: '#ECFDF5', color: '#059669' },
  };
  const c = map[status] || { label: status, bg: '#F3F4F6', color: '#6B7280' };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
      {c.label}
    </span>
  );
};

// ─── KPI Card ─────────────────────────────────────────────────
const KpiCard = ({ icon, label, value, sub, color }) => (
  <div
    style={{
      background: 'var(--bg-card)', borderRadius: 16,
      border: '1px solid var(--border-subtle)',
      padding: '20px 24px',
      borderLeft: `4px solid ${color}`,
      display: 'flex', flexDirection: 'column', gap: 8,
      transition: 'transform .2s, box-shadow .2s',
      cursor: 'default',
    }}
    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,.1)'; }}
    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{value ?? '-'}</div>
      <div style={{ background: color + '18', color, borderRadius: 12, padding: 12, lineHeight: 0 }}>{icon}</div>
    </div>
    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
  </div>
);

// ─── Presence helper ──────────────────────────────────────────
const getPresence = (lastActivity) => {
  if (!lastActivity) return { label: 'Jamais connecte', dot: '#D1D5DB' };
  const mins = (Date.now() - new Date(lastActivity)) / 60000;
  if (mins < 5)   return { label: 'Connecte',           dot: '#10B981' };
  if (mins < 30)  return { label: `Il y a ${Math.round(mins)}min`, dot: '#F59E0B' };
  const h = mins / 60;
  if (h < 24)     return { label: `Il y a ${Math.round(h)}h`, dot: '#D1D5DB' };
  return { label: `Il y a ${Math.floor(h / 24)}j`, dot: '#E5E7EB' };
};

// ─── Step 1: Création planning (Nom + Dates) ─────────────────
const PlanningStep1 = ({ departmentId, onCreated, onBack }) => {
  const [name, setName]         = useState('');
  const [startDate, setStart]   = useState('');
  const [endDate, setEnd]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const totalDays = startDate && endDate
    ? Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1 : 0;

  const today = new Date().toISOString().split('T')[0];
  const shortcuts = [
    { label: 'Ce mois',      fn: () => { const d = new Date(), y = d.getFullYear(), m = d.getMonth(); return { s: `${y}-${String(m+1).padStart(2,'0')}-01`, e: new Date(y,m+1,0).toISOString().split('T')[0] }; } },
    { label: 'Mois prochain',fn: () => { const d = new Date(), y = d.getFullYear(), m = d.getMonth()+1; return { s: `${y}-${String(m+1).padStart(2,'0')}-01`, e: new Date(y,m+1,0).toISOString().split('T')[0] }; } },
    { label: '3 mois',       fn: () => { const d = new Date(); const e = new Date(d); e.setMonth(e.getMonth()+3); return { s: d.toISOString().split('T')[0], e: e.toISOString().split('T')[0] }; } },
  ];

  const handleCreate = async () => {
    setError('');
    if (!startDate || !endDate) return setError('La date de début et de fin sont obligatoires.');
    if (new Date(endDate) < new Date(startDate)) return setError('La date de fin doit être après la date de début.');
    if (!departmentId) return setError('Service introuvable. Veuillez patienter que la page se charge complètement.');
    setSaving(true);
    try {
      const defaultName = name.trim() || `Planning ${new Date(startDate).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;
      const res = await schedulesAPI.create({ name: defaultName, start_date: startDate, end_date: endDate, department_id: departmentId, status: 'draft', creation_mode: 'assistant' });
      const id = res.data?.data?.id || res.data?.id;
      if (!id) throw new Error('ID de planning non reçu.');
      onCreated(id, defaultName, startDate, endDate);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Erreur lors de la création du planning.');
    } finally {
      setSaving(false);
    }
  };

  const inputSt = { width: '100%', padding: '11px 14px', borderRadius: 10, fontSize: 14, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ maxWidth: 540, margin: '0 auto' }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>1</div>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-primary)' }}>Informations</span>
        </div>
        <div style={{ flex: 1, height: 2, background: 'var(--border-subtle)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.4 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg-elevated)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, border: '2px solid var(--border-subtle)' }}>2</div>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-muted)' }}>Méthode</span>
        </div>
      </div>

      <div style={{ background: 'var(--bg-card)', borderRadius: 18, border: '1px solid var(--border-subtle)', padding: 28 }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800 }}>📅 Définir la période</h3>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)' }}>Ces informations sont obligatoires pour créer votre planning.</p>

        {/* Shortcuts */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {shortcuts.map(p => (
            <button key={p.label} onClick={() => { const v = p.fn(); setStart(v.s); setEnd(v.e); }}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--color-primary)', background: 'rgba(27,79,202,.06)', color: 'var(--color-primary)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Dates */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Date de début *</span>
            <input type="date" style={inputSt} value={startDate} min={today} onChange={e => setStart(e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Date de fin *</span>
            <input type="date" style={inputSt} value={endDate} min={startDate || today} onChange={e => setEnd(e.target.value)} />
          </label>
        </div>

        {totalDays > 0 && (
          <div style={{ padding: '8px 14px', background: '#EFF6FF', borderRadius: 8, fontSize: 12, color: '#3B82F6', fontWeight: 600, marginBottom: 14 }}>
            📊 {totalDays} jour{totalDays > 1 ? 's' : ''} · {Math.ceil(totalDays / 7)} semaine{Math.ceil(totalDays/7) > 1 ? 's' : ''}
          </div>
        )}

        {/* Nom */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 20 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Nom du planning <span style={{ fontWeight: 400 }}>(optionnel — généré automatiquement si vide)</span></span>
          <input type="text" style={inputSt} placeholder={`Ex: Gardes ${new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} — Urgences`}
            value={name} onChange={e => setName(e.target.value)} />
        </label>

        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#EF4444', marginBottom: 14, fontWeight: 600 }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onBack} style={{ padding: '11px 20px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }}>Annuler</button>
          <button onClick={handleCreate} disabled={saving || !startDate || !endDate}
            style={{ padding: '11px 28px', borderRadius: 10, border: 'none', background: saving || !startDate || !endDate ? '#9CA3AF' : 'linear-gradient(135deg, var(--color-primary), #7C3AED)', color: '#fff', fontWeight: 700, cursor: saving || !startDate || !endDate ? 'not-allowed' : 'pointer', fontSize: 14, boxShadow: saving ? 'none' : '0 4px 14px rgba(27,79,202,.3)' }}>
            {saving ? 'Création...' : 'Suivant →'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Step 2: Méthode de création ─────────────────────────────
const MethodSelector = ({ onSelect }) => {
  const methods = [
    {
      id: 'assistant', color: '#8B5CF6',
      gradient: 'linear-gradient(135deg,#8B5CF6,#6D28D9)',
      icon: '🤖',
      title: 'Assistant Intelligent', tag: 'Recommandé',
      desc: 'L\'assistant vous guide étape par étape. Répondez à quelques questions et le planning est généré automatiquement selon vos contraintes.',
      features: ['Génération automatique', 'Détection des conflits', 'Rotation équitable', '8 algorithmes disponibles'],
    },
    {
      id: 'spreadsheet', color: '#0891B2',
      gradient: 'linear-gradient(135deg,#0891B2,#0E7490)',
      icon: '📊',
      title: 'Tableur Manuel', tag: 'Contrôle total',
      desc: 'Remplissez vous-même le tableau de garde. Ajoutez le personnel, définissez les durées de garde et les colonnes personnalisées.',
      features: ['Colonnes dynamiques', 'Durées personnalisées', 'Import/Export Excel', 'Clic droit contextuel'],
    },
    {
      id: 'import', color: '#059669',
      gradient: 'linear-gradient(135deg,#059669,#047857)',
      icon: '📥',
      title: 'Importer Excel / CSV', tag: 'Rapide',
      desc: 'Importez un fichier Excel ou CSV existant. Le système reconnaît automatiquement les colonnes et vérifie les données.',
      features: ['Modèle téléchargeable', 'Vérification des données', 'Prévisualisation avant import', 'CSV et XLSX supportés'],
    },
  ];

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.6 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#10B981', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>✓</div>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#10B981' }}>Informations</span>
        </div>
        <div style={{ flex: 1, height: 2, background: 'var(--color-primary)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>2</div>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-primary)' }}>Choisir la méthode</span>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>Comment créer ce planning ?</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Le planning est déjà enregistré — choisissez maintenant la méthode de saisie</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 20 }}>
        {methods.map(m => (
          <div key={m.id} onClick={() => onSelect(m.id)}
            style={{ background: 'var(--bg-card)', borderRadius: 20, overflow: 'hidden', border: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'transform .2s, box-shadow .2s' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 16px 40px ${m.color}22`; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
          >
            <div style={{ background: m.gradient, padding: '24px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 28 }}>{m.icon}</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 4 }}>{m.title}</div>
                <span style={{ background: 'rgba(255,255,255,.2)', color: '#fff', padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>{m.tag}</span>
              </div>
            </div>
            <div style={{ padding: '18px 22px' }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>{m.desc}</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {m.features.map(f => (
                  <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
                    <span style={{ color: m.color, lineHeight: 0 }}><IconCheck /></span> {f}
                  </li>
                ))}
              </ul>
              <button style={{ width: '100%', marginTop: 16, padding: '10px 0', border: 'none', borderRadius: 10, background: m.gradient, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Commencer</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── StaffRow component ────────────────────────────────────────
const StaffRow = ({ m, sel, isExternal, deptName, onToggle }) => (
  <div onClick={onToggle}
    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, cursor: 'pointer',
      border: `1.5px solid ${sel ? 'var(--color-primary)' : 'var(--border-subtle)'}`,
      background: sel ? 'rgba(27,79,202,.05)' : 'var(--bg-card)', transition: 'all .1s',
    }}
    onMouseEnter={e => e.currentTarget.style.background = sel ? 'rgba(27,79,202,.08)' : 'var(--bg-elevated)'}
    onMouseLeave={e => e.currentTarget.style.background = sel ? 'rgba(27,79,202,.05)' : 'var(--bg-card)'}
  >
    <div style={{ width: 32, height: 32, borderRadius: '50%', background: isExternal ? '#D97706' : 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
      {(m.first_name||'?')[0]}{(m.last_name||'?')[0]}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.first_name} {m.last_name}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span>{m.role_name}</span>
        {isExternal && deptName && <span style={{ color: '#D97706', fontWeight: 600 }}>⚡ {deptName}</span>}
      </div>
    </div>
    {isExternal && <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 9, fontWeight: 800, background: '#FFFBEB', color: '#D97706' }}>Externe</span>}
    {sel && <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}><IconCheck /></span>}
  </div>
);

// ─── Wizard Assistant ─────────────────────────────────────────
const WizardAssistant = ({ departmentId, scheduleId, startDate: initStart, endDate: initEnd, name: initName, onBack, onDone }) => {
  const [step, setStep]         = useState(0);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [context, setContext]   = useState(null);
  const [staffSearch, setStaffSearch]           = useState('');
  const [showExternalPicker, setShowExternalPicker] = useState(false);
  const [roleSearch, setRoleSearch]             = useState('');
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(null);
  const [stepError, setStepError]               = useState('');
  const [cfg, setCfg] = useState({
    startDate: initStart || '', endDate: initEnd || '', name: initName || '',
    periodType: 'monthly', useWeekSlices: false, weekSlices: [],
    shiftTypeId: '', algo: 'round_robin',
    staffIds: [], requiredPosts: [],
    externalStaff: [], teamA: [], teamB: [],
  });

  // Wizard context (shift types)
  useEffect(() => {
    if (!departmentId) return;
    scheduleBuilderAPI.getWizardContext({ departmentId })
      .then(r => setContext(r.data.data))
      .catch(() => {});
  }, [departmentId]);

  // TOUT le personnel de l'hôpital — propre service en premier
  const { data: hospitalStaffData, isLoading: staffLoading } = useQuery({
    queryKey: ['hospital-staff-wizard', staffSearch],
    queryFn: () => schedulesAPI.getHospitalStaff({ search: staffSearch || undefined, limit: 200 }),
    staleTime: 60000,
  });
  const allHospitalStaff = hospitalStaffData?.data?.data || hospitalStaffData?.data || [];
  // Groupe 1: même service, Groupe 2: autres services, Groupe 3: sans service
  const ownStaff     = allHospitalStaff.filter(m => m.dept_id === departmentId);
  const otherStaff   = allHospitalStaff.filter(m => m.dept_id && m.dept_id !== departmentId);
  const noServiceStaff = allHospitalStaff.filter(m => !m.dept_id);

  // Fetch platform roles (dynamique)
  const { data: rolesData } = useQuery({
    queryKey: ['platform-roles'],
    queryFn: () => schedulesAPI.getRoles(),
    staleTime: 5 * 60 * 1000,
  });
  const platformRoles = rolesData?.data?.data || rolesData?.data || [];
  const filteredPlatformRoles = platformRoles.filter(r =>
    !roleSearch || r.name.toLowerCase().includes(roleSearch.toLowerCase())
  );

  const WEEK_TYPES = [
    { id: 'semaine_a',      label: 'Semaine A',                   emoji: '🔵', desc: 'Première équipe en rotation' },
    { id: 'semaine_b',      label: 'Semaine B',                   emoji: '🟢', desc: 'Deuxième équipe en rotation' },
    { id: 'collaboration',  label: 'Collaboration inter-hôpital', emoji: '🤝', desc: 'Personnel externe inclus' },
    { id: 'formation',      label: 'Semaine formation',           emoji: '📚', desc: 'Gardes légères + formation' },
    { id: 'renfort',        label: 'Semaine renforcée',           emoji: '💪', desc: 'Effectif augmenté (pic, épidémie)' },
    { id: 'custom',         label: 'Personnalisée',               emoji: '✏️', desc: 'Nom libre défini par le chef' },
  ];

  const algoOptions = [
    { id: 'round_robin',     label: 'Round-Robin équitable',      emoji: '🔄', badge: 'Recommandé',
      desc: 'Distribution cyclique équitable en tenant compte des gardes passées. Chaque membre reçoit un nombre de gardes quasi-identique.' },
    { id: 'ab_rotation',     label: 'Rotation A/B',              emoji: '↔️', badge: null,
      desc: 'Deux équipes alternatives qui tournent chaque semaine. Idéal pour les plannings avec organisation Semaine A / Semaine B.' },
    { id: 'weighted_fair',   label: 'Équilibrage pondéré',        emoji: '⚖️', badge: 'Nouveau',
      desc: 'Tient compte de l\'ancienneté, spécialité et charge récente pour une distribution encore plus juste.' },
    { id: 'constraint_first',label: 'Contraintes prioritaires',   emoji: '🛡️', badge: null,
      desc: 'Respecte d\'abord les indisponibilités et repos requis, puis distribue les gardes restantes.' },
    { id: 'skill_match',     label: 'Adéquation compétences',     emoji: '🎯', badge: 'Nouveau',
      desc: 'Affecte chaque garde selon la spécialité et le grade requis par poste. Optimise la qualité de couverture.' },
    { id: 'min_fatigue',     label: 'Minimisation fatigue',       emoji: '😴', badge: null,
      desc: 'Évite les gardes consécutives, respecte les temps de repos réglementaires et limite la charge hebdomadaire.' },
    { id: 'cyclic',          label: 'Cyclique fixe',              emoji: '📊', badge: null,
      desc: 'Chaque membre suit un pattern de rotation prédéfini et répété. Prévisible et stable dans le temps.' },
    { id: 'manual',          label: 'Manuel assisté',             emoji: '🖊️', badge: null,
      desc: 'L\'IA propose des suggestions et détecte les conflits, mais vous décidez manuellement de chaque affectation.' },
  ];

  const stepLabels = ['Période', 'Organisation', 'Algorithme', 'Équipe & Postes', 'Confirmation', 'Résultat'];

  const inputSt = {
    width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 14,
    border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
    color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
  };
  const btnPrimary = {
    padding: '11px 28px', borderRadius: 10, border: 'none', cursor: 'pointer',
    background: 'var(--color-primary)', color: '#fff', fontWeight: 700, fontSize: 14,
  };
  const btnSecondary = {
    padding: '11px 20px', borderRadius: 10, border: '1px solid var(--border-subtle)',
    background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 14, cursor: 'pointer',
  };

  const totalDays = cfg.startDate && cfg.endDate
    ? Math.ceil((new Date(cfg.endDate) - new Date(cfg.startDate)) / 86400000) + 1 : 0;

  const getStepError = () => {
    if (step === 0) {
      if (!cfg.startDate || !cfg.endDate) return 'Les dates de début et de fin sont obligatoires.';
      if (new Date(cfg.endDate) < new Date(cfg.startDate)) return 'La date de fin doit être après la date de début.';
      return '';
    }
    if (step === 1) {
      if (cfg.useWeekSlices) {
        if (cfg.weekSlices.length === 0) return 'Ajoutez au moins une semaine ou désactivez le découpage.';
        const incomplete = cfg.weekSlices.find(w => !w.startDate || !w.endDate);
        if (incomplete) return `La semaine "${incomplete.name || 'sans nom'}" doit avoir des dates de début et fin.`;
      }
      return '';
    }
    if (step === 2) {
      if (!cfg.algo) return 'Veuillez choisir un algorithme de répartition.';
      return '';
    }
    if (step === 3) {
      const totalSel = cfg.staffIds.length + cfg.externalStaff.length;
      if (totalSel === 0 && allHospitalStaff.length > 0) return 'Sélectionnez au moins un membre du personnel pour ce planning.';
      if (cfg.algo === 'ab_rotation' && (cfg.teamA.length === 0 || cfg.teamB.length === 0)) return 'L\'algorithme A/B nécessite au moins un membre dans chaque équipe.';
      return '';
    }
    return '';
  };
  const canNext = () => !getStepError();

  const addWeekSlice = () => {
    const lastEnd = cfg.weekSlices.length > 0 ? cfg.weekSlices[cfg.weekSlices.length - 1].endDate : cfg.startDate;
    const nextStart = lastEnd ? new Date(new Date(lastEnd).getTime() + 86400000).toISOString().split('T')[0] : cfg.startDate;
    setCfg(c => ({
      ...c,
      weekSlices: [...c.weekSlices, { id: Date.now(), type: 'semaine_a', name: 'Semaine A', startDate: nextStart, endDate: '', customName: '' }],
    }));
  };

  const updateSlice = (idx, field, val) => {
    setCfg(c => {
      const slices = [...c.weekSlices];
      slices[idx] = { ...slices[idx], [field]: val };
      if (field === 'type' && val !== 'custom') {
        const wt = WEEK_TYPES.find(w => w.id === val);
        if (wt) slices[idx].name = wt.label;
      }
      if (field === 'customName') slices[idx].name = val;
      return { ...c, weekSlices: slices };
    });
  };

  const removeSlice = (idx) => setCfg(c => ({ ...c, weekSlices: c.weekSlices.filter((_, i) => i !== idx) }));

  const addPost = () => {
    const roles = context?.roles || context?.staff?.reduce((acc, s) => {
      if (!acc.find(r => r.id === s.role_id)) acc.push({ id: s.role_id, name: s.role_name });
      return acc;
    }, []) || [];
    setCfg(c => ({ ...c, requiredPosts: [...c.requiredPosts, { id: Date.now(), roleName: '', roleId: '', count: 1 }] }));
  };

  const totalRequired = cfg.requiredPosts.reduce((sum, p) => sum + (parseInt(p.count) || 0), 0);
  const totalSelected = cfg.staffIds.length + cfg.externalStaff.length || allHospitalStaff.length;

  const generate = async () => {
    setLoading(true);
    try {
      const payload = { ...cfg, departmentId, staffIds: cfg.staffIds.length ? cfg.staffIds : undefined };
      const res = await scheduleBuilderAPI.generate(payload);
      setResult(res.data);
      setStep(5);
      if (res.data.data?.evaluation?.errors?.length === 0) {
        toast.success(res.data.message || 'Planning généré !');
      } else {
        toast('Planning généré avec avertissements', { icon: '⚠️' });
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Erreur de génération');
    } finally {
      setLoading(false);
    }
  };

  const filteredStaff = [];
  // (replaced by grouped hospital staff — ownStaff / otherStaff / noServiceStaff)

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      {/* Stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 24, overflowX: 'auto', paddingBottom: 4 }}>
        {stepLabels.map((lbl, i) => (
          <React.Fragment key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, opacity: i > step ? 0.4 : 1 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: i < step ? '#10B981' : i === step ? 'var(--color-primary)' : 'var(--bg-elevated)',
                color: i <= step ? '#fff' : 'var(--text-muted)', fontWeight: 700, fontSize: 11, flexShrink: 0,
              }}>
                {i < step ? <IconCheck /> : i + 1}
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: i === step ? 'var(--color-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {lbl}
              </span>
            </div>
            {i < stepLabels.length - 1 && (
              <div style={{ flex: 1, height: 2, background: i < step ? '#10B981' : 'var(--border-subtle)', minWidth: 12 }} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Card step */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-subtle)', padding: '24px 28px', marginBottom: 18 }}>

        {/* ── STEP 0 : Période ── */}
        {step === 0 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800 }}>📅 Quelle période ?</h3>
            <p style={{ margin: '0 0 18px', color: 'var(--text-muted)', fontSize: 13 }}>Définissez la plage de dates couverte par ce planning.</p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'Ce mois',     fn: () => { const d = new Date(), y = d.getFullYear(), m = d.getMonth(); return { s: `${y}-${String(m+1).padStart(2,'0')}-01`, e: new Date(y,m+1,0).toISOString().split('T')[0] }; } },
                { label: 'Mois prochain', fn: () => { const d = new Date(), y = d.getFullYear(), m = d.getMonth()+1; return { s: `${y}-${String(m+1).padStart(2,'0')}-01`, e: new Date(y,m+1,0).toISOString().split('T')[0] }; } },
                { label: '3 mois',      fn: () => { const d = new Date(); const e = new Date(d); e.setMonth(e.getMonth()+3); return { s: d.toISOString().split('T')[0], e: e.toISOString().split('T')[0] }; } },
              ].map(p => (
                <button key={p.label} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--color-primary)', background: 'rgba(27,79,202,.06)', color: 'var(--color-primary)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                  onClick={() => { const v = p.fn(); setCfg(c => ({ ...c, startDate: v.s, endDate: v.e })); }}>
                  {p.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Date de début *</span>
                <input type="date" style={inputSt} value={cfg.startDate} onChange={e => setCfg(c => ({ ...c, startDate: e.target.value }))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Date de fin *</span>
                <input type="date" style={inputSt} value={cfg.endDate} onChange={e => setCfg(c => ({ ...c, endDate: e.target.value }))} />
              </label>
            </div>
            {totalDays > 0 && (
              <div style={{ padding: '8px 14px', background: '#EFF6FF', borderRadius: 8, fontSize: 12, color: '#3B82F6', fontWeight: 600, marginBottom: 14 }}>
                📊 {totalDays} jours · {Math.ceil(totalDays / 7)} semaines
              </div>
            )}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Nom du planning (optionnel)</span>
              <input type="text" style={inputSt} placeholder="Ex: Gardes Août 2026 — Urgences"
                value={cfg.name} onChange={e => setCfg(c => ({ ...c, name: e.target.value }))} />
            </label>
          </div>
        )}

        {/* ── STEP 1 : Organisation (Type + Semaines) ── */}
        {step === 1 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800 }}>🗂️ Organisation des semaines</h3>
            <p style={{ margin: '0 0 18px', color: 'var(--text-muted)', fontSize: 13 }}>
              Définissez comment découper la période. Vous pouvez nommer chaque semaine et lui donner un caractère particulier.
            </p>

            {/* Type de garde — optionnel */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
                Type de garde <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>(optionnel — laissez vide pour tous types)</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div onClick={() => setCfg(c => ({ ...c, shiftTypeId: '' }))}
                  style={{ padding: '10px 14px', borderRadius: 10, cursor: 'pointer', border: `2px solid ${!cfg.shiftTypeId ? 'var(--color-primary)' : 'var(--border-subtle)'}`, background: !cfg.shiftTypeId ? 'rgba(27,79,202,.06)' : 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#94A3B8', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>Tous types de garde</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>L'algorithme gérera la répartition par type</div>
                  </div>
                  {!cfg.shiftTypeId && <span style={{ color: 'var(--color-primary)' }}><IconCheck /></span>}
                </div>
                {(context?.shiftTypes || []).map(st => (
                  <div key={st.id} onClick={() => setCfg(c => ({ ...c, shiftTypeId: st.id }))}
                    style={{ padding: '10px 14px', borderRadius: 10, cursor: 'pointer', border: `2px solid ${cfg.shiftTypeId === st.id ? st.color || 'var(--color-primary)' : 'var(--border-subtle)'}`, background: cfg.shiftTypeId === st.id ? `${st.color}12` : 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: st.color, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{st.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {st.start_time?.slice(0, 5)} – {st.end_time?.slice(0, 5)} ({st.duration_hours}h{st.is_overnight ? ' · nuit' : ''})
                      </div>
                    </div>
                    {cfg.shiftTypeId === st.id && <span style={{ color: st.color }}><IconCheck /></span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Découpage par semaines */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Découpage par semaines nommées</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Facultatif — pour les plannings avec organisation complexe</div>
                </div>
                <button onClick={() => setCfg(c => ({ ...c, useWeekSlices: !c.useWeekSlices, weekSlices: !c.useWeekSlices && c.weekSlices.length === 0 ? [{ id: 1, type: 'semaine_a', name: 'Semaine A', startDate: c.startDate, endDate: '', customName: '' }] : c.weekSlices }))}
                  style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${cfg.useWeekSlices ? 'var(--color-primary)' : 'var(--border-subtle)'}`, background: cfg.useWeekSlices ? 'var(--color-primary)' : 'transparent', color: cfg.useWeekSlices ? '#fff' : 'var(--text-secondary)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  {cfg.useWeekSlices ? '✓ Activé' : 'Activer'}
                </button>
              </div>

              {cfg.useWeekSlices && (
                <div>
                  {cfg.weekSlices.map((slice, idx) => (
                    <div key={slice.id} style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 14, marginBottom: 8, border: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 18 }}>{WEEK_TYPES.find(w => w.id === slice.type)?.emoji || '📋'}</span>
                          <span style={{ fontWeight: 700, fontSize: 13 }}>{slice.name || `Semaine ${idx + 1}`}</span>
                        </div>
                        <button onClick={() => removeSlice(idx)}
                          style={{ background: 'rgba(239,68,68,.1)', border: 'none', borderRadius: 6, padding: '4px 8px', color: '#EF4444', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                          Supprimer
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Type</span>
                          <select value={slice.type} onChange={e => updateSlice(idx, 'type', e.target.value)}
                            style={{ ...inputSt, padding: '7px 10px', fontSize: 12 }}>
                            {WEEK_TYPES.map(w => <option key={w.id} value={w.id}>{w.emoji} {w.label}</option>)}
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Début</span>
                          <input type="date" value={slice.startDate} min={cfg.startDate} max={cfg.endDate}
                            onChange={e => updateSlice(idx, 'startDate', e.target.value)} style={{ ...inputSt, padding: '7px 10px', fontSize: 12 }} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Fin</span>
                          <input type="date" value={slice.endDate} min={slice.startDate} max={cfg.endDate}
                            onChange={e => updateSlice(idx, 'endDate', e.target.value)} style={{ ...inputSt, padding: '7px 10px', fontSize: 12 }} />
                        </label>
                      </div>
                      {slice.type === 'custom' && (
                        <input type="text" placeholder="Nom personnalisé de la semaine..." value={slice.customName}
                          onChange={e => updateSlice(idx, 'customName', e.target.value)}
                          style={{ ...inputSt, marginTop: 8, fontSize: 12, padding: '7px 10px' }} />
                      )}
                      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                        {WEEK_TYPES.find(w => w.id === slice.type)?.desc}
                      </div>
                    </div>
                  ))}
                  <button onClick={addWeekSlice}
                    style={{ width: '100%', padding: '10px', borderRadius: 10, border: '2px dashed var(--border-subtle)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    ＋ Ajouter une semaine
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 2 : Algorithme ── */}
        {step === 2 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800 }}>⚙️ Méthode de répartition</h3>
            <p style={{ margin: '0 0 18px', color: 'var(--text-muted)', fontSize: 13 }}>
              Choisissez comment les gardes seront distribuées. L'algorithme s'adapte automatiquement aux contraintes de votre équipe.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {algoOptions.map(a => (
                <div key={a.id} onClick={() => setCfg(c => ({ ...c, algo: a.id }))}
                  style={{
                    padding: '14px 18px', borderRadius: 12, cursor: 'pointer',
                    border: `2px solid ${cfg.algo === a.id ? 'var(--color-primary)' : 'var(--border-subtle)'}`,
                    background: cfg.algo === a.id ? 'rgba(27,79,202,.06)' : 'var(--bg-card)',
                    display: 'flex', gap: 12, alignItems: 'flex-start', transition: 'all .15s',
                  }}>
                  <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1.2 }}>{a.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{a.label}</span>
                      {a.badge && (
                        <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 10, fontWeight: 800, background: a.badge === 'Recommandé' ? '#DCFCE7' : '#EFF6FF', color: a.badge === 'Recommandé' ? '#059669' : '#3B82F6' }}>
                          {a.badge}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{a.desc}</div>
                  </div>
                  {cfg.algo === a.id && <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}><IconCheck /></span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 3 : Équipe & Postes ── */}
        {step === 3 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800 }}>👥 Équipe & Postes requis</h3>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>
              Définissez les postes à couvrir, sélectionnez les membres et ajoutez éventuellement du personnel externe.
            </p>

            {/* Postes requis */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                📋 Postes de garde requis
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                  (par garde : combien de personnes par rôle)
                </span>
              </div>

              {/* RoleSearchDropdown — dynamique depuis la BDD */}
              {cfg.requiredPosts.map((post, idx) => (
                <div key={post.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  {/* Dropdown avec recherche */}
                  <div style={{ flex: 1, position: 'relative' }}>
                    <div
                      onClick={() => { setRoleDropdownOpen(roleDropdownOpen === idx ? null : idx); setRoleSearch(''); }}
                      style={{
                        ...inputSt, padding: '8px 12px', cursor: 'pointer', display: 'flex',
                        alignItems: 'center', justifyContent: 'space-between', fontSize: 12,
                        color: post.roleName ? 'var(--text-primary)' : 'var(--text-muted)',
                        userSelect: 'none',
                      }}>
                      <span>{post.roleName || 'Sélectionner un rôle...'}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{roleDropdownOpen === idx ? '▲' : '▼'}</span>
                    </div>
                    {roleDropdownOpen === idx && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                        borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,.15)',
                        maxHeight: 220, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                      }}>
                        {/* Search input inside dropdown */}
                        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
                          <input
                            autoFocus
                            value={roleSearch}
                            onChange={e => setRoleSearch(e.target.value)}
                            placeholder="Rechercher un rôle..."
                            style={{ width: '100%', padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border-subtle)', fontSize: 12, outline: 'none', background: 'var(--bg-elevated)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
                          />
                        </div>
                        {/* Role list */}
                        <div style={{ overflowY: 'auto', flex: 1 }}>
                          {platformRoles.length === 0 ? (
                            <div style={{ padding: '12px 14px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>Chargement...</div>
                          ) : filteredPlatformRoles.length === 0 ? (
                            <div style={{ padding: '12px 14px', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>Aucun résultat</div>
                          ) : filteredPlatformRoles.map(role => (
                            <div
                              key={role.id}
                              onClick={() => {
                                setCfg(c => { const p = [...c.requiredPosts]; p[idx] = { ...p[idx], roleName: role.name, roleId: role.id }; return { ...c, requiredPosts: p }; });
                                setRoleDropdownOpen(null);
                              }}
                              style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: post.roleId === role.id ? 700 : 400, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                              onMouseLeave={e => e.currentTarget.style.background = ''}
                            >
                              <span>{role.name}</span>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{role.user_count || 0} pers.</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Counter */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button onClick={() => setCfg(c => { const p = [...c.requiredPosts]; p[idx].count = Math.max(1, (p[idx].count || 1) - 1); return { ...c, requiredPosts: p }; })}
                      style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', cursor: 'pointer', fontWeight: 700 }}>−</button>
                    <span style={{ fontSize: 14, fontWeight: 700, minWidth: 24, textAlign: 'center' }}>{post.count}</span>
                    <button onClick={() => setCfg(c => { const p = [...c.requiredPosts]; p[idx].count = (p[idx].count || 1) + 1; return { ...c, requiredPosts: p }; })}
                      style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', cursor: 'pointer', fontWeight: 700 }}>＋</button>
                  </div>
                  <button onClick={() => setCfg(c => ({ ...c, requiredPosts: c.requiredPosts.filter((_, i) => i !== idx) }))}
                    style={{ padding: '6px 10px', borderRadius: 6, border: 'none', background: '#FEF2F2', color: '#EF4444', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>✕</button>
                </div>
              ))}
              <button onClick={addPost}
                style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px dashed var(--border-subtle)', background: 'transparent', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                ＋ Ajouter un poste
              </button>
              {totalRequired > 0 && (
                <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: totalRequired <= totalSelected ? '#ECFDF5' : '#FEF2F2', border: `1px solid ${totalRequired <= totalSelected ? '#A7F3D0' : '#FECACA'}`, fontSize: 12, fontWeight: 600, color: totalRequired <= totalSelected ? '#059669' : '#EF4444' }}>
                  {totalRequired <= totalSelected ? '✓' : '⚠'} {totalRequired} personnes requises · {totalSelected} disponibles
                </div>
              )}
            </div>

            {/* Sélection équipe — TOUT l'hôpital */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>👥 Sélection du personnel</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {allHospitalStaff.length} personne{allHospitalStaff.length !== 1 ? 's' : ''} disponibles ·
                    {cfg.staffIds.length === 0 ? ' Tous sélectionnés par défaut' : ` ${cfg.staffIds.length} sélectionné(s)`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setCfg(c => ({ ...c, staffIds: allHospitalStaff.map(s => s.id) }))}
                    style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--color-primary)', background: 'rgba(27,79,202,.06)', cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 600 }}>Tous</button>
                  <button onClick={() => setCfg(c => ({ ...c, staffIds: ownStaff.map(s => s.id) }))}
                    style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}>Mon service</button>
                  <button onClick={() => setCfg(c => ({ ...c, staffIds: [] }))}
                    style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}>Vider</button>
                </div>
              </div>
              <input type="text" placeholder="🔍 Rechercher par nom, prénom, matricule..." value={staffSearch}
                onChange={e => setStaffSearch(e.target.value)}
                style={{ ...inputSt, marginBottom: 10, fontSize: 12, padding: '8px 12px' }} />

              {staffLoading ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Chargement du personnel...</div>
              ) : allHospitalStaff.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                  Aucun personnel trouvé dans cet hôpital.
                </div>
              ) : (
                <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Groupe 1: Mon service */}
                  {ownStaff.length > 0 && (
                    <>
                      <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 800, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 1, background: 'rgba(27,79,202,.04)', borderRadius: 6, marginBottom: 4 }}>
                        🏥 Personnel de ce service ({ownStaff.length})
                      </div>
                      {ownStaff.map(m => {
                        const sel = cfg.staffIds.length === 0 || cfg.staffIds.includes(m.id);
                        return <StaffRow key={m.id} m={m} sel={sel} isExternal={false} onToggle={() => setCfg(c => {
                          const ids = c.staffIds.length === 0 ? allHospitalStaff.map(s => s.id) : [...c.staffIds];
                          return { ...c, staffIds: ids.includes(m.id) ? ids.filter(x => x !== m.id) : [...ids, m.id] };
                        })} />;
                      })}
                    </>
                  )}
                  {/* Groupe 2: Autres services */}
                  {otherStaff.length > 0 && (
                    <>
                      <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 800, color: '#D97706', textTransform: 'uppercase', letterSpacing: 1, background: 'rgba(217,119,6,.04)', borderRadius: 6, marginTop: 8, marginBottom: 4 }}>
                        🔄 Autres services ({otherStaff.length}) — Notification automatique
                      </div>
                      {otherStaff.map(m => {
                        const sel = cfg.staffIds.includes(m.id);
                        return <StaffRow key={m.id} m={m} sel={sel} isExternal deptName={m.dept_name} onToggle={() => {
                          setCfg(c => {
                            const ids = [...c.staffIds];
                            if (ids.includes(m.id)) return { ...c, staffIds: ids.filter(x => x !== m.id) };
                            toast(`🔔 Sélection de ${m.first_name} ${m.last_name} — notification au chef du service ${m.dept_name}`, { icon: '⚠️' });
                            return { ...c, staffIds: [...ids, m.id] };
                          });
                        }} />;
                      })}
                    </>
                  )}
                  {/* Groupe 3: Sans service */}
                  {noServiceStaff.length > 0 && (
                    <>
                      <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, background: 'rgba(107,114,128,.04)', borderRadius: 6, marginTop: 8, marginBottom: 4 }}>
                        👤 Personnel sans service ({noServiceStaff.length})
                      </div>
                      {noServiceStaff.map(m => {
                        const sel = cfg.staffIds.length === 0 || cfg.staffIds.includes(m.id);
                        return <StaffRow key={m.id} m={m} sel={sel} isExternal={false} onToggle={() => setCfg(c => {
                          const ids = c.staffIds.length === 0 ? allHospitalStaff.map(s => s.id) : [...c.staffIds];
                          return { ...c, staffIds: ids.includes(m.id) ? ids.filter(x => x !== m.id) : [...ids, m.id] };
                        })} />;
                      })}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Personnel externe — via HospitalStaffPicker */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    🤝 Personnel externe
                    <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>(autre service — notification automatique)</span>
                  </div>
                </div>
                <button onClick={() => setShowExternalPicker(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #1B4FCA, #7C3AED)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  ＋ Ajouter
                </button>
              </div>
              {cfg.externalStaff.length === 0 ? (
                <div style={{ padding: '14px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px dashed var(--border-subtle)', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                  Aucun personnel externe ajouté.<br />
                  <span style={{ fontSize: 11 }}>Le chef du service concerné sera notifié automatiquement.</span>
                </div>
              ) : (
                cfg.externalStaff.map((ext, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: '#FFFBEB', border: '1px solid #FDE68A', marginBottom: 6 }}>
                    <span style={{ fontSize: 18 }}>👤</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{ext.firstName || ext.first_name} {ext.lastName || ext.last_name}</div>
                      <div style={{ fontSize: 11, color: '#D97706' }}>{ext.deptName || ext.dept_name} · {ext.role_name || ext.roleName} · Notification envoyée</div>
                    </div>
                    <button onClick={() => setCfg(c => ({ ...c, externalStaff: c.externalStaff.filter((_, i) => i !== idx) }))}
                      style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 14 }}>✕</button>
                  </div>
                ))
              )}
            </div>

            {/* Drawer HospitalStaffPicker pour personnel externe */}
            <HospitalStaffPicker
              open={showExternalPicker}
              onClose={() => setShowExternalPicker(false)}
              onSelect={member => {
                setCfg(c => ({
                  ...c,
                  externalStaff: c.externalStaff.find(e => e.userId === member.id)
                    ? c.externalStaff
                    : [...c.externalStaff, { userId: member.id, firstName: member.first_name, lastName: member.last_name, deptName: member.dept_name, roleName: member.role_name }],
                }));
                toast(`👤 ${member.first_name} ${member.last_name} ajouté — notification au chef du service ${member.dept_name}`, { icon: '🔔' });
                setShowExternalPicker(false);
              }}
              onDragStart={() => {}}
              ownDeptId={departmentId}
              title="Rechercher personnel externe"
            />
          </div>
        )}

        {/* ── STEP 4 : Confirmation ── */}
        {step === 4 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800 }}>✅ Récapitulatif</h3>
            <p style={{ margin: '0 0 20px', color: 'var(--text-muted)', fontSize: 13 }}>Vérifiez la configuration avant de générer le planning.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Période',       value: `${cfg.startDate} au ${cfg.endDate} (${totalDays} jours)` },
                { label: 'Type de garde', value: cfg.shiftTypeId ? (context?.shiftTypes?.find(s => s.id === cfg.shiftTypeId)?.name || '-') : 'Tous types' },
                { label: 'Organisation',  value: cfg.useWeekSlices ? `${cfg.weekSlices.length} semaine(s) nommée(s)` : 'Planning continu' },
                { label: 'Algorithme',    value: algoOptions.find(a => a.id === cfg.algo)?.label },
                { label: 'Personnel',     value: cfg.staffIds.length > 0 ? `${cfg.staffIds.length} membres sélectionnés` : `Tous actifs (${context?.staff?.length || 0})` },
                { label: 'Postes requis', value: cfg.requiredPosts.length > 0 ? cfg.requiredPosts.map(p => `${p.count}× ${p.roleName}`).join(', ') : 'Non définis' },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '11px 14px', background: 'var(--bg-elevated)', borderRadius: 10, gap: 12 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>{row.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, textAlign: 'right' }}>{row.value}</span>
                </div>
              ))}
            </div>
            {context?.plannedAbsences?.length > 0 && (
              <div style={{ marginTop: 14, padding: '10px 14px', background: '#FFFBEB', borderRadius: 8, border: '1px solid #FDE68A', fontSize: 12, color: '#D97706', fontWeight: 600 }}>
                ⚠️ {context.plannedAbsences.length} absence(s) prévue(s) sur cette période — prises en compte automatiquement
              </div>
            )}
          </div>
        )}

        {/* ── STEP 5 : Résultat ── */}
        {step === 5 && result && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 56, marginBottom: 14 }}>
              {result.data?.evaluation?.errors?.length === 0 ? '🎉' : '⚠️'}
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: result.data?.evaluation?.errors?.length === 0 ? '#10B981' : '#F59E0B' }}>
              {result.data?.evaluation?.errors?.length === 0 ? 'Planning généré avec succès !' : 'Planning généré avec avertissements'}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 22 }}>
              {result.data?.generatedCount || 0} gardes créées · {algoOptions.find(a => a.id === cfg.algo)?.label}
            </p>
            {result.data?.evaluation && (
              <div style={{ textAlign: 'left', marginBottom: 20 }}>
                {(result.data.evaluation.errors || []).map((e, i) => (
                  <div key={i} style={{ padding: '10px 14px', background: '#FEF2F2', borderRadius: 8, marginBottom: 6, fontSize: 12, color: '#EF4444' }}>{e.message}</div>
                ))}
                {(result.data.evaluation.warnings || []).map((w, i) => (
                  <div key={i} style={{ padding: '10px 14px', background: '#FFFBEB', borderRadius: 8, marginBottom: 6, fontSize: 12, color: '#D97706' }}>{w.message}</div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button style={btnPrimary} onClick={() => onDone(result.data?.scheduleId)}>Voir le planning</button>
              <button style={btnSecondary} onClick={() => { setStep(0); setResult(null); setCfg(c => ({ ...c, startDate: '', endDate: '', name: '', weekSlices: [], requiredPosts: [], externalStaff: [] })); }}>
                Nouveau planning
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      {step < 5 && (
        <div>
          {/* Error banner — shown when user tries to advance with missing fields */}
          {stepError && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#EF4444', marginBottom: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              ⚠ {stepError}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button style={btnSecondary} onClick={() => { setStepError(''); step === 0 ? onBack() : setStep(s => s - 1); }}>
              {step === 0 ? '← Changer de méthode' : '← Retour'}
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Étape {step + 1} / {stepLabels.length}</div>
            {step < 4 ? (
              <button
                style={{ ...btnPrimary, background: canNext() ? 'var(--color-primary)' : '#9CA3AF', cursor: canNext() ? 'pointer' : 'not-allowed' }}
                onClick={() => {
                  const err = getStepError();
                  if (err) { setStepError(err); return; }
                  setStepError('');
                  setStep(s => s + 1);
                }}>
                Suivant →
              </button>
            ) : (
              <button style={{ ...btnPrimary, opacity: loading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 8 }}
                disabled={loading} onClick={generate}>
                {loading && <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', animation: 'spin 1s linear infinite' }} />}
                {loading ? 'Génération...' : '🚀 Générer le planning'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};


// ─── Status meta (full set) ─────────────────────────────────────
const STATUS_FULL = {
  draft:              { label: 'Brouillon',           bg: '#F3F4F6', color: '#6B7280', icon: '📝' },
  preparing:          { label: 'En préparation',      bg: '#FFFBEB', color: '#D97706', icon: '⚙️' },
  pending_validation: { label: 'En attente',          bg: '#EFF6FF', color: '#2563EB', icon: '⏳' },
  validated:          { label: 'Validé',              bg: '#ECFDF5', color: '#059669', icon: '✅' },
  submitted:          { label: 'Soumis',              bg: '#EFF6FF', color: '#3B82F6', icon: '📤' },
  under_review:       { label: 'En révision',         bg: '#FFFBEB', color: '#F59E0B', icon: '🔍' },
  approved:           { label: 'Approuvé',            bg: '#ECFDF5', color: '#10B981', icon: '✔️' },
  rejected:           { label: 'Rejeté',              bg: '#FEF2F2', color: '#EF4444', icon: '❌' },
  active:             { label: 'Actif',               bg: '#ECFDF5', color: '#059669', icon: '🟢' },
  archived:           { label: 'Archivé',             bg: '#F9FAFB', color: '#9CA3AF', icon: '📦' },
};

const FullStatusBadge = ({ status }) => {
  const m = STATUS_FULL[status] || { label: status, bg: '#F3F4F6', color: '#6B7280', icon: '•' };
  return (
    <span style={{ background: m.bg, color: m.color, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      {m.icon} {m.label}
    </span>
  );
};

// ─── Schedule Action Menu ────────────────────────────────────────
function ScheduleActionMenu({ schedule, onView, onRefresh }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const doAction = async (action, label) => {
    setOpen(false);
    if (action === 'delete' && !window.confirm(`Supprimer le planning "${schedule.name}" ? Cette action est irréversible.`)) return;
    try {
      await schedulesAPI.action(schedule.id, action);
      toast.success(label);
      onRefresh();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Erreur');
    }
  };

  const isArchived = schedule.status === 'archived';
  const isDeletable = ['draft', 'archived'].includes(schedule.status);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border-subtle)', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center' }}
        title="Actions">
        ⋮
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', zIndex: 200, minWidth: 190,
          background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
          borderRadius: 10, padding: '4px 0',
          boxShadow: '0 12px 40px rgba(0,0,0,.18)',
          animation: 'fadeIn .1s ease',
        }}>
          <ActItem icon="👁" label="Ouvrir" onClick={() => { setOpen(false); onView(schedule.id); }} />
          <ActItem icon="⧉" label="Dupliquer" onClick={() => doAction('duplicate', 'Planning dupliqué !')} />
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '3px 0' }} />
          {!isArchived
            ? <ActItem icon="📦" label="Archiver" onClick={() => doAction('archive', 'Planning archivé')} />
            : <ActItem icon="🔄" label="Restaurer" onClick={() => doAction('restore', 'Planning restauré en brouillon')} />
          }
          {isDeletable && (
            <ActItem icon="🗑" label="Supprimer" danger onClick={() => doAction('delete', 'Planning supprimé')} />
          )}
        </div>
      )}
    </div>
  );
}

const ActItem = ({ icon, label, onClick, danger }) => (
  <button onClick={onClick}
    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: danger ? '#EF4444' : 'var(--text-primary)', textAlign: 'left' }}
    onMouseEnter={e => e.currentTarget.style.background = danger ? '#FEF2F2' : 'var(--bg-elevated)'}
    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
    <span style={{ fontSize: 15 }}>{icon}</span> {label}
  </button>
);

// ─── Schedule List ─────────────────────────────────────────────
const ScheduleList = ({ departmentId, onView, onNew }) => {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['schedules', departmentId],
    queryFn:  () => schedulesAPI.getAll({ departmentId, limit: 50 }),
    enabled:  !!departmentId,
  });

  const allItems = data?.data?.data || data?.data || [];
  const items = statusFilter ? allItems.filter(s => s.status === statusFilter) : allItems;

  const refresh = () => qc.invalidateQueries(['schedules', departmentId]);

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Chargement...</div>;
  }

  const modeLabel = m => ({ assistant: '🤖 Assistant', spreadsheet: '📊 Tableur', visual: '📅 Visuel' }[m] || m);

  // Count by status
  const statusCounts = allItems.reduce((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {});

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Mes plannings</h3>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{allItems.length} planning{allItems.length !== 1 ? 's' : ''} au total</p>
        </div>
        <button onClick={onNew} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, var(--color-primary), #7C3AED)', color: '#fff', fontWeight: 700, fontSize: 13, boxShadow: '0 4px 14px rgba(27,79,202,.3)' }}>
          <IconPlus /> Nouveau planning
        </button>
      </div>

      {/* Status filter pills */}
      {allItems.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          <button onClick={() => setStatusFilter('')} style={{
            padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${!statusFilter ? 'var(--color-primary)' : 'var(--border-subtle)'}`,
            background: !statusFilter ? 'rgba(27,79,202,.08)' : 'transparent',
            color: !statusFilter ? 'var(--color-primary)' : 'var(--text-muted)',
          }}>Tous ({allItems.length})</button>
          {Object.entries(statusCounts).map(([st, cnt]) => {
            const m = STATUS_FULL[st] || { label: st, icon: '•' };
            return (
              <button key={st} onClick={() => setStatusFilter(st === statusFilter ? '' : st)} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${statusFilter === st ? m.color : 'var(--border-subtle)'}`,
                background: statusFilter === st ? m.bg : 'transparent',
                color: statusFilter === st ? m.color : 'var(--text-muted)',
              }}>{m.icon} {m.label} ({cnt})</button>
            );
          })}
        </div>
      )}

      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '56px 20px', background: 'var(--bg-card)', borderRadius: 16, border: '1px dashed var(--border-subtle)', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{statusFilter ? 'Aucun planning dans ce statut' : 'Aucun planning créé'}</div>
          <div style={{ fontSize: 13, marginBottom: 18 }}>Créez votre premier tableau de garde</div>
          <button onClick={onNew} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--color-primary)', color: '#fff', fontWeight: 700 }}>
            Créer un planning
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(s => (
            <div key={s.id}
              style={{
                background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border-subtle)',
                padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
                transition: 'box-shadow .15s, border-color .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.08)'; e.currentTarget.style.borderColor = 'rgba(27,79,202,.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
            >
              {/* Color bar */}
              <div style={{ width: 4, height: 48, borderRadius: 4, background: STATUS_FULL[s.status]?.color || '#9CA3AF', flexShrink: 0 }} />

              {/* Icon */}
              <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(27,79,202,.07)', color: 'var(--color-primary)', flexShrink: 0 }}>
                <IconCalendar />
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onView(s.id)}>
                <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                  {s.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span>📅 {s.start_date} → {s.end_date}</span>
                  {s.creation_mode && <span>{modeLabel(s.creation_mode)}</span>}
                  {s.updated_at && <span>Modifié {new Date(s.updated_at).toLocaleDateString('fr-FR')}</span>}
                </div>
              </div>

              {/* Status */}
              <FullStatusBadge status={s.status} />

              {/* Arrow + Actions */}
              <span style={{ color: 'var(--text-muted)', lineHeight: 0, cursor: 'pointer' }} onClick={() => onView(s.id)}><IconRight /></span>
              <ScheduleActionMenu schedule={s} onView={onView} onRefresh={refresh} />
            </div>
          ))}
        </div>
      )}

      <style>{`@keyframes fadeIn { from { opacity:0; transform:scale(.97) } to { opacity:1; transform:scale(1) } }`}</style>
    </div>
  );
};

// ─── MAIN COMPONENT ───────────────────────────────────────────
export default function ChefDeServiceDashboard() {
  const { user } = useAuthStore();
  const [activeTab,    setActiveTab]    = useState('overview');
  const [selectedDept, setSelectedDept] = useState(null);
  const [view,         setView]         = useState('list');
  const [selectedScheduleId, setSelectedScheduleId] = useState(null);
  const [showImport, setShowImport] = useState(false);
  // 2-step flow: stores {id, name, startDate, endDate} after step 1
  const [scheduleInfo, setScheduleInfo] = useState(null);

  // Departments dont ce chef est responsable
  const { data: deptData, isLoading: deptLoading } = useQuery({
    queryKey: ['myDepartments', user?.id],
    queryFn:  () => departmentsAPI.getAll({ head: user?.id }),
  });
  const departments = deptData?.data?.data || deptData?.data || [];

  useEffect(() => {
    // Priorité: 1) departments chargés  2) department_id du profil user (fallback rapide)
    if (departments.length > 0 && !selectedDept) {
      setSelectedDept(departments[0].id);
    } else if (!selectedDept && user?.department_id) {
      setSelectedDept(user.department_id);
    }
  }, [departments, user]);

  // Detail du service selectionne
  const { data: deptDetail } = useQuery({
    queryKey: ['deptDetail', selectedDept],
    queryFn:  () => departmentsAPI.getOne(selectedDept),
    enabled:  !!selectedDept,
  });
  const dept = deptDetail?.data?.data || deptDetail?.data;

  // Absences en attente
  const { data: absData } = useQuery({
    queryKey: ['absences-pending', selectedDept],
    queryFn:  () => absencesAPI.getAll({ departmentId: selectedDept, status: 'pending', limit: 10 }),
    enabled:  !!selectedDept,
  });
  const pendingAbsences = absData?.data?.data || absData?.data || [];

  // Gardes du jour
  const { data: todayData } = useQuery({
    queryKey: ['shifts-today', selectedDept],
    queryFn:  () => shiftsAPI.getToday({ departmentId: selectedDept }),
    enabled:  !!selectedDept,
    refetchInterval: 60000,
  });
  const todayShifts = todayData?.data?.data || todayData?.data || [];

  const tabs = [
    { id: 'overview',  label: "Vue d'ensemble", emoji: '??' },
    { id: 'schedules', label: 'Plannings',       emoji: '??' },
    { id: 'team',      label: 'Equipe',          emoji: '??' },
    { id: 'absences',  label: 'Absences',        emoji: '??' },
  ];

  const cardSt = { background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: 24 };

  if (deptLoading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>Chargement...</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', padding: 24 }}>

      {/* Header */}
      <div style={{ marginBottom: 26 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
              Chef de Service
            </div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: 'var(--text-primary)' }}>
              Bonjour, {user?.firstName}
            </h1>
            <p style={{ margin: '5px 0 0', color: 'var(--text-muted)', fontSize: 14 }}>
              Gerez les plannings et l'equipe de votre service
            </p>
          </div>
          {departments.length > 1 && (
            <select value={selectedDept || ''} onChange={e => setSelectedDept(e.target.value)}
              style={{ padding: '10px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer' }}>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
        </div>

        {/* Info service */}
        {dept && (
          <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg,var(--color-primary),#7C3AED)', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 14, color: '#fff' }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 0 }}>
              <IconUsers />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{dept.name}</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {dept.department_type}{dept.floor ? ` - Etage ${dept.floor}` : ''}{dept.bed_count ? ` - ${dept.bed_count} lits` : ''}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{dept.member_count || dept.staff_count || '-'}</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>Personnel</div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 22, background: 'var(--bg-card)', padding: 5, borderRadius: 14, border: '1px solid var(--border-subtle)', width: 'fit-content' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => { setActiveTab(t.id); setView('list'); }}
            style={{
              padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: activeTab === t.id ? 'var(--color-primary)' : 'transparent',
              color: activeTab === t.id ? '#fff' : 'var(--text-secondary)',
              transition: 'all .2s', display: 'flex', alignItems: 'center', gap: 6,
            }}>
            {t.label}
            {t.id === 'absences' && pendingAbsences.length > 0 && (
              <span style={{ background: '#EF4444', color: '#fff', borderRadius: 20, padding: '1px 7px', fontSize: 10, fontWeight: 800 }}>
                {pendingAbsences.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── VUE D'ENSEMBLE ─────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 22 }}>
            <KpiCard icon={<IconUsers />}   label="Personnel actif"   value={dept?.member_count || '-'}  color="#3B82F6" sub="dans ce service" />
            <KpiCard icon={<IconCalendar />} label="Gardes aujourd'hui" value={todayShifts.length}       color="#8B5CF6" sub={new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} />
            <KpiCard icon={<IconAlert />}   label="Absences en cours" value={pendingAbsences.length}     color="#F59E0B" sub="en attente" />
            <KpiCard icon={<IconCheck />}   label="Personnel present" value={dept?.member_count ? Math.max(0, (dept.member_count || 0) - pendingAbsences.length) : '-'} color="#10B981" sub="disponibles" />
          </div>

          {/* Actions rapides */}
          <div style={{ ...cardSt, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>Actions rapides</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[
                { label: 'Créer un planning', color: 'var(--color-primary)', action: () => { setActiveTab('schedules'); setView('new'); } },
                { label: 'Importer Excel/CSV',  color: '#0891B2',              action: () => setShowImport(true) },
                { label: 'Voir l\'equipe',    color: '#10B981',              action: () => setActiveTab('team') },
                { label: 'Absences',          color: '#F59E0B',              action: () => setActiveTab('absences') },
              ].map(a => (
                <button key={a.label} onClick={a.action} style={{
                  padding: '10px 18px', borderRadius: 10, border: `1px solid ${a.color}40`,
                  background: `${a.color}12`, color: a.color, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Gardes du jour */}
          {todayShifts.length > 0 && (
            <div style={{ ...cardSt, marginBottom: 20 }}>
              <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#8B5CF6' }}><IconCalendar /></span>
                Gardes du jour — {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 8 }}>
                {todayShifts.slice(0, 8).map(s => (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                    borderRadius: 10, background: 'var(--bg-elevated)',
                    border: `1px solid var(--border-subtle)`,
                    borderLeft: `4px solid ${s.color || '#3B82F6'}`,
                  }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: `linear-gradient(135deg, ${s.color || '#3B82F6'}, #7C3AED)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontSize: 10, fontWeight: 900, flexShrink: 0,
                    }}>
                      {(s.first_name || s.user_first_name || '?')[0]}{(s.last_name || s.user_last_name || '?')[0]}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.first_name || s.user_first_name} {s.last_name || s.user_last_name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {s.shift_type_name || s.type_name || 'Garde'} · {s.start_time?.slice(0,5)} - {s.end_time?.slice(0,5)}
                      </div>
                    </div>
                    <span style={{
                      padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                      background: s.status === 'confirmed' ? '#ECFDF5' : '#EFF6FF',
                      color: s.status === 'confirmed' ? '#059669' : '#3B82F6',
                    }}>
                      {s.status === 'confirmed' ? 'Confirme' : 'Planifie'}
                    </span>
                  </div>
                ))}
              </div>
              {todayShifts.length > 8 && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  +{todayShifts.length - 8} autres gardes
                </div>
              )}
            </div>
          )}

          {/* Absences en attente */}
          {pendingAbsences.length > 0 && (
            <div style={cardSt}>
              <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#F59E0B' }}><IconAlert /></span>
                Absences en attente de validation
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pendingAbsences.slice(0, 5).map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', background: '#FFFBEB', borderRadius: 10, border: '1px solid #FDE68A' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{a.first_name || a.user_first_name} {a.last_name || a.user_last_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {a.absence_type_name} - {a.start_date} au {a.end_date}
                      </div>
                    </div>
                    <StatusBadge status="submitted" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PLANNINGS ──────────────────────────────────── */}
      {activeTab === 'schedules' && (
        <div>
          {/* Étape 0 — Liste des plannings */}
          {view === 'list' && (
            <ScheduleList departmentId={selectedDept}
              onView={(id) => { setSelectedScheduleId(id); setView('spreadsheet'); }}
              onNew={() => { setScheduleInfo(null); setView('new'); }} />
          )}

          {/* Étape 1 — Créer le planning (Nom + Dates) */}
          {view === 'new' && (
            <PlanningStep1
              departmentId={selectedDept}
              onBack={() => setView('list')}
              onCreated={(id, name, startDate, endDate) => {
                setSelectedScheduleId(id);
                setScheduleInfo({ id, name, startDate, endDate });
                setView('method');
              }}
            />
          )}

          {/* Étape 2 — Choisir la méthode */}
          {view === 'method' && (
            <MethodSelector onSelect={(method) => {
              if (method === 'import') {
                setShowImport(true);
                // Stay on method view so user can go back
              } else {
                setView(method);
              }
            }} />
          )}

          {/* Assistant intelligent (reçoit startDate/endDate déjà créés) */}
          {view === 'assistant' && (
            <WizardAssistant
              departmentId={selectedDept}
              scheduleId={scheduleInfo?.id || selectedScheduleId}
              startDate={scheduleInfo?.startDate}
              endDate={scheduleInfo?.endDate}
              name={scheduleInfo?.name}
              onBack={() => setView('method')}
              onDone={(schedId) => {
                const id = schedId || scheduleInfo?.id || selectedScheduleId;
                if (id) { setSelectedScheduleId(id); setView('spreadsheet'); }
                else setView('list');
                toast.success('Planning généré !');
              }}
            />
          )}

          {/* Tableur — vue directe */}
          {view === 'spreadsheet' && selectedScheduleId && (
            <SmartSpreadsheet
              scheduleId={selectedScheduleId}
              departmentId={selectedDept}
              onBack={() => setView('list')}
            />
          )}

          {/* Tableur sans planning sélectionné */}
          {view === 'spreadsheet' && !selectedScheduleId && (
            <div style={{ ...cardSt, textAlign: 'center', padding: '48px 20px' }}>
              <div style={{ fontSize: 38, marginBottom: 10 }}>📋</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Aucun planning sélectionné</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 18 }}>
                Créez d'abord un planning, puis ouvrez-le ici.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button onClick={() => { setScheduleInfo(null); setView('new'); }}
                  style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'var(--color-primary)', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                  Créer un planning
                </button>
                <button onClick={() => setView('list')}
                  style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}>
                  Voir mes plannings
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── EQUIPE ─────────────────────────────────────────── */}
      {activeTab === 'team' && (
        <div style={cardSt}>
          <h3 style={{ margin: '0 0 18px', fontSize: 17, fontWeight: 700 }}>Personnel du service</h3>
          {!(dept?.staff || dept?.members || []).length ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>Aucun membre dans ce service</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
              {(dept.staff || dept.members || []).map(m => {
                const pres = getPresence(m.last_activity_at);
                return (
                  <div key={m.id} style={{ padding: 14, background: 'var(--bg-elevated)', borderRadius: 12, display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,var(--color-primary),#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 800 }}>
                        {m.first_name[0]}{m.last_name[0]}
                      </div>
                      <span style={{ position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: '50%', background: pres.dot, border: '2px solid var(--bg-elevated)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.first_name} {m.last_name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{m.role_name || m.role_code}</div>
                      {m.speciality && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{m.speciality}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ABSENCES ───────────────────────────────────────── */}
      {activeTab === 'absences' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Absences du service</h3>
            <button style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#F59E0B', color: '#fff', fontWeight: 700, fontSize: 13 }}>
              <IconPlus /> Declarer une absence
            </button>
          </div>
          {pendingAbsences.length === 0 ? (
            <div style={{ ...cardSt, textAlign: 'center', padding: '48px 20px' }}>
              <div style={{ fontSize: 38, marginBottom: 10 }}>?</div>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 5 }}>Aucune absence en attente</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Tout le personnel est disponible</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {pendingAbsences.map(a => (
                <div key={a.id} style={{ ...cardSt, display: 'flex', alignItems: 'center', gap: 14, padding: '15px 20px' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: '#FFFBEB', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F59E0B', flexShrink: 0 }}>
                    <IconAlert />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{a.user_first_name || a.first_name} {a.user_last_name || a.last_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {a.absence_type_name} - {a.start_date} au {a.end_date}
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          departmentId={selectedDept}
          onClose={() => setShowImport(false)}
          onImported={(schedId) => { if (schedId) { setSelectedScheduleId(schedId); setActiveTab('schedules'); setView('spreadsheet'); } }}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

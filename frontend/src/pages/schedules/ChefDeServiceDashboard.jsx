import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store';
import { useLocation, useNavigate } from 'react-router-dom';
import { departmentsAPI, schedulesAPI, absencesAPI, scheduleBuilderAPI, shiftsAPI, adminAPI } from '../../api';
import SmartSpreadsheet from './components/SmartSpreadsheet';
import VisualCalendar from './components/VisualCalendar';
import ImportModal from './components/ImportModal';
import HospitalStaffPicker from './components/HospitalStaffPicker';
import ScheduleChangeProposals from './components/ScheduleChangeProposals';
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
  const [specialDaysOnly, setSpecialDaysOnly] = useState(false);

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
      const defaultName = name.trim() || `${specialDaysOnly ? 'Gardes week-ends et jours fériés' : 'Planning'} ${new Date(startDate).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;
      const res = await schedulesAPI.create({ name: defaultName, start_date: startDate, end_date: endDate, department_id: departmentId, status: 'draft', schedule_type: specialDaysOnly ? 'special_weekend_holiday' : 'normal', creation_mode: specialDaysOnly ? 'special_days' : 'assistant', metadata: specialDaysOnly ? { schedule_kind: 'weekend_holiday', special_days_only: true } : { schedule_kind: 'normal' } });
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

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, marginBottom: 16, borderRadius: 10, border: `1px solid ${specialDaysOnly ? '#F59E0B' : 'var(--border-subtle)'}`, background: specialDaysOnly ? '#FFFBEB' : 'var(--bg-elevated)', cursor: 'pointer' }}>
          <input type="checkbox" checked={specialDaysOnly} onChange={e => setSpecialDaysOnly(e.target.checked)} style={{ marginTop: 3 }} />
          <span><strong style={{ display: 'block', fontSize: 13 }}>Planning spécial : week-ends et jours fériés uniquement</strong><span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--text-muted)' }}>Les jours fériés sont récupérés depuis la configuration du Super Admin. Seules ces dates seront affichées dans le tableur.</span></span>
        </label>

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
      desc: 'L\'assistant vous guide étape par étape. Spécifiez l\'équipe, les contraintes et générez automatiquement le meilleur planning.',
      features: ['Assistant en 7 étapes', 'Règles métier & Relais', '3 propositions optimisées', 'Génération intelligente'],
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

// ─── ASSISTANT DE PLANIFICATION DES GARDES (7 ÉTAPES) ─────────────
const WizardAssistant = ({ departmentId, scheduleId, startDate: initStart, endDate: initEnd, name: initName, onBack, onDone }) => {
  const { user } = useAuthStore();
  const [step, setStep]       = useState(0); // 0 to 6
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Step 1: Informations Générales
  const [cfg, setCfg] = useState({
    name: initName || '',
    startDate: initStart || '',
    endDate: initEnd || '',
    periodType: 'monthly', // weekly | monthly | ab_weeks | rotation | custom
    scheduleType: 'normal', // normal | special_weekend_holiday
  });

  // Keep synced if initStart or initEnd changes
  useEffect(() => {
    if (initStart) setCfg(c => ({ ...c, startDate: initStart }));
    if (initEnd) setCfg(c => ({ ...c, endDate: initEnd }));
    if (initName) setCfg(c => ({ ...c, name: initName }));
  }, [initStart, initEnd, initName]);

  // Step 2: Constitution de l'équipe
  const [selectedStaffIds, setSelectedStaffIds] = useState([]);
  const [staffSearch, setStaffSearch]           = useState('');

  // Fetch tous les membres disponibles de l'hôpital / service
  const { data: hospitalStaffData } = useQuery({
    queryKey: ['hospital-staff-wizard', staffSearch],
    queryFn: () => schedulesAPI.getHospitalStaff({ search: staffSearch || undefined, limit: 200 }),
    staleTime: 60000,
  });
  const allStaff = hospitalStaffData?.data?.data || hospitalStaffData?.data || [];
  const ownStaff   = allStaff.filter(m => m.dept_id === departmentId);

  // Par défaut, sélectionner tous les membres du service au premier chargement
  useEffect(() => {
    if (ownStaff.length > 0 && selectedStaffIds.length === 0) {
      setSelectedStaffIds(ownStaff.map(s => s.id));
    }
  }, [ownStaff]);

  // Step 3: Contraintes & Ordre de Relais par membre
  const [memberConfigs, setMemberConfigs] = useState({});
  useEffect(() => {
    setMemberConfigs(prev => {
      const next = { ...prev };
      selectedStaffIds.forEach(id => {
        if (!next[id]) {
          const staffObj = allStaff.find(s => s.id === id);
          next[id] = {
            id,
            firstName: staffObj?.first_name || '',
            lastName: staffObj?.last_name || '',
            roleName: staffObj?.role_name || '',
            roleCode: staffObj?.role_code || '',
            isAvailable: true,
            presenceDuration: 'full',
            periodStart: cfg.startDate,
            periodEnd: cfg.endDate,
            maxShiftsMonth: 10,
            excludedDays: [],
            preferredCycle: 'any',
          };
        }
      });
      return next;
    });
  }, [selectedStaffIds, allStaff, cfg.startDate, cfg.endDate]);

  // Step 4: Définir les Règles du Service & Missions
  const [serviceReqs, setServiceReqs] = useState({
    seniorCount: 1,
    residentCount: 2,
    supervisorCount: 1,
    nurseCount: 2,
    shiftHours: '07_07',
    maxPerWeek: 5,
    noConsecutiveShifts: true,
    minRestHours: 24,
  });

  // Step 5: Choix du Mode de Génération
  const [generationMode, setGenerationMode] = useState('auto_balance');

  // Step 6: Validation Intelligente & Pre-Check
  const [anomalies, setAnomalies] = useState([]);
  const [autoFixed, setAutoFixed] = useState(false);

  // Step 7: Propositions (A, B, C)
  const [proposals, setProposals] = useState([]);
  const [selectedProposalKey, setSelectedProposalKey] = useState('proposal_a');

  // Navigation labels
  const stepLabels = [
    '1. Informations',
    '2. Équipe',
    '3. Contraintes',
    '4. Missions & Règles',
    '5. Mode de génération',
    '6. Pré-Validation',
    '7. Choix du planning',
  ];

  const totalDays = cfg.startDate && cfg.endDate
    ? Math.max(1, Math.ceil((new Date(cfg.endDate) - new Date(cfg.startDate)) / 86400000) + 1) : 0;

  const getStepError = () => {
    if (step === 0) {
      if (!cfg.startDate || !cfg.endDate) return 'Les dates de début et de fin sont obligatoires.';
      if (new Date(cfg.endDate) < new Date(cfg.startDate)) return 'La date de fin doit être postérieure à la date de début.';
      return '';
    }
    if (step === 1) {
      if (selectedStaffIds.length === 0) return 'Sélectionnez au moins un membre du personnel pour composer l\'équipe.';
      return '';
    }
    return '';
  };
  const canNext = () => !getStepError();

  const runPreCheck = () => {
    const detected = [];
    const staffList = selectedStaffIds.map(id => memberConfigs[id]).filter(Boolean);

    const seniorCount = staffList.filter(s => (s?.roleName?.toLowerCase().includes('senior') || s?.roleName?.toLowerCase().includes('médecin'))).length;
    if (seniorCount === 0) {
      detected.push({
        id: 'no-senior',
        severity: 'error',
        message: 'Aucun Médecin Sénior n\'a été inclus dans l\'équipe sélectionnée.',
      });
    }

    staffList.forEach(s => {
      if (s?.periodStart && s?.periodEnd && s.periodEnd < s.periodStart) {
        detected.push({
          id: `invalid-period-${s.id}`,
          severity: 'warning',
          message: `${s.firstName} ${s.lastName} : La date de fin de présence (${s.periodEnd}) précède le début (${s.periodStart}).`,
        });
      }
    });

    setAnomalies(detected);
  };

  const autoFixAnomalies = () => {
    setMemberConfigs(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(id => {
        if (next[id].periodEnd < next[id].periodStart) {
          next[id].periodEnd = cfg.endDate;
        }
      });
      return next;
    });
    setAnomalies([]);
    setAutoFixed(true);
    toast.success('Anomalies corrigées automatiquement avec succès !');
  };

  const handleGenerateProposals = async () => {
    setGenerating(true);
    try {
      const selectedStaffObjects = selectedStaffIds.map(id => memberConfigs[id]).filter(Boolean);
      const res = await scheduleBuilderAPI.generateProposals({
        departmentId,
        name: cfg.name || `Planning ${cfg.startDate} → ${cfg.endDate}`,
        startDate: cfg.startDate,
        endDate: cfg.endDate,
        periodType: cfg.periodType,
        scheduleType: cfg.scheduleType,
        selectedStaff: selectedStaffObjects,
        serviceRequirements: serviceReqs,
        generationStrategy: generationMode,
      });

      setProposals(res.data.data.proposals || []);
      setStep(6);
      toast.success('3 propositions de planning générées avec succès !');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la génération des propositions');
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirmSelectedProposal = async () => {
    const chosen = proposals.find(p => p.key === selectedProposalKey) || proposals[0];
    if (!chosen) return;
    setLoading(true);
    try {
      const res = await scheduleBuilderAPI.confirmProposal({
        departmentId,
        name: cfg.name || `Planning (${cfg.startDate} → ${cfg.endDate})`,
        startDate: cfg.startDate,
        endDate: cfg.endDate,
        scheduleType: cfg.scheduleType,
        periodType: cfg.periodType,
        selectedProposal: chosen,
      });

      toast.success(res.data.message || 'Planning créé avec succès !');
      onDone(res.data.data?.scheduleId);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la création du planning');
    } finally {
      setLoading(false);
    }
  };

  const inputSt = {
    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
    color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box'
  };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      {/* Stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 24, overflowX: 'auto', paddingBottom: 4 }}>
        {stepLabels.map((lbl, i) => (
          <React.Fragment key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, opacity: i > step ? 0.45 : 1 }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: i < step ? '#10B981' : i === step ? 'var(--color-primary)' : 'var(--bg-elevated)',
                color: i <= step ? '#fff' : 'var(--text-muted)', fontWeight: 800, fontSize: 11, flexShrink: 0,
              }}>
                {i < step ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 11, fontWeight: i === step ? 800 : 600, color: i === step ? 'var(--color-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {lbl}
              </span>
            </div>
            {i < stepLabels.length - 1 && (
              <div style={{ flex: 1, height: 2, background: i < step ? '#10B981' : 'var(--border-subtle)', minWidth: 8 }} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Main step container */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 18, border: '1px solid var(--border-subtle)', padding: '24px 28px', marginBottom: 18, boxShadow: '0 10px 30px rgba(0,0,0,.04)' }}>

        {/* ══ ÉTAPE 1 : Informations Générales ══════════════════════════ */}
        {step === 0 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>
              📋 Étape 1 : Informations générales du planning
            </h3>
            <p style={{ margin: '0 0 20px', color: 'var(--text-muted)', fontSize: 13 }}>
              Spécifiez l'intitulé, la période globale et le type de garde à organiser.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, gridColumn: '1 / -1' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Nom du planning *</span>
                <input type="text" style={inputSt} value={cfg.name} onChange={e => setCfg(c => ({ ...c, name: e.target.value }))} placeholder="Ex: Garde Septembre - Octobre 2026" />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Date de début *</span>
                <input type="date" style={inputSt} value={cfg.startDate} onChange={e => setCfg(c => ({ ...c, startDate: e.target.value }))} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Date de fin *</span>
                <input type="date" style={inputSt} value={cfg.endDate} onChange={e => setCfg(c => ({ ...c, endDate: e.target.value }))} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Organisation temporelle</span>
                <select style={inputSt} value={cfg.periodType} onChange={e => setCfg(c => ({ ...c, periodType: e.target.value }))}>
                  <option value="weekly">Hebdomadaire (1 semaine)</option>
                  <option value="monthly">Mensuel (1 mois)</option>
                  <option value="ab_weeks">Semaines A / B (Alternance)</option>
                  <option value="rotation">Rotation cyclique</option>
                  <option value="custom">Période personnalisée</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Nature des gardes</span>
                <select style={inputSt} value={cfg.scheduleType} onChange={e => setCfg(c => ({ ...c, scheduleType: e.target.value }))}>
                  <option value="normal">📋 Planning Normal (Tous les jours de la période)</option>
                  <option value="special_weekend_holiday">⚡ Planning Spécial (Week-ends & Jours Fériés uniquement)</option>
                </select>
              </label>
            </div>

            {totalDays > 0 && (
              <div style={{ padding: '10px 14px', background: 'rgba(27,79,202,.06)', border: '1px solid rgba(27,79,202,.15)', borderRadius: 10, fontSize: 12, color: 'var(--color-primary)', fontWeight: 700 }}>
                📊 Période de {totalDays} jour(s) · environ {Math.ceil(totalDays / 7)} semaine(s)
              </div>
            )}
          </div>
        )}

        {/* ══ ÉTAPE 2 : Constitution de l'équipe ═════════════════════════ */}
        {step === 1 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>
              👥 Étape 2 : Constitution de l'équipe
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>
              Sélectionnez les professionnels hospitaliers participant à ce planning de garde.
            </p>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <input type="text" placeholder="🔍 Filtrer par nom, prénom, rôle..." style={{ ...inputSt, maxWidth: 320 }} value={staffSearch} onChange={e => setStaffSearch(e.target.value)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setSelectedStaffIds(allStaff.map(s => s.id))} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-primary)', background: 'rgba(27,79,202,.06)', color: 'var(--color-primary)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Tous sélectionner</button>
                <button type="button" onClick={() => setSelectedStaffIds([])} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Vider</button>
              </div>
            </div>

            <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 8 }}>
              {allStaff.map(member => {
                const sel = selectedStaffIds.includes(member.id);
                return (
                  <div key={member.id} onClick={() => setSelectedStaffIds(prev => sel ? prev.filter(x => x !== member.id) : [...prev, member.id])} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: 8, background: sel ? 'rgba(27,79,202,.06)' : 'var(--bg-card)', border: `1px solid ${sel ? 'var(--color-primary)' : 'var(--border-subtle)'}`, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="checkbox" checked={sel} readOnly style={{ cursor: 'pointer' }} />
                      <div>
                        <strong style={{ fontSize: 13 }}>{member.first_name} {member.last_name}</strong>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{member.role_name || member.role_code} · {member.matricule || 'Sans mat.'}</div>
                      </div>
                    </div>
                    {member.dept_id !== departmentId && <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 800, background: '#FFFBEB', color: '#D97706' }}>Externe ({member.dept_name})</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══ ÉTAPE 3 : Définir les contraintes & Ordre de relais ══════ */}
        {step === 2 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>
              🎯 Étape 3 : Contraintes individuelles & Ordre de relais
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>
              Configurez les périodes d'intervention, relais séquentiels et indisponibilités de chaque membre.
            </p>

            <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {selectedStaffIds.map(id => {
                const member = memberConfigs[id] || {};
                return (
                  <div key={id} style={{ padding: 14, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <strong style={{ fontSize: 14, color: 'var(--color-primary)' }}>👨‍⚕️ {member.firstName} {member.lastName} <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>({member.roleName})</span></strong>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>Début de présence</span>
                        <input type="date" style={{ ...inputSt, padding: '6px 8px', fontSize: 11 }} value={member.periodStart || ''} onChange={e => setMemberConfigs(prev => ({ ...prev, [id]: { ...prev[id], periodStart: e.target.value } }))} />
                      </label>

                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>Fin de présence (Relais)</span>
                        <input type="date" style={{ ...inputSt, padding: '6px 8px', fontSize: 11 }} value={member.periodEnd || ''} onChange={e => setMemberConfigs(prev => ({ ...prev, [id]: { ...prev[id], periodEnd: e.target.value } }))} />
                      </label>

                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>Max gardes / mois</span>
                        <input type="number" style={{ ...inputSt, padding: '6px 8px', fontSize: 11 }} value={member.maxShiftsMonth || 10} onChange={e => setMemberConfigs(prev => ({ ...prev, [id]: { ...prev[id], maxShiftsMonth: parseInt(e.target.value) || 10 } }))} />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══ ÉTAPE 4 : Définir les règles du service & Missions ═════════ */}
        {step === 3 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>
              🏛️ Étape 4 : Règles du service & Besoins en garde
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>
              Définissez le nombre minimal de membres requis par garde et les limites de repos réglementaires.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ padding: 14, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 800, color: 'var(--color-primary)' }}>👥 Besoins par garde (Effectif requis)</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <span>Séniors / Médecins :</span>
                    <input type="number" min="0" style={{ ...inputSt, width: 70, padding: '4px 8px', textAlign: 'center' }} value={serviceReqs.seniorCount} onChange={e => setServiceReqs(s => ({ ...s, seniorCount: parseInt(e.target.value) || 0 }))} />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <span>Résidents :</span>
                    <input type="number" min="0" style={{ ...inputSt, width: 70, padding: '4px 8px', textAlign: 'center' }} value={serviceReqs.residentCount} onChange={e => setServiceReqs(s => ({ ...s, residentCount: parseInt(e.target.value) || 0 }))} />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <span>Surveillants :</span>
                    <input type="number" min="0" style={{ ...inputSt, width: 70, padding: '4px 8px', textAlign: 'center' }} value={serviceReqs.supervisorCount} onChange={e => setServiceReqs(s => ({ ...s, supervisorCount: parseInt(e.target.value) || 0 }))} />
                  </label>
                </div>
              </div>

              <div style={{ padding: 14, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 800, color: 'var(--color-primary)' }}>⏱️ Horaires & Repos obligatoire</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
                    Plage horaire des gardes
                    <select style={inputSt} value={serviceReqs.shiftHours} onChange={e => setServiceReqs(s => ({ ...s, shiftHours: e.target.value }))}>
                      <option value="07_07">07h → 07h (Garde de 24 heures)</option>
                      <option value="08_08">08h → 08h (Garde de 24 heures)</option>
                      <option value="12h_day_night">12h Jour / Nuit (08h-20h / 20h-08h)</option>
                      <option value="8h_three_shifts">8h par équipe (08h-16h / 16h-24h / 00h-08h)</option>
                    </select>
                  </label>

                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginTop: 4 }}>
                    <span>Repos minimum après garde :</span>
                    <select style={{ ...inputSt, width: 110, padding: '4px 6px', fontSize: 11 }} value={serviceReqs.minRestHours} onChange={e => setServiceReqs(s => ({ ...s, minRestHours: parseInt(e.target.value) || 24 }))}>
                      <option value={24}>24 heures</option>
                      <option value={48}>48 heures</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ ÉTAPE 5 : Choix du Mode de Génération ═════════════════════ */}
        {step === 4 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>
              ⚙️ Étape 5 : Stratégie de génération des gardes
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>
              Choisissez le mode de répartition qui correspond le mieux à votre organisation.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { id: 'auto_balance', title: 'Mode 4 : Équilibrage Automatique (Recommandé)', icon: '⚖️', desc: 'Répartit automatiquement les gardes, nuits et week-ends de manière égale entre les membres.' },
                { id: 'relais', title: 'Mode 3 : Répartition par Périodes & Relais', icon: '⏱️', desc: 'Respecte scrupuleusement les tranches de présence définies à l\'étape 3 (ex: Résident Y puis Résident Z).' },
                { id: 'rotation', title: 'Mode 2 : Rotation Séquentielle', icon: '🔄', desc: 'Alterne les gardes selon une séquence fixe et prévisible entre les membres de l\'équipe.' },
                { id: 'manual', title: 'Mode 1 : Canevas Manuel Assisté', icon: '🖊️', desc: 'Génère la grille vierge structurée avec l\'équipe configurée pour une saisie libre dans le Tableur.' },
              ].map(mode => (
                <div key={mode.id} onClick={() => setGenerationMode(mode.id)} style={{ padding: 14, borderRadius: 12, border: `2px solid ${generationMode === mode.id ? 'var(--color-primary)' : 'var(--border-subtle)'}`, background: generationMode === mode.id ? 'rgba(27,79,202,.06)' : 'var(--bg-card)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 24 }}>{mode.icon}</span>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: 13, color: generationMode === mode.id ? 'var(--color-primary)' : 'var(--text-primary)' }}>{mode.title}</strong>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{mode.desc}</div>
                  </div>
                  {generationMode === mode.id && <span style={{ color: 'var(--color-primary)', fontWeight: 900 }}>✓</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ ÉTAPE 6 : Validation Intelligente (Pré-Check) ══════════════ */}
        {step === 5 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>
              🔍 Étape 6 : Pré-Validation Intelligente
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>
              L'Assistant vérifie les conflits, absences, règles de repos et manque d'effectif avant la génération.
            </p>

            {anomalies.length === 0 ? (
              <div style={{ padding: 20, borderRadius: 14, background: '#ECFDF5', border: '1.5px solid #10B981', textAlign: 'center' }}>
                <span style={{ fontSize: 36 }}>✅</span>
                <h4 style={{ margin: '8px 0 4px', fontSize: 15, color: '#047857', fontWeight: 800 }}>Aucune anomalie détectée !</h4>
                <p style={{ margin: 0, fontSize: 12, color: '#065F46' }}>L'équipe et les contraintes sont parfaitement configurées pour générer le planning.</p>
              </div>
            ) : (
              <div>
                <div style={{ padding: 14, borderRadius: 12, background: '#FEF2F2', border: '1.5px solid #EF4444', marginBottom: 14 }}>
                  <strong style={{ color: '#991B1B', fontSize: 13 }}>⚠️ {anomalies.length} anomalie(s) ou avertissement(s) détecté(s) :</strong>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#B91C1C', lineHeight: 1.6 }}>
                    {anomalies.map(a => <li key={a.id}>{a.message}</li>)}
                  </ul>
                </div>
                {!autoFixed && (
                  <button type="button" onClick={autoFixAnomalies} style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #10B981, #059669)', color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
                    🛠️ Corriger automatiquement les anomalies
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══ ÉTAPE 7 : Choix parmi 3 Propositions (A, B, C) ═════════════ */}
        {step === 6 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>
              🎉 Étape 7 : Choix parmi les 3 Propositions
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>
              L'Assistant a construit 3 variantes optimisées. Comparez et sélectionnez la meilleure option pour votre service.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 18 }}>
              {proposals.map(prop => {
                const isSelected = selectedProposalKey === prop.key;
                return (
                  <div key={prop.key} onClick={() => setSelectedProposalKey(prop.key)} style={{ padding: 14, borderRadius: 14, border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--border-subtle)'}`, background: isSelected ? 'rgba(27,79,202,.06)' : 'var(--bg-card)', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <strong style={{ fontSize: 13, color: isSelected ? 'var(--color-primary)' : 'var(--text-primary)' }}>{prop.title}</strong>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 12px', lineHeight: 1.4 }}>{prop.description}</p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Couverture :</span>
                        <strong style={{ color: '#10B981' }}>{prop.metrics?.coveragePct}%</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Score d'équité :</span>
                        <strong style={{ color: 'var(--color-primary)' }}>{prop.metrics?.equityScore}%</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Gardes totales :</span>
                        <strong>{prop.metrics?.totalShifts}</strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer Navigation Buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button type="button" onClick={() => step === 0 ? onBack() : setStep(s => s - 1)} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
          {step === 0 ? '← Retour' : '← Étape précédente'}
        </button>

        {step < 5 && (
          <button type="button" disabled={!canNext()} onClick={() => { setStep(s => s + 1); if (step === 4) runPreCheck(); }} style={{ padding: '9px 24px', borderRadius: 8, border: 'none', background: canNext() ? 'var(--color-primary)' : '#9CA3AF', color: '#fff', fontWeight: 800, fontSize: 12, cursor: canNext() ? 'pointer' : 'not-allowed' }}>
            Suivant →
          </button>
        )}

        {step === 5 && (
          <button type="button" disabled={generating} onClick={handleGenerateProposals} style={{ padding: '9px 26px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #1B4FCA, #7C3AED)', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 14px rgba(27,79,202,.3)' }}>
            {generating ? 'Génération des 3 propositions...' : '🚀 Générer les 3 propositions →'}
          </button>
        )}

        {step === 6 && (
          <button type="button" disabled={loading} onClick={handleConfirmSelectedProposal} style={{ padding: '9px 26px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #10B981, #059669)', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 14px rgba(16,185,129,.3)' }}>
            {loading ? 'Création...' : '📊 Valider & Ouvrir dans le Tableur'}
          </button>
        )}
      </div>
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
          position: 'absolute', right: 0, top: '110%', zIndex: 200, minWidth: 190, background: 'var(--bg-card)', borderRadius: 10, padding: '4px 0' }}>
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
  const location = useLocation();
  const navigate = useNavigate();
  const [proposalScheduleId, setProposalScheduleId] = useState(null);
  const [activeTab,    setActiveTab]    = useState('overview');
  const [selectedDept, setSelectedDept] = useState(null);
  const [view,         setView]         = useState('list');
  const [selectedScheduleId, setSelectedScheduleId] = useState(null);
  const [showImport, setShowImport] = useState(false);
  // 2-step flow: stores {id, name, startDate, endDate} after step 1
  const [scheduleInfo, setScheduleInfo] = useState(null);
  useEffect(() => {
    const scheduleId = new URLSearchParams(location.search).get('scheduleId');
    if (!scheduleId) return;
    setSelectedScheduleId(scheduleId);
    setProposalScheduleId(scheduleId);
    setActiveTab('schedules');
    setView('spreadsheet');
    navigate('/chef-de-service', { replace: true });
  }, [location.search, navigate]);

  // Departments dont ce chef est responsable (ou tous les services pour le Surveillant Général)
  const isSG = user?.roleCode === 'general_supervisor';
  const { data: deptData, isLoading: deptLoading } = useQuery({
    queryKey: ['myDepartments', user?.id, user?.roleCode],
    queryFn:  () => isSG
      ? departmentsAPI.getAll()
      : departmentsAPI.getAll({ head: user?.id }),
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

  const roleLabel = isSG
    ? 'Surveillant Général — Consultation Hôpital'
    : user?.roleCode === 'service_supervisor'
    ? 'Surveillant de Service'
    : 'Chef de Service';
  const pageSub = isSG
    ? 'Consultez les plannings et formulez des propositions de modification pour les services'
    : 'Gérez les plannings et l’équipe de votre service';

  const tabs = [
    { id: 'overview',  label: "Vue d'ensemble", emoji: '👁️' },
    { id: 'schedules', label: 'Plannings',       emoji: '📋' },
    { id: 'team',      label: 'Équipe',          emoji: '👥' },
    { id: 'absences',  label: 'Absences',        emoji: '🏖️' },
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
              onManageProposals={() => setProposalScheduleId(selectedScheduleId)}
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
      {proposalScheduleId && <ScheduleChangeProposals scheduleId={proposalScheduleId} onClose={() => setProposalScheduleId(null)} />}

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

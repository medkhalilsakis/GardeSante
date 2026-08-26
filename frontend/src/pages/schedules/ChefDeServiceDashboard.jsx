import React, { useState, useEffect, useRef } from 'react';
import { Check, EllipsisVertical, PenLine, RefreshCw, Scale, Timer } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store';
import { useLocation, useNavigate } from 'react-router-dom';
// `shiftsAPI` a été retiré : il servait uniquement à `/shifts/today`, qui lit la
// table `shifts` que le flux tableur n'alimente pas — le compteur « Gardes
// aujourd'hui » valait donc 0 en permanence. La garde du jour vient désormais de
// `/chef/overview`, qui lit le tableur comme le fait l'appel du jour (Lot Z4).
import { departmentsAPI, schedulesAPI, scheduleBuilderAPI, absencesShiftAPI } from '../../api';
import SmartSpreadsheet from './components/SmartSpreadsheet';
// Le tableur est l'écran le plus dense de la plateforme : une exception de rendu
// y vidait tout l'affichage sans un mot. La barrière l'isole et la nomme.
import ErrorBoundary from '../../components/common/ErrorBoundary';
// Le même planning lu par journée : la vue qui répond à « qui tient ce jour-là »,
// et où une garde de brouillon se déplace au glisser-déposer.
import VisualCalendar from './components/VisualCalendar';
import ImportModal from './components/ImportModal';
import ScheduleChangeProposals from './components/ScheduleChangeProposals';
import StaffLoansPanel from './components/StaffLoansPanel';
// Vue d'ensemble de pilotage du service (Lot Z4). Un seul appel `/chef/overview`
// remplace les quatre compteurs dont deux étaient faux, et rend enfin ce dont un
// chef a besoin : ses plannings, ses files d'attente, les congés qui heurtent une
// garde, l'équité de la charge et l'effectif de garde du jour.
import ChefOverviewPanel from './components/ChefOverviewPanel';
import WizardAssistantV2 from './components/WizardAssistantV2';
// Absences déclarées à l'appel du jour (point 8) — panneau neuf, en lecture seule.
import ShiftAbsencesPanel from './components/ShiftAbsencesPanel';
import ReplacementsPanel from '../replacements/components/ReplacementsPanel';
import HospitalGuardCalendar from '../../components/calendar/HospitalGuardCalendar';
import ScopedStatsPanel from '../../components/statistics/ScopedStatsPanel';
import StaffLoanStatsPanel from '../../components/statistics/StaffLoanStatsPanel';
import ContextBadge from '../../components/layout/ContextBadge';
// La même coquille d'en-tête que le tableur : le tableau de bord annonce son
// service exactement comme un planning annonce sa période.
import PlanningHero from './components/PlanningHero';
// Dates en français sans jamais construire de `Date` sur une colonne DATE.
import { frenchRange, shortFrenchDate } from '@/utils/frenchDates';
import './components/ScheduleRegister.css';
import './components/PlanningCreation.css';
import toast from 'react-hot-toast';

// ─── Icons ────────────────────────────────────────────────────
const Svg = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const IconPlus     = () => <Svg d="M12 5v14M5 12h14" />;

const localDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Jamais un code technique à l'écran : `department_type` vaut `emergency`, `icu`…
// L'ancienne bannière affichait la valeur brute de la colonne.
const DEPT_TYPE_LABELS = {
  emergency: 'Urgences', surgery: 'Chirurgie', icu: 'Réanimation',
  internal: 'Médecine interne', pediatrics: 'Pédiatrie',
  radiology: 'Radiologie', other: 'Autre',
};

/* Presence : cinq degres d'un meme axe, du present au jamais vu. Les tons de
   la plateforme les portent — le service pour qui est la, l'alerte pour qui
   s'eloigne, puis l'encre qui s'efface. Les gris figes d'origine restaient
   clairs en theme sombre et la pastille disparaissait sur son fond. */
const getPresence = (lastActivity) => {
  if (!lastActivity) return { label: 'Jamais connecté', dot: 'var(--gs-rule-strong)' };
  const mins = (Date.now() - new Date(lastActivity)) / 60000;
  if (mins < 5)   return { label: 'Connecté',           dot: 'var(--gs-duty)' };
  if (mins < 30)  return { label: `Il y a ${Math.round(mins)}min`, dot: 'var(--gs-alert)' };
  const h = mins / 60;
  if (h < 24)     return { label: `Il y a ${Math.round(h)}h`, dot: 'var(--gs-ink-faint)' };
  return { label: `Il y a ${Math.floor(h / 24)}j`, dot: 'var(--gs-rule-strong)' };
};

// ─── Step 1: Création planning (Nom + Dates) ─────────────────
const PlanningStep1 = ({ departmentId, onCreated, onBack }) => {
  const qc = useQueryClient();
  const [name, setName]         = useState('');
  const [startDate, setStart]   = useState('');
  const [endDate, setEnd]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [specialDaysOnly, setSpecialDaysOnly] = useState(false);

  const totalDays = startDate && endDate
    ? Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1 : 0;

  const today = localDateKey();
  const endDateMin = startDate && startDate > today ? startDate : today;
  const isBackdatedOngoingPeriod = Boolean(startDate && endDate && startDate <= today && endDate >= today);
  const shortcuts = [
    { label: 'Ce mois',      fn: () => { const d = new Date(), y = d.getFullYear(), m = d.getMonth(); return { s: localDateKey(new Date(y, m, 1)), e: localDateKey(new Date(y, m + 1, 0)) }; } },
    { label: 'Mois prochain',fn: () => { const d = new Date(), y = d.getFullYear(), m = d.getMonth(); return { s: localDateKey(new Date(y, m + 1, 1)), e: localDateKey(new Date(y, m + 2, 0)) }; } },
    { label: '3 mois',       fn: () => { const d = new Date(); const e = new Date(d); e.setMonth(e.getMonth()+3); return { s: localDateKey(d), e: localDateKey(e) }; } },
  ];

  const handleCreate = async () => {
    setError('');
    if (!startDate || !endDate) return setError('La date de début et de fin sont obligatoires.');
    if (endDate < startDate) return setError('La date de fin doit être après la date de début.');
    if (endDate < today) return setError(`La date de fin doit être égale ou postérieure au ${today}.`);
    if (!departmentId) return setError('Service introuvable. Veuillez patienter que la page se charge complètement.');
    setSaving(true);
    try {
      const defaultName = name.trim() || `${specialDaysOnly ? 'Gardes week-ends et jours fériés' : 'Planning'} ${new Date(startDate).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;
      const res = await schedulesAPI.create({ name: defaultName, start_date: startDate, end_date: endDate, department_id: departmentId, status: 'draft', schedule_type: specialDaysOnly ? 'special_weekend_holiday' : 'normal', creation_mode: specialDaysOnly ? 'special_days' : 'assistant', metadata: specialDaysOnly ? { schedule_kind: 'weekend_holiday', special_days_only: true } : { schedule_kind: 'normal' } });
      const id = res.data?.data?.id || res.data?.id;
      if (!id) throw new Error('ID de planning non reçu.');
      // Le planning existe : la liste doit le refléter immédiatement, sinon il
      // « disparaît » en revenant en arrière (cache react-query de 30 s).
      await qc.invalidateQueries({ queryKey: ['schedules'] });
      onCreated(id, defaultName, startDate, endDate);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Erreur lors de la création du planning.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {/* Fil d'étapes — deux temps numérotés. La numérotation dit ici quelque
          chose de vrai : la période est enregistrée avant que la méthode de
          saisie soit choisie. Les deux pastilles rondes colorées d'avant ne
          disaient rien de plus, et employaient le bleu d'autorité pour du
          repérage. */}
      <div className="gs-new-steps">
        <span className="gs-new-step" aria-current="step"><i>1</i><span>Période</span></span>
        <span className="gs-new-step"><i>2</i><span>Méthode de saisie</span></span>
      </div>

      <div className="gs-card gs-new-panel">
        <h3>Définir la période</h3>
        <p>La période est obligatoire : c'est elle qui donne au tableur ses journées.</p>

        {/* Raccourcis */}
        <div style={{ display: 'flex', gap: 7, marginBottom: 14, flexWrap: 'wrap' }}>
          {shortcuts.map(p => (
            <button type="button" key={p.label} className="gs-btn" style={{ minHeight: 28, padding: '5px 12px', fontSize: 11.5 }}
              onClick={() => { const v = p.fn(); setStart(v.s); setEnd(v.e); }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Dates */}
        <div className="gs-new-dates">
          <label className="gs-new-field">
            <span>Date de début</span>
            <input
              type="date"
              className="gs-new-input"
              value={startDate}
              onChange={e => {
                const nextStart = e.target.value;
                const nextMinimumEnd = nextStart && nextStart > today ? nextStart : today;
                setStart(nextStart);
                if (endDate && endDate < nextMinimumEnd) setEnd(nextMinimumEnd);
              }}
            />
          </label>
          <label className="gs-new-field">
            <span>Date de fin</span>
            <input type="date" className="gs-new-input" value={endDate} min={endDateMin} onChange={e => setEnd(e.target.value)} />
          </label>
        </div>

        {totalDays > 0 && (
          <p className="gs-new-span">
            <span><b>{totalDays}</b>jour{totalDays > 1 ? 's' : ''}</span>
            <span><b>{Math.ceil(totalDays / 7)}</b>semaine{Math.ceil(totalDays / 7) > 1 ? 's' : ''}</span>
          </p>
        )}

        {isBackdatedOngoingPeriod && (
          <p className="gs-new-note is-info">
            Cette période a déjà commencé. Le planning restera en brouillon pendant sa préparation, puis passera « En cours » dès son envoi.
          </p>
        )}

        <label className={`gs-new-kind ${specialDaysOnly ? 'is-on' : ''}`}>
          <input type="checkbox" checked={specialDaysOnly} onChange={e => setSpecialDaysOnly(e.target.checked)} />
          <span>
            <strong>Week-ends et jours fériés uniquement</strong>
            <small>Les jours fériés viennent de la configuration du Super Admin. Seules ces dates apparaîtront dans le tableur.</small>
          </span>
        </label>

        {/* Nom */}
        <label className="gs-new-field" style={{ marginBottom: 18 }}>
          <span>Nom du planning <em>— généré si vide</em></span>
          <input type="text" className="gs-new-input" placeholder={`Ex. Gardes ${new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} — ${specialDaysOnly ? 'week-ends' : 'service'}`}
            value={name} onChange={e => setName(e.target.value)} />
        </label>

        {error && <p className="gs-new-note is-alert">{error}</p>}

        <div className="gs-new-actions">
          <button type="button" className="gs-btn" onClick={onBack}>Annuler</button>
          <button type="button" className="gs-btn is-primary" onClick={handleCreate} disabled={saving || !startDate || !endDate}>
            {saving ? 'Création…' : 'Choisir la méthode'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Step 2: Méthode de création ─────────────────────────────
// Les quatre méthodes portaient chacune un dégradé (violet, violet foncé, cyan,
// vert), un émoji et un bouton « Commencer » plein : quatre appels à l'action de
// même poids sur un écran qui n'en demande qu'un. La couleur ne distinguait rien
// que le titre ne disait déjà — elle est retirée, et la carte recommandée est la
// seule à porter le bleu d'autorité.
const MethodSelector = ({ onSelect }) => {
  const methods = [
    {
      id: 'assistant', lead: true,
      title: 'Assistant guidé', tag: 'Recommandé',
      desc: 'Sept étapes : l\'équipe, ses périodes, les contraintes du service, puis trois répartitions à comparer.',
      features: ['Règles métier et relais', 'Pré-validation avant génération', 'Trois propositions comparées'],
    },
    {
      id: 'assistant_v2',
      title: 'Assistant V2', tag: 'Nouveau',
      desc: 'Les congés sont écartés dès la génération et la grille est contrôlée par le serveur avant de devenir un planning. Modifiable avant envoi.',
      features: ['Congés respectés d\'office', 'Cinq modes de répartition', 'Anomalies corrigées en un clic', 'Briefs réutilisables'],
    },
    {
      id: 'spreadsheet',
      title: 'Tableur manuel', tag: 'Contrôle total',
      desc: 'Remplissez vous-même le tableau de garde : le personnel, ses périodes, les durées et vos propres colonnes.',
      features: ['Colonnes personnalisées', 'Durées de garde par ligne', 'Export Excel, PDF et CSV'],
    },
    {
      id: 'import',
      title: 'Importer un fichier', tag: 'Rapide',
      desc: 'Reprenez un tableau Excel ou CSV existant. Les colonnes sont reconnues et les données vérifiées avant l\'import.',
      features: ['Modèle téléchargeable', 'Vérification des données', 'Aperçu avant import', 'XLSX et CSV'],
    },
  ];

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="gs-new-steps">
        <span className="gs-new-step" data-state="done"><i>1</i><span>Période</span></span>
        <span className="gs-new-step" aria-current="step"><i>2</i><span>Méthode de saisie</span></span>
      </div>

      <div className="gs-new-lede">
        <h3>Comment remplir ce planning ?</h3>
        <p>La période est enregistrée. Le planning existe déjà en brouillon — il ne reste qu'à choisir par quel bout le remplir.</p>
      </div>

      <div className="gs-new-methods">
        {methods.map(m => (
          <button type="button" key={m.id} onClick={() => onSelect(m.id)}
            className={`gs-new-method ${m.lead ? 'is-lead' : ''}`}>
            <span className="gs-new-method-head">
              <strong>{m.title}</strong>
              <span className={`gs-new-tag ${m.lead ? 'is-lead' : ''}`}>{m.tag}</span>
            </span>
            <p>{m.desc}</p>
            <ul>
              {m.features.map(f => (
                <li key={f}><i aria-hidden="true" />{f}</li>
              ))}
            </ul>
            <span className="gs-new-method-go">Choisir cette méthode →</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// ─── ASSISTANT DE PLANIFICATION DES GARDES (7 ÉTAPES) ─────────────
const WizardAssistant = ({ departmentId, startDate: initStart, endDate: initEnd, name: initName, onBack, onDone }) => {
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

  // Step 6: pre-validation avant generation
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

  /* Pas de `outline: 'none'` : un style en ligne bat la regle de la couche de
     jetons, et le champ perdait son seul repere au clavier. */
  const inputSt = {
    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--gs-rule)', background: 'var(--gs-paper)',
    color: 'var(--gs-ink)', boxSizing: 'border-box'
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
                background: i < step ? 'var(--gs-duty)' : i === step ? 'var(--gs-seal)' : 'var(--gs-paper-alt)',
                color: i <= step ? 'var(--gs-on-tone)' : 'var(--gs-ink-faint)', fontWeight: 800, fontSize: 11, flexShrink: 0,
              }}>
                {i < step ? <Check size={13} strokeWidth={3} /> : i + 1}
              </div>
              <span style={{ fontSize: 11, fontWeight: i === step ? 800 : 600, color: i === step ? 'var(--gs-seal)' : 'var(--gs-ink-faint)', whiteSpace: 'nowrap' }}>
                {lbl}
              </span>
            </div>
            {i < stepLabels.length - 1 && (
              <div style={{ flex: 1, height: 2, background: i < step ? 'var(--gs-duty)' : 'var(--gs-rule)', minWidth: 8 }} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Main step container */}
      <div style={{ background: 'var(--gs-paper)', borderRadius: 18, border: '1px solid var(--gs-rule)', padding: '24px 28px', marginBottom: 18, boxShadow: 'var(--gs-shadow-card)' }}>

        {/* ══ ÉTAPE 1 : Informations Générales ══════════════════════════ */}
        {step === 0 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--gs-display)', fontSize: 19, fontWeight: 700, letterSpacing: '-.015em', color: 'var(--gs-ink)' }}>
              Étape 1 : Informations générales du planning
            </h3>
            <p style={{ margin: '0 0 20px', color: 'var(--gs-ink-faint)', fontSize: 13 }}>
              Spécifiez l'intitulé, la période globale et le type de garde à organiser.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, gridColumn: '1 / -1' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gs-ink-faint)' }}>Nom du planning *</span>
                <input type="text" style={inputSt} value={cfg.name} onChange={e => setCfg(c => ({ ...c, name: e.target.value }))} placeholder="Ex: Garde Septembre - Octobre 2026" />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gs-ink-faint)' }}>Date de début *</span>
                <input type="date" style={inputSt} value={cfg.startDate} onChange={e => setCfg(c => ({ ...c, startDate: e.target.value }))} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gs-ink-faint)' }}>Date de fin *</span>
                <input type="date" style={inputSt} value={cfg.endDate} onChange={e => setCfg(c => ({ ...c, endDate: e.target.value }))} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gs-ink-faint)' }}>Organisation temporelle</span>
                <select style={inputSt} value={cfg.periodType} onChange={e => setCfg(c => ({ ...c, periodType: e.target.value }))}>
                  <option value="weekly">Hebdomadaire (1 semaine)</option>
                  <option value="monthly">Mensuel (1 mois)</option>
                  <option value="ab_weeks">Semaines A / B (Alternance)</option>
                  <option value="rotation">Rotation cyclique</option>
                  <option value="custom">Période personnalisée</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gs-ink-faint)' }}>Nature des gardes</span>
                <select style={inputSt} value={cfg.scheduleType} onChange={e => setCfg(c => ({ ...c, scheduleType: e.target.value }))}>
                  <option value="normal">Planning normal (tous les jours de la période)</option>
                  <option value="special_weekend_holiday">Planning spécial (week-ends et jours fériés uniquement)</option>
                </select>
              </label>
            </div>

            {totalDays > 0 && (
              <div style={{ padding: '10px 14px', background: 'var(--gs-seal-wash)', border: '1px solid color-mix(in srgb, var(--gs-seal) 20%, transparent)', borderRadius: 10, fontSize: 12, color: 'var(--gs-seal)', fontWeight: 700 }}>
                Période de {totalDays} jour(s) · environ {Math.ceil(totalDays / 7)} semaine(s)
              </div>
            )}
          </div>
        )}

        {/* ══ ÉTAPE 2 : Constitution de l'équipe ═════════════════════════ */}
        {step === 1 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--gs-display)', fontSize: 19, fontWeight: 700, letterSpacing: '-.015em', color: 'var(--gs-ink)' }}>
              Étape 2 : Constitution de l'équipe
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--gs-ink-faint)', fontSize: 13 }}>
              Sélectionnez les professionnels hospitaliers participant à ce planning de garde.
            </p>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <input type="text" placeholder="Filtrer par nom, prénom, rôle…" style={{ ...inputSt, maxWidth: 320 }} value={staffSearch} onChange={e => setStaffSearch(e.target.value)} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setSelectedStaffIds(allStaff.map(s => s.id))} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--gs-seal)', background: 'var(--gs-seal-wash)', color: 'var(--gs-seal)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Tous sélectionner</button>
                <button type="button" onClick={() => setSelectedStaffIds([])} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--gs-rule)', background: 'transparent', color: 'var(--gs-ink-faint)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Vider</button>
              </div>
            </div>

            <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--gs-rule)', borderRadius: 10, padding: 8 }}>
              {allStaff.map(member => {
                const sel = selectedStaffIds.includes(member.id);
                return (
                  <div key={member.id} onClick={() => setSelectedStaffIds(prev => sel ? prev.filter(x => x !== member.id) : [...prev, member.id])} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: 8, background: sel ? 'var(--gs-seal-wash)' : 'var(--gs-paper)', border: `1px solid ${sel ? 'var(--gs-seal)' : 'var(--gs-rule)'}`, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="checkbox" checked={sel} readOnly style={{ cursor: 'pointer' }} />
                      <div>
                        <strong style={{ fontSize: 13 }}>{member.first_name} {member.last_name}</strong>
                        <div style={{ fontSize: 11, color: 'var(--gs-ink-faint)' }}>{member.role_name || member.role_code} · {member.matricule || 'Sans mat.'}</div>
                      </div>
                    </div>
                    {member.dept_id !== departmentId && <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 800, background: 'var(--gs-alert-wash)', color: 'var(--gs-alert-strong)' }}>Externe ({member.dept_name})</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ══ ÉTAPE 3 : Définir les contraintes & Ordre de relais ══════ */}
        {step === 2 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--gs-display)', fontSize: 19, fontWeight: 700, letterSpacing: '-.015em', color: 'var(--gs-ink)' }}>
              Étape 3 : Contraintes individuelles et ordre de relais
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--gs-ink-faint)', fontSize: 13 }}>
              Configurez les périodes d'intervention, relais séquentiels et indisponibilités de chaque membre.
            </p>

            <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {selectedStaffIds.map(id => {
                const member = memberConfigs[id] || {};
                return (
                  <div key={id} style={{ padding: 14, borderRadius: 12, background: 'var(--gs-paper-alt)', border: '1px solid var(--gs-rule)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <strong style={{ fontSize: 14, color: 'var(--gs-seal)' }}>{member.firstName} {member.lastName} <span style={{ fontSize: 11, color: 'var(--gs-ink-faint)', fontWeight: 500 }}>({member.roleName})</span></strong>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--gs-ink-faint)' }}>Début de présence</span>
                        <input type="date" style={{ ...inputSt, padding: '6px 8px', fontSize: 11 }} value={member.periodStart || ''} onChange={e => setMemberConfigs(prev => ({ ...prev, [id]: { ...prev[id], periodStart: e.target.value } }))} />
                      </label>

                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--gs-ink-faint)' }}>Fin de présence (Relais)</span>
                        <input type="date" style={{ ...inputSt, padding: '6px 8px', fontSize: 11 }} value={member.periodEnd || ''} onChange={e => setMemberConfigs(prev => ({ ...prev, [id]: { ...prev[id], periodEnd: e.target.value } }))} />
                      </label>

                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--gs-ink-faint)' }}>Max gardes / mois</span>
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
            <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--gs-display)', fontSize: 19, fontWeight: 700, letterSpacing: '-.015em', color: 'var(--gs-ink)' }}>
              Étape 4 : Règles du service et besoins en garde
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--gs-ink-faint)', fontSize: 13 }}>
              Définissez le nombre minimal de membres requis par garde et les limites de repos réglementaires.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ padding: 14, borderRadius: 12, background: 'var(--gs-paper-alt)', border: '1px solid var(--gs-rule)' }}>
                <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 800, color: 'var(--gs-seal)' }}>Besoins par garde (Effectif requis)</h4>
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

              <div style={{ padding: 14, borderRadius: 12, background: 'var(--gs-paper-alt)', border: '1px solid var(--gs-rule)' }}>
                <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 800, color: 'var(--gs-seal)' }}>Horaires et repos obligatoire</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--gs-ink-faint)' }}>
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
            <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--gs-display)', fontSize: 19, fontWeight: 700, letterSpacing: '-.015em', color: 'var(--gs-ink)' }}>
              Étape 5 : Stratégie de génération des gardes
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--gs-ink-faint)', fontSize: 13 }}>
              Choisissez le mode de répartition qui correspond le mieux à votre organisation.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { id: 'auto_balance', title: 'Mode 4 : Équilibrage automatique (recommandé)', Icon: Scale, desc: 'Répartit automatiquement les gardes, nuits et week-ends de manière égale entre les membres.' },
                { id: 'relais', title: 'Mode 3 : Répartition par périodes et relais', Icon: Timer, desc: 'Respecte scrupuleusement les tranches de présence définies à l\'étape 3 (ex: Résident Y puis Résident Z).' },
                { id: 'rotation', title: 'Mode 2 : Rotation séquentielle', Icon: RefreshCw, desc: 'Alterne les gardes selon une séquence fixe et prévisible entre les membres de l\'équipe.' },
                { id: 'manual', title: 'Mode 1 : Canevas manuel assisté', Icon: PenLine, desc: 'Génère la grille vierge structurée avec l\'équipe configurée pour une saisie libre dans le Tableur.' },
              ].map(mode => (
                <div key={mode.id} onClick={() => setGenerationMode(mode.id)} style={{ padding: 14, borderRadius: 12, border: `2px solid ${generationMode === mode.id ? 'var(--gs-seal)' : 'var(--gs-rule)'}`, background: generationMode === mode.id ? 'var(--gs-seal-wash)' : 'var(--gs-paper)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <mode.Icon size={22} strokeWidth={1.75} style={{ flexShrink: 0, color: generationMode === mode.id ? 'var(--gs-seal)' : 'var(--gs-ink-faint)' }} />
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: 13, color: generationMode === mode.id ? 'var(--gs-seal)' : 'var(--gs-ink)' }}>{mode.title}</strong>
                    <div style={{ fontSize: 11, color: 'var(--gs-ink-faint)', marginTop: 2 }}>{mode.desc}</div>
                  </div>
                  {generationMode === mode.id && <Check size={16} strokeWidth={3} style={{ flexShrink: 0, color: 'var(--gs-seal)' }} />}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ ÉTAPE 6 : Pré-validation avant génération ══════════════ */}
        {step === 5 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--gs-display)', fontSize: 19, fontWeight: 700, letterSpacing: '-.015em', color: 'var(--gs-ink)' }}>
              Étape 6 : Pré-validation
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--gs-ink-faint)', fontSize: 13 }}>
              L'Assistant vérifie les conflits, absences, règles de repos et manque d'effectif avant la génération.
            </p>

            {anomalies.length === 0 ? (
              <div style={{ padding: 20, borderRadius: 14, background: 'var(--gs-duty-wash)', border: `1.5px solid color-mix(in srgb, var(--gs-duty) 40%, transparent)`, textAlign: 'center' }}>
                <h4 style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--gs-duty)', fontWeight: 800 }}>Aucune anomalie détectée</h4>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--gs-ink-soft)' }}>L'équipe et les contraintes sont configurées pour générer le planning.</p>
              </div>
            ) : (
              <div>
                <div style={{ padding: 14, borderRadius: 12, background: 'var(--gs-alert-wash)', border: `1.5px solid color-mix(in srgb, var(--gs-alert-strong) 40%, transparent)`, marginBottom: 14 }}>
                  <strong style={{ color: 'var(--gs-alert-strong)', fontSize: 13 }}>{anomalies.length} anomalie(s) ou avertissement(s) détecté(s) :</strong>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--gs-ink-soft)', lineHeight: 1.6 }}>
                    {anomalies.map(a => <li key={a.id}>{a.message}</li>)}
                  </ul>
                </div>
                {!autoFixed && (
                  <button type="button" onClick={autoFixAnomalies} className="gs-btn" style={{ width: '100%' }}>
                    Corriger automatiquement les anomalies
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══ ÉTAPE 7 : Choix parmi 3 Propositions (A, B, C) ═════════════ */}
        {step === 6 && (
          <div>
            <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--gs-display)', fontSize: 19, fontWeight: 700, letterSpacing: '-.015em', color: 'var(--gs-ink)' }}>
              Étape 7 : Choix parmi les trois propositions
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--gs-ink-faint)', fontSize: 13 }}>
              L'Assistant a construit 3 variantes optimisées. Comparez et sélectionnez la meilleure option pour votre service.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 18 }}>
              {proposals.map(prop => {
                const isSelected = selectedProposalKey === prop.key;
                return (
                  <div key={prop.key} onClick={() => setSelectedProposalKey(prop.key)} style={{ padding: 14, borderRadius: 14, border: `2px solid ${isSelected ? 'var(--gs-seal)' : 'var(--gs-rule)'}`, background: isSelected ? 'var(--gs-seal-wash)' : 'var(--gs-paper)', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <strong style={{ fontSize: 13, color: isSelected ? 'var(--gs-seal)' : 'var(--gs-ink)' }}>{prop.title}</strong>
                      <p style={{ fontSize: 11, color: 'var(--gs-ink-faint)', margin: '6px 0 12px', lineHeight: 1.4 }}>{prop.description}</p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--gs-rule)', paddingTop: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: 'var(--gs-ink-faint)' }}>Couverture :</span>
                        <strong style={{ color: 'var(--gs-duty)' }}>{prop.metrics?.coveragePct}%</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: 'var(--gs-ink-faint)' }}>Score d'équité :</span>
                        <strong style={{ color: 'var(--gs-seal)' }}>{prop.metrics?.equityScore}%</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: 'var(--gs-ink-faint)' }}>Gardes totales :</span>
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

      {/* Navigation — une seule action engage l'étape suivante, et elle porte
          seule le bleu d'autorité. Les trois dégradés (violet, bleu-violet,
          vert) mettaient au même poids « Suivant », « Générer » et
          « Valider ». */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="gs-btn" onClick={() => step === 0 ? onBack() : setStep(s => s - 1)}>
          {step === 0 ? '← Retour' : '← Étape précédente'}
        </button>

        {step < 5 && (
          <button type="button" className="gs-btn is-primary" disabled={!canNext()} onClick={() => { setStep(s => s + 1); if (step === 4) runPreCheck(); }}>
            Suivant →
          </button>
        )}

        {step === 5 && (
          <button type="button" className="gs-btn is-primary" disabled={generating} onClick={handleGenerateProposals}>
            {generating ? 'Génération des propositions…' : 'Générer les 3 propositions →'}
          </button>
        )}

        {step === 6 && (
          <button type="button" className="gs-btn is-primary" disabled={loading} onClick={handleConfirmSelectedProposal}>
            {loading ? 'Création…' : 'Valider et ouvrir le tableur'}
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Status meta (full set) ─────────────────────────────────────
// Un seul vocabulaire d'états pour le registre et pour l'en-tête du tableur :
// `STATUS_META` (SmartSpreadsheet) donne la même correspondance état → ton, donc
// un planning « en vigueur » a la même couleur dans la liste et dans le tableur.
// Les pastilles colorées et les émojis ont disparu : dans une liste de dix
// lignes, dix pastilles ne hiérarchisent plus rien.
const STATUS_FULL = {
  draft:              { label: 'Brouillon',      tone: 'open' },
  preparing:          { label: 'En préparation', tone: 'open' },
  pending_validation: { label: 'En attente',     tone: 'sealed' },
  validated:          { label: 'Validé',         tone: 'live' },
  submitted:          { label: 'En vigueur',     tone: 'sealed' },
  // Conservés en secours : plus aucun planning n'est créé dans ces statuts.
  under_review:       { label: 'En révision',    tone: 'open' },
  approved:           { label: 'Approuvé',       tone: 'live' },
  rejected:           { label: 'Rejeté',         tone: 'stopped' },
  active:             { label: 'En cours',       tone: 'live' },
  archived:           { label: 'Archivé',        tone: 'neutral' },
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
    <div ref={ref} className={`gs-reg-actions${open ? ' is-open' : ''}`}>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className="gs-reg-actions__trigger"
        aria-label={`Actions sur « ${schedule.name} »`}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Actions">
        <EllipsisVertical size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="gs-reg-actions__menu" role="menu">
          <ActItem label="Ouvrir" onClick={() => { setOpen(false); onView(schedule.id); }} />
          <ActItem label="Dupliquer" onClick={() => doAction('duplicate', 'Planning dupliqué')} />
          <div className="gs-reg-actions__divider" />
          {!isArchived
            ? <ActItem label="Archiver" onClick={() => doAction('archive', 'Planning archivé')} />
            : <ActItem label="Restaurer" onClick={() => doAction('restore', 'Planning restauré en brouillon')} />
          }
          {isDeletable && (
            <ActItem label="Supprimer" danger onClick={() => doAction('delete', 'Planning supprimé')} />
          )}
        </div>
      )}
    </div>
  );
}

// Un verbe par ligne, rien devant : les émojis (👁 ⧉ 📦 🗑) doublaient le mot
// sans le préciser, et le registre n'en porte plus aucun.
const ActItem = ({ label, onClick, danger }) => (
  <button type="button" role="menuitem" onClick={onClick}
    className={`gs-reg-actions__item${danger ? ' is-danger' : ''}`}>
    {label}
  </button>
);

// ─── Schedule List ─────────────────────────────────────────────
const ScheduleList = ({ departmentId, onView, onNew }) => {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['schedules', departmentId],
    queryFn:  () => schedulesAPI.getAll({ departmentId, limit: 50 }),
    // Le retour à la liste doit toujours montrer l'état réel du serveur :
    // sans cela un planning tout juste créé reste absent le temps du cache.
    refetchOnMount: 'always',
  });

  const allItems = data?.data?.data || data?.data || [];
  const items = statusFilter ? allItems.filter(s => s.status === statusFilter) : allItems;

  const refresh = () => qc.invalidateQueries(['schedules', departmentId]);

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--gs-ink-faint)' }}>Chargement...</div>;
  }

  // Provenance du planning, sans émoji : c'est un fait de plus sur la ligne, pas
  // une catégorie à signaler. `special_days` n'est pas une méthode de création
  // mais la nature du planning — c'est le même mot que porte l'en-tête du
  // tableur pour ces plannings-là ; il s'affichait en clair (`special_days`).
  const modeLabel = m => ({
    assistant: 'Assistant', spreadsheet: 'Tableur', visual: 'Visuel',
    special_days: 'Week-ends & fériés',
  }[m] || m);
  // Les dates arrivent en `YYYY-MM-DD` (colonnes DATE castées côté serveur) ;
  // `updated_at` est un horodatage, donc on passe par le fuseau local avant de
  // le mettre en français.
  const dk = v => String(v || '').slice(0, 10);

  // Count by status
  const statusCounts = allItems.reduce((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {});

  return (
    <div>
      <div className="gs-reg-head">
        <div>
          <h3>Mes plannings</h3>
          <p>{allItems.length} planning{allItems.length !== 1 ? 's' : ''} au total</p>
        </div>
        <button type="button" className="gs-btn is-primary" onClick={onNew}>
          <IconPlus /> Nouveau planning
        </button>
      </div>

      {/* Filtre par état */}
      {allItems.length > 0 && (
        <div className="gs-reg-filters">
          <button type="button" className="gs-reg-filter" data-tone="sealed"
            aria-pressed={!statusFilter} onClick={() => setStatusFilter('')}>
            Tous <b className="gs-num">{allItems.length}</b>
          </button>
          {Object.entries(statusCounts).map(([st, cnt]) => {
            const m = STATUS_FULL[st] || { label: st, tone: 'neutral' };
            return (
              <button key={st} type="button" className="gs-reg-filter" data-tone={m.tone}
                aria-pressed={statusFilter === st}
                onClick={() => setStatusFilter(st === statusFilter ? '' : st)}>
                {m.label} <b className="gs-num">{cnt}</b>
              </button>
            );
          })}
        </div>
      )}

      {items.length === 0 ? (
        <div className="gs-reg-empty">
          <strong>{statusFilter ? 'Aucun planning dans cet état' : 'Aucun planning'}</strong>
          <p>{statusFilter
            ? 'Changez de filtre pour voir les autres plannings du service.'
            : 'Créez le premier tableau de garde du service.'}</p>
          {statusFilter
            ? <button type="button" className="gs-btn" onClick={() => setStatusFilter('')}>Voir tous les plannings</button>
            : <button type="button" className="gs-btn is-primary" onClick={onNew}><IconPlus /> Créer un planning</button>}
        </div>
      ) : (
        <div className="gs-reg-list">
          {items.map(s => {
            const m = STATUS_FULL[s.status] || { label: s.status, tone: 'neutral' };
            return (
              <div key={s.id} className="gs-reg-row" data-tone={m.tone}>
                <span className="gs-reg-rail" aria-hidden="true" />

                {/* Le bouton porte le nom, son `::after` couvre la ligne : un
                    seul point d'entrée, atteignable au clavier. */}
                <button type="button" className="gs-reg-open" onClick={() => onView(s.id)}>
                  <span className="gs-reg-name">{s.name}</span>
                  <span className="gs-reg-facts">
                    <span className="gs-num">{frenchRange(dk(s.start_date), dk(s.end_date))}</span>
                    {s.creation_mode && <span>{modeLabel(s.creation_mode)}</span>}
                    {s.updated_at && <span>modifié le {shortFrenchDate(localDateKey(new Date(s.updated_at)), true)}</span>}
                  </span>
                </button>

                <span className="gs-reg-status">{m.label}</span>

                <span className="gs-reg-tools">
                  <ScheduleActionMenu schedule={s} onView={onView} onRefresh={refresh} />
                </span>
              </div>
            );
          })}
        </div>
      )}
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
  // Lecture active d'un planning ouvert : le tableur ou le calendrier. Les deux
  // affichent les mêmes gardes ; seule la question posée change.
  const [reading,      setReading]      = useState('spreadsheet');
  const [selectedScheduleId, setSelectedScheduleId] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [deepLinkScheduleId, setDeepLinkScheduleId] = useState(null);
  // 2-step flow: stores {id, name, startDate, endDate} after step 1
  const [scheduleInfo, setScheduleInfo] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const scheduleId = params.get('scheduleId');

    // Deep-link depuis une notification de remplacement : on ouvre l'onglet
    // Remplacements, surtout pas le tableur (qui ne doit pas être modifié).
    if (params.get('tab') === 'remplacements') {
      setActiveTab('remplacements');
      if (scheduleId) setDeepLinkScheduleId(scheduleId);
      navigate('/chef-de-service', { replace: true });
      return;
    }

    // Deep-link depuis une notification de note ou circulaire. L'onglet n'existe
    // plus ici (point 7) : on redirige vers l'écran indépendant. Les
    // notifications déjà en base pointent encore sur `?tab=notes`, elles
    // continuent donc de fonctionner.
    if (params.get('tab') === 'notes') {
      navigate('/notes', { replace: true });
      return;
    }

    // Depuis le calendrier hospitalier, le chef arrive directement dans la
    // création d'un planning. La navigation reste portée par l'écran du chef.
    if (params.get('tab') === 'schedules' && params.get('view') === 'new') {
      setActiveTab('schedules');
      setScheduleInfo(null);
      setSelectedScheduleId(null);
      setView('new');
      navigate('/chef-de-service', { replace: true });
      return;
    }

    if (!scheduleId) return;
    setSelectedScheduleId(scheduleId);
    // Une notification sans cible de vue ouvre les propositions. Un lien
    // explicite vers le tableur ouvre uniquement le registre demandé.
    if (params.get('view') !== 'spreadsheet') setProposalScheduleId(scheduleId);
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
  // La spécialité ne se répète pas quand elle porte déjà le nom du service
  // (« Urgences » de type `emergency`).
  const deptTypeLabel = DEPT_TYPE_LABELS[dept?.department_type] || dept?.department_type || null;
  const deptFacts = dept ? [
    deptTypeLabel && deptTypeLabel.toLowerCase() !== String(dept.name || '').toLowerCase() ? deptTypeLabel : null,
    dept.floor ? `Étage ${dept.floor}` : null,
    dept.bed_count ? `${dept.bed_count} lits` : null,
  ].filter(Boolean).join(' · ') : '';

  // La garde du jour est lue par `<ChefOverviewPanel>` via `/chef/overview`, qui
  // parcourt les tableurs en cours exactement comme l'appel du jour. L'ancienne
  // requête `['shifts-today']` interrogeait `/shifts/today` : cette route lit la
  // vue `v_today_shifts` sur la table `shifts`, que le flux tableur n'alimente
  // pas, ignore `departmentId` et calcule le jour en UTC. Elle renvoyait donc une
  // liste vide en permanence — d'où un compteur figé à 0 et une carte « Gardes du
  // jour » qui ne s'affichait jamais. Requête supprimée (Lot Z4).

  const currentDay = new Date().toLocaleDateString('en-CA');
  const { data: todayAbsenceData } = useQuery({
    // `departmentId` était dans la clé de cache mais pas dans la requête : changer
    // de service invalidait le cache pour redemander exactement les mêmes lignes.
    // Le serveur bornait un chef à son service **primaire** ; il honore désormais
    // ce paramètre quand le service est l'un des siens (absences-shift.controller.js).
    queryKey: ['absences-shift', 'today', selectedDept, currentDay],
    queryFn: () => absencesShiftAPI.getAll({
      ...(selectedDept ? { departmentId: selectedDept } : {}),
      from: currentDay, to: currentDay, limit: 200,
    }),
    enabled: !!selectedDept,
    refetchInterval: 60000,
  });
  const todayAbsences = (todayAbsenceData?.data?.data || []).filter((absence) => (
    !selectedDept || !absence.department_id || absence.department_id === selectedDept
  ));
  // `absentStaffCount` servait au compteur « Personnel présent », qui soustrayait
  // les absents de `member_count` — un total non filtré sur `is_active`. Le vrai
  // chiffre (`effectif.disponibles`) vient maintenant de `/chef/overview`.

  // Cet écran est partagé par trois fonctions — il annonce celle de qui le
  // regarde. Le sous-titre qui doublait cette phrase (« Gérez les plannings et
  // l'équipe de votre service ») a été retiré avec l'ancien en-tête : il ne
  // disait rien que le rôle et les onglets ne disent déjà.
  const roleLabel = isSG
    ? 'Surveillant Général — Consultation Hôpital'
    : user?.roleCode === 'service_supervisor'
    ? 'Surveillant de Service'
    : 'Chef de Service';

  // Les libellés seuls : le champ `emoji` que portait chaque onglet n'a jamais
  // été rendu.
  const tabs = [
    { id: 'overview',  label: "Vue d'ensemble" },
    { id: 'schedules', label: 'Plannings' },
    { id: 'team',      label: 'Équipe' },
    { id: 'absences',  label: 'Absences' },
    { id: 'remplacements', label: 'Remplacements' },
    // L'onglet « Notes » est parti vers l'écran indépendant /notes (point 7).
    { id: 'calendrier', label: 'Calendrier hôpital' },
    { id: 'stats',     label: 'Statistiques' },
    { id: 'loan-stats', label: 'Prêts personnel' },
  ];

  const cardSt = { background: 'var(--gs-paper)', border: '1px solid var(--gs-rule)', borderRadius: 16, padding: 24 };

  if (deptLoading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--gs-paper-alt)' }}>Chargement...</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gs-paper-alt)', padding: 24 }}>

      {/* Appartenance — hôpital et service(s) dont on est chef. */}
      <ContextBadge variant="header" />

      {/* ── En-tête du service ───────────────────────────────────────────
          Le service était annoncé trois fois — le badge d'appartenance, le bloc
          « Bonjour », puis une bannière en dégradé violet qui était l'élément le
          plus lourd de l'écran, juste au-dessus du tableur. Une seule annonce
          désormais, dans la coquille `PlanningHero` que le tableur emploie déjà :
          le tableau de bord et le planning se lisent comme un seul système.

          `pageSub` disparaît — c'était la moitié redondante de la
          différenciation des rôles. `roleLabel` la porte à lui seul, donc un
          surveillant de service ou un surveillant général ne lit toujours pas
          « Chef de Service ». */}
      <div className="gs-card" style={{ marginBottom: 18, overflow: 'visible' }}>
        <PlanningHero
          standalone
          eyebrow={`${roleLabel}${user?.firstName ? ` · Bonjour ${user.firstName}` : ''}`}
          title={dept?.name || 'Mon service'}
          range={deptFacts || null}
          quantities={[
            ...(dept ? [{ label: 'Personnel', value: dept.member_count || dept.staff_count || '—' }] : []),
            {
              label: "Absents aujourd'hui",
              value: todayAbsences.length,
              tone: todayAbsences.length > 0 ? 'alert' : undefined,
            },
          ]}
          actions={departments.length > 1 ? (
            <select value={selectedDept || ''} onChange={e => setSelectedDept(e.target.value)}
              aria-label="Service consulté"
              style={{
                minHeight: 32, padding: '6px 10px', borderRadius: 8,
                border: '1px solid var(--gs-rule-strong)', background: 'var(--gs-paper)',
                color: 'var(--gs-ink)', fontFamily: 'var(--gs-body)', fontSize: 12,
                fontWeight: 600, cursor: 'pointer',
              }}>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          ) : null}
        />
      </div>

      {/* Onglets — un onglet actif se souligne, il ne se remplit pas : la
          pastille bleue pleine employait la couleur d'autorité pour une simple
          navigation. Le compteur d'absences reste, c'est le repère qui dit
          qu'il y a quelque chose à traiter. */}
      <nav className="gs-tabs" aria-label="Sections du service" style={{ marginBottom: 20 }}>
        {tabs.map(t => (
          <button key={t.id} type="button" className="gs-tab"
            aria-current={activeTab === t.id ? 'page' : undefined}
            onClick={() => { setActiveTab(t.id); setView('list'); }}>
            {t.label}
            {t.id === 'absences' && todayAbsences.length > 0 && (
              <span className="gs-tab-count">{todayAbsences.length}</span>
            )}
          </button>
        ))}
      </nav>

      {/* ── VUE D'ENSEMBLE ─────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div>
          {/* Tout le pilotage du service en un appel. Les destinations passent par
              les mêmes bascules d'onglet que les boutons d'origine : rien de
              nouveau côté navigation, donc rien à casser. `canManage` distingue
              qui peut agir (chef) de qui ne fait que lire (surveillant général) —
              c'est aussi ce qui aiguille les prêts de personnel, invisibles pour
              un SG dans `/staff-loans`. */}
          <ChefOverviewPanel
            departmentId={selectedDept}
            canManage={!isSG}
            onGoTo={(tab) => { setActiveTab(tab); setView('list'); }}
            onNewSchedule={() => { setActiveTab('schedules'); setView('new'); }}
            onOpenSchedule={(id) => {
              setSelectedScheduleId(id);
              setActiveTab('schedules');
              setView('spreadsheet');
            }}
            onImport={() => setShowImport(true)}
          />

          {/* Prêts de personnel inter-service (accord donné ou refusé par le chef propriétaire) */}
          <div style={{ marginTop: 20 }}>
            <StaffLoansPanel />
          </div>
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

          {/* Assistant intelligent V2 — écran distinct, la V1 ci-dessus reste intacte */}
          {view === 'assistant_v2' && (
            <WizardAssistantV2
              departmentId={selectedDept}
              scheduleId={scheduleInfo?.id || selectedScheduleId}
              startDate={scheduleInfo?.startDate}
              endDate={scheduleInfo?.endDate}
              name={scheduleInfo?.name}
              onBack={() => setView('method')}
              onDone={(schedId) => {
                // L'assistant V2 crée son propre brouillon : on ouvre celui-là,
                // pas celui préparé à l'étape 1.
                if (schedId) { setSelectedScheduleId(schedId); setView('spreadsheet'); }
                else setView('list');
              }}
            />
          )}

          {/* Tableur — vue directe. Deux lectures du même planning : par
              personnel (une ligne par agent, sa période, ses cases) ou par
              journée (une colonne par jour, qui la tient). Les libellés
              nomment l'axe de lecture et non l'objet : le tableur propose déjà
              ses propres onglets « Calendrier synthétique » et « Calendrier
              détaillé », un troisième « Calendrier » ici ne voudrait rien dire.
              Le sélecteur vit ici pour n'ajouter aucun prop aux deux écrans. */}
          {view === 'spreadsheet' && selectedScheduleId && (
            <>
              <div className="gs-reg-reading">
                <button type="button"
                  className={`gs-btn${reading === 'spreadsheet' ? ' is-primary' : ''}`}
                  onClick={() => setReading('spreadsheet')}>
                  Par personnel
                </button>
                <button type="button"
                  className={`gs-btn${reading === 'calendar' ? ' is-primary' : ''}`}
                  onClick={() => setReading('calendar')}>
                  Par journée
                </button>
              </div>

              {reading === 'spreadsheet' ? (
                <ErrorBoundary label="Tableur de garde" onBack={() => setView('list')}>
                  <SmartSpreadsheet
                    scheduleId={selectedScheduleId}
                    departmentId={selectedDept}
                    onBack={() => setView('list')}
                    onManageProposals={() => setProposalScheduleId(selectedScheduleId)}
                  />
                </ErrorBoundary>
              ) : (
                <VisualCalendar
                  scheduleId={selectedScheduleId}
                  onBack={() => setView('list')}
                />
              )}
            </>
          )}

          {/* Tableur sans planning sélectionné */}
          {view === 'spreadsheet' && !selectedScheduleId && (
            <div className="gs-reg-empty">
              <strong>Aucun planning ouvert</strong>
              <p>Créez d'abord un planning, puis ouvrez-le depuis la liste.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="gs-btn is-primary" onClick={() => { setScheduleInfo(null); setView('new'); }}>
                  <IconPlus /> Créer un planning
                </button>
                <button type="button" className="gs-btn" onClick={() => setView('list')}>
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
            <div style={{ color: 'var(--gs-ink-faint)', textAlign: 'center', padding: 40 }}>Aucun membre dans ce service</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
              {(dept.staff || dept.members || []).map(m => {
                const pres = getPresence(m.last_activity_at);
                return (
                  <div key={m.id} style={{ padding: 14, background: 'var(--gs-paper-alt)', borderRadius: 12, display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--gs-rule)' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      {/* Les initiales, pas un badge : un disque à plat, à
                          l'encre du registre. Le dégradé violet faisait de
                          chaque agent une vignette de plus. */}
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--gs-seal-wash)', border: '1px solid var(--gs-rule)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gs-seal)', fontFamily: 'var(--gs-display)', fontSize: 13, fontWeight: 700 }}>
                        {m.first_name[0]}{m.last_name[0]}
                      </div>
                      <span style={{ position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: '50%', background: pres.dot, border: '2px solid var(--gs-paper-alt)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.first_name} {m.last_name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--gs-ink-faint)', marginTop: 2 }}>{m.role_name || m.role_code}</div>
                      {m.speciality && <div style={{ fontSize: 10, color: 'var(--gs-ink-faint)' }}>{m.speciality}</div>}
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
          <ShiftAbsencesPanel departmentId={selectedDept} />
        </div>
      )}

      {/* ── REMPLACEMENTS ──────────────────────────────────── */}
      {activeTab === 'remplacements' && (
        <div>
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Remplacements</h3>
            <p style={{ margin: '4px 0 0', color: 'var(--gs-ink-faint)', fontSize: 13 }}>
              Gardes courantes déjà soumises définitivement — le tableur n'est jamais modifié
            </p>
          </div>
          <ReplacementsPanel initialScheduleId={deepLinkScheduleId} />
        </div>
      )}

      {/* ── NOTES & CIRCULAIRES ─────────────────────────────
          Déplacées vers l'écran indépendant `/notes` (point 7) : l'onglet et son
          rendu ont été retirés d'ici. Les montages des autres tableaux de bord
          (directeur, super admin, surveillant) restent en place — l'énoncé ne
          demandait le retrait que depuis le planning des gardes. */}

      {/* ── CALENDRIER HÔPITAL (lecture seule) ─────────────── */}
      {activeTab === 'calendrier' && (
        <HospitalGuardCalendar title="Calendrier des gardes — hôpital" />
      )}

      {/* ── STATISTIQUES DU SERVICE ────────────────────────── */}
      {activeTab === 'stats' && (
        <ScopedStatsPanel title="Statistiques de mes services" />
      )}

      {/* ── STATISTIQUES DES PRÊTS DE PERSONNEL ────────────── */}
      {activeTab === 'loan-stats' && (
        <StaffLoanStatsPanel title="Prêts de personnel — mes services" />
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

/**
 * SmartSpreadsheet — le tableau de garde du service
 * ═════════════════════════════════════════════════
 * Tableur : colonnes figées, glisser-déposer des lignes, menu contextuel,
 * sélecteur de personnel, brouillon / envoi, propositions de modification.
 *
 * Refonte de présentation (« Registre de garde ») : l'écran s'ouvre sur ce dont
 * on parle et son état (`PlanningHero`), puis sur la question qu'un chef de
 * service se pose devant son tableau — chaque journée est-elle couverte, et par
 * assez de monde (`MonthRibbon`) —, et seulement ensuite sur la saisie. Les
 * quatre exports tiennent dans un menu (`ExportMenu`). Aucune fonction n'a été
 * retirée et aucune règle métier n'a bougé : seule la hiérarchie a changé.
 */
import React, {
  useState, useRef, useEffect, useMemo, useCallback,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminAPI, departmentsAPI, scheduleBuilderAPI, schedulesAPI } from '../../../api';
import HospitalStaffPicker from './HospitalStaffPicker';
import FixedRosterPanel from './FixedRosterPanel';
import ScheduleHistoryPanel from './ScheduleHistoryPanel';
import ImportModal from './ImportModal';
import PlanningHero from './PlanningHero';
import MonthRibbon from './MonthRibbon';
import ExportMenu from './ExportMenu';
import { frenchRange, frenchSpan, shortFrenchDate } from '@/utils/frenchDates';
import './SmartSpreadsheet.css';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../../store';

// ── Icônes ──────────────────────────────────────────────────────────────
const Ico = ({ d, s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const IcoSave    = () => <Ico d="M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2zM17 21V13H7v8M7 3v5h8" />;
const IcoSend    = () => <Ico d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />;
const IcoPlus    = () => <Ico d="M12 5v14M5 12h14" />;
const IcoTrash   = () => <Ico d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />;
const IcoSearch  = () => <Ico d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />;
const IcoCopy    = () => <Ico d="M8 17.929H6c-1.105 0-2-.912-2-2.036V5.036C4 3.912 4.895 3 6 3h8c1.105 0 2 .912 2 2.036v1.866m-6 .17h8c1.105 0 2 .91 2 2.035v10.857C20 21.088 19.105 22 18 22h-8c-1.105 0-2-.912-2-2.036V9.107c0-1.124.895-2.036 2-2.036z" />;
const IcoDrag    = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
    <circle cx="9" cy="6"  r="1.5"/><circle cx="15" cy="6"  r="1.5"/>
    <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
    <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
  </svg>
);
const IcoUsers   = () => <Ico d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" s={16} />;

// ── Constantes ─────────────────────────────────────────────────────────
const DOW_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTH_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

// Accord au pluriel. « 6 jours sélectionnés » se lit ; « 6 jour(s) sélectionné(s) »
// se déchiffre. Le tableur affiche des comptes partout, la marque va au bout.
const plur = (n) => (n > 1 ? 's' : '');

// Ce que dit une colonne, au survol de son intitulé. L'explication remplace les
// émojis (⏰ 🏠) que l'en-tête accolait aux libellés : ils doublaient un mot déjà
// clair. La colonne « Périodes » gagne au passage l'explication qu'elle n'avait
// pas — l'ancienne clé visait un type `date` qu'aucune colonne n'emploie.
const COL_HINTS = {
  periods: 'Période individuelle de présence dans ce planning',
  'special-dates': 'Week-ends et jours fériés retenus pour cet agent',
  time: 'Heures de début et de fin de garde',
  bool: 'Cochée : l’agent assure sa garde à domicile (astreinte). Décochée (par défaut) : garde à l’hôpital, en présence.',
};

const PROPOSAL_COLOR_PALETTES = [
  {
    key: 'amber',
    bg: 'var(--gs-alert-wash)',
    bgDark: 'var(--gs-alert-wash)',
    badgeBg: 'var(--gs-alert-wash)',
    border: 'var(--gs-alert)',
    borderDark: 'var(--gs-alert)',
    text: 'var(--gs-alert)',
    textDark: 'var(--gs-alert)',
    name: 'À traiter',
    dot: '•',
  },
  {
    key: 'sky',
    bg: 'var(--gs-seal-wash)',
    bgDark: 'var(--gs-seal-wash)',
    badgeBg: 'var(--gs-seal-wash)',
    border: 'var(--gs-seal)',
    borderDark: 'var(--gs-seal)',
    text: 'var(--gs-seal)',
    textDark: 'var(--gs-seal)',
    name: 'À traiter',
    dot: '•',
  },
  {
    key: 'purple',
    bg: 'var(--gs-duty-wash)',
    bgDark: 'var(--gs-duty-wash)',
    badgeBg: 'var(--gs-duty-wash)',
    border: 'var(--gs-duty)',
    borderDark: 'var(--gs-duty)',
    text: 'var(--gs-duty)',
    textDark: 'var(--gs-duty)',
    name: 'À traiter',
    dot: '•',
  },
  {
    key: 'emerald',
    bg: 'var(--gs-duty-wash)',
    bgDark: 'var(--gs-duty-wash)',
    badgeBg: 'var(--gs-duty-wash)',
    border: 'var(--gs-duty)',
    borderDark: 'var(--gs-duty)',
    text: 'var(--gs-duty)',
    textDark: 'var(--gs-duty)',
    name: 'À traiter',
    dot: '•',
  },
  {
    key: 'rose',
    bg: 'var(--gs-alert-wash)',
    bgDark: 'var(--gs-alert-wash)',
    badgeBg: 'var(--gs-alert-wash)',
    border: 'var(--gs-alert)',
    borderDark: 'var(--gs-alert)',
    text: 'var(--gs-alert)',
    textDark: 'var(--gs-alert)',
    name: 'À traiter',
    dot: '•',
  },
  {
    key: 'orange',
    bg: 'var(--gs-alert-wash)',
    bgDark: 'var(--gs-alert-wash)',
    badgeBg: 'var(--gs-alert-wash)',
    border: 'var(--gs-alert)',
    borderDark: 'var(--gs-alert)',
    text: 'var(--gs-alert)',
    textDark: 'var(--gs-alert)',
    name: 'À traiter',
    dot: '•',
  },
];

const getProposalPalette = (index = 0) => PROPOSAL_COLOR_PALETTES[index % PROPOSAL_COLOR_PALETTES.length];

// Teinte réservée aux agents empruntés à un autre service, tant que leur chef
// n'a pas répondu. Volontairement distincte des palettes de propositions
// (ambre/orange) pour qu'on ne confonde pas les deux signaux.
const PENDING_EXT = {
  bg: 'var(--gs-alert-wash)',
  bgDark: 'var(--gs-alert-wash)',
  border: 'var(--gs-alert)',
  text: 'var(--gs-alert)',
};

const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

// Couleurs des groupes de semaines. Elles sortent en clair, pas en jeton :
// c'est un `<input type="color">` que le chef manipule, et sa valeur part dans
// les métadonnées du planning — un `var(--gs-…)` n'y serait pas une couleur.
// On sème donc les quatre premières teintes d'identité du système pour qu'un
// nouveau groupe naisse déjà dans la palette de la plateforme.
const WEEK_GROUP_COLORS = ['#1B4FCA', '#0F766E', '#7A3E9D', '#B4530A'];
const WEEK_GROUP_DEFAULT = WEEK_GROUP_COLORS[0];

function getDays(start, end) {
  if (!start || !end) return [];
  // Date pure : midi local évite que `new Date('YYYY-MM-DD')` recule d'un jour.
  const days = [], d = new Date(`${dateKey(start)}T12:00:00`), last = new Date(`${dateKey(end)}T12:00:00`);
  while (d <= last) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return days;
}

// Les dates de PostgreSQL peuvent arriver sous forme ISO ou Date : le tableur
// compare toujours des clés YYYY-MM-DD, sans effet de fuseau horaire.
const dateKey = (value) => {
  if (!value) return '';
  if (typeof value === 'string') {
    const direct = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (direct) return direct[0];
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value);
  const direct = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (direct) return direct[0];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Un identifiant de ligne n'est pas un identifiant de personnel. Les lignes du
// tableur portent des identifiants fabriqués ici (« new-… », « import-row-… »)
// tandis qu'un agent est toujours désigné par l'UUID de son compte : le serveur
// refuse la sauvegarde si les deux se mélangent. Même test que côté serveur.
const isPersonnelId = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

// La fonction visible vient du métier réel quand il est renseigné. Le rôle
// technique reste le dernier recours pour les anciens plannings et profils.
const resolveStaffFunction = (member = {}) => {
  const candidates = [
    member.function_name,
    member.functionName,
    member.job_title,
    member.jobTitle,
    member.secondary_role_name,
    member.secondaryRoleName,
    member.role_name,
    member.roleName,
  ];

  return candidates.find(value => typeof value === 'string' && value.trim())?.trim() || '';
};

const normalizeFixedSlots = (slots) => (Array.isArray(slots) ? slots : [])
  .map((slot, index) => ({
    id: String(slot?.id || `fixed-slot-${index + 1}`),
    jobTitleId: slot?.jobTitleId || slot?.job_title_id || null,
    functionName: String(slot?.functionName || slot?.function_name || slot?.job_title || 'Fonction à renseigner').trim(),
    quantity: Math.min(Math.max(Number(slot?.quantity) || 1, 1), 50),
    isConstant: slot?.isConstant ?? slot?.is_constant ?? true,
  }));

const normalizeFunction = (value) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();

const resolveStaffJobTitleId = (member = {}) => member.job_title_id || member.jobTitleId || null;

const staffMatchesFixedRequirement = (member, row) => {
  if (!row?.fixedSlotId) return true;
  const requiredJobTitleId = row.fixedJobTitleId;
  const memberJobTitleId = resolveStaffJobTitleId(member);
  if (requiredJobTitleId) return String(memberJobTitleId || '') === String(requiredJobTitleId);
  return normalizeFunction(resolveStaffFunction(member)) === normalizeFunction(row.fixedFunctionName);
};

const fixedSlotKey = (slotId, positionIndex) => `${slotId}:${positionIndex}`;

const syncRowsToFixedRoster = (sourceRows, slots, createRow) => {
  const normalizedSlots = normalizeFixedSlots(slots);
  if (!normalizedSlots.length) return sourceRows.length ? sourceRows : [createRow()];

  const fixedRows = new Map();
  const usedFixedRows = new Set();
  const flexibleRows = [];
  sourceRows.forEach((row) => {
    if (row.fixedSlotId && Number.isInteger(Number(row.fixedPositionIndex))) {
      fixedRows.set(fixedSlotKey(row.fixedSlotId, Number(row.fixedPositionIndex)), row);
    } else {
      flexibleRows.push(row);
    }
  });

  const usedFlexible = new Set();
  const nextRows = [];
  normalizedSlots.forEach((slot) => {
    for (let positionIndex = 0; positionIndex < slot.quantity; positionIndex += 1) {
      const key = fixedSlotKey(slot.id, positionIndex);
      let row = fixedRows.get(key);
      if (row) usedFixedRows.add(key);
      if (!row) {
        const compatibleIndex = flexibleRows.findIndex((candidate, index) => {
          if (usedFlexible.has(index) || !candidate.userId) return false;
          if (slot.jobTitleId && resolveStaffJobTitleId(candidate) && String(resolveStaffJobTitleId(candidate)) !== String(slot.jobTitleId)) return false;
          return !slot.jobTitleId || normalizeFunction(candidate.roleName) === normalizeFunction(slot.functionName);
        });
        if (compatibleIndex >= 0) {
          usedFlexible.add(compatibleIndex);
          row = flexibleRows[compatibleIndex];
        }
      }
      if (!row) row = createRow(`fixed-${slot.id}-${positionIndex + 1}`);
      nextRows.push({
        ...row,
        fixedSlotId: slot.id,
        fixedPositionIndex: positionIndex,
        fixedJobTitleId: slot.jobTitleId || null,
        fixedFunctionName: slot.functionName,
        fixedConstant: Boolean(slot.isConstant),
        roleName: row.userId ? row.roleName : slot.functionName,
      });
    }
  });

  // A quantity reduction must not silently delete an already assigned person.
  flexibleRows.forEach((row, index) => {
    if (usedFlexible.has(index) || !row.userId) return;
    nextRows.push({
      ...row,
      fixedSlotId: null,
      fixedPositionIndex: null,
      fixedJobTitleId: null,
      fixedFunctionName: null,
      fixedConstant: false,
    });
  });
  fixedRows.forEach((row, key) => {
    if (usedFixedRows.has(key) || !row.userId) return;
    nextRows.push({
      ...row,
      fixedSlotId: null,
      fixedPositionIndex: null,
      fixedJobTitleId: null,
      fixedFunctionName: null,
      fixedConstant: false,
    });
  });
  return nextRows.length ? nextRows : [createRow()];
};

const optionalBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
};

const staffRequiresLoan = (member = {}, currentDepartmentId) => {
  if (!currentDepartmentId) return false;

  const explicitRequirement = optionalBoolean(member.requires_loan ?? member.requiresLoan);
  if (explicitRequirement !== null) return explicitRequirement;

  const explicitMembership = optionalBoolean(
    member.belongs_to_priority_department ?? member.belongsToPriorityDepartment
  );
  if (explicitMembership !== null) return !explicitMembership;

  if (Array.isArray(member.departments)) {
    if (member.departments.length === 0) return false;
    return !member.departments.some(department => String(
      department?.id ?? department?.department_id ?? department?.departmentId ?? ''
    ) === String(currentDepartmentId));
  }

  const memberDepartmentId = member.dept_id || member.deptId;
  return Boolean(memberDepartmentId && String(memberDepartmentId) !== String(currentDepartmentId));
};

const resolveStaffDepartmentName = (member = {}) => {
  if (member.dept_name || member.deptName) return member.dept_name || member.deptName;
  if (!Array.isArray(member.departments)) return '';

  const primary = member.departments.find(department => (
    department?.isPrimary === true || department?.is_primary === true
  ));
  return primary?.name || member.departments[0]?.name || '';
};

const normalizeRowPeriods = (row, fallbackStart = '', fallbackEnd = '') => {
  const source = Array.isArray(row?.periods)
    ? row.periods
    : [{ startDate: row?.periodStart || row?.period_start || fallbackStart, endDate: row?.periodEnd || row?.period_end || fallbackEnd }];
  const periods = source
    .map(period => ({
      startDate: dateKey(period?.startDate || period?.start || period?.periodStart || period?.period_start),
      endDate: dateKey(period?.endDate || period?.end || period?.periodEnd || period?.period_end),
    }))
    .filter(period => period.startDate || period.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  return periods.filter((period, index) => index === 0
    || period.startDate !== periods[index - 1].startDate
    || period.endDate !== periods[index - 1].endDate);
};

const periodBounds = (periods = []) => ({
  startDate: periods[0]?.startDate || '',
  endDate: periods.at(-1)?.endDate || '',
});

const dateInRowPeriods = (date, row, fallbackStart = '', fallbackEnd = '') => {
  const key = dateKey(date);
  return normalizeRowPeriods(row, fallbackStart, fallbackEnd)
    .some(period => key >= period.startDate && key <= period.endDate);
};

// Un chef de service lit « 1er août → 31 août », pas « 2026-08-01 → 2026-08-31 ».
// Les deux formes décrivent la même clé YYYY-MM-DD : seule la lecture change.
const periodsLabel = (periods = [], compact = false) => periods
  .map(period => {
    if (!compact) return `du ${period.startDate} au ${period.endDate}`;
    const sameYear = String(period.startDate).slice(0, 4) === String(period.endDate).slice(0, 4);
    return `${shortFrenchDate(period.startDate, !sameYear)} → ${shortFrenchDate(period.endDate, true)}`;
  })
  .join(' ; ');

// ── De service, ou pas ──────────────────────────────────────────────────
// Le tableur n'a plus de codes de garde : une case est cochée ou vide. Ces deux
// fonctions sont le miroir exact de `backend/src/modules/schedules/
// spreadsheet-reader.js` (`isMarked` / `rowOnDuty`), pour que l'écran montre
// précisément ce que le serveur lira ensuite.

/** Une valeur de case vaut-elle « de service » ? */
const isMarked = (value) => {
  if (value === true) return true;
  const text = String(value ?? '').trim();
  if (!text) return false;
  // Tolérance des plannings antérieurs : « R » était l'ancien code Repos.
  return text.charAt(0).toUpperCase() !== 'R';
};

/** Jours cochés d'une ligne, en clés 'YYYY-MM-DD'. */
const rowMarkedDays = (row) => Object.entries(row?.shifts || {})
  .filter(([, value]) => isMarked(value))
  .map(([date]) => dateKey(date))
  .filter(Boolean);

/**
 * Règle d'arbitrage de la ligne :
 *   • planning spécial → les jours cochés, jamais la période ;
 *   • ligne SANS aucun jour coché → la période de participation fait foi ;
 *   • ligne AVEC des jours cochés → les jours cochés (assistant, import).
 */
const rowIsOnDuty = (row, date, { isSpecial = false, min = '', max = '' } = {}) => {
  const key = dateKey(date);
  if (!key) return false;
  const marks = rowMarkedDays(row);
  if (isSpecial || marks.length > 0) return marks.includes(key);
  return dateInRowPeriods(key, row, min, max);
};

// ── Cachet d'état ───────────────────────────────────────────────────────
// Le vocabulaire est celui de la liste des plannings (`ChefDeServiceDashboard`,
// `STATUS_FULL`) : sans l'entrée `active`, le tableur retombait sur `draft` et
// annonçait « Brouillon » sur un planning en cours.
// `tone` choisit le cachet : ouvert (modifiable), scellé (envoyé), vivant (en
// cours), arrêté (rejeté).
const STATUS_META = {
  draft:              { label: 'Brouillon',      tone: 'open' },
  preparing:          { label: 'En préparation', tone: 'open' },
  pending_validation: { label: 'En attente',     tone: 'sealed' },
  validated:          { label: 'Validé',         tone: 'live' },
  submitted:          { label: 'En vigueur',     tone: 'sealed' },
  under_review:       { label: 'En révision',    tone: 'open' },
  approved:           { label: 'Approuvé',       tone: 'live' },
  rejected:           { label: 'Rejeté',         tone: 'stopped' },
  active:             { label: 'En cours',       tone: 'live' },
  archived:           { label: 'Archivé',        tone: 'neutral' },
};

// ── Context Menu ─────────────────────────────────────────────────────────
function ContextMenu({ x, y, onAction, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handle = e => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  // Un verbe par ligne, rien devant. Le menu de la ligne parle la même langue
  // que celui du registre des plannings : les pictogrammes (↑ ↓ ⧉ 🗑) doublaient
  // des libellés déjà explicites.
  const items = [
    { label: 'Insérer au-dessus', action: 'insertAbove' },
    { label: 'Insérer en dessous', action: 'insertBelow' },
    { divider: true },
    { label: 'Dupliquer la ligne', action: 'duplicate' },
    { divider: true },
    { label: 'Supprimer la ligne', action: 'delete', danger: true },
  ];

  return (
    <div ref={ref} className="ss-context-menu" style={{ top: y, left: x }}>
      {items.map((item, i) => item.divider ? (
        <div key={i} className="ss-context-menu__divider" />
      ) : (
        <button key={item.action}
          onClick={() => { onAction(item.action); onClose(); }}
          className={`ss-context-menu__item${item.danger ? ' is-danger' : ''}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── Case « de service » ──────────────────────────────────────────────────
// Il n'y a plus de code de garde : une seule notion, de service (●) ou pas (·).
// `clickable` distingue les deux plannings : dans un planning « week-ends et
// jours fériés » la case se coche au clic (c'est le seul moyen de désigner les
// jours) ; dans un planning normal elle est le miroir de la période de la ligne,
// et le clic ouvre l'éditeur de périodes.
const DUTY_ON = '●';
const DUTY_OFF = '·';

function DutyCell({ onDuty, onClick, clickable, isProposed, isConflict, proposedOnDuty, proposerName, palette }) {
  const shown = isProposed ? proposedOnDuty : onDuty;
  const pal = palette || { bg: 'var(--gs-alert-wash)', border: 'var(--gs-alert)', borderDark: 'var(--gs-alert)', textDark: 'var(--gs-alert)', badgeBg: 'var(--gs-alert-wash)', dot: '•' };

  return (
    <div onClick={onClick}
      title={
        isConflict
          ? `⚡ CONFLIT : ${proposerName}\nCliquez pour inspecter et choisir la valeur !`
          : isProposed
          ? `⚠️ Proposition (${proposerName || 'Surveillant'}) :\n${proposedOnDuty ? 'Agent placé de service ce jour-là' : 'Service retiré ce jour-là'}`
          : clickable
          ? `${shown ? 'De service' : 'Pas de service'}\nCliquer pour ${shown ? 'retirer' : 'sélectionner'} ce jour`
          : `${shown ? 'De service' : 'Pas de service'}\nMiroir de la période d'affectation — cliquer pour la modifier`
      }
      className={`ss-duty-cell${shown ? ' is-on' : ''}${isProposed ? ' is-proposed' : ''}${isConflict ? ' is-conflict' : ''}`}
      style={{ '--proposal-bg': pal.bg, '--proposal-border': pal.borderDark, '--proposal-text': pal.textDark }}
    >
      {isProposed && (
        <span className="ss-duty-cell__marker" />
      )}
      {shown ? DUTY_ON : DUTY_OFF}
    </div>
  );
}

function MultiPeriodPicker({ row, min, max, onChange, onClose }) {
  const [periods, setPeriods] = useState(() => normalizeRowPeriods(row, min, max));
  const [range, setRange] = useState({ startDate: min, endDate: max });
  // Une ligne issue de l'assistant ou d'un import porte une répartition jour par
  // jour, qui prime sur la période. Enregistrer de nouvelles périodes l'efface —
  // sinon le geste du chef resterait sans effet.
  const hasDailyMarks = Object.values(row?.shifts || {}).some(isMarked);

  const addRange = () => {
    if (!range.startDate || !range.endDate || range.startDate > range.endDate) {
      toast.error('Choisissez une période valide.');
      return;
    }
    if (range.startDate < min || range.endDate > max) {
      toast.error(`La période doit rester comprise entre le ${min} et le ${max}.`);
      return;
    }
    const next = [...periods, range]
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
    if (next.some((period, index) => index > 0 && period.startDate <= next[index - 1].endDate)) {
      toast.error('Les périodes ne peuvent pas se chevaucher.');
      return;
    }
    setPeriods(next);
  };

  const save = () => {
    if (!periods.length) {
      toast.error('Ajoutez au moins une période.');
      return;
    }
    const bounds = periodBounds(periods);
    onChange({ periods, periodStart: bounds.startDate, periodEnd: bounds.endDate });
    onClose();
  };

  return (
    <div className="ss-modal-backdrop ss-modal-backdrop--periods" onClick={onClose}>
      <div className="ss-modal ss-modal--periods" onClick={event => event.stopPropagation()}>
        <div className="ss-modal__header">
          <div>
            <strong>Périodes d'affectation</strong>
            <div className="ss-modal__hint">
              Affectez la période complète ou plusieurs plages distinctes comprises dans le planning.
            </div>
          </div>
          <button type="button" onClick={onClose} className="ss-modal__close">✕</button>
        </div>

        {hasDailyMarks && (
          <div className="ss-modal__notice">
            Cette ligne porte une répartition jour par jour (assistant ou import).
            Enregistrer de nouvelles périodes la remplace : le service suivra alors
            les périodes ci-dessous.
          </div>
        )}

        <button type="button" onClick={() => setPeriods([{ startDate: min, endDate: max }])} className="gs-btn ss-modal__full-period">
          Utiliser toute la période du planning : {min} → {max}
        </button>

        <div className="ss-modal__range-row">
          <input type="date" value={range.startDate} min={min} max={max} onChange={event => setRange(value => ({ ...value, startDate: event.target.value, endDate: event.target.value > value.endDate ? event.target.value : value.endDate }))} style={weekInputStyle} />
          <input type="date" value={range.endDate} min={range.startDate || min} max={max} onChange={event => setRange(value => ({ ...value, endDate: event.target.value }))} style={weekInputStyle} />
          <button type="button" onClick={addRange} className="gs-btn is-primary">Ajouter</button>
        </div>

        <div className="ss-modal__period-list">
          {periods.map((period, index) => (
            <div key={`${period.startDate}-${period.endDate}-${index}`} className="ss-modal__period-item">
              <span className="ss-modal__period-index">{index + 1}</span>
              <strong>{period.startDate} → {period.endDate}</strong>
              <button type="button" onClick={() => setPeriods(current => current.filter((_, itemIndex) => itemIndex !== index))} title="Supprimer cette période" className="gs-btn is-danger ss-modal__period-delete"><IcoTrash /></button>
            </div>
          ))}
          {!periods.length && <div className="ss-modal__empty">Aucune période ajoutée.</div>}
        </div>

        <div className="ss-modal__actions">
          <button type="button" onClick={onClose} className="gs-btn">Annuler</button>
          <button type="button" onClick={save} className="gs-btn is-primary">Enregistrer les périodes</button>
        </div>
      </div>
    </div>
  );
}

function SpecialDatesPicker({ row, allowedDays, holidays = [], onChange, onClose }) {
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const selected = new Set(Object.entries(row?.shifts || {})
    .filter(([, value]) => isMarked(value))
    .map(([date]) => dateKey(date)));
  const allowedKeys = allowedDays.map(dateKey);
  const holidayName = key => holidays
    .filter(h => key >= dateKey(h.start_date) && key <= dateKey(h.end_date))
    .map(h => h.name).join(', ');

  const commit = (nextSelected) => {
    const nextShifts = { ...(row?.shifts || {}) };
    allowedKeys.forEach(key => {
      if (nextSelected.has(key)) nextShifts[key] = true;
      else delete nextShifts[key];
    });
    onChange(nextShifts);
  };

  const toggle = key => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    commit(next);
  };

  const addRange = () => {
    if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return toast.error('Choisissez une plage valide.');
    const next = new Set(selected);
    allowedKeys.filter(key => key >= rangeStart && key <= rangeEnd).forEach(key => next.add(key));
    if (next.size === selected.size) return toast.error('Cette plage ne contient aucun week-end ou jour férié autorisé.');
    commit(next);
    setRangeStart(''); setRangeEnd('');
  };

  return (
    <div className="ss-modal-backdrop ss-modal-backdrop--special" onClick={onClose}>
      {/* Sélecteur des jours d'un planning « week-ends et jours fériés ».
          Trois états, trois encres du registre : un jour retenu est de service
          (`--gs-duty`, la même encre que le ● du tableur), un jour férié se
          signale d'un filet ambre, un simple week-end reste à l'encre neutre.
          Les quatre violets codés en dur n'appartenaient à aucun système et
          devenaient illisibles en thème sombre : fond pâle fixe sous une encre
          qui, elle, s'éclaircissait. */}
      <div className="ss-modal ss-modal--special" onClick={e => e.stopPropagation()}>
        <div className="ss-modal__header">
          <div>
            <strong style={{ fontFamily: 'var(--gs-display)', fontSize: 15, fontWeight: 700, color: 'var(--gs-ink)' }}>Jours de garde retenus</strong>
            <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--gs-ink-faint)', marginTop: 3 }}>Un jour, plusieurs jours ou une plage. Seuls les samedis, dimanches et jours fériés configurés peuvent être retenus.</div>
          </div>
          <button type="button" onClick={onClose} style={{ ...btnGhost, padding: '5px 9px' }}>✕</button>
        </div>
        <div className="ss-modal__range-row ss-modal__range-row--special">
          <input type="date" value={rangeStart} min={allowedKeys[0]} max={allowedKeys.at(-1)} onChange={e => setRangeStart(e.target.value)} style={weekInputStyle} />
          <input type="date" value={rangeEnd} min={rangeStart || allowedKeys[0]} max={allowedKeys.at(-1)} onChange={e => setRangeEnd(e.target.value)} style={weekInputStyle} />
          <button type="button" onClick={addRange} className="gs-btn">Ajouter la plage</button>
        </div>
        <div className="ss-modal__special-grid">
          {allowedKeys.map(key => {
            const date = new Date(`${key}T12:00:00`);
            const holiday = holidayName(key);
            const checked = selected.has(key);
            return <button type="button" key={key} onClick={() => toggle(key)} className={`ss-modal__special-day${checked ? ' is-selected' : ''}${holiday ? ' is-holiday' : ''}`}>
              <div style={{ fontFamily: 'var(--gs-data)', fontVariantNumeric: 'tabular-nums', fontSize: 11, fontWeight: 600 }}>{checked ? '● ' : '· '}{DOW_FR[date.getDay()]} {date.getDate()} {MONTH_FR[date.getMonth()]}</div>
              <div style={{ fontSize: 9, color: holiday ? 'var(--gs-alert)' : 'var(--gs-ink-faint)', marginTop: 2 }}>{holiday || 'Week-end'}</div>
            </button>;
          })}
        </div>
        <div className="ss-modal__footer">
          <span className="ss-modal__selected-count">
            <b>{selected.size}</b>
            jour{plur(selected.size)} retenu{plur(selected.size)}
          </span>
          <button type="button" onClick={onClose} className="gs-btn is-primary">Terminer</button>
        </div>
      </div>
    </div>
  );
}

export function PeriodTimeline({ rows, start, end }) {
  const toDay = (value) => new Date(`${dateKey(value)}T12:00:00`).getTime() / 86400000;
  const first = toDay(start), last = toDay(end), total = Math.max(1, last - first + 1);
  const activeRows = rows.filter(row => row.userId);
  const todayDay = toDay(new Date());
  const showToday = todayDay >= first && todayDay <= last;
  const timelineDays = Array.from({ length: total }, (_, index) => {
    const day = new Date((first + index) * 86400000);
    return { key: dateKey(day), weekend: isWeekend(day) };
  });
  const timelineMinWidth = Math.max(820, 230 + (total * 18));
  const monthMarkers = [];
  const cursor = new Date(`${dateKey(start)}T12:00:00`);
  while (cursor.getTime() <= new Date(`${dateKey(end)}T12:00:00`).getTime()) {
    monthMarkers.push({ label: `${MONTH_FR[cursor.getMonth()]} ${cursor.getFullYear()}`, left: ((cursor.getTime() / 86400000 - first) / total) * 100 });
    cursor.setMonth(cursor.getMonth() + 1, 1);
  }

  return (
    <section className="ss-timeline" aria-label="Calendrier synthétique des périodes">
      <div className="ss-timeline__scroll">
        <div className="ss-timeline__canvas" style={{ minWidth: timelineMinWidth }}>
          <div className="ss-timeline__header">
            <div className="ss-timeline__header-label">
              <span>Personnel planifié</span>
              <small>{activeRows.length} affectation{plur(activeRows.length)}</small>
            </div>
            <div className="ss-timeline__months">
              {monthMarkers.map(marker => (
                <span className="ss-timeline__month" key={marker.label} style={{ left: `${marker.left}%` }}>
                  {marker.label}
                </span>
              ))}
              <div className="ss-timeline__day-grid" aria-hidden="true">
                {timelineDays.map(day => <span className={`ss-timeline__day ${day.weekend ? 'is-weekend' : ''}`} key={day.key} />)}
              </div>
              {showToday && <span className="ss-timeline__today" style={{ left: `${((todayDay - first + 0.5) / total) * 100}%` }}><span>Aujourd'hui</span></span>}
            </div>
          </div>

          {activeRows.map(row => {
            const periods = normalizeRowPeriods(row, dateKey(start), dateKey(end));
            const personName = `${row.lastName} ${row.firstName}`.trim() || 'Personnel';
            const initials = `${row.lastName?.[0] || ''}${row.firstName?.[0] || ''}`.toUpperCase() || 'P';
            const accent = stableStaffColor(row.userId || row.id);
            return (
              <div className="ss-timeline__row" key={row.id}>
                <div className="ss-timeline__person">
                  <span className="ss-timeline__avatar" style={{ '--staff-color': accent }}>{initials}</span>
                  <span className="ss-timeline__identity">
                    <strong title={personName}>{personName}</strong>
                    <small title={row.roleName || 'Fonction non renseignée'}>{row.roleName || 'Fonction non renseignée'} · {periods.length} période{plur(periods.length)}</small>
                  </span>
                </div>
                <div className="ss-timeline__track">
                  <div className="ss-timeline__day-grid" aria-hidden="true">
                    {timelineDays.map(day => <span className={`ss-timeline__day ${day.weekend ? 'is-weekend' : ''}`} key={day.key} />)}
                  </div>
                  {showToday && <span className="ss-timeline__today" style={{ left: `${((todayDay - first + 0.5) / total) * 100}%` }} />}
                  {periods.map((period, index) => {
                    const clippedStart = Math.max(first, toDay(period.startDate));
                    const clippedEnd = Math.min(last, toDay(period.endDate));
                    if (clippedEnd < clippedStart) return null;
                    const left = ((clippedStart - first) / total) * 100;
                    const width = Math.max((1 / total) * 100, ((clippedEnd - clippedStart + 1) / total) * 100);
                    const label = `${period.startDate} → ${period.endDate}`;
                    return (
                      <span
                        className="ss-timeline__period"
                        key={`${period.startDate}-${period.endDate}-${index}`}
                        style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, '--staff-color': accent }}
                        title={`${period.startDate} 00:00:00 → ${period.endDate} 23:59:59`}
                        tabIndex={0}
                        aria-label={`Période de ${personName}, du ${period.startDate} au ${period.endDate}`}
                      >
                        <span>{label}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {activeRows.length === 0 && <div className="ss-timeline__empty">Ajoutez du personnel dans le tableur pour visualiser son calendrier.</div>}
    </section>
  );
}

// Une teinte stable par agent, prise dans l'échelle d'identité du système, celle
// qu'utilise déjà l'avatar : c'est de la distinction, pas un état, et elle suit
// le thème clair ou sombre sans que ce fichier ait à le savoir. Les jetons sont
// écrits un par un ci-dessous, jamais assemblés, pour que la garde de jetons
// puisse les vérifier — elle lit le fichier, commentaires compris.
const STAFF_PALETTE = [
  'var(--gs-id-1)',
  'var(--gs-id-2)',
  'var(--gs-id-3)',
  'var(--gs-id-4)',
  'var(--gs-id-5)',
  'var(--gs-id-6)',
  'var(--gs-id-7)',
  'var(--gs-id-8)',
  'var(--gs-id-9)',
  'var(--gs-id-10)',
];

function stableStaffColor(value) {
  const source = String(value ?? 'staff');
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) hash = ((hash << 5) - hash) + source.charCodeAt(index);
  return STAFF_PALETTE[Math.abs(hash) % STAFF_PALETTE.length];
}

export function DetailedCalendar({ rows, days, start, end, holidays = [], weekOrganization = [], isSpecialSchedule = false }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const [legendExpanded, setLegendExpanded] = useState(false);

  useEffect(() => {
    if (!selectedDay) return undefined;
    const handleKeyDown = event => {
      if (event.key === 'Escape') setSelectedDay(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedDay]);

  const staff = useMemo(() => rows
    .filter(row => row.userId || row.lastName)
    .map(row => ({
      row,
      key: row.userId || row.id,
      color: stableStaffColor(row.userId || row.id),
      name: `${row.lastName} ${row.firstName}`.trim() || 'Agent',
      role: row.roleName || 'Fonction non renseignée',
      periods: normalizeRowPeriods(row, dateKey(start), dateKey(end)),
    })), [rows, start, end]);

  // Même arbitrage que le serveur : cases cochées dans un planning spécial ou
  // dès qu'une ligne en porte, période de participation sinon.
  const dailyMap = useMemo(() => {
    const context = { isSpecial: isSpecialSchedule, min: dateKey(start), max: dateKey(end) };
    const map = Object.fromEntries(days.map(day => [dateKey(day), []]));
    staff.forEach(person => {
      days.forEach(day => {
        const key = dateKey(day);
        if (rowIsOnDuty(person.row, key, context)) map[key].push(person);
      });
    });
    return map;
  }, [days, staff, isSpecialSchedule, start, end]);

  const totalPresences = useMemo(() => Object.values(dailyMap).reduce((total, people) => total + people.length, 0), [dailyMap]);
  const monthGroups = useMemo(() => {
    const groups = [];
    days.forEach(day => {
      const key = `${day.getFullYear()}-${day.getMonth()}`;
      let group = groups.find(item => item.key === key);
      if (!group) {
        group = { key, year: day.getFullYear(), month: day.getMonth(), days: [] };
        groups.push(group);
      }
      group.days.push(day);
    });
    return groups;
  }, [days]);
  const todayKey = dateKey(new Date());
  const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];

  return (
    <section className="ss-calendar" aria-label="Calendrier détaillé par jour">
      <header className="ss-calendar__hero">
        <div className="ss-calendar__hero-copy">
          <span className="ss-calendar__eyebrow">VUE JOUR PAR JOUR</span>
          <h2 className="ss-calendar__title">Calendrier détaillé des affectations</h2>
          <p className="ss-calendar__subtitle">Chaque journée reprend les agents couverts par leur période. Ouvrez une date pour consulter le détail sans modifier le tableur.</p>
        </div>
        <div className="ss-calendar__metrics" aria-label="Indicateurs du calendrier">
          <div className="ss-calendar__metric"><span>Personnel</span><strong>{staff.length}</strong></div>
          <div className="ss-calendar__metric"><span>Affectations</span><strong>{totalPresences}</strong></div>
          <div className="ss-calendar__metric"><span>Jours affichés</span><strong>{days.length}</strong></div>
        </div>
      </header>

      {staff.length > 0 && (
        <section className="ss-calendar__legend" aria-label="Légende du personnel">
          <div className="ss-calendar__legend-header">
            <div><strong>Légende des agents</strong><span>{staff.length} couleur{plur(staff.length)} stable{plur(staff.length)}</span></div>
            {staff.length > 8 && <button type="button" onClick={() => setLegendExpanded(value => !value)}>{legendExpanded ? 'Réduire' : `Afficher les ${staff.length} agents`}</button>}
          </div>
          <div className="ss-calendar__legend-list">
            {(legendExpanded ? staff : staff.slice(0, 8)).map(person => (
              <span className="ss-calendar__legend-item" key={person.key} style={{ '--staff-color': person.color }}>
                <span className="ss-calendar__dot" />
                <span title={person.name}>{person.name}</span>
                <small title={person.role}>{person.role}</small>
              </span>
            ))}
            {!legendExpanded && staff.length > 8 && <span className="ss-calendar__legend-more">+{staff.length - 8} autres</span>}
          </div>
        </section>
      )}

      {weekOrganization.length > 0 && (
        <div className="ss-calendar__groups" aria-label="Organisation temporelle">
          {weekOrganization.map((group, index) => <div className="ss-calendar__group" key={group.id || index} style={{ '--group-color': group.color || WEEK_GROUP_DEFAULT }}><strong>{group.name}</strong><span>{group.startDate} → {group.endDate}</span></div>)}
        </div>
      )}

      <div className="ss-calendar__months">
        {monthGroups.map(group => (
          <section className="ss-calendar__month-section" key={group.key}>
            <div className="ss-calendar__month-header"><strong>{MONTH_FR[group.month]} {group.year}</strong><span>{group.days.length} jour{plur(group.days.length)}</span></div>
            <div className="ss-calendar__weekdays" aria-hidden="true">
              {weekdayOrder.map(dayIndex => <span className="ss-calendar__weekday" key={dayIndex}>{DOW_FR[dayIndex]}</span>)}
            </div>
            <div className="ss-calendar__grid">
              {group.days.map((day, dayIndex) => {
                const key = dateKey(day);
                const people = dailyMap[key] || [];
                const weekend = isWeekend(day);
                const matchingHolidays = holidays.filter(holiday => key >= dateKey(holiday.start_date) && key <= dateKey(holiday.end_date));
                const isHolidayDay = matchingHolidays.length > 0;
                const holidayNames = matchingHolidays.map(holiday => holiday.name).filter(Boolean).join(', ') || 'Jour férié';
                const isToday = key === todayKey;
                const dayClasses = ['ss-calendar__day'];
                if (weekend) dayClasses.push('is-weekend');
                if (isHolidayDay) dayClasses.push('is-holiday');
                if (isToday) dayClasses.push('is-today');
                if (people.length) dayClasses.push('has-staff');
                const firstColumn = dayIndex === 0 ? (day.getDay() === 0 ? 7 : day.getDay()) : null;
                return (
                  <button
                    type="button"
                    key={key}
                    className={dayClasses.join(' ')}
                    style={firstColumn ? { '--calendar-start': firstColumn } : undefined}
                    onClick={() => setSelectedDay({ day, people, isHolidayDay, holidayNames, weekend })}
                    aria-label={`${DOW_FR[day.getDay()]} ${day.getDate()} ${MONTH_FR[day.getMonth()]} : ${people.length} affectation${plur(people.length)}`}
                  >
                    <div className="ss-calendar__day-top">
                      <span className="ss-calendar__day-number">{day.getDate()} <small>{DOW_FR[day.getDay()]}</small></span>
                      <span className="ss-calendar__day-badge">{isHolidayDay ? 'Férié' : weekend ? 'Week-end' : `${people.length} affect.`}</span>
                    </div>
                    {isHolidayDay && <div className="ss-calendar__day-label" title={holidayNames}>{holidayNames}</div>}
                    {people.length ? (
                      <div className="ss-calendar__people">
                        {people.slice(0, 3).map(person => {
                          const initials = `${person.row.lastName?.[0] || ''}${person.row.firstName?.[0] || ''}`.toUpperCase() || 'P';
                          return <span className="ss-calendar__person" key={person.key} style={{ '--staff-color': person.color }} title={`${person.name} — ${person.role}`}><span className="ss-calendar__dot">{initials}</span><span className="ss-calendar__person-name">{person.name}</span></span>;
                        })}
                        {people.length > 3 && <span className="ss-calendar__more">+{people.length - 3}</span>}
                      </div>
                    ) : <span className="ss-calendar__empty-day">Aucune affectation</span>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {days.length === 0 && <div className="ss-calendar__empty-day ss-calendar__empty-state">Aucune journée à afficher pour cette période.</div>}

      {selectedDay && (
        <div className="ss-calendar__modal-backdrop" role="presentation" onClick={() => setSelectedDay(null)}>
          <div className="ss-calendar__modal" role="dialog" aria-modal="true" aria-labelledby="detailed-calendar-dialog-title" onClick={event => event.stopPropagation()}>
            <div className="ss-calendar__modal-header">
              <div>
                <span className="ss-calendar__eyebrow">DÉTAIL DE LA JOURNÉE</span>
                <h3 id="detailed-calendar-dialog-title">{DOW_FR[selectedDay.day.getDay()]} {selectedDay.day.getDate()} {MONTH_FR[selectedDay.day.getMonth()]}</h3>
                {selectedDay.isHolidayDay && <p>{selectedDay.holidayNames}</p>}
              </div>
              <button type="button" className="ss-calendar__modal-close" onClick={() => setSelectedDay(null)} aria-label="Fermer">✕</button>
            </div>
            <p className="ss-calendar__modal-note">Consultation uniquement — aucune modification du tableur.</p>
            {selectedDay.people.length ? (
              <div className="ss-calendar__modal-list">
                {selectedDay.people.map(person => <div className="ss-calendar__modal-person" key={person.key} style={{ '--staff-color': person.color }}><span className="ss-calendar__dot" /><div><strong>{person.name}</strong><small>{person.role} · {person.periods.length ? periodsLabel(person.periods, true) : 'Dates sélectionnées'}</small></div></div>)}
              </div>
            ) : <div className="ss-calendar__empty-state">Aucun personnel prévu ce jour.</div>}
          </div>
        </div>
      )}
    </section>
  );
}
// Une valeur de cellule n'est pas toujours une chaîne : la colonne « Périodes »
// porte un tableau d'objets. Rendre un objet fait remonter une exception qui
// démonte tout le tableur — l'écran devient blanc, sans message. Toute valeur
// affichée par la fenêtre des propositions passe donc par cette lecture.
const cellValueText = (value) => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (Array.isArray(value)) return periodsLabel(normalizeRowPeriods({ periods: value }), true);
  if (typeof value === 'object') return periodsLabel(normalizeRowPeriods(value), true);
  return String(value);
};

function CellProposalModal({ cellInfo, onClose, onApplyValue }) {
  if (!cellInfo) return null;
  const { rowName, colLabel, originalVal, proposals } = cellInfo;
  const originalText = cellValueText(originalVal);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-overlay)', backdropFilter: 'blur(4px)', zIndex: 3500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: 'var(--gs-paper)', borderRadius: 16, border: '1px solid var(--gs-rule)', padding: 24, width: 490, maxWidth: '94vw', boxShadow: 'var(--gs-shadow-lift)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--gs-alert)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>⚡</span> <span>Propositions & Conflits sur cette case</span>
            </div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: 'var(--gs-ink)' }}>
              {rowName}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--gs-ink-faint)', marginTop: 2 }}>
              Champ : <strong>{colLabel}</strong>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--gs-ink-faint)', cursor: 'pointer', padding: 4 }}>✕</button>
        </div>

        {/* Valeur officielle actuelle */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--gs-paper-alt)', border: '1px solid var(--gs-rule)', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--gs-ink-faint)', fontWeight: 600 }}>Officiel Actuel :</span>
          <strong style={{ fontSize: 13, color: 'var(--gs-ink)', padding: '2px 8px', borderRadius: 6, background: 'color-mix(in srgb, var(--gs-ink) 8%, transparent)' }}>
            {originalText || 'Non renseigné'}
          </strong>
        </div>

        {/* Liste des propositions side by side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 320, overflowY: 'auto', marginBottom: 20 }}>
          {(proposals || []).map((prop, idx) => {
            // Une proposition sans palette ne doit pas non plus vider l'écran :
            // on retombe sur la palette de rang, comme partout ailleurs.
            const palette = prop.palette || getProposalPalette(idx);
            return (
            <div key={prop.proposalId || idx} style={{
              padding: 14, borderRadius: 12,
              background: palette.bg,
              border: `2px solid ${palette.borderDark}`,
              boxShadow: 'var(--gs-shadow-card)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15 }}>{palette.dot}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: palette.textDark }}>
                    {prop.proposerName}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: palette.badgeBg, color: palette.textDark, border: `1px solid ${palette.borderDark}` }}>
                    {prop.roleIcon} {prop.roleTitle}
                  </span>
                </div>

                <div style={{ fontSize: 13, fontWeight: 900, color: palette.textDark, marginTop: 4 }}>
                  Proposé : <span style={{ textDecoration: 'underline', background: palette.badgeBg, padding: '2px 8px', borderRadius: 6 }}>{cellValueText(prop.proposedVal) || '—'}</span>
                </div>

                {prop.comment && (
                  <div style={{ fontSize: 11, color: palette.text, marginTop: 6, fontStyle: 'italic', background: 'var(--gs-paper)', padding: '4px 8px', borderRadius: 6 }}>
                    💬 "{prop.comment}"
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  onApplyValue(prop.rawValue ?? prop.proposedVal);
                  onClose();
                }}
                style={{
                  padding: '9px 16px', borderRadius: 8, border: 'none',
                  background: palette.borderDark, color: '#fff',
                  fontSize: 12, fontWeight: 800, cursor: 'pointer', flexShrink: 0,
                  boxShadow: 'var(--gs-shadow-card)'
                }}>
                ✓ Appliquer
              </button>
            </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--gs-rule)', background: 'transparent', color: 'var(--gs-ink-soft)', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

const weekInputStyle = { padding: '6px 8px', borderRadius: 6, border: '1px solid var(--gs-rule-strong)', background: 'var(--gs-paper)', color: 'var(--gs-ink)', fontSize: 11 };

// ── Main ─────────────────────────────────────────────────────────────────
export default function SmartSpreadsheet({ scheduleId, departmentId, onBack, onManageProposals }) {
  const qc = useQueryClient();
  const { user } = useAuthStore();

  // ── State ──
  const [rows, setRows]               = useState([]);
  const [editingCell, setEditingCell] = useState(null);
  const [editVal, setEditVal]         = useState('');
  const [filter, setFilter]           = useState({ search: '', role: '' });
  const [hiddenCols, setHiddenCols]   = useState(new Set());
  const [showColPanel, setShowColPanel] = useState(false);
  const [isDirty, setIsDirty]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [pickerOpen, setPickerOpen]   = useState(false);
  const [pickerRowId, setPickerRowId] = useState(null);
  const [personSearch, setPersonSearch] = useState(null);
  const [periodPicker, setPeriodPicker] = useState(null);
  const [specialDatesPicker, setSpecialDatesPicker] = useState(null);
  const [viewMode, setViewMode] = useState('table');
  const [spreadsheetMode, setSpreadsheetMode] = useState('standard');
  const [fixedSlots, setFixedSlots] = useState([]);
  const [fixedConfigCollapsed, setFixedConfigCollapsed] = useState(false);
  const [dragOverRow, setDragOverRow] = useState(null);
  const [draggingRow, setDraggingRow] = useState(null);
  // Colonnes dynamiques
  const [customCols, setCustomCols]   = useState([]);
  const [weekOrganization, setWeekOrganization] = useState([]);
  const [showWeekOrganization, setShowWeekOrganization] = useState(false);
  const [showAddCol, setShowAddCol]   = useState(false);
  const [newColName, setNewColName]   = useState('');
  const [newColType, setNewColType]   = useState('text');
  const [editingColHeader, setEditingColHeader] = useState(null); // key of col being renamed
  const [colHeaderVal, setColHeaderVal] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const inputRef = useRef(null);
  const saveVersion = useRef(0);
  const downloadScheduleExport = async (format) => {
    const requests = {
      pdf: scheduleBuilderAPI.exportPDF,
      excel: scheduleBuilderAPI.exportExcel,
      csv: scheduleBuilderAPI.exportCSV,
      calendar: scheduleBuilderAPI.exportCalendarPDF,
    };
    const names = { pdf: 'tableur-garde.pdf', excel: 'tableur-garde.xlsx', csv: 'tableur-garde.csv', calendar: 'calendrier-detaille-garde.pdf' };
    try {
      const response = await requests[format](scheduleId);
      const disposition = response.headers?.['content-disposition'] || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || names[format];
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data]);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('Export telecharge avec succes.');
    } catch {
      toast.error('Impossible de generer cet export.');
    }
  };

  // ── Data fetch ──
  const { data: schedData, isLoading } = useQuery({
    queryKey: ['schedule-detail', scheduleId],
    queryFn: () => scheduleBuilderAPI.getDetail(scheduleId),
    enabled: !!scheduleId,
  });
  // L'API renvoie { success, data: { schedule, shifts, ... } }.
  // Le tableur doit utiliser le planning imbriqué pour lire ses dates globales.
  const scheduleDetail = schedData?.data?.data || schedData?.data;
  const schedule = scheduleDetail?.schedule || scheduleDetail;

  // Personnel emprunté à un autre service : l'accord du chef propriétaire est
  // demandé automatiquement mais ne bloque rien. Tant qu'il n'a pas répondu, la
  // ligne est teintée ; s'il accepte elle redevient normale ; s'il refuse le
  // serveur la retire seul, sans toucher à l'état du planning.
  const externalLoans = scheduleDetail?.externalLoans || {};
  const pendingExternalCount = useMemo(
    () => Object.values(externalLoans).filter(l => l.status === 'pending').length,
    [externalLoans]
  );

  // Change proposals fetch (du surveillant)
  const { data: propData } = useQuery({
    queryKey: ['schedule-change-proposals', scheduleId],
    queryFn: () => scheduleBuilderAPI.getChangeProposals(scheduleId),
    enabled: !!scheduleId,
  });
  const proposals = propData?.data?.data || propData?.data || [];
  const pendingProposals = useMemo(() => {
    return proposals.filter(p => p.status === 'pending');
  }, [proposals]);

  const [activeProposalId, setActiveProposalId] = useState(null);
  const [cellModalInfo, setCellModalInfo]       = useState(null);

  const proposalsWithPalettes = useMemo(() => {
    return pendingProposals.map((prop, idx) => {
      const palette = getProposalPalette(idx);
      const isSG = prop.proposer_role_code === 'general_supervisor' || (prop.proposer_role && prop.proposer_role.toLowerCase().includes('général'));
      const roleTitle = isSG ? 'Surveillant Général' : (prop.proposer_role || 'Surveillant de Service');
      const roleIcon = isSG ? '🛡️' : '📋';
      const mapByUserId = {};
      (prop.proposal?.rows || []).forEach(r => {
        const uId = r.userId || r.user_id || r.id;
        if (uId) mapByUserId[uId] = r;
      });
      return {
        ...prop,
        idx,
        palette,
        roleTitle,
        roleIcon,
        isSG,
        mapByUserId,
        proposerName: `${prop.first_name || ''} ${prop.last_name || ''}`.trim() || roleTitle,
      };
    });
  }, [pendingProposals]);

  const activeProposalsToEvaluate = useMemo(() => {
    if (!activeProposalId || activeProposalId === 'all') {
      return proposalsWithPalettes;
    }
    return proposalsWithPalettes.filter(p => p.id === activeProposalId);
  }, [proposalsWithPalettes, activeProposalId]);

  const pendingProposal = useMemo(() => {
    if (!pendingProposals.length) return null;
    if (activeProposalId === 'all') return pendingProposals[0];
    return pendingProposals.find(p => p.id === activeProposalId) || pendingProposals[0];
  }, [pendingProposals, activeProposalId]);

  const activeProposalIndex = useMemo(() => {
    if (!pendingProposal || !pendingProposals.length) return 0;
    const idx = pendingProposals.findIndex(p => p.id === pendingProposal.id);
    return idx >= 0 ? idx : 0;
  }, [pendingProposal, pendingProposals]);

  const activePalette = useMemo(() => getProposalPalette(activeProposalIndex), [activeProposalIndex]);

  const [notifyingSG, setNotifyingSG] = useState(false);
  const handleNotifySG = async () => {
    const comment = window.prompt('Note ou message pour le Surveillant Général (optionnel) :');
    if (comment === null) return;
    setNotifyingSG(true);
    try {
      const res = await scheduleBuilderAPI.notifySG(scheduleId, { comment });
      toast.success(res.data?.message || 'Planning transmis au Surveillant Général avec succès !');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la transmission au SG');
    } finally {
      setNotifyingSG(false);
    }
  };

  const [decidingProposal, setDecidingProposal] = useState(false);
  const refreshProposalData = async () => {
    await qc.refetchQueries({ queryKey: ['schedule-change-proposals', scheduleId] });
    await qc.refetchQueries({ queryKey: ['schedule-detail', scheduleId] });
  };

  const resolveProposalLocally = (proposalId, status) => {
    qc.setQueryData(['schedule-change-proposals', scheduleId], old => {
      if (!old?.data?.data || !Array.isArray(old.data.data)) return old;
      return { ...old, data: { ...old.data, data: old.data.data.map(p => p.id === proposalId ? { ...p, status } : p) } };
    });
  };

  const getMultiCellProposals = useCallback((row, colKey) => {
    if (!activeProposalsToEvaluate.length) return [];
    const cellProps = [];

    activeProposalsToEvaluate.forEach(prop => {
      if (row.isProposedNewRow) {
        const rawValue = row[colKey];
        const proposedVal = colKey === 'periods'
          ? periodsLabel(normalizeRowPeriods(row), true)
          : String(rawValue || '').trim();
        if (proposedVal) {
          cellProps.push({
            proposalId: prop.id,
            proposerName: prop.proposerName,
            roleTitle: prop.roleTitle,
            roleIcon: prop.roleIcon,
            originalVal: 'Non présent dans l’officiel',
            proposedVal,
            rawValue,
            palette: prop.palette,
            comment: prop.comment
          });
        }
      } else {
        const propRow = prop.mapByUserId[row.userId || row.id];
        if (propRow) {
          const rawValue = propRow[colKey] || propRow[colKey === 'periodStart' ? 'period_start' : colKey === 'periodEnd' ? 'period_end' : colKey];
          const currentVal = colKey === 'periods'
            ? periodsLabel(normalizeRowPeriods(row), true)
            : String(row[colKey] || '').trim();
          const proposedVal = colKey === 'periods'
            ? periodsLabel(normalizeRowPeriods(propRow), true)
            : String(rawValue || '').trim();
          if (proposedVal && proposedVal !== currentVal) {
            cellProps.push({
              proposalId: prop.id,
              proposerName: prop.proposerName,
              roleTitle: prop.roleTitle,
              roleIcon: prop.roleIcon,
              originalVal: currentVal || 'Non renseigné',
              proposedVal,
              rawValue: colKey === 'periods' ? normalizeRowPeriods(propRow) : rawValue,
              palette: prop.palette,
              comment: prop.comment
            });
          }
        }
      }
    });

    return cellProps;
  }, [activeProposalsToEvaluate]);

  // Propositions portant sur une case de jour. Il n'y a plus de lettre à
  // comparer : on compare deux booléens « de service / pas de service ».
  const getMultiShiftProposals = useCallback((row, dateStr) => {    if (!activeProposalsToEvaluate.length) return [];
    const shiftProps = [];

    activeProposalsToEvaluate.forEach(prop => {
      if (row.isProposedNewRow) {
        if (isMarked(row.shifts?.[dateStr])) {
          shiftProps.push({
            proposalId: prop.id,
            proposerName: prop.proposerName,
            roleTitle: prop.roleTitle,
            roleIcon: prop.roleIcon,
            originalVal: 'Pas de service',
            proposedVal: 'De service',
            proposedOnDuty: true,
            rawValue: true,
            palette: prop.palette,
            comment: prop.comment
          });
        }
      } else {
        const propRow = prop.mapByUserId[row.userId || row.id];
        if (propRow) {
          const current = isMarked(row.shifts?.[dateStr]);
          const proposed = isMarked(propRow.shifts?.[dateStr]);
          if (proposed !== current) {
            shiftProps.push({
              proposalId: prop.id,
              proposerName: prop.proposerName,
              roleTitle: prop.roleTitle,
              roleIcon: prop.roleIcon,
              originalVal: current ? 'De service' : 'Pas de service',
              proposedVal: proposed ? 'De service' : 'Retirée',
              proposedOnDuty: proposed,
              rawValue: proposed,
              palette: prop.palette,
              comment: prop.comment
            });
          }
        }
      }
    });

    return shiftProps;
  }, [activeProposalsToEvaluate]);

  /**
   * Dates à examiner pour repérer une proposition de jour : celles de la ligne
   * officielle ET celles ajoutées par les propositions. Sans cette union, un
   * jour ajouté par un surveillant — absent de la ligne officielle — ne
   * colorerait jamais la ligne.
   */
  const proposalShiftDates = useCallback((row) => {
    const dates = new Set(Object.keys(row.shifts || {}));
    activeProposalsToEvaluate.forEach(prop => {
      const propRow = prop.mapByUserId[row.userId || row.id];
      Object.keys(propRow?.shifts || {}).forEach(date => dates.add(date));
    });
    return [...dates];
  }, [activeProposalsToEvaluate]);

  const handleApplyProposalValue = (val) => {
    if (!cellModalInfo) return;
    const { rowId, colKey, dateStr, isShift } = cellModalInfo;
    if (isShift) {
      toggleDuty(rowId, dateStr, val === true);
    } else if (colKey && colKey.startsWith('custom_')) {
      setRows(prev => prev.map(r => r.id === rowId ? { ...r, custom: { ...(r.custom || {}), [colKey]: val } } : r));
      dirty();
    } else if (colKey === 'periods') {
      const periods = normalizeRowPeriods({ periods: val });
      const bounds = periodBounds(periods);
      updateRow(rowId, { periods, periodStart: bounds.startDate, periodEnd: bounds.endDate });
    } else if (colKey) {
      updateRow(rowId, { [colKey]: val });
    }
    toast.success(
      isShift
        ? `✓ ${val === true ? 'Journée de service ajoutée' : 'Journée de service retirée'} !`
        : `✓ Valeur "${cellValueText(val)}" appliquée au planning !`
    );
  };


  const { data: holidaysRes } = useQuery({
    queryKey: ['admin-holidays', dateKey(schedule?.start_date), dateKey(schedule?.end_date)],
    queryFn: async () => {
      const result = await adminAPI.getHolidays({ startDate: dateKey(schedule.start_date), endDate: dateKey(schedule.end_date) });
      return result.data?.data || result.data || [];
    },
    enabled: !!schedule,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30000,
  });
  const publicHolidays = holidaysRes || [];

  // Effectif minimum de garde du service : c'est lui qui rend le ruban du mois
  // capable de dire « cette journée est couverte, mais trop juste ». Lecture
  // seule, mise en cache dix minutes — la valeur ne change presque jamais.
  const { data: departmentRes } = useQuery({
    queryKey: ['department-min-guard', schedule?.department_id || departmentId],
    queryFn: () => departmentsAPI.getOne(schedule?.department_id || departmentId),
    enabled: !!(schedule?.department_id || departmentId),
    staleTime: 600000,
  });
  const minGuardCount = Number(
    departmentRes?.data?.data?.min_guard_count ?? departmentRes?.data?.min_guard_count ?? 0
  ) || 0;

  const isWeekendHolidaySchedule = schedule?.schedule_type === 'special_weekend_holiday' || schedule?.metadata?.schedule_kind === 'weekend_holiday' || schedule?.metadata?.special_days_only === true;

  const days = useMemo(() => {
    const allDays = getDays(schedule?.start_date, schedule?.end_date);
    if (!isWeekendHolidaySchedule) return allDays;

    return allDays.filter(day => {
      const key = dateKey(day);
      const dayOfWeek = day.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = publicHolidays.some(h => {
        const hStart = dateKey(h.start_date);
        const hEnd = dateKey(h.end_date);
        return key >= hStart && key <= hEnd;
      });
      return isWeekend || isHoliday;
    });
  }, [schedule, isWeekendHolidaySchedule, publicHolidays]);

  const showDailyGrid = false;

  // Contexte de la règle de lecture partagée, réutilisé par toutes les cases.
  const dutyContext = useMemo(() => ({
    isSpecial: isWeekendHolidaySchedule,
    min: dateKey(schedule?.start_date),
    max: dateKey(schedule?.end_date),
  }), [isWeekendHolidaySchedule, schedule]);
  // Un planning envoyé est en vigueur ('submitted') puis en cours ('active').
  // Les deux ouvrent le droit de proposer une modification : sans 'active', les
  // surveillants perdraient ce droit au moment même où le planning démarre.
  const canProposeChanges = ['submitted', 'active'].includes(schedule?.status) && ['service_supervisor', 'general_supervisor'].includes(user?.roleCode);
  const canDirectEdit = schedule?.status === 'draft'
    || (['submitted', 'active'].includes(schedule?.status) && user?.roleCode === 'department_head');
  const canManageProposals = ['submitted', 'active'].includes(schedule?.status) && user?.roleCode === 'department_head';
  // En revanche l'annulation d'envoi s'arrête au démarrage : un planning en
  // cours ne peut plus revenir en brouillon.
  const canCancelSubmission = schedule?.status === 'submitted' && user?.roleCode === 'department_head';

  const createEmptyRow = useCallback((idx = Date.now()) => ({
    id: `new-${idx}`, userId: null,
    lastName: '', firstName: '', roleName: '', phone: '', matricule: '',
    jobTitleId: null,
    periods: [{ startDate: dateKey(schedule?.start_date), endDate: dateKey(schedule?.end_date) }],
    periodStart: dateKey(schedule?.start_date), periodEnd: dateKey(schedule?.end_date),
    shiftStart: '07:00', shiftEnd: '07:00',
    atHome: false,
    deptId: departmentId, shifts: {}, isNew: true,
    fixedSlotId: null, fixedPositionIndex: null, fixedJobTitleId: null,
    fixedFunctionName: null, fixedConstant: false,
    custom: {},
  }), [schedule?.start_date, schedule?.end_date, departmentId]);

  // Build rows from schedule
  useEffect(() => {
    if (!schedule) return;
    const spreadsheetMetadata = schedule.metadata?.spreadsheet || {};
    const savedRows = spreadsheetMetadata.rows;
    const savedMode = spreadsheetMetadata.mode === 'fixed' ? 'fixed' : 'standard';
    const savedFixedSlots = normalizeFixedSlots(spreadsheetMetadata.fixedRoster);
    setSpreadsheetMode(savedMode);
    setFixedSlots(savedFixedSlots);
    setViewMode(current => (current === 'calendar' || current === 'detailed')
      ? current
      : savedMode === 'fixed' ? 'fixed' : 'table');
    const staffList = scheduleDetail?.staff || schedule.staff || [];
    const currentStaffById = new Map(
      staffList.map(member => [member.userId || member.user_id || member.id, member])
    );
    const shifts    = scheduleDetail?.shifts || schedule.shifts || [];
    const officialRows = savedRows?.length ? savedRows : staffList;
    // Les membres ajoutés dans des propositions n’existent pas encore dans le planning officiel.
    const allProposedRows = proposalsWithPalettes.flatMap(p => p.proposal?.rows || []);
    const existingPersonnelIds = new Set(officialRows.map(m => m.userId || m.user_id || m.id).filter(Boolean));
    const sourceRows = [...officialRows, ...allProposedRows.filter(m => {
      const id = m.userId || m.user_id || m.id;
      return id && !existingPersonnelIds.has(id);
    })];
    const built = sourceRows.map(m => {
      // `personnelId` sert de clé de ligne et retombe sur l'identifiant de la
      // ligne elle-même pour rester unique. Le personnel, lui, ne se devine
      // pas : une ligne importée sans agent ne porte qu'un identifiant de
      // ligne, et le recopier en `userId` faisait échouer toute sauvegarde du
      // planning importé (« identifiant de personnel invalide »).
      const personnelId = m.userId || m.user_id || m.id;
      const staffUserId = isPersonnelId(personnelId) ? personnelId : null;
      const currentStaff = currentStaffById.get(personnelId);
      const isProposedNewRow = Boolean(pendingProposal && !existingPersonnelIds.has(personnelId));
      const shiftMap = { ...(m.shifts || {}) };
      shifts.filter(s => s.user_id === personnelId).forEach(s => {
        // Les gardes « spreadsheet-… » ne viennent pas de la base : le serveur
        // vient de les déduire de ce tableur (cases ou période de la ligne). Les
        // réinjecter ici ferait un aller-retour qui transforme une donnée déduite
        // en donnée source : à la sauvegarde, une ligne pilotée par sa période se
        // retrouverait avec toutes ses cases cochées, et déplacer la période ne
        // déplacerait plus ses gardes. On ne reprend donc que les vraies gardes
        // historiques, seul objet de cette surcouche.
        if (String(s.id || '').startsWith('spreadsheet-')) return;
        const d = String(s.shift_date || s.shiftDate || '').split('T')[0];
        if (!d) return;
        // Reprise des plannings antérieurs : la table `shifts` n'est plus
        // alimentée, seule reste l'information « cet agent était de service ».
        shiftMap[d] = true;
      });
      return {
        id: `row-${personnelId}`, userId: staffUserId,
        lastName: m.last_name || m.lastName || '', firstName: m.first_name || m.firstName || '',
        roleName: resolveStaffFunction(currentStaff || m), phone: m.phone || '', matricule: m.matricule || '',
        jobTitleId: resolveStaffJobTitleId(currentStaff || m),
        periods: normalizeRowPeriods(m, dateKey(schedule.start_date), dateKey(schedule.end_date)),
        periodStart: dateKey(m.periodStart || m.period_start) || dateKey(schedule.start_date),
        periodEnd: dateKey(m.periodEnd || m.period_end) || dateKey(schedule.end_date),
        shiftStart: m.shiftStart || '07:00', shiftEnd: m.shiftEnd || '07:00',
        // Garde à domicile — absent ⇒ false ⇒ garde à l'hôpital, en présence.
        // Les plannings enregistrés avant cette colonne restent donc en présence.
        atHome: (m.atHome ?? m.at_home) === true,
        deptId: m.department_id || departmentId,
        shifts: shiftMap, isNew: false,
        isProposedNewRow,
        fixedSlotId: m.fixedSlotId || m.fixed_slot_id || null,
        fixedPositionIndex: Number.isInteger(Number(m.fixedPositionIndex ?? m.fixed_position_index)) ? Number(m.fixedPositionIndex ?? m.fixed_position_index) : null,
        fixedJobTitleId: m.fixedJobTitleId || m.fixed_job_title_id || null,
        fixedFunctionName: m.fixedFunctionName || m.fixed_function_name || null,
        fixedConstant: Boolean(m.fixedConstant ?? m.fixed_constant),
        custom: m.custom || {},
      };
    });
    setRows(current => {
      if (savedMode === 'fixed') return syncRowsToFixedRoster(built, savedFixedSlots, createEmptyRow);
      // Une ligne sans personnel n'a rien à enregistrer : le serveur ne garde
      // que les agents réellement affectés, et la reconstruction ne la retrouve
      // donc jamais dans la réponse. Sans ce report, tout rafraîchissement du
      // planning — enregistrement automatique, événement temps réel, relève des
      // jours fériés — effaçait la ligne que le chef venait d'ouvrir pour la
      // remplir. On la reprend telle quelle, en écartant celles que la réponse
      // rapporte déjà pour ne pas la voir deux fois.
      const rebuiltIds = new Set(built.map(row => row.id));
      const pending = current.filter(row => !row.userId && !row.isProposedNewRow && !rebuiltIds.has(row.id));
      const merged = [...built, ...pending];
      // Le tableur n'est jamais vide : sans aucune ligne, on en ouvre une.
      return merged.length ? merged : [createEmptyRow()];
    });
    setCustomCols(spreadsheetMetadata.customCols || []);
    setWeekOrganization(spreadsheetMetadata.week_organization || []);
  }, [schedule, scheduleDetail, departmentId, pendingProposal, createEmptyRow]);

  const emptyRow = createEmptyRow;

  // Période = jours de participation ; durée = heures de la garde.
  const fixedCols = [
    { key: 'lastName',   label: 'Nom',           w: 120 },
    { key: 'firstName',  label: 'Prénom',         w: 100 },
    { key: 'phone',      label: 'Tél',            w: 100 },
    { key: 'matricule',  label: 'Matricule',      w: 90  },
    { key: 'roleName',   label: 'Fonction',       w: 135 },
    { key: 'periods',     label: 'Périodes',        w: 230, type: 'periods' },
    { key: 'shiftStart',  label: 'Durée - début', w: 105, type: 'time' },
    { key: 'shiftEnd',    label: 'Durée - fin',    w: 105, type: 'time' },
    // Nature de la garde : décochée par défaut ⇒ garde à l'hôpital, en présence.
    { key: 'atHome',      label: 'Garde à domicile', w: 112, type: 'bool' },
  ];
  const specialFixedCols = [
    ...fixedCols.slice(0, 5),
    { key: 'specialDates', label: 'Jours / périodes autorisés', w: 190, type: 'special-dates' },
    ...fixedCols.filter(c => ['shiftStart', 'shiftEnd', 'atHome'].includes(c.key)),
  ];
  const activeFixedCols = isWeekendHolidaySchedule ? specialFixedCols : fixedCols;
  const visibleFixedCols = activeFixedCols.filter(c => !hiddenCols.has(c.key));
  const visibleCols = visibleFixedCols; // backward compat alias
  const roles = [...new Set(rows.map(r => r.roleName).filter(Boolean))];

  const filteredRows = rows.filter(r => {
    if (!filter.search && !filter.role) return true;
    const name = `${r.lastName} ${r.firstName}`.toLowerCase();
    return (!filter.search || name.includes(filter.search.toLowerCase()))
        && (!filter.role || r.roleName === filter.role);
  });

  // ── Stats ──
  // Compté avec la règle partagée : les cases cochées dans un planning spécial,
  // la période de participation sinon. Compter les seules cases donnerait 0 sur
  // la quasi-totalité des plannings, qui n'expriment que des périodes.
  const stats = useMemo(() => {
    const assignedRows = rows.filter(row => row.userId);
    const counts = assignedRows.map(r => days.filter(day => rowIsOnDuty(r, dateKey(day), dutyContext)).length);
    const t = counts.reduce((a, b) => a + b, 0);
    return { total: t, avg: assignedRows.length ? (t / assignedRows.length).toFixed(1) : 0, staff: assignedRows.length };
  }, [rows, days, dutyContext]);

  const periodErrors = useMemo(() => {
    const isHeadEditingPublished = user?.roleCode === 'department_head'
      && ['submitted', 'active'].includes(schedule?.status);
    const roster = rows.filter(r => r.userId && !(isHeadEditingPublished && r.isProposedNewRow));
    if (!roster.length || !schedule) return [];
    const start = dateKey(schedule.start_date);
    const end = dateKey(schedule.end_date);
    const errors = [];
    roster.forEach(r => {
      const name = `${r.lastName} ${r.firstName}`.trim() || 'Personnel sélectionné';
      if (isWeekendHolidaySchedule) {
        const selected = Object.entries(r.shifts || {}).filter(([, value]) => isMarked(value)).map(([date]) => dateKey(date));
        if (!selected.length) errors.push(`${name} : sélectionnez au moins un week-end ou jour férié.`);
        const invalid = selected.find(date => !days.some(day => dateKey(day) === date));
        if (invalid) errors.push(`${name} : la date ${invalid} n'est pas un week-end ou un jour férié autorisé.`);
        return;
      }
      const periods = normalizeRowPeriods(r, start, end);
      if (!periods.length) errors.push(`${name} : ajoutez au moins une période.`);
      periods.forEach((period, index) => {
        const label = periods.length > 1 ? `période ${index + 1}` : 'période';
        if (!period.startDate || !period.endDate) errors.push(`${name} : les deux dates de la ${label} sont obligatoires.`);
        else if (period.startDate < start || period.endDate > end) errors.push(`${name} : la ${label} doit rester entre le ${start} et le ${end}.`);
        else if (period.startDate > period.endDate) errors.push(`${name} : le début de la ${label} doit précéder sa fin.`);
        if (index > 0 && period.startDate <= periods[index - 1].endDate) errors.push(`${name} : les périodes ${index} et ${index + 1} se chevauchent.`);
      });
    });
    if (!isWeekendHolidaySchedule) {
      if (!roster.some(r => normalizeRowPeriods(r, start, end).some(period => period.startDate === start))) errors.push(`Couverture manquante : au moins un personnel doit commencer le ${start}.`);
      if (!roster.some(r => normalizeRowPeriods(r, start, end).some(period => period.endDate === end))) errors.push(`Couverture manquante : au moins un personnel doit finir le ${end}.`);
    }
    return errors;
  }, [rows, schedule, user?.roleCode, isWeekendHolidaySchedule, days]);

  const fixedRosterErrors = useMemo(() => {
    if (spreadsheetMode !== 'fixed') return [];
    return rows
      .filter(row => row.userId && row.fixedSlotId && !staffMatchesFixedRequirement(row, row))
      .map(row => `${row.lastName} ${row.firstName}`.trim()
        + ` : la fonction attendue est « ${row.fixedFunctionName || 'non renseignée'} ».`);
  }, [rows, spreadsheetMode]);

  const dirty = useCallback(() => { saveVersion.current += 1; setIsDirty(true); }, []);

  const existingUserIds = useMemo(() => {
    return rows.map(r => r.userId).filter(Boolean);
  }, [rows]);

  const pickerTargetRow = useMemo(
    () => rows.find(row => row.id === pickerRowId) || null,
    [rows, pickerRowId]
  );

  const { data: searchData } = useQuery({
    queryKey: ['spreadsheet-person-search', personSearch?.value, departmentId],
    queryFn: () => schedulesAPI.getHospitalStaff({
      search: personSearch?.value,
      priorityDeptId: departmentId,
      limit: 12,
    }),
    enabled: !!personSearch?.value?.trim(),
  });
  const calendarRows = spreadsheetMode === 'fixed'
    ? filteredRows.filter(row => row.userId)
    : filteredRows;
  const searchResults = useMemo(() => {
    const raw = searchData?.data?.data || searchData?.data || [];
    const set = new Set(existingUserIds);
    const targetRow = personSearch?.rowId ? rows.find(row => row.id === personSearch.rowId) : null;
    return raw.filter(member => !set.has(member.id) && staffMatchesFixedRequirement(member, targetRow));
  }, [searchData, existingUserIds, personSearch?.rowId, rows]);

  const handleFixedSlotsChange = (nextSlots) => {
    const normalized = normalizeFixedSlots(nextSlots);
    setFixedSlots(normalized);
    setRows(current => syncRowsToFixedRoster(current, normalized, createEmptyRow));
    dirty();
  };

  const switchSpreadsheetMode = (nextMode) => {
    if (nextMode === spreadsheetMode) {
      setViewMode(nextMode === 'fixed' ? 'fixed' : 'table');
      return;
    }
    const hasAssignments = rows.some(row => row.userId);
    const message = nextMode === 'fixed'
      ? 'Passer au Tableur fixe ? Les personnels compatibles seront placés dans les fonctions configurées.'
      : 'Revenir au Tableur normal ? Le canevas fixe sera retiré de ce planning, mais les personnels affectés seront conservés.';
    if ((hasAssignments || fixedSlots.length > 0) && !window.confirm(message)) return;

    if (nextMode === 'fixed') {
      setSpreadsheetMode('fixed');
      setViewMode('fixed');
    } else {
      setSpreadsheetMode('standard');
      setViewMode('table');
      setFixedSlots([]);
      setRows(current => {
        const preserved = current.filter(row => row.userId).map(row => ({
          ...row,
          fixedSlotId: null,
          fixedPositionIndex: null,
          fixedJobTitleId: null,
          fixedFunctionName: null,
          fixedConstant: false,
        }));
        return preserved.length ? preserved : [createEmptyRow()];
      });
    }
    dirty();
  };

  // ── Row mutations ──
  const updateRow = (id, patch) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    dirty();
  };

  /**
   * Coche / décoche un jour de service.
   *
   * Dans un planning normal la case est le miroir de la période : elle n'est pas
   * cliquable, et cette fonction n'est appelée que par l'application d'une
   * proposition de modification (`forcedOnDuty`). Dans un planning
   * « week-ends et jours fériés » c'est la bascule normale au clic.
   */
  const toggleDuty = (rowId, dateStr, forcedOnDuty) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      if (!isWeekendHolidaySchedule && !dateInRowPeriods(dateStr, r, dateKey(schedule?.start_date), dateKey(schedule?.end_date))) return r;
      const next = forcedOnDuty === undefined ? !isMarked(r.shifts?.[dateStr]) : forcedOnDuty === true;
      const shifts = { ...r.shifts };
      if (next) shifts[dateStr] = true;
      else delete shifts[dateStr];
      return { ...r, shifts };
    }));
    dirty();
  };

  // `position` est l'index où la nouvelle ligne se place ; par défaut, à la fin.
  const addRow = (position = null) => {
    const row = emptyRow();
    setRows(prev => {
      const arr = [...prev];
      const at = position === null ? arr.length : Math.max(0, Math.min(position, arr.length));
      arr.splice(at, 0, row);
      return arr;
    });
    // Pas de `dirty()` ici : une ligne vide n'a aucun contenu à enregistrer.
    // L'aller-retour ne servait qu'à recharger le planning et à inscrire une
    // entrée « Brouillon du planning enregistré » à l'historique pour un clic
    // qui n'a rien changé. L'enregistrement viendra avec le premier vrai
    // contenu — un agent choisi, une case cochée.
  };

  const removeRow = id => {
    setRows(prev => prev.flatMap((row) => {
      if (row.id !== id) return [row];
      if (!row.fixedSlotId) return [];
      return [{
        ...row,
        userId: null,
        firstName: '', lastName: '', phone: '', matricule: '', jobTitleId: null,
        roleName: row.fixedFunctionName || '', shifts: {}, isNew: true,
      }];
    }));
    dirty();
  };

  const duplicateRow = idx => {
    const src = rows[idx];
    const copy = {
      ...src,
      id: `new-${Date.now()}`,
      isNew: true,
      periods: normalizeRowPeriods(src).map(period => ({ ...period })),
      shifts: { ...src.shifts },
      fixedSlotId: null,
      fixedPositionIndex: null,
      fixedJobTitleId: null,
      fixedFunctionName: null,
      fixedConstant: false,
    };
    setRows(prev => { const arr = [...prev]; arr.splice(idx + 1, 0, copy); return arr; });
    dirty();
  };

  // « Insérer au-dessus » de la première ligne, c'est la première position :
  // l'ancien calcul y descendait à -1, que le tableur lisait « à la fin ».
  const insertRow = (idx, above) => {
    addRow(above ? idx : idx + 1);
  };

  const handleContextAction = (action, idx) => {
    if (action === 'delete')       removeRow(rows[idx].id);
    else if (action === 'duplicate') duplicateRow(idx);
    else if (action === 'insertAbove') insertRow(idx, true);
    else if (action === 'insertBelow') insertRow(idx, false);
  };

  // ── Drag-to-reorder rows ──
  const handleRowDragStart = (e, idx) => {
    setDraggingRow(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };

  const handleRowDrop = (e, targetIdx) => {
    e.preventDefault();
    const staffPayload = e.dataTransfer.getData('application/json');
    if (staffPayload) {
      try {
        applyStaffToRow(rows[targetIdx].id, JSON.parse(staffPayload));
        setDragOverRow(null);
        return;
      } catch { /* déplacement de ligne : géré ci-dessous */ }
    }
    const from = parseInt(e.dataTransfer.getData('text/plain'));
    if (isNaN(from) || from === targetIdx) return;
    setRows(prev => {
      const arr = [...prev];
      const [moved] = arr.splice(from, 1);
      arr.splice(targetIdx, 0, moved);
      return arr;
    });
    setDragOverRow(null);
    setDraggingRow(null);
    dirty();
  };

  // ── Drop staff from sidebar OR HospitalStaffPicker ──
  const applyStaffToRow = (rowId, member) => {
    const targetRow = rows.find(row => row.id === rowId);
    if (spreadsheetMode === 'fixed' && targetRow?.fixedSlotId && !staffMatchesFixedRequirement(member, targetRow)) {
      toast.error(`${member.last_name || member.lastName || 'Ce personnel'} ne correspond pas à la fonction « ${targetRow.fixedFunctionName || 'requise'} ».`);
      return false;
    }
    updateRow(rowId, {
      userId:    member.id,
      firstName: member.first_name || member.firstName || '',
      lastName:  member.last_name  || member.lastName  || '',
      roleName:  resolveStaffFunction(member),
      jobTitleId: resolveStaffJobTitleId(member),
      phone:     member.phone || '',
      matricule: member.matricule || '',
      deptId:    member.dept_id || member.deptId || departmentId,
      isNew:     false,
    });
    // Personnel externe : la demande d'accord part toute seule à l'enregistrement.
    // Rien n'est bloqué ici — la ligne sera simplement teintée tant que le chef
    // propriétaire n'a pas répondu.
    if (staffRequiresLoan(member, departmentId)) {
      const ownerDepartmentName = resolveStaffDepartmentName(member);
      const departmentLabel = ownerDepartmentName ? ` (${ownerDepartmentName})` : '';
      toast(`Personnel externe${departmentLabel} — une demande d'accord partira à son chef à l'enregistrement. Le tableur reste enregistrable et envoyable.`, { icon: '🔔', duration: 5000 });
    }
    return true;
  };

  // ── Staff picker select (adds to first empty row or new row) ──
  const handlePickerSelect = (member) => {
    if (pickerRowId) {
      if (applyStaffToRow(pickerRowId, member)) {
        setPickerRowId(null);
        setPickerOpen(false);
      }
      return;
    }
    const emptyIdx = rows.findIndex(r => r.isNew || !r.userId);
    if (emptyIdx >= 0) {
      applyStaffToRow(rows[emptyIdx].id, member);
    } else {
      const row = emptyRow();
      setRows(prev => [...prev, row]);
      setTimeout(() => applyStaffToRow(row.id, member), 0);
    }
  };

  // Les données d'identité proviennent exclusivement de la fiche personnel.
  const startEdit = (id, key, val) => {
    setEditingCell({ id, key });
    setEditVal(val || '');
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const commitEdit = () => {
    if (!editingCell) return;
    updateRow(editingCell.id, { [editingCell.key]: editVal });
    setEditingCell(null);
  };

  // ── Save / Submit ──
  const saveDraft = async (silent = false) => {
    const validationErrors = [...periodErrors, ...fixedRosterErrors];
    if (validationErrors.length) {
      toast.error(`Modification non enregistrée : ${validationErrors[0]}`);
      return false;
    }
    const versionAtStart = saveVersion.current;
    // Les nouvelles lignes jaunes appartiennent encore à une proposition en
    // attente. Une sauvegarde directe du chef ne doit pas les accepter en bloc :
    // elles passent par les boutons d'acceptation/refus des propositions.
    const rowsToSave = canDirectEdit && ['submitted', 'active'].includes(schedule?.status)
      ? rows.filter(row => !row.isProposedNewRow)
      : rows;
    setSaving(true);
    try {
      if (canProposeChanges) {
        await scheduleBuilderAPI.proposeChanges(scheduleId, { rows, customCols, week_organization: weekOrganization, spreadsheetMode, fixedRoster: fixedSlots });
        if (saveVersion.current === versionAtStart) setIsDirty(false);
        if (!silent) toast.success('Proposition envoyée au chef de service');
        return true;
      }
      const res = await scheduleBuilderAPI.saveDraft(scheduleId, {
        rows: rowsToSave,
        customCols,
        week_organization: weekOrganization,
        spreadsheetMode,
        fixedRoster: spreadsheetMode === 'fixed' ? fixedSlots : [],
      });
      // Une modification intervenue pendant la requête reste marquée à sauvegarder.
      if (saveVersion.current === versionAtStart) setIsDirty(false);
      qc.invalidateQueries({ queryKey: ['schedule-detail', scheduleId] });
      qc.invalidateQueries({ queryKey: ['staff-loans'] });
      if (!silent) {
        const waiting = res?.data?.data?.pendingExternal?.length || 0;
        const savedLabel = schedule?.status === 'draft' ? 'Brouillon enregistré' : 'Planning mis à jour';
        if (waiting) toast.success(`${savedLabel} — ${waiting} agent${plur(waiting)} d'un autre service en attente de l'accord de leur chef`);
        else toast.success(savedLabel);
      }
      return true;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Impossible d\'enregistrer les modifications. Vérifiez la connexion au serveur.');
      return false;
    } finally { setSaving(false); }
  };

  // Sauvegarde automatique en brouillon : les modifications ne sont jamais perdues.
  useEffect(() => {
    if (!isDirty || saving || schedule?.status !== 'draft') return undefined;
    const timer = setTimeout(() => saveDraft(true), 1200);
    return () => clearTimeout(timer);
  }, [isDirty, rows, customCols, weekOrganization, spreadsheetMode, fixedSlots]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmSubmit = async () => {
    if (!confirm('Envoyer ce planning au surveillant du service ? Cette action est définitive.')) return;
    if (isDirty && !(await saveDraft(false))) return;
    setSubmitting(true);
    try {
      await scheduleBuilderAPI.submit(scheduleId, { status: 'submitted' });
      toast.success('Planning envoyé !');
      setIsDirty(false);
      qc.invalidateQueries(['schedule-detail', scheduleId]);
    } catch { toast.error('Erreur lors de l\'envoi'); }
    finally { setSubmitting(false); }
  };

  const cancelSubmission = async () => {
    const reason = window.prompt('Motif obligatoire de l’annulation :');
    if (!reason?.trim()) return;
    try {
      await scheduleBuilderAPI.cancelSubmission(scheduleId, reason.trim());
      toast.success('Envoi annulé : les surveillants ont été informés.');
      qc.invalidateQueries({ queryKey: ['schedule-detail', scheduleId] });
    } catch (err) { toast.error(err.response?.data?.message || 'Impossible d’annuler l’envoi.'); }
  };

  // ── Context menu handler ──
  const openContextMenu = (e, idx) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, rowIdx: idx });
  };

  // ── Loading / empty ──
  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--gs-ink-faint)' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--gs-rule)', borderTopColor: 'var(--gs-seal)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 14px' }} />
        Chargement du tableur...
      </div>
    );
  }
  if (!schedule) return <div style={{ textAlign: 'center', padding: 40 }}>Planning introuvable</div>;

  const statusMeta = STATUS_META[schedule.status] || { label: schedule.status, tone: 'neutral' };
  const startKey = dateKey(schedule.start_date);
  const endKey = dateKey(schedule.end_date);
  const todayKey = dateKey(new Date());
  return (
    <div className="smart-spreadsheet" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* ══ EN-TÊTE DU PLANNING ══════════════════════════════════════════
          Ce dont on parle, dans quel état c'est, ce que ça pèse — puis le
          ruban du mois, qui répond à « chaque journée est-elle couverte ? ». */}
      <PlanningHero
        onBack={onBack}
        backLabel="Retour aux plannings"
        eyebrow={`${frenchSpan(startKey, endKey)} · Planning de garde`}
        kindLabel={isWeekendHolidaySchedule ? 'Week-ends & jours fériés' : null}
        title={schedule.name}
        statusLabel={statusMeta.label}
        statusTone={statusMeta.tone}
        dirtyLabel={isDirty ? '● Modifications non enregistrées' : null}
        range={frenchRange(startKey, endKey)}
        quantities={[
          { label: isWeekendHolidaySchedule ? 'Dates retenues' : 'Jours couverts', value: days.length, unit: isWeekendHolidaySchedule ? 'dates' : 'jours' },
          // « Personnel affecté », pas « Personnel » : le tableau de bord du
          // service annonce son effectif juste au-dessus, avec le même mot pour
          // un autre nombre. Ici on compte les agents inscrits à ce planning.
          { label: 'Personnel affecté', value: stats.staff, unit: 'pers.' },
          { label: 'Journées de service', value: stats.total, tone: 'duty' },
          { label: 'Moyenne par personne', value: stats.avg, unit: 'j.' },
          ...(minGuardCount ? [{ label: 'Effectif minimum', value: minGuardCount, unit: '/ jour' }] : []),
        ]}
        notices={
          <>
            {periodErrors.length > 0 && (
              <div className="gs-hero-notice is-alert">
                <strong>Période invalide —</strong>&nbsp;{periodErrors[0]}
                {periodErrors.length > 1 && ` (+${periodErrors.length - 1} autre${periodErrors.length > 2 ? 's' : ''})`}
              </div>
            )}
            {pendingExternalCount > 0 && (
              <div className="gs-hero-notice is-wait">
                <strong>{pendingExternalCount} agent{plur(pendingExternalCount)} d’un autre service</strong>&nbsp;{pendingExternalCount > 1 ? 'attendent' : 'attend'} l’accord de {pendingExternalCount > 1 ? 'leur' : 'son'}
                chef. Les lignes concernées sont teintées ; vous pouvez enregistrer et envoyer ce planning normalement —
                en cas de refus, seule la ligne concernée sera retirée.
              </div>
            )}
          </>
        }
        actions={
          <>
            <ExportMenu onExport={downloadScheduleExport} />
            {['service_supervisor', 'department_head'].includes(user?.roleCode) && ['submitted', 'active'].includes(schedule?.status) && (
              <button className="smart-spreadsheet__notify gs-btn is-quiet"
                type="button"
                onClick={handleNotifySG}
                disabled={notifyingSG}
                title="Envoyer une notification au Surveillant Général pour consultation et suggestions"
              >
                {notifyingSG ? 'Envoi…' : 'Transmettre au SG'}
              </button>
            )}
            <button className="smart-spreadsheet__add-staff gs-btn is-primary" type="button" onClick={() => setPickerOpen(true)}>
              <IcoUsers /> Ajouter du personnel
            </button>
          </>
        }
      >
        {(viewMode === 'table' || viewMode === 'fixed') && (
          <MonthRibbon
            days={days}
            rows={rows}
            isOnDuty={(row, key) => rowIsOnDuty(row, key, dutyContext)}
            dateKey={dateKey}
            holidays={publicHolidays}
            minStaff={minGuardCount}
            todayKey={todayKey}
            isSpecial={isWeekendHolidaySchedule}
            onOpenRow={rowId => setPeriodPicker({ rowId })}
          />
        )}
      </PlanningHero>

      {/* ══ BARRE D'OUTILS DU TABLEAU ════════════════════════════════════
          Ce qui agit sur la lecture du tableau, et rien d'autre. */}
      <div className="smart-spreadsheet__toolbar">
        <div className="smart-spreadsheet__search">
          <span className="smart-spreadsheet__search-icon" aria-hidden="true"><IcoSearch /></span>
          <input className="smart-spreadsheet__search-input"
            value={filter.search}
            onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
            aria-label="Chercher une personne dans le tableau"
            placeholder="Chercher une personne…" />
        </div>

        {roles.length > 0 && (
          <select className="smart-spreadsheet__role-filter" value={filter.role}
            aria-label="Filtrer par fonction"
            onChange={e => setFilter(f => ({ ...f, role: e.target.value }))}>
            <option value="">Toutes les fonctions</option>
            {roles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        )}

        {(filter.search || filter.role) && (
          <span className="smart-spreadsheet__filter-count">
            {filteredRows.length} / {rows.length} ligne{rows.length > 1 ? 's' : ''}
          </span>
        )}

        <div className="smart-spreadsheet__toolbar-end">
          <button className={`smart-spreadsheet__tool-button ${showColPanel ? 'is-on' : ''}`} type="button"
            aria-expanded={showColPanel}
            onClick={() => setShowColPanel(v => !v)}>
            Colonnes{hiddenCols.size > 0 ? ` (${hiddenCols.size} masquée${hiddenCols.size > 1 ? 's' : ''})` : ''}
          </button>
          <button className="smart-spreadsheet__add-column" type="button"
            onClick={() => { setShowAddCol(true); setNewColName(''); setNewColType('text'); }}>
            <IcoPlus /> Colonne
          </button>
        </div>
      </div>

      {/* ══ ADD COLUMN MODAL ═══════════════════════════════════════════════ */}
      {showAddCol && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-overlay)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowAddCol(false)}>
          <div style={{ background: 'var(--gs-paper)', borderRadius: 16, padding: 28, width: 340, boxShadow: 'var(--gs-shadow-lift)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 18px', fontSize: 16, fontWeight: 800 }}>＋ Nouvelle colonne</h3>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gs-ink-faint)' }}>Nom de la colonne *</span>
              <input autoFocus value={newColName} onChange={e => setNewColName(e.target.value)}
                placeholder="Ex: Service, Grade, Note..."
                style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--gs-rule)', fontSize: 13, background: 'var(--gs-paper-alt)', color: 'var(--gs-ink)', outline: 'none' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 20 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gs-ink-faint)' }}>Type</span>
              <select value={newColType} onChange={e => setNewColType(e.target.value)}
                style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--gs-rule)', fontSize: 13, background: 'var(--gs-paper-alt)', color: 'var(--gs-ink)', cursor: 'pointer', outline: 'none' }}>
                <option value="text">Texte</option>
                <option value="number">Nombre</option>
                <option value="time">Heure (HH:MM)</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAddCol(false)} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--gs-rule)', background: 'transparent', color: 'var(--gs-ink-soft)', cursor: 'pointer', fontWeight: 600 }}>Annuler</button>
              <button disabled={!newColName.trim()} onClick={() => {
                if (!newColName.trim()) return;
                const key = `custom_${Date.now()}`;
                setCustomCols(prev => [...prev, { key, label: newColName.trim(), type: newColType, w: 110 }]);
                setRows(prev => prev.map(r => ({ ...r, custom: { ...(r.custom || {}), [key]: '' } })));
                setShowAddCol(false);
                dirty();
              }} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: newColName.trim() ? 'var(--gs-seal)' : 'var(--gs-rule-strong)', color: '#fff', cursor: newColName.trim() ? 'pointer' : 'not-allowed', fontWeight: 700 }}>Ajouter</button>
            </div>
          </div>
        </div>
      )}

      {/* Column visibility panel */}
      {showColPanel && (
        <div className="smart-spreadsheet__column-panel" style={{ display: 'flex', gap: 8, padding: '8px 14px', background: 'var(--gs-paper-alt)', borderBottom: '1px solid var(--gs-rule)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gs-ink-faint)' }}>Colonnes :</span>
          {activeFixedCols.map(c => {
            const vis = !hiddenCols.has(c.key);
            return (
              <button key={c.key} onClick={() => {
                setHiddenCols(prev => {
                  const next = new Set(prev);
                  if (next.has(c.key)) next.delete(c.key);
                  else next.add(c.key);
                  return next;
                });
              }} style={{
                padding: '4px 10px', borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: 'pointer',
                border: `1px solid ${vis ? 'var(--gs-seal)' : 'var(--gs-rule)'}`,
                background: vis ? 'var(--gs-seal-wash)' : 'transparent',
                color: vis ? 'var(--gs-seal)' : 'var(--gs-ink-faint)',
              }}>
                {vis ? '✓ ' : ''}{c.label}
              </button>
            );
          })}
          {hiddenCols.size > 0 && (
            <button onClick={() => setHiddenCols(new Set())} style={{ ...btnGhost, fontSize: 10 }}>Tout afficher</button>
          )}
        </div>
      )}
      {/* ══ BANNIÈRE CONSULTATION SURVEILLANT GÉNÉRAL ════════════════════
          Un avis, pas une alerte : ce bandeau ne fait que rappeler au
          surveillant général ce qu'il peut faire ici. Le dégradé violet, le
          filet de 2 px et l'œil 👁️ en faisaient l'élément le plus voyant d'un
          document dont le sujet est ailleurs. */}
      {user?.roleCode === 'general_supervisor' && (
        <div className="smart-spreadsheet__consultation-banner" style={{
          margin: '10px 14px', padding: '10px 13px', borderRadius: 10,
          background: 'var(--gs-paper-alt)',
          border: '1px dashed var(--gs-rule-strong)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10
        }}>
          <div>
            <div style={{ fontFamily: 'var(--gs-display)', fontSize: 12.5, fontWeight: 700, color: 'var(--gs-ink)' }}>
              Consultation et suggestions — surveillant général
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--gs-ink-soft)', marginTop: 2 }}>
              Vous consultez ce planning. Vos propositions de modification partent aussitôt au chef de service, qui les valide.
            </div>
          </div>
        </div>
      )}

      {/* ══ BANNIÈRE PROPOSITION SURVEILLANT ════════════════════════════ */}
      {/* La vue combinée n'est pas une quatrième couleur : c'est l'institution
          qui regarde tout le monde à la fois, donc le sceau. Chaque proposition
          prise séparément garde la teinte de son auteur. */}
      {pendingProposals.length > 0 && (
        <div className="smart-spreadsheet__proposal-banner" style={{
          margin: '10px 14px', padding: '14px 18px', borderRadius: 12,
          background: activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1)
            ? 'var(--gs-seal-wash)'
            : activePalette.bg,
          border: `2px solid ${activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? 'var(--gs-seal)' : activePalette.border}`,
          boxShadow: 'var(--gs-shadow-card)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12
        }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? 'var(--gs-seal)' : activePalette.text }}>
              <span style={{ fontSize: 16 }}>{activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? '●' : activePalette.dot}</span>
              <span>
                {pendingProposals.length > 1
                  ? `${pendingProposals.length} propositions de modification en attente`
                  : `Proposition de modification reçue de ${pendingProposal.first_name} ${pendingProposal.last_name} (${pendingProposal.proposer_role || 'Surveillant'})`}
              </span>
              <span style={{ padding: '2px 8px', borderRadius: 12, background: activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? 'var(--gs-seal-wash)' : activePalette.badgeBg, border: `1px solid ${activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? 'var(--gs-seal)' : activePalette.borderDark}`, fontSize: 10, fontWeight: 800, color: activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? 'var(--gs-seal)' : activePalette.textDark }}>
                {pendingProposals.length > 1 ? (activeProposalId === 'all' || !activeProposalId ? 'Vue Combinée (Toutes)' : `Filtre: ${pendingProposal.first_name} ${pendingProposal.last_name}`) : 'En attente de décision'}
              </span>
            </div>

            {/* Onglets si plusieurs propositions */}
            {pendingProposals.length > 1 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gs-ink-soft)' }}>Mode d'affichage :</span>

                {/* Tab vue combinée */}
                <button
                  type="button"
                  onClick={() => setActiveProposalId('all')}
                  style={{
                    padding: '4px 12px', borderRadius: 14, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                    border: `1.5px solid ${activeProposalId === 'all' || !activeProposalId ? 'var(--gs-seal)' : 'var(--gs-rule-strong)'}`,
                    background: activeProposalId === 'all' || !activeProposalId ? 'var(--gs-seal-wash)' : 'var(--gs-paper)',
                    color: 'var(--gs-seal)',
                    boxShadow: activeProposalId === 'all' || !activeProposalId ? 'var(--gs-shadow-card)' : 'none',
                    display: 'flex', alignItems: 'center', gap: 5
                  }}
                >
                  <span>●</span>
                  <span>Toutes les propositions ({pendingProposals.length}) — Vue Combinée</span>
                </button>

                {/* Tabs individuels */}
                {proposalsWithPalettes.map(prop => {
                  const isSel = activeProposalId === prop.id;
                  const pal = prop.palette;
                  return (
                    <button
                      key={prop.id}
                      type="button"
                      onClick={() => setActiveProposalId(prop.id)}
                      style={{
                        padding: '4px 12px', borderRadius: 14, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        border: `1.5px solid ${isSel ? pal.borderDark : pal.border}`,
                        background: isSel ? pal.badgeBg : pal.bg,
                        color: pal.textDark,
                        boxShadow: isSel ? 'var(--gs-shadow-card)' : 'none',
                        display: 'flex', alignItems: 'center', gap: 5
                      }}
                    >
                      <span>{pal.dot}</span>
                      <span>{prop.proposerName} ({prop.roleTitle})</span>
                    </button>
                  );
                })}
              </div>
            )}

            {pendingProposal.comment && (
              <div style={{ fontSize: 11, color: activePalette.textDark, marginTop: 4, fontStyle: 'italic' }}>
                💬 Note : "{pendingProposal.comment}"
              </div>
            )}
            <div style={{ fontSize: 11, color: activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? 'var(--gs-seal)' : activePalette.text, marginTop: 4, fontWeight: 600 }}>
              💡 Chaque auteur a sa couleur propre. En cas de propositions multiples sur le même champ, la case s'affiche avec ⚡ (cliquez sur la case pour inspecter les propositions en conflit).
            </div>
          </div>

          {user?.roleCode === 'department_head' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Bouton ACCEPTER TOUT si plusieurs propositions */}
              {pendingProposals.length > 1 && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setDecidingProposal(true);
                      await scheduleBuilderAPI.decideAllProposals(scheduleId, { decision: 'accepted' });
                      toast.success(`✓ Les ${pendingProposals.length} propositions ont été acceptées et appliquées !`);
                      refreshProposalData();
                    } catch (err) {
                      toast.error(err.response?.data?.message || 'Erreur lors de la décision générale');
                    } finally {
                      setDecidingProposal(false);
                    }
                  }}
                  disabled={decidingProposal}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: 'none',
                    background: 'var(--gs-duty)', color: '#fff',
                    fontWeight: 900, fontSize: 12, cursor: 'pointer', boxShadow: 'var(--gs-shadow-card)',
                    display: 'flex', alignItems: 'center', gap: 6
                  }}
                >
                  ⚡ Accepter tout ({pendingProposals.length})
                </button>
              )}

              {/* Bouton Approuver la proposition active */}
              <button
                type="button"
                onClick={async () => {
                  try {
                    setDecidingProposal(true);
                    await scheduleBuilderAPI.decideProposal(scheduleId, pendingProposal.id, { decision: 'accepted' });
                    resolveProposalLocally(pendingProposal.id, 'accepted');
                    toast.success(pendingProposals.length > 1 ? `✓ Proposition de ${pendingProposal.first_name} acceptée !` : '✓ Proposition acceptée et appliquée au planning !');
                    refreshProposalData();
                  } catch (err) {
                    toast.error(err.response?.data?.message || 'Erreur lors de la décision');
                  } finally {
                    setDecidingProposal(false);
                  }
                }}
                disabled={decidingProposal}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: 'var(--gs-duty)', color: '#fff',
                  fontWeight: 800, fontSize: 12, cursor: 'pointer', boxShadow: 'var(--gs-shadow-card)',
                  display: 'flex', alignItems: 'center', gap: 6
                }}
              >
                ✓ {pendingProposals.length > 1 ? 'Accepter cette proposition' : 'Approuver la proposition'}
              </button>

              {/* Bouton Rejeter tout si plusieurs propositions */}
              {pendingProposals.length > 1 && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setDecidingProposal(true);
                      await scheduleBuilderAPI.decideAllProposals(scheduleId, { decision: 'rejected' });
                      toast.success('Toutes les propositions ont été refusées.');
                      refreshProposalData();
                    } catch (err) {
                      toast.error(err.response?.data?.message || 'Erreur lors du refus');
                    } finally {
                      setDecidingProposal(false);
                    }
                  }}
                  disabled={decidingProposal}
                  style={{
                    padding: '8px 14px', borderRadius: 8, border: '1px solid var(--gs-alert)',
                    background: 'var(--gs-alert-wash)', color: 'var(--gs-alert)',
                    fontWeight: 800, fontSize: 12, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6
                  }}
                >
                  ✕ Rejeter tout ({pendingProposals.length})
                </button>
              )}

              {/* Bouton Rejeter la proposition active */}
              {pendingProposals.length === 1 && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setDecidingProposal(true);
                      await scheduleBuilderAPI.decideProposal(scheduleId, pendingProposal.id, { decision: 'rejected' });
                      resolveProposalLocally(pendingProposal.id, 'rejected');
                      toast.success('Proposition refusée.');
                      refreshProposalData();
                    } catch (err) {
                      toast.error(err.response?.data?.message || 'Erreur lors du refus');
                    } finally {
                      setDecidingProposal(false);
                    }
                  }}
                  disabled={decidingProposal}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: `1px solid ${activePalette.borderDark}`,
                    background: activePalette.bg, color: activePalette.textDark,
                    fontWeight: 800, fontSize: 12, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6
                  }}
                >
                  ✕ Rejeter la proposition
                </button>
              )}
            </div>
          )}
        </div>
      )}


      {/* ══ ORGANISATION TEMPORELLE ══════════════════════════════════════
          Repliée par défaut : c'est un outil de découpage, pas une lecture. */}
      {viewMode !== 'history' && <div className="smart-spreadsheet__week-panel">
        <div className="smart-spreadsheet__week-header"><strong>Organisation temporelle</strong><span className="smart-spreadsheet__week-hint">Des groupes de dates pour vous repérer. Le service des agents n’est pas modifié.</span><button type="button" className="smart-spreadsheet__week-toggle" aria-expanded={showWeekOrganization} onClick={() => setShowWeekOrganization(v => !v)}>{showWeekOrganization ? 'Masquer' : 'Organiser les semaines'}</button></div>
        {weekOrganization.length > 0 && <div className="smart-spreadsheet__week-chips">{weekOrganization.map((group, index) => <span key={group.id || index} style={{ '--group-color': group.color || WEEK_GROUP_DEFAULT }}>{group.name} · {shortFrenchDate(group.startDate)} → {shortFrenchDate(group.endDate, true)}</span>)}</div>}
        {showWeekOrganization && <div className="smart-spreadsheet__week-editor">{weekOrganization.map((group, index) => <div className="smart-spreadsheet__week-row" key={group.id || index}><input type="color" aria-label="Couleur du groupe" value={group.color || WEEK_GROUP_DEFAULT} onChange={e => { setWeekOrganization(items => items.map((item, i) => i === index ? { ...item, color: e.target.value } : item)); dirty(); }} /><input value={group.name || ''} aria-label="Nom du groupe" onChange={e => { setWeekOrganization(items => items.map((item, i) => i === index ? { ...item, name: e.target.value } : item)); dirty(); }} placeholder="Semaine A" style={weekInputStyle} /><input type="date" aria-label="Début du groupe" value={group.startDate || ''} onChange={e => { setWeekOrganization(items => items.map((item, i) => i === index ? { ...item, startDate: e.target.value } : item)); dirty(); }} style={weekInputStyle} /><input type="date" aria-label="Fin du groupe" value={group.endDate || ''} onChange={e => { setWeekOrganization(items => items.map((item, i) => i === index ? { ...item, endDate: e.target.value } : item)); dirty(); }} style={weekInputStyle} /><button type="button" className="smart-spreadsheet__week-remove" title="Supprimer ce groupe" onClick={() => { setWeekOrganization(items => items.filter((_, i) => i !== index)); dirty(); }}>×</button></div>)}<button type="button" className="smart-spreadsheet__week-add" onClick={() => { setWeekOrganization(items => [...items, { id: `week-${Date.now()}`, name: `Semaine ${String.fromCharCode(65 + items.length)}`, startDate: dateKey(schedule.start_date), endDate: dateKey(schedule.end_date), color: WEEK_GROUP_COLORS[items.length % WEEK_GROUP_COLORS.length] }]); dirty(); }}>Ajouter un groupe de dates</button></div>}
      </div>}
      {/* ══ RAIL DES VUES ════════════════════════════════════════════════
          Un seul rail, un seul état actif : la vue courante est soulignée
          plutôt que remplie de quatre couleurs différentes. */}
      <nav className="smart-spreadsheet__view-tabs" aria-label="Vues du planning">
        <button className={`smart-spreadsheet__view-tab ${viewMode === 'table' ? 'is-active is-standard' : ''}`} type="button" aria-current={viewMode === 'table' ? 'page' : undefined} onClick={() => switchSpreadsheetMode('standard')}>Tableur</button>
        {user?.roleCode === 'department_head' && (
          <button className={`smart-spreadsheet__view-tab ${viewMode === 'fixed' ? 'is-active is-fixed' : ''}`} type="button" aria-current={viewMode === 'fixed' ? 'page' : undefined} onClick={() => switchSpreadsheetMode('fixed')}>Tableur fixe</button>
        )}
        {!isWeekendHolidaySchedule && <button className={`smart-spreadsheet__view-tab ${viewMode === 'calendar' ? 'is-active is-calendar' : ''}`} type="button" aria-current={viewMode === 'calendar' ? 'page' : undefined} onClick={() => setViewMode('calendar')}>Calendrier synthétique</button>}
        <button className={`smart-spreadsheet__view-tab ${viewMode === 'detailed' ? 'is-active is-calendar' : ''}`} type="button" aria-current={viewMode === 'detailed' ? 'page' : undefined} onClick={() => setViewMode('detailed')}>Calendrier détaillé</button>
        <button className={`smart-spreadsheet__view-tab ${viewMode === 'history' ? 'is-active is-history' : ''}`} type="button" aria-current={viewMode === 'history' ? 'page' : undefined} onClick={() => setViewMode('history')}>Historique</button>
        <span className={`smart-spreadsheet__mode-chip ${spreadsheetMode === 'fixed' ? 'is-fixed' : ''}`}>
          Mode : {spreadsheetMode === 'fixed' ? 'tableur fixe' : 'tableur normal'}
        </span>
      </nav>

      {viewMode === 'fixed' && spreadsheetMode === 'fixed' && user?.roleCode === 'department_head' && (
        <FixedRosterPanel
          departmentId={schedule.department_id || departmentId}
          slots={fixedSlots}
          onSlotsChange={handleFixedSlotsChange}
          onTemplateLoaded={handleFixedSlotsChange}
          hasSavedSlots={fixedSlots.length > 0}
          disabled={!canDirectEdit}
          collapsed={fixedConfigCollapsed}
          onCollapsedChange={setFixedConfigCollapsed}
        />
      )}

      {viewMode !== 'history' && <div className={`smart-spreadsheet__period-strip ${isWeekendHolidaySchedule ? 'is-special' : ''}`}>
        <span className="smart-spreadsheet__period-label">{isWeekendHolidaySchedule ? 'Week-ends & jours fériés' : 'Période du planning'}</span>
        <span className="smart-spreadsheet__period-range">{frenchRange(startKey, endKey) || '—'}</span>
        <span className="smart-spreadsheet__period-note">{isWeekendHolidaySchedule ? `${days.length} date${plur(days.length)} retenue${plur(days.length)} : uniquement les week-ends et jours fériés configurés.` : 'Premier et dernier jour inclus.'}</span>
      </div>}

      {/* D'où vient ce calendrier : une note, pas un état. Le vert qu'elle
          portait est l'encre réservée au « de service ». */}
      {(viewMode === 'calendar' || viewMode === 'detailed') && spreadsheetMode === 'fixed' && (
        <div className="smart-spreadsheet__calendar-source" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderBottom: '1px solid var(--gs-rule)', background: 'var(--gs-paper-alt)', color: 'var(--gs-ink-soft)', fontSize: 10, fontWeight: 600 }}>
          Source du calendrier : tableur fixe · {calendarRows.length} agent{plur(calendarRows.length)} affecté{plur(calendarRows.length)} sur {fixedSlots.reduce((total, slot) => total + slot.quantity, 0)} poste{plur(fixedSlots.reduce((total, slot) => total + slot.quantity, 0))}
        </div>
      )}
      {viewMode === 'calendar' && <PeriodTimeline rows={calendarRows} start={schedule.start_date} end={schedule.end_date} />}
      {viewMode === 'detailed' && <DetailedCalendar rows={calendarRows} days={days} start={schedule.start_date} end={schedule.end_date} holidays={publicHolidays} weekOrganization={weekOrganization} isSpecialSchedule={isWeekendHolidaySchedule} />}
      {viewMode === 'history' && <ScheduleHistoryPanel scheduleId={scheduleId} />}

      {/* La coque en grille (`minmax(0, 1fr)`) empêche la largeur intrinsèque
          du tableau de remonter dans la mise en page de l'application : sans
          elle, le document entier débordait horizontalement sous ~1300 px. */}
      <div className="smart-spreadsheet__table-shell" style={{ display: viewMode === 'table' || viewMode === 'fixed' ? 'grid' : 'none' }}>
      <div className="smart-spreadsheet__table-viewport" style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <table className="smart-spreadsheet__table" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
          <colgroup>
            {/* poignée de déplacement */}
            <col style={{ width: 28 }} />
            {/* numéro de ligne */}
            <col style={{ width: 28 }} />
            {visibleCols.map(c => <col key={c.key} style={{ width: c.w }} />)}
            {customCols.map(c => <col key={c.key} style={{ width: c.w }} />)}
            {showDailyGrid && days.map(d => <col key={d.toISOString()} style={{ width: 36 }} />)}
            {/* actions de ligne */}
            <col style={{ width: 32 }} />
          </colgroup>

          {/* Header */}
          <thead className="smart-spreadsheet__table-head" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            {/* Column labels */}
            <tr>
              <th className="smart-spreadsheet__table-cell is-drag" style={{ ...thBase, width: 28 }} />
              <th className="smart-spreadsheet__table-cell is-index" style={{ ...thBase, width: 28 }}><span style={{ fontSize: 9 }}>#</span></th>
              {visibleCols.map(c => (
                <th className="smart-spreadsheet__table-cell" data-column={c.key} key={c.key} style={{ ...thBase, position: 'relative' }}>
                  {COL_HINTS[c.type]
                    ? <span title={COL_HINTS[c.type]}>{c.label}</span>
                    : c.label
                  }
                </th>
              ))}
              {/* Custom columns header with rename + delete */}
              {customCols.map(c => (
                <th className="smart-spreadsheet__table-cell" data-column={c.key} key={c.key} style={{ ...thBase, position: 'relative', minWidth: c.w }}>
                  {editingColHeader === c.key ? (
                    <input autoFocus value={colHeaderVal}
                      onChange={e => setColHeaderVal(e.target.value)}
                      onBlur={() => {
                        if (colHeaderVal.trim()) setCustomCols(prev => prev.map(col => col.key === c.key ? { ...col, label: colHeaderVal.trim() } : col));
                        setEditingColHeader(null);
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingColHeader(null); }}
                      style={{ width: '80%', fontSize: 10, padding: '2px 4px', border: '1px solid var(--gs-seal)', borderRadius: 3, background: 'var(--gs-ink)', color: 'var(--gs-paper)', outline: 'none' }} />
                  ) : (
                    <span style={{ cursor: 'text' }} onDoubleClick={() => { setEditingColHeader(c.key); setColHeaderVal(c.label); }}>
                      {c.label}
                    </span>
                  )}
                  <button onClick={() => {
                    setCustomCols(prev => prev.filter(col => col.key !== c.key));
                    setRows(prev => prev.map(r => { const { [c.key]: _, ...rest } = (r.custom || {}); return { ...r, custom: rest }; }));
                    dirty();
                  }} title="Supprimer cette colonne"
                    style={{ position: 'absolute', top: 1, right: 2, background: 'none', border: 'none', color: 'var(--gs-alert)', cursor: 'pointer', fontSize: 10, lineHeight: 1, padding: 0 }}>✕</button>
                </th>
              ))}
              {/* Le bandeau des jours est inversé — encre au fond, papier en
                  texte — pour tenir la grille sous les yeux quand on défile.
                  Le week-end s'allège au lieu de s'assombrir : c'est un jour
                  qui compte moins, pas un jour plus grave. */}
              {showDailyGrid && days.map(d => (
                <th className={`smart-spreadsheet__table-cell ${isWeekend(d) ? 'is-weekend' : ''}`} key={d.toISOString()} style={{
                  ...thBase,
                  background: isWeekend(d) ? 'var(--gs-ink-soft)' : 'var(--gs-ink)',
                  color: 'var(--gs-paper)',
                }}>
                  <div style={{ fontSize: 8, fontWeight: 700, lineHeight: 1, color: isWeekend(d) ? 'var(--gs-paper-alt)' : 'var(--gs-ink-faint)' }}>{DOW_FR[d.getDay()]}</div>
                  <div style={{ fontSize: 11, fontWeight: 900 }}>{d.getDate()}</div>
                </th>
              ))}
              {/* Colonne des actions de ligne : son en-tête n'a rien à annoncer
                  que la ligne ne dise déjà. Le ⚙ qui s'y trouvait était un
                  ornement — le nom reste, pour les lecteurs d'écran. */}
              <th className="smart-spreadsheet__table-cell is-actions" style={thBase} aria-label="Actions de ligne" />
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {filteredRows.map((row, ri) => {
              const isDragging = draggingRow === ri;
              const isOver = dragOverRow === ri;
              const rowProps = visibleCols.flatMap(c => getMultiCellProposals(row, c.key));
              const hasRowConflict = visibleCols.some(c => getMultiCellProposals(row, c.key).length > 1) ||
                customCols.some(c => getMultiCellProposals(row, c.key).length > 1) ||
                proposalShiftDates(row).some(d => getMultiShiftProposals(row, d).length > 1);
              const isRowProposedYellow = row.isProposedNewRow || rowProps.length > 0 ||
                customCols.some(c => getMultiCellProposals(row, c.key).length > 0) ||
                proposalShiftDates(row).some(d => getMultiShiftProposals(row, d).length > 0);

              const firstRowProp = rowProps[0];
              const rowPalette = firstRowProp ? firstRowProp.palette : activePalette;

              // Ligne d'un agent externe en attente de l'accord de son chef.
              // Teinte distincte, uniquement si aucune proposition ne colore déjà la ligne.
              const loanState = row.userId ? externalLoans[row.userId] : null;
              const showPendingExternal = loanState?.status === 'pending' && !hasRowConflict && !isRowProposedYellow;
              const pendingTitle = showPendingExternal
                ? `En attente de l'accord de ${loanState.ownerChiefName || 'son chef de service'}${loanState.ownerDepartmentName ? ` (${loanState.ownerDepartmentName})` : ''}. Le tableur s'enregistre et s'envoie normalement ; en cas de refus cette ligne sera retirée automatiquement.`
                : undefined;
              const baseBg = showPendingExternal
                ? PENDING_EXT.bg
                : ri % 2 === 0 ? 'var(--gs-paper)' : 'var(--gs-paper-alt)';

              return (
                <tr
                  className={`smart-spreadsheet__table-row ${isDragging ? 'is-dragging' : ''} ${isOver ? 'is-drop-target' : ''} ${hasRowConflict ? 'is-conflict' : ''} ${isRowProposedYellow ? 'is-proposed' : ''} ${showPendingExternal ? 'is-external' : ''}`}
                  key={row.id}
                  draggable
                  title={pendingTitle}
                  onDragStart={e => handleRowDragStart(e, ri)}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/json') ? 'copy' : 'move'; setDragOverRow(ri); }}
                  onDragLeave={() => setDragOverRow(null)}
                  onDrop={e => handleRowDrop(e, ri)}
                  onContextMenu={e => spreadsheetMode === 'fixed' ? e.preventDefault() : openContextMenu(e, ri)}
                  style={{
                    background: isOver
                      ? 'var(--gs-seal-wash)'
                      : hasRowConflict
                      ? 'var(--gs-alert-wash)'
                      : isRowProposedYellow
                      ? rowPalette.bg
                      : baseBg,
                    opacity: isDragging ? 0.4 : 1,
                    transition: 'background .1s',
                    outline: isOver ? '2px solid var(--gs-seal)' : hasRowConflict ? '2px dashed var(--gs-alert)' : isRowProposedYellow ? `1.5px solid ${rowPalette.borderDark}` : showPendingExternal ? `1.5px dashed ${PENDING_EXT.border}` : 'none',
                    boxShadow: isOver ? 'inset 0 0 0 2px color-mix(in srgb, var(--gs-seal) 18%, transparent)' : isRowProposedYellow ? `inset 0 0 0 1px ${rowPalette.badgeBg}` : 'none',
                  }}
                  onMouseEnter={e => { if (!isOver && !isDragging) e.currentTarget.style.background = isRowProposedYellow ? rowPalette.bgDark : showPendingExternal ? PENDING_EXT.bgDark : 'var(--gs-seal-wash)'; }}
                  onMouseLeave={e => { if (!isOver) e.currentTarget.style.background = isRowProposedYellow ? rowPalette.bg : baseBg; }}
                >
                  {/* Drag handle */}
                  <td className="smart-spreadsheet__table-cell is-drag" style={{ ...tdBase, cursor: 'grab', textAlign: 'center', color: isRowProposedYellow ? rowPalette.textDark : 'var(--gs-ink-faint)', paddingLeft: 4, background: isRowProposedYellow ? rowPalette.bgDark : undefined }}
                    onDragStart={e => handleRowDragStart(e, ri)}>
                    <IcoDrag />
                  </td>

                  {/* Row number */}
                  <td className="smart-spreadsheet__table-cell is-index" style={{ ...tdBase, textAlign: 'center', background: isRowProposedYellow ? rowPalette.bgDark : undefined }}>
                    <span style={{ fontSize: 9, fontWeight: isRowProposedYellow ? 800 : 400, color: isRowProposedYellow ? rowPalette.textDark : 'var(--gs-ink-faint)' }}>{ri + 1}</span>
                    {showPendingExternal && <span style={{ fontSize: 9, marginLeft: 2 }} aria-label="En attente d'accord">⏳</span>}
                    {row.fixedSlotId && <span title={`${row.fixedFunctionName}${row.fixedConstant ? ' · constante' : ' · ce planning'}`} style={{ display: 'block', marginTop: 2, color: row.fixedConstant ? 'var(--gs-duty)' : 'var(--gs-ink-soft)', fontSize: 8, fontWeight: 900 }}>F{Number(row.fixedPositionIndex) + 1}</span>}
                  </td>

                  {/* Info columns — fixed + time */}
                  {visibleCols.map(col => {
                    const isEd = editingCell?.id === row.id && editingCell?.key === col.key;
                    const val = row[col.key] || '';
                    const cellProps = getMultiCellProposals(row, col.key);
                    const hasProps = cellProps.length > 0;
                    const isConflict = cellProps.length > 1;
                    const topProp = cellProps[0];
                    const pal = topProp ? topProp.palette : activePalette;

                    const cellBg = isConflict
                      ? 'var(--gs-alert-wash)'
                      : hasProps ? pal.bgDark : undefined;

                    const cellBorder = isConflict
                      ? '2px dashed var(--gs-alert)'
                      : hasProps ? `1.5px solid ${pal.borderDark}` : undefined;

                    const tooltipTitle = isConflict
                      ? `⚡ CONFLIT : ${cellProps.length} propositions sur ce champ :\n` + cellProps.map(p => `${p.palette.dot} ${p.proposerName} (${p.roleTitle}) : "${p.proposedVal}"${p.comment ? ` (${p.comment})` : ''}`).join('\n') + `\n\nCliquez pour inspecter et choisir la valeur !`
                      : hasProps
                      ? `⚠️ Proposition (${topProp.proposerName} - ${topProp.roleTitle}) :\nActuel : ${topProp.originalVal}\nProposé : ${topProp.proposedVal}`
                      : undefined;

                    if (col.type === 'periods') {
                      const currentPeriods = normalizeRowPeriods(row, dateKey(schedule.start_date), dateKey(schedule.end_date));
                      const displayVal = hasProps ? (isConflict ? cellProps.map(p => p.proposedVal).join(' / ') : topProp.proposedVal) : periodsLabel(currentPeriods, true);
                      return (
                        <td className="smart-spreadsheet__table-cell" data-column={col.key} key={col.key} style={{ ...tdBase, background: cellBg, border: cellBorder }}>
                          <button type="button"
                            onClick={() => {
                              if (hasProps) {
                                setCellModalInfo({
                                  rowId: row.id,
                                  rowName: `${row.lastName} ${row.firstName}`.trim() || 'Personnel',
                                  colKey: col.key,
                                  colLabel: col.label,
                                  // `row.periods` est un tableau d'objets, pas
                                  // une chaîne : le passer tel quel à la fenêtre
                                  // la faisait planter au rendu — et l'exception
                                  // démontait tout le tableur (écran blanc). On
                                  // envoie la même lecture que la cellule.
                                  originalVal: periodsLabel(currentPeriods, true) || 'Non renseigné',
                                  proposals: cellProps,
                                  isShift: false
                                });
                              } else {
                                setPeriodPicker({ rowId: row.id });
                              }
                            }}
                            title={tooltipTitle}
                            style={{
                              width: '100%', padding: '4px 5px', borderRadius: 5, fontSize: 10, cursor: 'pointer', textAlign: 'left',
                              border: isConflict ? '1.5px solid var(--gs-alert)' : hasProps ? `1px solid ${pal.borderDark}` : '1px solid var(--gs-rule)',
                              background: isConflict ? 'var(--gs-alert-wash)' : hasProps ? pal.bgDark : 'var(--gs-paper-alt)',
                              color: isConflict ? 'var(--gs-alert)' : hasProps ? pal.textDark : val ? 'var(--gs-ink)' : 'var(--gs-ink-faint)',
                              fontWeight: hasProps ? 800 : 500
                            }}>
                            {/* Le marqueur ne sert qu'à signaler une proposition
                                ou un conflit. Le 📅 qu'il portait sinon répétait
                                le nom de la colonne sur chacune des lignes. */}
                            {displayVal || 'Choisir les périodes'}{isConflict ? ' ⚡' : hasProps ? ` ${pal.dot}` : ''}
                          </button>
                        </td>
                      );
                    }
                    if (col.type === 'special-dates') {
                      const selectedDates = Object.entries(row.shifts || {}).filter(([, value]) => isMarked(value)).map(([date]) => dateKey(date));
                      const label = selectedDates.length === 0
                        ? 'Choisir les jours'
                        : `${selectedDates.length} jour${plur(selectedDates.length)} sélectionné${plur(selectedDates.length)}`;
                      return <td className="smart-spreadsheet__table-cell" data-column={col.key} key={col.key} style={{ ...tdBase, background: cellBg, border: cellBorder }}>
                        {/* Planning « week-ends et jours fériés » : les jours se
                            désignent un à un. Le bouton emprunte le ton du
                            cartouche qui annonce ce type de planning dans
                            l'en-tête, au lieu d'un ambre codé en dur. */}
                        <button type="button" onClick={() => setSpecialDatesPicker({ rowId: row.id })} title="Sélectionner un ou plusieurs week-ends / jours fériés" style={{ width: '100%', padding: '6px 7px', borderRadius: 6, border: hasProps ? `1px solid ${pal.borderDark}` : '1px solid color-mix(in srgb, var(--gs-alert) 38%, transparent)', background: hasProps ? pal.bgDark : 'var(--gs-alert-wash)', color: hasProps ? pal.textDark : 'var(--gs-alert)', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>
                          {label}
                        </button>
                      </td>;
                    }
                    if (col.type === 'time') {
                      const displayTime = hasProps ? (isConflict ? topProp.proposedVal : topProp.proposedVal) : (val || '07:00');
                      return (
                        <td className="smart-spreadsheet__table-cell" data-column={col.key} key={col.key} style={{ ...tdBase, background: cellBg, border: cellBorder }}
                          onClick={() => {
                            if (hasProps) {
                              setCellModalInfo({
                                rowId: row.id,
                                rowName: `${row.lastName} ${row.firstName}`.trim() || 'Personnel',
                                colKey: col.key,
                                colLabel: col.label,
                                originalVal: val || '07:00',
                                proposals: cellProps,
                                isShift: false
                              });
                            }
                          }}
                          title={tooltipTitle}>
                          <input type="time" value={displayTime} onChange={e => updateRow(row.id, { [col.key]: e.target.value })}
                            style={{ fontSize: 10, border: 'none', background: 'transparent', color: isConflict ? 'var(--gs-alert)' : hasProps ? pal.textDark : 'var(--gs-ink)', fontWeight: hasProps ? 800 : 400, cursor: 'pointer', padding: 0, width: '100%', outline: 'none' }} />
                        </td>
                      );
                    }
                    // Garde à domicile — une simple case à cocher, décochée par
                    // défaut. Cochée : astreinte à domicile ; décochée : garde à
                    // l'hôpital, en présence. La valeur est un booléen, pas un
                    // code : rien d'autre dans le tableur ne change.
                    //
                    // Le mot suffit : le 🏠 doublait « Domicile », et le violet
                    // qui l'accompagnait ne se rattachait à rien. Le ruban du
                    // mois marque déjà l'astreinte avec `--gs-duty` — même
                    // encre ici.
                    if (col.type === 'bool') {
                      const checked = row[col.key] === true;
                      return (
                        <td className="smart-spreadsheet__table-cell" data-column={col.key} key={col.key} style={{ ...tdBase, background: cellBg, border: cellBorder, textAlign: 'center' }}
                          title={tooltipTitle || (checked
                            ? 'Garde à domicile (astreinte) — décochez pour une garde à l’hôpital'
                            : 'Garde à l’hôpital, en présence — cochez pour une garde à domicile')}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: checked ? 'var(--gs-duty)' : 'var(--gs-ink-faint)' }}>
                            <input type="checkbox" checked={checked}
                              onChange={e => updateRow(row.id, { [col.key]: e.target.checked })}
                              style={{ width: 14, height: 14, cursor: 'pointer', accentColor: 'var(--gs-duty)', margin: 0 }} />
                            {checked ? 'Domicile' : 'Présence'}
                          </label>
                        </td>
                      );
                    }
                    const isPersonnelField = ['lastName', 'firstName', 'phone', 'matricule', 'roleName'].includes(col.key);
                    if (isPersonnelField) {
                      const isSearchCell = !row.userId && col.key === 'lastName';
                      const fixedFunctionDisplay = col.key === 'roleName' && row.fixedSlotId ? row.fixedFunctionName : null;
                      const displayPersonnelVal = fixedFunctionDisplay || (hasProps ? (isConflict ? `${topProp.proposedVal} (+${cellProps.length - 1})` : topProp.proposedVal) : val);
                      return (
                        <td className="smart-spreadsheet__table-cell" data-column={col.key} key={col.key} style={{ ...tdBase, position: 'relative', maxWidth: col.w, background: cellBg, border: cellBorder }}
                          title={tooltipTitle}
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => { const data = e.dataTransfer.getData('application/json'); if (data) { try { applyStaffToRow(row.id, JSON.parse(data)); } catch {} } }}
                          onClick={() => {
                            if (hasProps) {
                              setCellModalInfo({
                                rowId: row.id,
                                rowName: `${row.lastName} ${row.firstName}`.trim() || 'Personnel',
                                colKey: col.key,
                                colLabel: col.label,
                                originalVal: val || 'Non renseigné',
                                proposals: cellProps,
                                isShift: false
                              });
                            } else if (!row.userId) { setPickerRowId(row.id); setPickerOpen(true); }
                          }}>
                          {isSearchCell ? (
                            <>
                              <input value={personSearch?.rowId === row.id ? personSearch.value : ''}
                                onClick={e => e.stopPropagation()}
                                onChange={e => setPersonSearch({ rowId: row.id, value: e.target.value })}
                                placeholder="Rechercher..."
                                style={{ width: '100%', padding: '3px 4px', border: '1px solid var(--gs-seal)', borderRadius: 4, fontSize: 11, background: 'var(--gs-paper)', color: 'var(--gs-ink)', outline: 'none' }} />
                              {personSearch?.rowId === row.id && personSearch.value && (
                                <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, width: 260, maxHeight: 190, overflowY: 'auto', background: 'var(--gs-paper)', border: '1px solid var(--gs-rule)', borderRadius: 7, boxShadow: 'var(--gs-shadow-lift)' }}>
                                  {searchResults.map(member => <button key={member.id} onClick={e => { e.stopPropagation(); applyStaffToRow(row.id, member); setPersonSearch(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'transparent', color: 'var(--gs-ink)', cursor: 'pointer', fontSize: 11 }}>
                                    <strong>{member.last_name} {member.first_name}</strong>{' '}
                                    <span style={{ color: 'var(--gs-ink-faint)' }}>
                                      · {resolveStaffFunction(member) || 'Fonction non renseignée'}
                                      {member.matricule ? ` · ${member.matricule}` : ''}
                                    </span>
                                  </button>)}
                                </div>
                              )}
                            </>
                          ) : (
                            <span title={row.userId ? 'Information issue de la fiche personnel' : 'Cliquez pour choisir un membre du personnel'} style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: isConflict ? 'var(--gs-alert)' : hasProps ? pal.textDark : val ? 'var(--gs-ink)' : 'var(--gs-ink-faint)', fontWeight: hasProps ? 800 : 500 }}>
                              {displayPersonnelVal || 'Choisir...'} {fixedFunctionDisplay ? (row.fixedConstant ? '◆' : '◇') : isConflict ? `⚡ (${cellProps.length} props)` : row.isProposedNewRow ? `${pal.dot} (Nouveau)` : hasProps ? pal.dot : ''}
                            </span>
                          )}
                        </td>
                      );
                    }
                    return (
                      <td className="smart-spreadsheet__table-cell" data-column={col.key} key={col.key} style={{ ...tdBase, position: 'relative', maxWidth: col.w, background: cellBg, border: cellBorder }}
                        title={tooltipTitle}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          const data = e.dataTransfer.getData('application/json');
                          if (data) { try { applyStaffToRow(row.id, JSON.parse(data)); } catch {} }
                        }}
                        onClick={() => {
                          if (hasProps) {
                            setCellModalInfo({
                              rowId: row.id,
                              rowName: `${row.lastName} ${row.firstName}`.trim() || 'Personnel',
                              colKey: col.key,
                              colLabel: col.label,
                              originalVal: val || 'Non renseigné',
                              proposals: cellProps,
                              isShift: false
                            });
                          } else {
                            startEdit(row.id, col.key, val);
                          }
                        }}>
                        {isEd ? (
                          <input ref={inputRef} value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitEdit(); } if (e.key === 'Escape') setEditingCell(null); }}
                            style={{ width: '100%', padding: '2px 4px', border: '2px solid var(--gs-seal)', borderRadius: 4, fontSize: 11, background: 'var(--gs-paper)', color: 'var(--gs-ink)', outline: 'none' }} />
                        ) : (
                          <span style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text', color: isConflict ? 'var(--gs-alert)' : hasProps ? pal.textDark : val ? 'var(--gs-ink)' : 'var(--gs-ink-faint)', fontWeight: hasProps ? 800 : 400 }}>
                            {isConflict ? `${topProp.proposedVal} ⚡` : hasProps ? `${topProp.proposedVal} ${pal.dot}` : (val || (row.isNew && col.key === 'lastName' ? '⊕ Glisser...' : '—'))}
                          </span>
                        )}
                      </td>
                    );
                  })}

                  {/* Custom dynamic columns */}
                  {customCols.map(col => {
                    const val = (row.custom || {})[col.key] || '';
                    const isEd = editingCell?.id === row.id && editingCell?.key === col.key;
                    const propCustomVal = proposalMap?.mapByUserId[row.userId || row.id]?.custom?.[col.key];
                    const isYellow = propCustomVal !== undefined && String(propCustomVal).trim() !== String(val).trim();

                    return (
                      <td className="smart-spreadsheet__table-cell" data-column={col.key} key={col.key} style={{ ...tdBase, maxWidth: col.w, background: isYellow ? activePalette.bgDark : undefined, border: isYellow ? `1.5px solid ${activePalette.borderDark}` : undefined }}
                        title={isYellow ? `⚠️ Proposition du surveillant :\nActuel : ${val || '—'}\nProposé : ${propCustomVal}` : undefined}
                        onClick={() => startEdit(row.id, col.key, val)}>
                        {isEd ? (
                          <input ref={inputRef} type={col.type === 'number' ? 'number' : col.type === 'time' ? 'time' : 'text'}
                            value={editVal} onChange={e => setEditVal(e.target.value)}
                            onBlur={() => {
                              setRows(prev => prev.map(r => r.id === row.id ? { ...r, custom: { ...(r.custom || {}), [col.key]: editVal } } : r));
                              setEditingCell(null); dirty();
                            }}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
                            style={{ width: '100%', padding: '2px 4px', border: '2px solid var(--gs-seal)', borderRadius: 4, fontSize: 11, background: 'var(--gs-paper)', color: 'var(--gs-ink)', outline: 'none' }} />
                        ) : (
                          <span style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text', color: isYellow ? activePalette.textDark : val ? 'var(--gs-ink)' : 'var(--gs-ink-faint)', fontWeight: isYellow ? 800 : 400 }}>
                            {isYellow ? `${propCustomVal} ${activePalette.dot}` : (val || '—')}
                          </span>
                        )}
                      </td>
                    );
                  })}

                  {/* Day cells (masques dans la vue compacte) */}
                  {showDailyGrid && days.map(d => {
                    const dateStr = dateKey(d);
                    // Miroir de la règle serveur : dans un planning normal la case
                    // reflète la période d'affectation de la ligne et n'est pas
                    // cliquable ; dans un planning « week-ends et jours fériés »
                    // elle se coche au clic, seul moyen d'y désigner les jours.
                    const onDuty = rowIsOnDuty(row, dateStr, dutyContext);
                    const dayProposals = getMultiShiftProposals(row, dateStr);
                    const topShiftProp = dayProposals[0];
                    const isShiftConflict = dayProposals.length > 1;
                    const inPeriod = isWeekendHolidaySchedule || dateInRowPeriods(dateStr, row, dateKey(schedule.start_date), dateKey(schedule.end_date));
                    return (
                      <td className={`smart-spreadsheet__table-cell ${isWeekend(d) ? 'is-weekend' : ''} ${!inPeriod ? 'is-outside-period' : ''}`} key={dateStr} style={{
                        ...tdBase, padding: '4px 3px', textAlign: 'center',
                        borderLeft: isWeekend(d) ? '1px solid var(--gs-rule-strong)' : '1px solid var(--gs-rule)',
                        background: !inPeriod ? 'color-mix(in srgb, var(--gs-ink) 8%, transparent)' : topShiftProp ? (topShiftProp.palette?.bgDark || activePalette.bgDark) : isWeekend(d) && !onDuty ? 'color-mix(in srgb, var(--gs-ink) 4%, transparent)' : undefined,
                        opacity: inPeriod ? 1 : .38,
                      }}>
                        <DutyCell
                          onDuty={onDuty}
                          clickable={isWeekendHolidaySchedule && inPeriod}
                          isProposed={Boolean(topShiftProp)}
                          isConflict={isShiftConflict}
                          proposedOnDuty={topShiftProp?.proposedOnDuty}
                          proposerName={topShiftProp?.proposerName}
                          palette={topShiftProp?.palette}
                          onClick={() => {
                            if (dayProposals.length) {
                              setCellModalInfo({
                                rowId: row.id,
                                rowName: `${row.lastName} ${row.firstName}`.trim() || 'Personnel',
                                colKey: null,
                                colLabel: `Journée du ${dateStr}`,
                                originalVal: onDuty ? 'De service' : 'Pas de service',
                                proposals: dayProposals,
                                dateStr,
                                isShift: true,
                              });
                              return;
                            }
                            if (!inPeriod) return;
                            // Planning normal : la case n'est pas modifiable, c'est
                            // la période d'affectation qui décide. On ouvre donc
                            // directement son éditeur.
                            if (isWeekendHolidaySchedule) toggleDuty(row.id, dateStr);
                            else setPeriodPicker({ rowId: row.id });
                          }}
                        />
                      </td>
                    );
                  })}

                  {/* Row actions */}
                  <td className="smart-spreadsheet__table-cell is-actions" style={{ ...tdBase, textAlign: 'center', padding: '2px 4px' }}>
                    <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                      {!row.fixedSlotId && <button onClick={e => { e.stopPropagation(); duplicateRow(ri); }}
                        title="Dupliquer la ligne"
                        style={{ padding: '3px 4px', borderRadius: 4, border: 'none', background: 'var(--gs-seal-wash)', color: 'var(--gs-seal)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                        <IcoCopy />
                      </button>}
                      <button onClick={e => { e.stopPropagation(); removeRow(row.id); }}
                        title={row.fixedSlotId ? 'Vider ce poste' : 'Supprimer la ligne'}
                        style={{ padding: '3px 4px', borderRadius: 4, border: 'none', background: 'var(--gs-alert-wash)', color: 'var(--gs-alert)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                        <IcoTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {/* Empty state */}
            {filteredRows.length === 0 && (
              <tr>
                <td className="smart-spreadsheet__table-empty" colSpan={2 + visibleCols.length + customCols.length + (showDailyGrid ? days.length : 0) + 1} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--gs-ink-faint)', fontSize: 13 }}>
                  {filter.search || filter.role ? 'Aucun résultat pour ce filtre' : 'Tableau vide — cliquez "Ajouter du personnel" ou glissez depuis le panneau'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>

      {/* ══ ADD ROW BAR ══════════════════════════════════════════════════ */}
      {viewMode !== 'history' && spreadsheetMode !== 'fixed' && <div className="smart-spreadsheet__add-row-bar">
        <button type="button" className="gs-btn" onClick={() => addRow()} style={{ borderStyle: 'dashed' }}>
          <IcoPlus /> Ajouter une ligne
        </button>
      </div>}

      {/* ══ FOOTER ═══════════════════════════════════════════════════════
          L'état d'enregistrement ne se colore que lorsqu'il réclame un geste :
          « sauvegardé » est une non-nouvelle, elle reste en encre pâle. Le vert
          d'origine empruntait la couleur réservée à « de service ». */}
      {viewMode !== 'history' && <div className="smart-spreadsheet__action-bar">
        <div className="smart-spreadsheet__save-state">
          {isDirty
            ? <span className="is-dirty">● Modifications non enregistrées</span>
            : <span>✓ Tout est enregistré</span>}
        </div>

        <button type="button" className="gs-btn" onClick={() => saveDraft(false)}
          disabled={(!canDirectEdit && !canProposeChanges) || !isDirty || saving}>
          <IcoSave /> {saving ? 'Enregistrement…' : canProposeChanges ? 'Envoyer la proposition' : schedule.status === 'draft' ? 'Enregistrer le brouillon' : 'Enregistrer les modifications'}
        </button>

        {schedule.status === 'draft' && (
          <button type="button" className="gs-btn is-primary" onClick={confirmSubmit} disabled={submitting}>
            <IcoSend /> {submitting ? 'Envoi…' : 'Envoyer au surveillant du service'}
          </button>
        )}
        {canManageProposals && <button type="button" className="gs-btn" onClick={onManageProposals}>Gérer les propositions</button>}
        {canCancelSubmission && <button type="button" className="gs-btn is-danger" onClick={cancelSubmission}>Annuler l’envoi</button>}
      </div>}

      {/* ══ CONTEXT MENU ════════════════════════════════════════════════ */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          onAction={action => handleContextAction(action, contextMenu.rowIdx)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* ══ HOSPITAL STAFF PICKER ════════════════════════════════════════ */}
      <HospitalStaffPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePickerSelect}
        onDragStart={member => {
          // store in dataTransfer for drop on row
          window.__draggedStaff = member;
        }}
        ownDeptId={departmentId}
        title={pickerTargetRow?.fixedSlotId ? `Affecter : ${pickerTargetRow.fixedFunctionName}` : 'Ajouter du personnel'}
        excludeUserIds={existingUserIds}
        requiredJobTitleId={pickerTargetRow?.fixedJobTitleId || null}
        requiredFunctionName={pickerTargetRow?.fixedFunctionName || ''}
      />

      {/* ══ PERIOD DATE PICKER CALENDAR ════════════════════════════════ */}
      {periodPicker && (
        <MultiPeriodPicker
          row={rows.find(r => r.id === periodPicker.rowId)}
          min={dateKey(schedule?.start_date)}
          max={dateKey(schedule?.end_date)}
          onChange={(patch) => updateRow(periodPicker.rowId, isWeekendHolidaySchedule ? patch : { ...patch, shifts: {} })}
          onClose={() => setPeriodPicker(null)}
        />
      )}

      {specialDatesPicker && (
        <SpecialDatesPicker
          row={rows.find(r => r.id === specialDatesPicker.rowId)}
          allowedDays={days}
          holidays={publicHolidays}
          onChange={shifts => updateRow(specialDatesPicker.rowId, { shifts })}
          onClose={() => setSpecialDatesPicker(null)}
        />
      )}

      {/* ══ CELL PROPOSAL CONFLICT MODAL ════════════════════════════════ */}
      <CellProposalModal
        cellInfo={cellModalInfo}
        onClose={() => setCellModalInfo(null)}
        onApplyValue={handleApplyProposalValue}
      />

      {showImportModal && (
        <ImportModal
          departmentId={departmentId || schedule?.department_id}
          scheduleId={scheduleId}
          onClose={() => setShowImportModal(false)}
          onImported={() => {
            setShowImportModal(false);
            qc.invalidateQueries(['schedule-detail', scheduleId]);
            refetch?.();
          }}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────
// En-tête de tableau : encre sur papier, une seule épaisseur de filet. Le
// bandeau ardoise importé plus tôt jurait avec le reste de la plateforme.
const thBase = {
  padding: '8px 6px', fontSize: 9.5, fontWeight: 600, textAlign: 'center',
  background: 'var(--gs-paper-alt)', color: 'var(--gs-ink-faint)', position: 'sticky', top: 0, zIndex: 2,
  whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.1em',
  fontFamily: 'var(--gs-display)',
  borderRight: '1px solid var(--gs-rule)', borderBottom: '1px solid var(--gs-rule-strong)',
};
const tdBase = {
  padding: '5px 6px', fontSize: 11, borderBottom: '1px solid var(--gs-rule)',
  borderRight: '1px solid var(--gs-rule)', verticalAlign: 'middle',
};
const btnGhost = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px',
  borderRadius: 8, border: '1px solid var(--gs-rule-strong)',
  background: 'transparent', cursor: 'pointer', color: 'var(--gs-ink-soft)',
  fontFamily: 'var(--gs-body)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
};


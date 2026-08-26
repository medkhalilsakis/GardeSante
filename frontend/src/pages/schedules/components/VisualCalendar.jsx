/**
 * VisualCalendar — le tableau de garde, journée par journée
 * ════════════════════════════════════════════════════════
 *
 * Seconde lecture du même planning : le tableur montre une ligne par agent et sa
 * période de participation ; ce calendrier montre une colonne par journée et
 * répond à la question qu'on se pose devant un mois de garde — cette journée
 * est-elle tenue, et par qui. Sur un brouillon, une garde se déplace d'une
 * journée à l'autre au glisser-déposer.
 *
 * ── Comment l'écriture fonctionne ──────────────────────────────────────────
 * Il n'existe aucune API « par garde » : le tableau de garde
 * (`metadata.spreadsheet.rows`) est la seule source de vérité, et les gardes que
 * cet écran affiche sont une vue que le serveur en déduit. Un déplacement passe
 * donc par `saveDraft`, qui rejoue toutes les règles du tableur — congés,
 * périodes obligatoires, couverture du début et de la fin, accord du chef pour un
 * agent prêté. Aucune règle n'est réinventée ici : les refus du serveur sont
 * affichés tels qu'il les formule.
 *
 * ── Ce que le déplacement respecte ─────────────────────────────────────────
 * Une ligne du tableur exprime sa couverture de deux façons, et le déplacement
 * reste dans celle de la ligne qu'il touche :
 *   • ligne pilotée par ses cases (planning de week-ends / jours fériés, ligne
 *     importée) → on décoche la journée quittée, on coche la journée d'arrivée ;
 *   • ligne pilotée par sa période (le cas courant) → on opère sur les périodes :
 *     la journée quittée sort de sa période, qui se scinde si elle en occupait le
 *     milieu, et la journée d'arrivée devient une période d'un jour, fusionnée
 *     avec ses voisines si elles se touchent.
 * Cocher une case sur une ligne à périodes ferait basculer toute la ligne en
 * lecture « par cases » et effacerait le reste de sa couverture : c'est
 * précisément ce que la seconde branche évite.
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { scheduleBuilderAPI } from '../../../api';
import {
  dateParts, longFrenchDate, shortFrenchDate, fullFrenchDate,
  frenchRange, frenchSpan, frenchifyIsoDates,
} from '@/utils/frenchDates';
import './VisualCalendar.css';
import toast from 'react-hot-toast';

// ── Icônes ──────────────────────────────────────────────────────────────
const Ico = ({ d, s = 15 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const IcoLeft  = () => <Ico d="M15 18l-6-6 6-6" s={14} />;
const IcoRight = () => <Ico d="M9 18l6-6-6-6" s={14} />;
const IcoClose = () => <Ico d="M18 6L6 18M6 6l12 12" s={12} />;

const plur = (n) => (n > 1 ? 's' : '');

// ── Clés de date ────────────────────────────────────────────────────────
// Tout se compare en clés « YYYY-MM-DD ». Les colonnes DATE de PostgreSQL
// arrivent déjà sous cette forme (`TO_CHAR`) ; construire une `Date` dessus la
// ferait reculer d'un jour dans un fuseau positif. Les seuls calculs de
// calendrier passent par UTC, où aucun décalage n'existe.

const dateKey = (value) => {
  if (!value) return '';
  const direct = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return direct ? direct[0] : '';
};

/** Décale une clé de `delta` jours. */
const shiftDay = (key, delta) => {
  const p = dateParts(key);
  if (!p) return '';
  return new Date(Date.UTC(p.y, p.m - 1, p.d + delta)).toISOString().slice(0, 10);
};

/** Jour de la semaine d'une clé — 0 = dimanche. */
const dowOf = (key) => {
  const p = dateParts(key);
  if (!p) return 0;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
};

/** La journée en cours, dans le fuseau du navigateur. */
const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const DOW_FR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

/** Nombre de jours du mois qui contient cette journée. */
const monthLength = (key) => {
  const p = dateParts(key);
  if (!p) return 0;
  return new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
};

/** Le 1er du mois voisin, à `delta` mois de distance. */
const shiftMonth = (key, delta) => {
  const p = dateParts(key);
  if (!p) return '';
  return new Date(Date.UTC(p.y, p.m - 1 + delta, 1)).toISOString().slice(0, 10);
};

/**
 * La grille, toujours alignée sur un lundi. En semaine : les 7 jours de la
 * semaine de l'ancre. En mois : le mois entier de l'ancre, complété jusqu'aux
 * bords de ses semaines — donc 5 ou 6 lignes selon le calendrier, jamais un
 * bloc de 4 semaines qui laisserait tomber la fin du mois hors de l'écran.
 */
const gridDays = (anchor, viewMode) => {
  const week = viewMode === 'week';
  const from = week ? anchor : `${anchor.slice(0, 8)}01`;
  const dow = dowOf(from);
  const first = shiftDay(from, dow === 0 ? -6 : 1 - dow);
  const offset = (dow + 6) % 7;
  const length = week ? 7 : 7 * Math.ceil((offset + monthLength(anchor)) / 7);
  const today = todayKey();
  return Array.from({ length }, (_, i) => {
    const key = shiftDay(first, i);
    const d = dowOf(key);
    return {
      key,
      num: dateParts(key)?.d || 0,
      dowLabel: DOW_FR[d],
      isWeekend: d === 0 || d === 6,
      isToday: key === today,
    };
  });
};

// ── Lecture d'une ligne du tableur ──────────────────────────────────────
// Miroir exact de `backend/src/modules/schedules/spreadsheet-reader.js` : cet
// écran ne décide de rien, il doit seulement savoir laquelle des deux formes de
// couverture pilote la ligne qu'il va modifier.

/** Une case vaut-elle « de service » ? (« R » était l'ancien code Repos.) */
const isMarked = (value) => {
  if (value === true) return true;
  const text = String(value ?? '').trim();
  if (!text) return false;
  return text.charAt(0).toUpperCase() !== 'R';
};

/** Journées cochées d'une ligne, en clés lisibles. */
const rowMarkedDays = (row) => Object.entries(row?.shifts || {})
  .filter(([, value]) => isMarked(value))
  .map(([date]) => dateKey(date))
  .filter(Boolean);

/** Périodes d'une ligne, triées, dédoublonnées, en clés. */
const rowPeriods = (row, fallbackStart = '', fallbackEnd = '') => {
  const source = Array.isArray(row?.periods) && row.periods.length
    ? row.periods
    : [{ startDate: row?.periodStart || row?.period_start || fallbackStart, endDate: row?.periodEnd || row?.period_end || fallbackEnd }];
  const periods = source
    .map(p => ({
      startDate: dateKey(p?.startDate || p?.start || p?.periodStart || p?.period_start),
      endDate: dateKey(p?.endDate || p?.end || p?.periodEnd || p?.period_end),
    }))
    .filter(p => p.startDate && p.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  return periods.filter((p, i) => i === 0
    || p.startDate !== periods[i - 1].startDate
    || p.endDate !== periods[i - 1].endDate);
};

/** Retire une journée d'une liste de périodes : la période concernée se scinde. */
const withoutDay = (periods, day) => periods.flatMap(p => {
  if (day < p.startDate || day > p.endDate) return [p];
  const kept = [];
  if (p.startDate < day) kept.push({ startDate: p.startDate, endDate: shiftDay(day, -1) });
  if (p.endDate > day) kept.push({ startDate: shiftDay(day, 1), endDate: p.endDate });
  return kept;
});

/**
 * Ajoute une journée : période d'un jour, fusionnée avec ses voisines quand
 * elles se touchent. Le serveur refuse les périodes qui se chevauchent, et une
 * liste tronçonnée ne se lirait plus dans le tableur.
 */
const withDay = (periods, day) => [...periods, { startDate: day, endDate: day }]
  .sort((a, b) => a.startDate.localeCompare(b.startDate))
  .reduce((merged, p) => {
    const last = merged[merged.length - 1];
    if (last && p.startDate <= shiftDay(last.endDate, 1)) {
      if (p.endDate > last.endDate) last.endDate = p.endDate;
      return merged;
    }
    merged.push({ ...p });
    return merged;
  }, []);

// Une teinte stable par agent, prise dans l'échelle d'identité du système —
// celle de l'avatar et du tableur. Elle distingue, elle ne qualifie pas, et elle
// suit le thème clair ou sombre sans que ce fichier ait à le savoir. Les jetons
// sont écrits un par un, jamais assemblés, pour rester vérifiables.
const STAFF_TONES = [
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

const staffTone = (value) => {
  const source = String(value ?? 'agent');
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) - hash) + source.charCodeAt(i);
  return STAFF_TONES[Math.abs(hash) % STAFF_TONES.length];
};

const initials = (first, last) => `${String(first || '').charAt(0)}${String(last || '').charAt(0)}`.toUpperCase() || '?';
const shortName = (first, last) => `${first || ''} ${String(last || '').charAt(0)}${last ? '.' : ''}`.trim();
const fullName  = (first, last) => `${first || ''} ${last || ''}`.trim() || 'Cet agent';
const hhmm = (value) => String(value || '').slice(0, 5);

// ── Carte d'une garde ───────────────────────────────────────────────────
function ShiftCard({ shift, date, draggable, onRemove }) {
  const [dragging, setDragging] = useState(false);
  const name = fullName(shift.first_name, shift.last_name);
  const hours = shift.start_time && shift.end_time ? `${hhmm(shift.start_time)} → ${hhmm(shift.end_time)}` : '';
  const nature = shift.at_home ? 'à domicile' : '';

  return (
    <div
      className={`vc__shift${draggable ? ' is-draggable' : ''}${dragging ? ' is-dragging' : ''}${shift.at_home ? ' is-at-home' : ''}`}
      style={{ '--vc-tone': staffTone(shift.user_id) }}
      draggable={draggable}
      onDragStart={draggable ? (e) => {
        setDragging(true);
        e.dataTransfer.setData('application/json', JSON.stringify({
          type: 'move-shift', userId: shift.user_id, fromDate: date, name,
        }));
        e.dataTransfer.effectAllowed = 'move';
      } : undefined}
      onDragEnd={() => setDragging(false)}
      title={[name, shift.role_name, hours, nature].filter(Boolean).join(' · ')}
    >
      <span className="vc__dot">{initials(shift.first_name, shift.last_name)}</span>
      <span className="vc__shift-body">
        <span className="vc__shift-name">{shortName(shift.first_name, shift.last_name)}</span>
        {(hours || nature) && (
          <span className="vc__shift-meta">{[hours, nature].filter(Boolean).join(' · ')}</span>
        )}
      </span>
      {onRemove && (
        <button type="button" className="vc__drop-shift" onClick={() => onRemove()}
          aria-label={`Retirer la garde de ${name} le ${longFrenchDate(date)}`}>
          <IcoClose />
        </button>
      )}
    </div>
  );
}

// ── Colonne du personnel ────────────────────────────────────────────────
function StaffAside({ staff, counts, collapsed, onToggle, draggable }) {
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? staff.filter(s => `${s.firstName} ${s.lastName}`.toLowerCase().includes(needle))
    : staff;

  return (
    <div className={`vc__aside${collapsed ? ' is-collapsed' : ''}`}>
      <button type="button" className="vc__aside-toggle" onClick={onToggle}
        aria-label={collapsed ? 'Afficher le personnel' : 'Masquer le personnel'}>
        {collapsed ? <IcoRight /> : <IcoLeft />}
      </button>

      {!collapsed && (
        <>
          <div className="vc__aside-head">Personnel du planning ({staff.length})</div>
          <input type="search" className="vc__search" value={search}
            placeholder="Chercher un agent"
            onChange={e => setSearch(e.target.value)} />
          <div className="vc__staff">
            {shown.map(s => (
              <div key={s.id}
                className={`vc__member${draggable ? ' is-draggable' : ''}`}
                style={{ '--vc-tone': staffTone(s.id) }}
                draggable={draggable}
                onDragStart={draggable ? (e) => {
                  e.dataTransfer.setData('application/json', JSON.stringify({
                    type: 'assign-staff', userId: s.id, name: fullName(s.firstName, s.lastName),
                  }));
                  e.dataTransfer.effectAllowed = 'copy';
                } : undefined}
                title={draggable ? `Glisser ${fullName(s.firstName, s.lastName)} sur une journée pour l'y ajouter` : undefined}
              >
                <span className="vc__initials">{initials(s.firstName, s.lastName)}</span>
                <span className="vc__member-body">
                  <span className="vc__member-name">{fullName(s.firstName, s.lastName)}</span>
                  <span className="vc__member-meta">
                    {[s.roleName, `${counts[s.id] || 0} garde${plur(counts[s.id] || 0)}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </div>
            ))}
            {!shown.length && <div className="vc__hint">Aucun agent ne correspond.</div>}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// VisualCalendar
// ═══════════════════════════════════════════════════════════════════════
export default function VisualCalendar({ scheduleId, onBack }) {
  const qc = useQueryClient();
  const [viewMode, setViewMode] = useState('month');
  const [anchor, setAnchor] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [dropTarget, setDropTarget] = useState('');

  // Cette clé est partagée avec `SmartSpreadsheet` : les deux écrans lisent le
  // même planning, une seule requête les sert, et une écriture faite ici est
  // vue là-bas sans second aller-retour. Le prix du partage est la forme : une
  // entrée de cache n'en a qu'une, et c'est celle de l'occupant — la réponse
  // axios entière. La déballer ici donnerait une entrée que l'autre écran ne
  // sait pas lire, et l'écran qui monte en second resterait sur son voile de
  // chargement.
  const { data, isLoading, error } = useQuery({
    queryKey: ['schedule-detail', scheduleId],
    queryFn: () => scheduleBuilderAPI.getDetail(scheduleId),
    enabled: !!scheduleId,
  });

  const detail   = data?.data?.data || data?.data || data;
  const schedule = detail?.schedule;
  // Mémorisé : sans cela le tableau de repli `[]` est neuf à chaque rendu et
  // invalide les trois agrégats ci-dessous à chaque fois.
  const shifts   = useMemo(() => detail?.shifts || [], [detail]);
  const spanMin  = dateKey(schedule?.start_date);
  const spanMax  = dateKey(schedule?.end_date);

  // Un planning couvre presque toujours un mois à venir : s'ouvrir sur
  // « aujourd'hui » afficherait une grille vide. On s'ouvre donc sur la journée
  // en cours si elle est dans le planning, sur sa première journée sinon.
  useEffect(() => {
    if (!spanMin || anchor) return;
    const today = todayKey();
    setAnchor(today < spanMin ? spanMin : (spanMax && today > spanMax ? spanMax : today));
  }, [spanMin, spanMax, anchor]);

  // Un planning de week-ends / jours fériés ne se lit que par ses cases : sa
  // couverture n'est pas continue, et le serveur n'y accepte qu'un week-end ou
  // un jour férié.
  const isSpecialSchedule = schedule?.schedule_type === 'special_weekend_holiday'
    || schedule?.metadata?.schedule_kind === 'weekend_holiday'
    || schedule?.metadata?.special_days_only === true;

  // Le glisser-déposer ne s'ouvre que sur un brouillon. Un planning envoyé ou en
  // cours ne se réécrit pas : il se corrige par un remplacement, qui garde la
  // trace de qui a remplacé qui et quand. Ce brouillon-là est déjà privé à son
  // chef de service — le serveur refuse d'en montrer le détail à quiconque
  // d'autre —, la permission d'écriture suit donc celle de la lecture.
  const canEdit = schedule?.status === 'draft';

  const staff = useMemo(() => {
    const map = new Map();
    shifts.forEach(s => {
      if (map.has(s.user_id)) return;
      map.set(s.user_id, {
        id: s.user_id,
        firstName: s.first_name,
        lastName: s.last_name,
        roleName: s.role_name || s.grade || '',
      });
    });
    return [...map.values()].sort((a, b) => `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`, 'fr'));
  }, [shifts]);

  const counts = useMemo(() => shifts.reduce((acc, s) => {
    acc[s.user_id] = (acc[s.user_id] || 0) + 1;
    return acc;
  }, {}), [shifts]);

  const byDate = useMemo(() => shifts.reduce((acc, s) => {
    const key = dateKey(s.shift_date || s.shiftDate);
    if (!key) return acc;
    (acc[key] = acc[key] || []).push(s);
    return acc;
  }, {}), [shifts]);

  const days = useMemo(() => (anchor ? gridDays(anchor, viewMode) : []), [anchor, viewMode]);

  const onDutyAlready = useCallback(
    (userId, date) => (byDate[date] || []).some(s => String(s.user_id) === String(userId)),
    [byDate]
  );

  // ── Écriture ──────────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: ({ payload }) => scheduleBuilderAPI.saveDraft(scheduleId, payload),
    onSuccess: (res, { message }) => {
      const waiting = res?.data?.data?.pendingExternal?.length || 0;
      toast.success(waiting
        ? `${message} — ${waiting} agent${plur(waiting)} d'un autre service en attente de l'accord de leur chef`
        : message);
      qc.invalidateQueries({ queryKey: ['schedule-detail', scheduleId] });
      qc.invalidateQueries({ queryKey: ['staff-loans'] });
    },
    onError: (err) => {
      // Les refus du serveur sont écrits pour être lus : congé qui heurte la
      // garde, période obligatoire, début ou fin du planning découvert. On les
      // affiche tels quels, dates remises en français.
      toast.error(frenchifyIsoDates(err?.response?.data?.message
        || "Modification non enregistrée : vérifiez la connexion au serveur."));
    },
  });

  /**
   * Compose la sauvegarde complète du tableau de garde autour d'un seul
   * changement. `saveDraft` remplace l'intégralité du tableur : les colonnes
   * personnalisées, l'organisation des semaines, le mode et les postes fixes
   * doivent être renvoyés tels qu'ils sont enregistrés, sinon ils retombent à
   * leur valeur par défaut — c'est-à-dire qu'ils disparaissent.
   */
  const buildChange = useCallback(({ userId, name, addDate, removeDate }) => {
    const sheet = schedule?.metadata?.spreadsheet;
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : null;
    if (!rows?.length) {
      return { refusal: "Ce planning n'a pas encore de tableau de garde enregistré : ouvrez le tableur pour le composer." };
    }
    const index = rows.findIndex(r => String(r.userId || r.user_id || '') === String(userId));
    if (index < 0) {
      return { refusal: `${name} n'a pas de ligne dans le tableau de garde : ajoutez-le d'abord dans le tableur.` };
    }
    const outside = [addDate, removeDate].find(d => d && (d < spanMin || d > spanMax));
    if (outside) {
      return { refusal: `Le ${longFrenchDate(outside)} est hors du planning (${frenchRange(spanMin, spanMax)}).` };
    }

    const row = rows[index];
    let next;
    if (isSpecialSchedule || rowMarkedDays(row).length > 0) {
      const cells = { ...(row.shifts || {}) };
      // Une case enregistrée peut porter une clé ISO complète : on retire toutes
      // celles qui désignent la journée quittée, pas seulement la forme courte.
      if (removeDate) Object.keys(cells).forEach(k => { if (dateKey(k) === removeDate) delete cells[k]; });
      if (addDate) cells[addDate] = true;
      next = { ...row, shifts: cells };
    } else {
      let periods = rowPeriods(row, spanMin, spanMax);
      if (removeDate) periods = withoutDay(periods, removeDate);
      if (addDate) periods = withDay(periods, addDate);
      if (!periods.length) {
        return { refusal: `${name} garderait un planning sans aucune période : retirez sa ligne depuis le tableur pour l'enlever du planning.` };
      }
      next = {
        ...row,
        periods,
        periodStart: periods[0].startDate,
        periodEnd: periods[periods.length - 1].endDate,
      };
    }

    return {
      payload: {
        rows: rows.map((r, i) => (i === index ? next : r)),
        customCols: Array.isArray(sheet.customCols) ? sheet.customCols : [],
        week_organization: Array.isArray(sheet.week_organization) ? sheet.week_organization : [],
        spreadsheetMode: sheet.mode === 'fixed' ? 'fixed' : 'standard',
        fixedRoster: Array.isArray(sheet.fixedRoster) ? sheet.fixedRoster : [],
      },
    };
  }, [schedule, spanMin, spanMax, isSpecialSchedule]);

  const apply = useCallback((change, message) => {
    const { payload, refusal } = buildChange(change);
    if (refusal) { toast.error(refusal); return; }
    save.mutate({ payload, message });
  }, [buildChange, save]);

  const moveDuty = useCallback((userId, name, fromDate, toDate) => {
    if (!fromDate || fromDate === toDate) return;
    if (onDutyAlready(userId, toDate)) {
      toast.error(`${name} est déjà de garde le ${longFrenchDate(toDate)}.`);
      return;
    }
    apply(
      { userId, name, addDate: toDate, removeDate: fromDate },
      `${name} : garde déplacée du ${shortFrenchDate(fromDate)} au ${shortFrenchDate(toDate)}`
    );
  }, [apply, onDutyAlready]);

  const addDuty = useCallback((userId, name, date) => {
    if (onDutyAlready(userId, date)) {
      toast.error(`${name} est déjà de garde le ${longFrenchDate(date)}.`);
      return;
    }
    apply({ userId, name, addDate: date }, `${name} : garde ajoutée le ${shortFrenchDate(date)}`);
  }, [apply, onDutyAlready]);

  const removeDuty = useCallback((userId, name, date) => {
    if (!window.confirm(`Retirer la garde de ${name} le ${fullFrenchDate(date)} ?`)) return;
    apply({ userId, name, removeDate: date }, `${name} : garde retirée le ${shortFrenchDate(date)}`);
  }, [apply]);

  // ── Glisser-déposer ───────────────────────────────────────────────────
  const droppable = useCallback(
    (key) => canEdit && !save.isPending && key >= spanMin && key <= spanMax,
    [canEdit, save.isPending, spanMin, spanMax]
  );

  const handleDragOver = (e, key) => {
    if (!droppable(key)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(key);
  };

  const handleDrop = (e, key) => {
    if (!droppable(key)) return;
    e.preventDefault();
    setDropTarget('');
    let payload = null;
    try { payload = JSON.parse(e.dataTransfer.getData('application/json') || 'null'); }
    catch { payload = null; }
    if (!payload?.userId) return;
    if (payload.type === 'move-shift') moveDuty(payload.userId, payload.name, dateKey(payload.fromDate), key);
    else if (payload.type === 'assign-staff') addDuty(payload.userId, payload.name, key);
  };

  // ── Chargement, refus ─────────────────────────────────────────────────
  // Un brouillon reste privé à son chef de service : le serveur refuse d'en
  // montrer le détail à quiconque d'autre. Sans ce cas, l'écran tournait
  // indéfiniment sur son indicateur de chargement.
  if (error) {
    return (
      <div className="vc">
        <div className="vc__loading">
          {frenchifyIsoDates(error?.response?.data?.message || 'Ce planning ne peut pas être affiché.')}
          <button type="button" className="gs-btn" onClick={onBack}>
            <IcoLeft /> Retour à mes plannings
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !schedule) {
    return (
      <div className="vc">
        <div className="vc__loading">
          <span className="vc__spinner" />
          Chargement du calendrier de garde…
        </div>
      </div>
    );
  }

  const totalShifts = shifts.length;

  return (
    <div className={`vc${viewMode === 'week' ? ' is-week' : ''}`}>

      {/* ══ Barre d'outils ═══════════════════════════════════════════ */}
      <div className="vc__bar">
        <button type="button" className="gs-btn" onClick={onBack}>
          <IcoLeft /> Retour
        </button>

        <div className="vc__id">
          <div className="vc__name">{schedule.name}</div>
          <div className="vc__sub">
            {[schedule.dept_name, frenchRange(spanMin, spanMax), `${totalShifts} garde${plur(totalShifts)}`]
              .filter(Boolean).join(' · ')}
          </div>
        </div>

        <div className="vc__nav">
          <button type="button" onClick={() => setAnchor(a => (viewMode === 'week' ? shiftDay(a, -7) : shiftMonth(a, -1)))}
            aria-label={viewMode === 'week' ? 'Semaine précédente' : 'Mois précédent'}><IcoLeft /></button>
          {/* Le bouton du milieu nomme ce qu'on regarde et ramène au planning
              d'un clic : deux informations pour une seule cible. En mois, il
              nomme le mois de l'ancre, pas l'étendue de la grille — les jours
              de complément appartiennent au mois voisin mais ne s'y regardent
              pas. */}
          <button type="button" onClick={() => setAnchor(spanMin)} title="Revenir au début du planning">
            {viewMode === 'week' && days.length
              ? frenchRange(days[0].key, days[days.length - 1].key)
              : frenchSpan(anchor, anchor)}
          </button>
          <button type="button" onClick={() => setAnchor(a => (viewMode === 'week' ? shiftDay(a, 7) : shiftMonth(a, 1)))}
            aria-label={viewMode === 'week' ? 'Semaine suivante' : 'Mois suivant'}><IcoRight /></button>
        </div>

        <div className="vc__seg">
          <button type="button" aria-pressed={viewMode === 'week'} onClick={() => setViewMode('week')}>Semaine</button>
          <button type="button" aria-pressed={viewMode === 'month'} onClick={() => setViewMode('month')}>Mois</button>
        </div>
      </div>

      {/* ══ Ce que le glisser-déposer fait ═══════════════════════════ */}
      <div className={`vc__mode${canEdit ? '' : ' is-locked'}`}>
        {canEdit ? (
          <>
            <strong>Brouillon modifiable.</strong>
            <span>
              Glissez une garde d'une journée vers une autre pour la déplacer, ou un agent
              de la colonne de gauche vers une journée pour l'y ajouter. Chaque dépôt
              enregistre le tableau de garde et rejoue ses règles — un agent en congé est
              refusé, et le début comme la fin du planning doivent rester couverts.
            </span>
          </>
        ) : (
          <>
            <strong>Lecture seule.</strong>
            <span>
              Ce planning n'est plus un brouillon : il ne se réécrit pas. Une garde qui
              change se traite en remplacement, qui conserve la trace de qui remplace qui.
            </span>
          </>
        )}
      </div>

      {/* ══ Personnel + grille ══════════════════════════════════════ */}
      <div className="vc__body">
        <StaffAside
          staff={staff}
          counts={counts}
          collapsed={collapsed}
          draggable={canEdit && !save.isPending}
          onToggle={() => setCollapsed(c => !c)}
        />

        <div className="vc__scroll">
          <div className="vc__grid">
            {days.slice(0, 7).map(day => (
              <div key={`dow-${day.key}`} className={`vc__dow${day.isToday ? ' is-today' : ''}`}>
                <div className="vc__dow-name">{day.dowLabel}</div>
                {viewMode === 'week' && <div className="vc__dow-num">{day.num}</div>}
              </div>
            ))}
          </div>

          <div className="vc__grid">
            {days.map(day => {
              const dayShifts = byDate[day.key] || [];
              const inSpan = day.key >= spanMin && day.key <= spanMax;
              const isDrop = dropTarget === day.key;
              const classes = ['vc__cell'];
              if (day.isWeekend) classes.push('is-weekend');
              if (day.isToday) classes.push('is-today');
              if (!inSpan) classes.push('is-outside');
              if (inSpan && !dayShifts.length) classes.push('is-empty');
              if (isDrop) classes.push('is-drop');

              return (
                <div key={day.key} className={classes.join(' ')}
                  onDragOver={e => handleDragOver(e, day.key)}
                  onDragLeave={() => setDropTarget(t => (t === day.key ? '' : t))}
                  onDrop={e => handleDrop(e, day.key)}
                >
                  <div className="vc__cell-head">
                    {/* En semaine, l'en-tête de colonne porte déjà le numéro du
                        jour : le répéter dans la case n'apprendrait rien. */}
                    {viewMode === 'month' && (
                      <span className="vc__cell-day">{day.dowLabel} {day.num}</span>
                    )}
                    {inSpan && (
                      <span className={`vc__count${dayShifts.length ? '' : ' is-empty'}`}>
                        {dayShifts.length ? `${dayShifts.length} de garde` : 'découverte'}
                      </span>
                    )}
                  </div>

                  {dayShifts.map(s => (
                    <ShiftCard key={s.id} shift={s} date={day.key}
                      draggable={canEdit && !save.isPending}
                      onRemove={canEdit && !save.isPending
                        ? () => removeDuty(s.user_id, fullName(s.first_name, s.last_name), day.key)
                        : undefined}
                    />
                  ))}

                  {!dayShifts.length && (
                    <div className="vc__hint">
                      {!inSpan ? 'Hors planning' : canEdit ? 'Déposer une garde ici' : '—'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {save.isPending && (
        <div className="vc__busy">
          <span className="vc__spinner" />
          Enregistrement du tableau de garde…
        </div>
      )}
    </div>
  );
}

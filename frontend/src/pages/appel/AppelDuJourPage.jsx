/**
 * Appel du jour (point 6) — déclarer la présence ou l'absence dans une garde du
 * jour courant. Écran dédié, ouvert au chef de service, au surveillant de
 * service, au surveillant général et au directeur.
 *
 * POURQUOI UN ÉCRAN À PART : la demande couvre quatre rôles dont les tableaux de
 * bord n'ont rien en commun. Un onglet dans chacun d'eux aurait signifié quatre
 * modifications d'écrans existants ; une page unique n'en modifie aucun.
 *
 * SOURCE DES GARDES : `GET /api/journal/overview` → `todayGuards[]`, qui lit le
 * tableur (`metadata.spreadsheet.rows`) des plannings à l'état `en_cours`
 * uniquement. C'est exactement le périmètre où le serveur accepte un
 * signalement, donc l'écran ne propose jamais une action qui sera refusée.
 *
 * TROIS ÉTATS DÉCLARABLES, DEUX CHEMINS :
 *   • Présent → `POST /api/journal` (`eventType: 'presence'`), pur journal.
 *   • Absent / Retard → `POST /api/absences-shift`, l'API existante qui crée
 *     l'absence, l'événement de journal, l'alerte de service, la notification à
 *     l'agent et les quatre emits temps réel. On ne réimplémente rien de tout ça.
 *     Le type « Retard » existe en base dans chaque établissement (code
 *     `retard`) et `absences-shift` en déduit lui-même l'événement `late`.
 *
 * L'état déjà déclaré est relu depuis le journal du jour pour ne pas pointer
 * deux fois le même agent.
 *
 * DEUX ONGLETS depuis le point 1 : le pointage du jour (ci-dessous, inchangé) et
 * l'historique des appels (`components/AppelHistoryPanel`). La durée d'un retard
 * est saisie dans la modale de motif et voyage jusqu'au serveur dans
 * `lateMinutes` — c'est la seule donnée qui manquait à la traçabilité.
 */

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { journalAPI, absencesShiftAPI, absencesAPI } from '../../api';
import { useAuthStore } from '../../store';
import ContextBadge from '../../components/layout/ContextBadge';
import PlanningStateBadge from '../../components/planning/PlanningStateBadge';
import JustificationChoice, { JustificationBadge } from '../../components/common/JustificationChoice';
import AppelHistoryPanel from './components/AppelHistoryPanel';

/** Rôles autorisés à pointer — miroir exact des gardes serveur (journal + absences-shift). */
const CALLER_ROLES = ['department_head', 'service_supervisor', 'general_supervisor', 'director'];

/**
 * Deux onglets (point 1) : le pointage du jour, inchangé, et la consultation de
 * l'historique des appels. Les rôles visés par la demande — chef de service,
 * surveillant de service, surveillant général — sont déjà tous dans
 * `CALLER_ROLES`, donc aucune règle d'accès ne bouge.
 */
const TABS = [
  { id: 'pointer', label: "Pointer aujourd'hui" },
  { id: 'history', label: 'Historique des appels' },
];

/** Date du jour en 'YYYY-MM-DD', assemblée depuis les parties locales (jamais toISOString). */
const todayKey = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const LONG_DATE = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

/** Les trois issues possibles d'un pointage, dans l'ordre d'affichage. */
const MARKS = {
  present: { label: 'Présent',  emoji: '✅', color: '#10B981', bg: 'rgba(16, 185, 129, .10)' },
  late:    { label: 'Retard',   emoji: '⏰', color: '#F59E0B', bg: 'rgba(245, 158, 11, .10)' },
  absent:  { label: 'Absent',   emoji: '⛔', color: '#EF4444', bg: 'rgba(239, 68, 68, .10)' },
};

/** Codes du tableur — miroir de SHIFT_LABELS côté serveur. */
const SHIFT_COLORS = { J: '#3B82F6', N: '#6366F1', S: '#8B5CF6', G: '#EF4444', R: '#9CA3AF' };

const card = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

const KPI = ({ label, value, color }) => (
  <div style={{ ...card, borderTop: `3px solid ${color}`, padding: '14px 16px' }}>
    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
      {label}
    </p>
    <p style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15, marginTop: 4 }}>
      {value}
    </p>
  </div>
);

/**
 * Modale de motif pour un retard ou une absence. Le motif reste facultatif —
 * le serveur ne l'exige pas — mais la trace est bien plus utile avec.
 *
 * Pour un retard, la DURÉE est demandée (point 1) : elle est facultative côté
 * serveur mais mise en avant ici, c'est l'information qui manquait à
 * l'historique. Elle n'apparaît jamais pour une absence.
 */
function ReasonModal({ mark, guard, onClose, onConfirm, busy }) {
  const [reason, setReason] = useState('');
  const [isJustified, setIsJustified] = useState(null);
  const [lateMinutes, setLateMinutes] = useState('');
  const meta = MARKS[mark];
  const isLate = mark === 'late';

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{meta.emoji} Déclarer « {meta.label} »</h2>
            <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
              {guard.name} — {guard.departmentName || 'Service'} · {guard.label || guard.code}
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); onConfirm({ reason, isJustified, lateMinutes }); }}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {isLate && (
              <div className="form-group">
                <label className="form-label">Durée du retard (minutes)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    className="form-control"
                    style={{ maxWidth: 130 }}
                    min={0}
                    max={1440}
                    step={5}
                    value={lateMinutes}
                    onChange={(e) => setLateMinutes(e.target.value)}
                    placeholder="ex. 25"
                  />
                  {[15, 30, 60, 120].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setLateMinutes(String(n))}
                      style={{
                        padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
                        fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                        border: `1px solid ${String(n) === lateMinutes ? '#F59E0B' : 'var(--border-default)'}`,
                        background: String(n) === lateMinutes ? '#F59E0B' : 'var(--bg-elevated)',
                        color: String(n) === lateMinutes ? '#fff' : '#B45309',
                      }}
                    >
                      {n < 60 ? `${n} min` : `${n / 60} h`}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  La durée apparaît dans l'historique des appels, dans le journal de service
                  et dans les absences du planning. Laissez vide si elle n'est pas connue.
                </p>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Motif</label>
              <textarea
                className="form-control form-control-textarea"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Précisions sur le signalement…"
              />
            </div>
            <JustificationChoice
              value={isJustified}
              onChange={setIsJustified}
              subject={isLate ? 'Retard' : 'Absence'}
              label={isLate ? 'Qualification du retard' : 'Qualification de l’absence'}
              required
            />
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              L'agent est notifié et la trace reste dans le journal de service et dans l'historique.
            </p>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Envoi…' : `Déclarer ${meta.label.toLowerCase()}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AppelDuJourPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const today = todayKey();

  const [deptFilter, setDeptFilter] = useState('');
  const [pending, setPending] = useState(null);   // { mark, guard } en attente de motif
  const [busyKey, setBusyKey] = useState(null);   // ligne en cours d'envoi
  const [tab, setTab] = useState('pointer');

  const canCall = CALLER_ROLES.includes(user?.roleCode) || user?.roleCode === 'super_admin';

  // --- Gardes du jour ---------------------------------------------------
  const { data: overviewRes, isLoading, isError, error } = useQuery({
    queryKey: ['journal-overview'],
    queryFn: () => journalAPI.getOverview(),
    enabled: canCall,
  });
  const overview = overviewRes?.data?.data;
  const guards = useMemo(() => overview?.todayGuards || [], [overview]);
  const serverToday = overview?.today || today;

  // --- Ce qui a déjà été pointé aujourd'hui ------------------------------
  const { data: eventsRes } = useQuery({
    queryKey: ['journal', 'appel', serverToday],
    queryFn: () => journalAPI.getEvents({ from: serverToday, to: serverToday, limit: 300 }),
    enabled: canCall,
  });

  /**
   * Clé de pointage : agent + planning. Un même agent peut être en garde sur
   * deux plannings le même jour ; les deux lignes se pointent séparément.
   */
  const markKey = (userId, scheduleId) => `${userId || '—'}|${scheduleId || '—'}`;

  const declared = useMemo(() => {
    const map = {};
    const byType = { presence: 'present', late: 'late', absence: 'absent' };
    for (const ev of eventsRes?.data?.data?.events || []) {
      const mark = byType[ev.type];
      if (!mark || !ev.userId) continue;
      const key = markKey(ev.userId, ev.scheduleId);
      // Les événements arrivent du plus récent au plus ancien : le premier vu
      // pour une clé est le dernier déclaré, c'est celui qui fait foi.
      if (!map[key]) {
        const metadataJustification = ev.metadata && typeof ev.metadata === 'object'
          ? ev.metadata.isJustified
          : undefined;
        map[key] = {
          mark,
          hour: ev.hour,
          reporter: ev.reporterName,
          id: ev.id,
          isJustified: typeof ev.isJustified === 'boolean' ? ev.isJustified : metadataJustification,
        };
      }
    }
    return map;
  }, [eventsRes]);

  // --- Types d'absence (partage la clé de cache du modal existant) --------
  const { data: typesRes } = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => absencesAPI.getTypes(),
    enabled: canCall,
  });
  const types = (typesRes?.data?.data || []).filter((t) => !t.is_leave);
  const lateType = types.find((t) => t.code === 'retard' || /retard/i.test(t.name || ''));
  const absentType = types.find((t) => t.code === 'absence_injustifiee')
    || types.find((t) => !/retard/i.test(t.name || ''))
    || types[0];

  const services = useMemo(() => {
    const m = new Map();
    guards.forEach((g) => { if (g.departmentId) m.set(g.departmentId, g.departmentName || 'Service'); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  }, [guards]);

  const visible = useMemo(
    () => (deptFilter ? guards.filter((g) => g.departmentId === deptFilter) : guards),
    [guards, deptFilter]
  );

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0, pending: 0 };
    visible.forEach((g) => {
      const d = declared[markKey(g.userId, g.scheduleId)];
      if (d) c[d.mark] += 1; else c.pending += 1;
    });
    return c;
  }, [visible, declared]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['journal-overview'] });
    qc.invalidateQueries({ queryKey: ['journal'] });
    qc.invalidateQueries({ queryKey: ['journal-alerts'] });
    qc.invalidateQueries({ queryKey: ['shift-absences'] });
  };

  const markPresent = useMutation({
    mutationFn: (g) => journalAPI.addEvent({
      departmentId: g.departmentId,
      scheduleId: g.scheduleId,
      eventType: 'presence',
      userId: g.userId,
      severity: 'info',
      title: `Présence confirmée — ${g.name}`,
      description: `Garde ${g.label || g.code} du ${serverToday} · ${g.scheduleName || ''}`.trim(),
    }),
    onSuccess: () => { toast.success('Présence enregistrée'); refreshAll(); },
    onError: (e) => toast.error(e?.response?.data?.message || 'Enregistrement impossible'),
    onSettled: () => setBusyKey(null),
  });

  const reportAbsence = useMutation({
    mutationFn: ({ guard, mark, reason, isJustified, lateMinutes }) => {
      const type = mark === 'late' ? lateType : absentType;
      return absencesShiftAPI.report({
        userId: guard.userId,
        scheduleId: guard.scheduleId,
        absenceTypeId: type?.id,
        absenceKind: mark === 'late' ? 'late' : 'absence',
        date: serverToday,
        // Pas de startTime/endTime : `todayGuards[]` vient du tableur, qui ne
        // porte qu'un code de garde, pas d'horaires. Les deux champs sont
        // facultatifs côté serveur.
        reason: reason || undefined,
        isJustified,
        severity: mark === 'late' ? 'info' : 'warning',
        // Durée du retard (point 1) : envoyée seulement quand elle est saisie.
        // Le serveur l'ignore de toute façon si le type n'est pas un retard.
        lateMinutes: mark === 'late' && lateMinutes !== '' && lateMinutes !== undefined
          ? Number(lateMinutes)
          : undefined,
      });
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.mark === 'late'
        ? (vars.lateMinutes ? `Retard de ${vars.lateMinutes} min signalé` : 'Retard signalé')
        : 'Absence signalée');
      setPending(null);
      refreshAll();
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Signalement impossible'),
    onSettled: () => setBusyKey(null),
  });

  const onMark = (guard, mark) => {
    if (!guard.userId) {
      toast.error('Cet agent n\'est pas rattaché à un compte : pointage impossible');
      return;
    }
    if (mark === 'present') {
      setBusyKey(markKey(guard.userId, guard.scheduleId));
      markPresent.mutate(guard);
      return;
    }
    setPending({ mark, guard });
  };

  if (!canCall) {
    return (
      <div>
        <ContextBadge variant="header" />
        <div className="page-header">
          <div>
            <h1 className="page-title">Appel du jour</h1>
          </div>
        </div>
        <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          L'appel du jour est réservé aux chefs de service, surveillants, surveillants généraux
          et directeurs.
        </div>
      </div>
    );
  }

  return (
    <div>
      <ContextBadge variant="header" />

      <div className="page-header">
        <div>
          <h1 className="page-title">Appel du jour</h1>
          <p className="page-subtitle">
            {tab === 'pointer'
              ? `${LONG_DATE(serverToday)} — présence, retard ou absence des agents en garde aujourd'hui`
              : 'Consultation des déclarations passées — par garde ou par jour'}
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={refreshAll}>↻ Actualiser</button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: tab === t.id ? 'var(--color-primary)' : 'transparent',
              color: tab === t.id ? '#fff' : 'var(--text-secondary)',
              fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'history' && <AppelHistoryPanel />}

      {tab === 'pointer' && (
      <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
        <KPI label="En garde aujourd'hui" value={visible.length}   color="#3B82F6" />
        <KPI label="Présents"             value={counts.present}   color="#10B981" />
        <KPI label="Retards"              value={counts.late}      color="#F59E0B" />
        <KPI label="Absents"              value={counts.absent}    color="#EF4444" />
        <KPI label="Reste à pointer"      value={counts.pending}   color="#6B7280" />
      </div>

      {services.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          <button
            onClick={() => setDeptFilter('')}
            className={deptFilter === '' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
          >
            Tous les services
          </button>
          {services.map(([id, name]) => (
            <button
              key={id}
              onClick={() => setDeptFilter(id)}
              className={deptFilter === id ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {isError ? (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--color-danger)' }}>
          {error?.response?.status === 403
            ? 'Votre rôle ne donne pas accès aux gardes du jour.'
            : 'Les gardes du jour n\'ont pas pu être chargées.'}
        </div>
      ) : isLoading ? (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          Chargement des gardes du jour…
        </div>
      ) : visible.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          🗓️ Aucune garde à pointer aujourd'hui
          <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
            L'appel ne porte que sur les plannings <strong>en cours</strong> comptant, au {serverToday},
            au moins un agent de service — soit par un code de garde dans la case du jour,
            soit par sa période de participation.
            {overview?.activeSchedules?.length
              ? ` ${overview.activeSchedules.length} planning(s) en cours, mais personne n'est de service aujourd'hui.`
              : ' Aucun planning n\'est en cours dans votre périmètre.'}
          </div>
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-sm)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-elevated)' }}>
                  {['Agent', 'Service', 'Garde', 'Planning', 'État déclaré', 'Pointer'].map((h) => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '10px 12px', color: 'var(--text-muted)',
                      fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.04em',
                      whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((g) => {
                  const key = markKey(g.userId, g.scheduleId);
                  const d = declared[key];
                  const meta = d ? MARKS[d.mark] : null;
                  const busy = busyKey === key;
                  return (
                    <tr key={key} style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      background: meta ? meta.bg : 'transparent',
                    }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {g.name}
                        {g.roleName && (
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}> · {g.roleName}</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>
                        {g.departmentName || '—'}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          fontWeight: 700, color: SHIFT_COLORS[g.code] || 'var(--text-primary)',
                        }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: 2,
                            background: SHIFT_COLORS[g.code] || 'var(--text-muted)',
                          }} />
                          {g.label || g.code}
                        </span>
                        {/* Sans code journalier, la ligne tient de la période de
                            participation : les heures de garde disent le reste. */}
                        {g.shiftStart && g.shiftEnd && (
                          <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
                            {g.shiftStart} → {g.shiftEnd}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 12 }}>
                        {g.scheduleName || '—'}
                        <div style={{ marginTop: 3 }}>
                          <PlanningStateBadge state="en_cours" size="sm" />
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {meta ? (
                          <div style={{ color: meta.color, fontWeight: 700 }}>
                            {meta.emoji} {meta.label}
                            {d.hour && (
                              <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}> · {d.hour}</span>
                            )}
                            {d.reporter && (
                              <div style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 10 }}>
                                par {d.reporter}
                              </div>
                            )}
                            {d.mark !== 'present' && typeof d.isJustified === 'boolean' && (
                              <div style={{ marginTop: 5 }}>
                                <JustificationBadge value={d.isJustified} />
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Non pointé</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {Object.entries(MARKS).map(([mark, m]) => (
                            <button
                              key={mark}
                              onClick={() => onMark(g, mark)}
                              disabled={busy || markPresent.isPending || reportAbsence.isPending || Boolean(d)}
                              title={d ? `Déjà pointé ${MARKS[d.mark].label.toLowerCase()}` : `Déclarer ${m.label.toLowerCase()}`}
                              style={{
                                padding: '4px 10px', borderRadius: 8,
                                cursor: busy ? 'wait' : (d ? 'not-allowed' : 'pointer'),
                                fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
                                border: `1px solid ${d?.mark === mark ? m.color : 'var(--border-default)'}`,
                                background: d?.mark === mark ? m.color : 'var(--bg-elevated)',
                                color: d?.mark === mark ? '#fff' : m.color,
                                opacity: busy || d ? 0.5 : 1,
                              }}
                            >
                              {m.emoji} {m.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.6 }}>
        Un pointage n'est jamais effacé : « Présent » alimente le journal de service, « Retard » et
        « Absent » créent en plus une absence, une alerte de service et une notification à l'agent.
        Une ligne déjà pointée est verrouillée ; sa déclaration reste consultable dans l’onglet
        « Historique des appels ».
      </p>
      </>
      )}

      {pending && (
        <ReasonModal
          mark={pending.mark}
          guard={pending.guard}
          busy={reportAbsence.isPending}
          onClose={() => setPending(null)}
          onConfirm={({ reason, isJustified, lateMinutes }) => {
            setBusyKey(markKey(pending.guard.userId, pending.guard.scheduleId));
            reportAbsence.mutate({
              guard: pending.guard, mark: pending.mark, reason, isJustified, lateMinutes,
            });
          }}
        />
      )}
    </div>
  );
}

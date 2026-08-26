/**
 * « Garde en direct » — sous-tableau de bord de la Supervision générale.
 *
 * Deux vues, un seul composant : la liste des gardes **En cours** de tous les
 * services, puis le tableau de bord direct de la garde sélectionnée
 * (`LiveGuardBoard`). Pas de nouvelle route : l'onglet reste le point d'entrée,
 * donc `App.jsx` et `Sidebar.jsx` ne sont pas touchés.
 *
 * Lecture seule pour le directeur comme pour le surveillant général. Aucun
 * endpoint nouveau : tout vient de `journal/overview`, `supervision/schedules`
 * et `journal` — dont les clés react-query sont déjà invalidées par
 * `hooks/useRealtime.js`, ce qui donne le temps réel sans modifier le hook.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Users, CalendarDays, Building2, ChevronRight, RefreshCw,
  AlertTriangle, Radio, Pause,
} from 'lucide-react';

import { journalAPI, supervisionAPI } from '../../../api';
import PlanningStateBadge from '../../../components/planning/PlanningStateBadge';
import LiveGuardBoard from './LiveGuardBoard';
import './LiveGuardBoard.css';

/** Même cadence que « Appel du jour » : le socket fait le travail, l'intervalle est la ceinture. */
const LIVE_REFRESH_INTERVAL = 15000;

/** Plafond appliqué côté serveur aux plannings en cours de `journal/overview`. */
const OVERVIEW_SCHEDULE_LIMIT = 40;

const SHORT_DATE = (iso) => {
  if (!iso) return '—';
  // Midi local : aucune bascule de jour possible quel que soit le fuseau.
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
};

const LONG_DATE = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

const dayNumber = (iso) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
};

const dayDiff = (from, to) => {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86400000);
};

const formatSyncTime = (timestamp) => {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const normalize = (value) => String(value || '').toLowerCase();

export default function LiveGuardsPanel() {
  const [selectedId, setSelectedId] = useState(null);
  const [live, setLive] = useState(true);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');

  /* Même clé et même appel que « Appel du jour » : le cache est partagé, pas dupliqué. */
  const overviewRes = useQuery({
    queryKey: ['journal-overview'],
    queryFn: () => journalAPI.getOverview(),
    refetchInterval: live ? LIVE_REFRESH_INTERVAL : false,
    refetchIntervalInBackground: true,
  });

  /* Même clé que l'onglet « Plannings reçus » filtré sur « en cours » : compteurs gratuits. */
  const schedulesRes = useQuery({
    queryKey: ['supervision-schedules', 'en_cours'],
    queryFn: () => supervisionAPI.getSchedules({ state: 'en_cours' }),
  });

  const overview = overviewRes.data?.data?.data;
  const today = overview?.today || null;
  const todayGuards = useMemo(() => overview?.todayGuards || [], [overview]);

  /* L'appel du jour de tout l'hôpital en une seule requête (la portée du journal
     est l'établissement pour le directeur et le surveillant général), regroupé
     ensuite par planning : pas de requête par carte. */
  const appelRes = useQuery({
    queryKey: ['journal', 'garde-direct-appel', today],
    queryFn: () => journalAPI.getEvents({
      type: 'presence,absence,late',
      from: today,
      to: today,
      limit: 300,
    }),
    enabled: Boolean(today),
    refetchInterval: live ? LIVE_REFRESH_INTERVAL : false,
    refetchIntervalInBackground: true,
  });

  /* Statut d'appel par agent : dérivation identique à `AppelDuJourPage`
     (clé `userId|scheduleId`, premier événement gagnant). */
  const declared = useMemo(() => {
    const map = {};
    const byType = { presence: 'present', late: 'late', absence: 'absent' };
    for (const event of appelRes.data?.data?.data?.events || []) {
      const mark = byType[event.type];
      if (!mark || !event.userId) continue;
      const key = `${event.userId || '—'}|${event.scheduleId || '—'}`;
      if (!map[key]) map[key] = mark;
    }
    return map;
  }, [appelRes.data]);

  /* Fusion : `activeSchedules` fait foi (c'est lui qui porte l'effectif du jour),
     `supervision/schedules` n'apporte que les compteurs. */
  const cards = useMemo(() => {
    const active = overview?.activeSchedules || [];
    const extra = {};
    for (const s of schedulesRes.data?.data?.data?.schedules || []) extra[s.id] = s;

    return active.map((schedule) => {
      const roster = todayGuards.filter((g) => g.scheduleId === schedule.id);
      const counts = { present: 0, late: 0, absent: 0, pending: 0 };
      for (const guard of roster) {
        const mark = declared[`${guard.userId || '—'}|${guard.scheduleId || '—'}`];
        if (mark === 'present') counts.present += 1;
        else if (mark === 'late') counts.late += 1;
        else if (mark === 'absent') counts.absent += 1;
        else counts.pending += 1;
      }
      const total = dayDiff(schedule.startDate, schedule.endDate);
      const index = dayDiff(schedule.startDate, today);
      const remaining = dayDiff(today, schedule.endDate);
      const ratio = roster.length ? Math.round(((roster.length - counts.pending) / roster.length) * 100) : 0;

      // Liseré de complétude du pointage, en jetons du registre : neutre sans
      // effectif, sceau quand tout est pointé, bleu de service en cours de
      // pointage, ambre tant que rien n'a été fait. Aucune couleur décorative —
      // le liseré ne dit que l'avancement.
      let accent = 'var(--gs-alert)';
      if (roster.length === 0) accent = 'var(--gs-rule-strong)';
      else if (counts.pending === 0) accent = 'var(--gs-seal)';
      else if (counts.pending < roster.length) accent = 'var(--gs-duty)';

      return {
        ...schedule,
        guardCount: extra[schedule.id]?.guardCount ?? null,
        staffCount: extra[schedule.id]?.staffCount ?? null,
        pendingProposals: extra[schedule.id]?.pendingProposals ?? 0,
        roster,
        counts,
        ratio,
        accent,
        dayIndex: index === null ? null : index + 1,
        dayTotal: total === null ? null : total + 1,
        daysRemaining: remaining,
      };
    });
  }, [overview, schedulesRes.data, todayGuards, declared, today]);

  const departments = useMemo(() => {
    const map = {};
    for (const card of cards) {
      if (card.departmentId) map[card.departmentId] = card.departmentName || 'Service';
    }
    return Object.entries(map).sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  }, [cards]);

  const visible = useMemo(() => {
    const needle = normalize(search.trim());
    return cards.filter((card) => {
      if (department && String(card.departmentId) !== String(department)) return false;
      if (!needle) return true;
      return normalize(card.name).includes(needle) || normalize(card.departmentName).includes(needle);
    });
  }, [cards, search, department]);

  /* Garde-fou de la limite serveur : on le dit, on ne le tait pas. */
  const beyondLimit = useMemo(() => {
    const all = schedulesRes.data?.data?.data?.schedules || [];
    const shown = overview?.activeSchedules?.length || 0;
    if (!all.length || shown < OVERVIEW_SCHEDULE_LIMIT) return 0;
    return Math.max(0, all.length - shown);
  }, [schedulesRes.data, overview]);

  const selected = selectedId ? cards.find((card) => card.id === selectedId) : null;

  /* Une garde suivie peut se terminer pendant la consultation : on l'annonce. */
  if (selectedId && !selected) {
    return (
      <div className="lgp-shell">
        <div className="lgp-notice">
          <AlertTriangle size={14} />
          <span>
            Cette garde n'est plus « En cours » (période terminée ou planning clôturé) : le tableau de bord
            direct ne s'applique plus. Revenez à la liste pour suivre une autre garde.
          </span>
        </div>
        <button type="button" className="lgb-back" onClick={() => setSelectedId(null)}>
          Retour aux gardes en cours
        </button>
      </div>
    );
  }

  if (selected) {
    return (
      <LiveGuardBoard
        schedule={selected}
        guards={todayGuards}
        today={today}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  if (overviewRes.isError) {
    return (
      <p className="lgp-error">
        Impossible de charger les gardes en cours : {overviewRes.error?.response?.data?.message || 'erreur serveur'}.
      </p>
    );
  }

  return (
    <div className="lgp-shell">
      <div className="lgp-toolbar">
        <div className="lgp-toolbar-copy">
          <h3>Gardes en cours — {cards.length} garde(s), tous services</h3>
          <p>
            {today ? LONG_DATE(today) : '—'} · seules les gardes dont la période couvre aujourd'hui sont
            listées. Sélectionnez une garde pour ouvrir son tableau de bord direct.
          </p>
        </div>
        <button
          type="button"
          className={`lgp-live${live ? ' is-live' : ''}`}
          onClick={() => setLive((v) => !v)}
          title={live ? 'Suspendre le rafraîchissement automatique' : 'Reprendre le rafraîchissement automatique'}
        >
          <span className="lgp-live-dot" />
          {live ? <Radio size={12} /> : <Pause size={12} />}
          {live ? 'En direct' : 'En pause'}
        </button>
        <span className="lgp-sync">
          <RefreshCw size={11} /> Synchronisé à {formatSyncTime(overviewRes.dataUpdatedAt)}
        </span>
      </div>

      {beyondLimit > 0 && (
        <div className="lgp-notice">
          <AlertTriangle size={14} />
          <span>
            {beyondLimit} garde(s) en cours au-delà de l'affichage temps réel : le suivi direct est plafonné à{' '}
            {OVERVIEW_SCHEDULE_LIMIT} plannings simultanés. Utilisez l'onglet « Plannings reçus » pour la liste
            complète.
          </span>
        </div>
      )}

      <div className="lgp-filters">
        <div className="lgp-search">
          <Search size={14} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un planning, un service…"
          />
        </div>
        <select className="lgp-select" value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">Tous les services ({departments.length})</option>
          {departments.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </div>

      {overviewRes.isLoading ? (
        <p className="lgp-loading">Chargement des gardes en cours…</p>
      ) : visible.length === 0 ? (
        <p className="lgp-empty">
          {cards.length === 0
            ? 'Aucune garde n\'est en cours aujourd\'hui dans l\'hôpital.'
            : 'Aucune garde ne correspond à ce filtre.'}
        </p>
      ) : (
        <div className="lgp-grid">
          {visible.map((card) => (
            <button
              key={card.id}
              type="button"
              className="lgp-card"
              style={{ '--lgp-accent': card.accent }}
              onClick={() => setSelectedId(card.id)}
            >
              <div className="lgp-card-head">
                <h4>{card.name || 'Planning'}</h4>
                <PlanningStateBadge
                  state={card.state}
                  status={card.status}
                  startDate={card.startDate}
                  endDate={card.endDate}
                  size="sm"
                />
              </div>

              <div className="lgp-card-meta">
                <span><Building2 size={12} /> {card.departmentName || 'Service inconnu'}</span>
                <span>
                  <CalendarDays size={12} /> {SHORT_DATE(card.startDate)} → {SHORT_DATE(card.endDate)}
                  {card.dayIndex && card.dayTotal ? ` · jour ${card.dayIndex}/${card.dayTotal}` : ''}
                  {card.daysRemaining !== null
                    ? card.daysRemaining > 0
                      ? ` · ${card.daysRemaining} j restant(s)`
                      : ' · dernier jour'
                    : ''}
                </span>
                <span><Users size={12} /> {card.roster.length} agent(s) de garde aujourd'hui</span>
              </div>

              <div
                className="lgp-progress"
                style={{ '--lgp-progress': `${card.ratio}%`, '--lgp-accent': card.accent }}
              >
                <span />
              </div>

              <div className="lgp-card-foot">
                {card.roster.length === 0 ? (
                  <span className="lgp-chip is-muted">Aucun agent aujourd'hui</span>
                ) : (
                  <>
                    <span className="lgp-chip is-ok">{card.counts.present} présent(s)</span>
                    {card.counts.late > 0 && <span className="lgp-chip is-warn">{card.counts.late} retard(s)</span>}
                    {card.counts.absent > 0 && (
                      <span className="lgp-chip is-warn">{card.counts.absent} absent(s)</span>
                    )}
                    {card.counts.pending > 0 && (
                      <span className="lgp-chip is-muted">{card.counts.pending} à pointer</span>
                    )}
                  </>
                )}
                <span className="lgp-card-open">Ouvrir <ChevronRight size={11} /></span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

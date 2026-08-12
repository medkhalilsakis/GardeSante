/**
 * Sélection de la garde — première étape des prêts de personnel (point 4).
 *
 * La demande est explicite : « le prêt de personnel doit être traité par garde,
 * on sélectionne la garde puis dans une autre interface on fait les prêts ».
 * Ce composant est donc un sélecteur, rien de plus : il n'écrit rien, il ne
 * modifie aucun écran existant, il liste les gardes du périmètre avec, pour
 * chacune, le nombre de prêts déjà rattachés.
 *
 * Deux sources, fusionnées :
 *   1. `schedulesAPI.getAll` — les gardes visibles par l'utilisateur (le serveur
 *      borne déjà : son service pour un chef, tout l'hôpital pour la direction).
 *   2. `staffLoansAPI.getAll` — les prêts, qui portent désormais l'identité de
 *      leur garde (`schedule_name`, période, état). Indispensable : une demande
 *      REÇUE pointe le planning du service DEMANDEUR, planning qu'un chef ne
 *      voit dans aucune de ses listes. Sans cette seconde source, ces demandes
 *      seraient introuvables dans l'onglet « Par garde ».
 *
 * La clé react-query commence par `staff-loans`, comme les autres panneaux :
 * `useRealtime` invalide déjà ce préfixe sur `staff-loan:requested` et
 * `staff-loan:decided`, donc les compteurs se rafraîchissent en temps réel sans
 * écouteur supplémentaire.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { schedulesAPI, staffLoansAPI } from '../../../api';
import PlanningStateBadge from '../../../components/planning/PlanningStateBadge';

/** Le serveur plafonne `listLoans` à 100 lignes : au-delà, les compteurs sont partiels. */
const LOAN_HARD_LIMIT = 100;

const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

const Pill = ({ children, bg, color, title }) => (
  <span
    title={title}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 20,
      background: bg, color, fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
    }}
  >
    {children}
  </span>
);

export default function ScheduleLoanPicker({ onSelect }) {
  const [search, setSearch] = useState('');
  const [onlyWithLoans, setOnlyWithLoans] = useState(false);

  const { data: schedRes, isLoading: loadingSched } = useQuery({
    queryKey: ['schedules', 'loan-picker'],
    queryFn: () => schedulesAPI.getAll({ limit: 100 }),
  });
  const { data: loanRes, isLoading: loadingLoans } = useQuery({
    queryKey: ['staff-loans', 'picker'],
    queryFn: () => staffLoansAPI.getAll({}),
    refetchInterval: 60000,
  });

  const schedules = useMemo(() => schedRes?.data?.data || [], [schedRes]);
  const loans = useMemo(() => loanRes?.data?.data || [], [loanRes]);

  /**
   * Une entrée par garde. Les gardes issues des prêts n'écrasent jamais celles
   * de la liste des plannings : cette dernière est la source de vérité pour le
   * nom, la période et l'état.
   */
  const gardes = useMemo(() => {
    const map = new Map();

    schedules.forEach((s) => {
      map.set(s.id, {
        id: s.id,
        name: s.name || 'Planning sans nom',
        departmentId: s.department_id,
        departmentName: s.department_name || '—',
        startDate: s.start_date,
        endDate: s.end_date,
        status: s.status,
        state: s.state,
        // La garde m'est accessible : je peux y demander un prêt.
        mine: true,
        total: 0, pending: 0, toDecide: 0,
      });
    });

    loans.forEach((l) => {
      if (!l.schedule_id) return;
      let g = map.get(l.schedule_id);
      if (!g) {
        // Garde d'un autre service, connue seulement par le prêt lui-même.
        g = {
          id: l.schedule_id,
          name: l.schedule_name || 'Garde d\'un autre service',
          departmentId: null,
          departmentName: l.schedule_department_name || l.requesting_department_name || '—',
          startDate: l.schedule_start,
          endDate: l.schedule_end,
          status: l.schedule_status,
          state: l.schedule_state,
          mine: false,
          total: 0, pending: 0, toDecide: 0,
        };
        map.set(l.schedule_id, g);
      }
      g.total += 1;
      if (l.status === 'pending') {
        g.pending += 1;
        if (l.is_incoming) g.toDecide += 1;
      }
    });

    // Ce qui attend une décision d'abord, puis les gardes les plus récentes.
    return [...map.values()].sort((a, b) => {
      if (b.toDecide !== a.toDecide) return b.toDecide - a.toDecide;
      if (b.pending !== a.pending) return b.pending - a.pending;
      return String(b.startDate || '').localeCompare(String(a.startDate || ''));
    });
  }, [schedules, loans]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return gardes.filter((g) => {
      if (onlyWithLoans && g.total === 0) return false;
      if (!q) return true;
      return g.name.toLowerCase().includes(q) || g.departmentName.toLowerCase().includes(q);
    });
  }, [gardes, search, onlyWithLoans]);

  const isLoading = loadingSched || loadingLoans;
  const totalToDecide = gardes.reduce((n, g) => n + g.toDecide, 0);
  const isFiltering = Boolean(search.trim() || onlyWithLoans);

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
            Choisissez la garde
            {totalToDecide > 0 && (
              <span style={{ marginLeft: 8, background: '#EF4444', color: '#fff', borderRadius: 20, padding: '1px 8px', fontSize: 10, fontWeight: 800 }}>
                {totalToDecide} à décider
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Les prêts se traitent garde par garde : ouvrez une garde pour voir ses prêts et en demander un.
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyWithLoans} onChange={(e) => setOnlyWithLoans(e.target.checked)} />
          Seulement les gardes avec des prêts
        </label>
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder="Nom de la garde, service…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '14px 0' }}>Chargement des gardes…</div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>
          {isFiltering
            ? 'Aucune garde ne correspond à ce filtre.'
            : 'Aucune garde accessible. Un planning de garde doit exister avant de pouvoir prêter du personnel.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map((g) => (
          <button
            key={g.id}
            onClick={() => onSelect(g)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
              border: g.toDecide > 0 ? '1px solid rgba(239,68,68,.45)' : '1px solid var(--border-subtle)',
              borderRadius: 11, padding: '11px 13px', cursor: 'pointer', fontFamily: 'inherit',
              background: g.toDecide > 0 ? 'rgba(239,68,68,.05)' : 'var(--bg-elevated)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{g.name}</span>
                <PlanningStateBadge state={g.state} status={g.status} startDate={g.startDate} endDate={g.endDate} size="sm" />
                {!g.mine && (
                  <Pill bg="rgba(99,102,241,.12)" color="#3730A3" title="Planning d'un autre service : vous y êtes concerné par un prêt.">
                    Autre service
                  </Pill>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                {g.departmentName} · du {fmt(g.startDate)} au {fmt(g.endDate)}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {g.toDecide > 0 && (
                <Pill bg="rgba(239,68,68,.12)" color="#991B1B" title="Demandes reçues qui attendent votre décision">
                  {g.toDecide} à décider
                </Pill>
              )}
              {g.pending - g.toDecide > 0 && (
                <Pill bg="rgba(249,115,22,.12)" color="#9A3412" title="Demandes envoyées en attente de réponse">
                  {g.pending - g.toDecide} en attente
                </Pill>
              )}
              <Pill
                bg={g.total > 0 ? 'rgba(16,185,129,.12)' : 'var(--bg-card)'}
                color={g.total > 0 ? '#065F46' : 'var(--text-muted)'}
                title="Nombre total de prêts rattachés à cette garde"
              >
                {g.total} prêt{g.total > 1 ? 's' : ''}
              </Pill>
              <span style={{ color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}>›</span>
            </div>
          </button>
        ))}
      </div>

      {loans.length >= LOAN_HARD_LIMIT && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10, fontStyle: 'italic' }}>
          Les compteurs portent sur les {LOAN_HARD_LIMIT} prêts les plus récents. Ouvrez une garde pour
          voir ses prêts au complet — la garde, elle, est interrogée séparément.
        </div>
      )}
    </div>
  );
}

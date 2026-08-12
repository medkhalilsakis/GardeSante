/**
 * Gestion des demandes de prêt de personnel — interface dédiée (point 2).
 *
 * Route `/staff-loans`. Page NEUVE : elle n'enveloppe que des composants déjà
 * livrés, sans les dupliquer ni les modifier dans leurs écrans d'origine.
 *
 *   - chef de service      → `StaffLoansPanel`    (demander / accepter / refuser)
 *   - surveillant général,
 *     directeur, admin     → `StaffLoansOverview` (lecture seule — la décision
 *                            reste au chef du service propriétaire, règle II)
 *
 * Ouverte depuis une notification de prêt (`?focus=<id>`), la demande concernée
 * est mise en évidence par la prop additive `focusId` de `StaffLoansPanel`.
 */

import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store';
import { staffLoansAPI } from '../../api';
import ContextBadge from '../../components/layout/ContextBadge';
import StaffLoansPanel from '../schedules/components/StaffLoansPanel';
import StaffLoansOverview from '../supervision/components/StaffLoansOverview';
// Traitement garde par garde (point 4) : sélecteur puis interface de la garde.
import ScheduleLoanPicker from './components/ScheduleLoanPicker';
import ScheduleLoanBoard from './components/ScheduleLoanBoard';

/** Rôles qui décident : seul le chef du service propriétaire répond. */
const DECIDERS = ['department_head'];
/** Rôles en lecture seule sur tout l'établissement. */
const WATCHERS = ['general_supervisor', 'director', 'hospital_admin'];

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

export default function StaffLoansPage() {
  const { user } = useAuthStore();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus');

  const role = user?.roleCode;
  const canDecide = DECIDERS.includes(role);
  const isWatcher = WATCHERS.includes(role);

  // Les prêts se traitent garde par garde (point 4) : c'est la vue par défaut.
  // Exception : arrivée depuis une notification (`?focus=`), où l'utilisateur
  // veut voir CETTE demande — la liste complète la met en évidence, elle reste
  // donc l'entrée directe dans ce cas.
  const [view, setView] = useState(focusId ? 'all' : 'by-schedule');
  const [garde, setGarde] = useState(null);

  // Compteurs du chef : lus sur le même endpoint que le panneau, mais sur une
  // clé react-query distincte — deux queryFn sur une même clé se marchent dessus.
  const { data: incoming } = useQuery({
    queryKey: ['staff-loans-page', 'incoming'],
    queryFn: () => staffLoansAPI.getAll({ direction: 'incoming' }).then((r) => r.data?.data || []),
    enabled: canDecide,
    refetchInterval: 60000,
  });
  const { data: outgoing } = useQuery({
    queryKey: ['staff-loans-page', 'outgoing'],
    queryFn: () => staffLoansAPI.getAll({ direction: 'outgoing' }).then((r) => r.data?.data || []),
    enabled: canDecide,
    refetchInterval: 60000,
  });

  const inList = incoming || [];
  const outList = outgoing || [];
  const pendingIn = inList.filter((l) => l.status === 'pending').length;
  const pendingOut = outList.filter((l) => l.status === 'pending').length;

  // Une notification peut survivre à sa demande (il existe des notifications
  // orphelines en base) : on ne promet la mise en évidence que si la demande
  // est réellement présente dans l'une des deux listes.
  const focusFound = !!focusId && [...inList, ...outList].some((l) => l.id === focusId);
  const focusResolved = !canDecide || !incoming || !outgoing;

  return (
    <div>
      <ContextBadge variant="header" />

      <div className="page-header">
        <div>
          <h1 className="page-title">Prêts de personnel</h1>
          <p className="page-subtitle">
            {canDecide
              ? 'Demandes reçues et envoyées — la décision vous revient pour les agents de votre service'
              : 'Suivi des prêts entre les services de l\'hôpital — consultation'}
          </p>
        </div>
      </div>

      {focusId && (focusFound || focusResolved ? (
        <div style={{
          ...card,
          padding: '10px 14px', marginBottom: 14,
          background: 'var(--color-primary-10)', border: '1px solid var(--color-primary)',
          fontSize: 12, color: 'var(--text-secondary)',
        }}>
          Vous arrivez depuis une notification : la demande concernée est mise en évidence ci-dessous.
        </div>
      ) : (
        <div style={{
          ...card,
          padding: '10px 14px', marginBottom: 14,
          background: 'rgba(245, 158, 11, .08)', border: '1px solid rgba(245, 158, 11, .35)',
          fontSize: 12, color: 'var(--text-secondary)',
        }}>
          La demande liée à cette notification n'est plus disponible — elle a pu être supprimée
          avec son planning. Les demandes en cours restent listées ci-dessous.
        </div>
      ))}

      {canDecide && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
          <KPI label="Reçues en attente"  value={pendingIn}  color="#F97316" />
          <KPI label="Envoyées en attente" value={pendingOut} color="#6366F1" />
          <KPI label="Total reçues"       value={inList.length}  color="#10B981" />
          <KPI label="Total envoyées"     value={outList.length} color="#3B82F6" />
        </div>
      )}

      {canDecide ? (
        <>
          {/* Deux entrées : le traitement par garde (demandé) et la liste
              complète, conservée à l'identique — une demande dont la garde a été
              supprimée ou archivée doit rester accessible. */}
          <div style={{
            display: 'flex', gap: 4, background: 'var(--bg-elevated)', padding: 4,
            borderRadius: 10, marginBottom: 14, width: 'fit-content',
          }}>
            {[{ id: 'by-schedule', label: 'Par garde' }, { id: 'all', label: 'Tous les prêts' }].map((t) => (
              <button key={t.id} onClick={() => setView(t.id)} style={{
                padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                background: view === t.id ? 'var(--color-primary)' : 'transparent',
                color: view === t.id ? '#fff' : 'var(--text-secondary)',
              }}>{t.label}</button>
            ))}
          </div>

          {view === 'by-schedule' ? (
            garde
              ? <ScheduleLoanBoard garde={garde} onBack={() => setGarde(null)} />
              : <ScheduleLoanPicker onSelect={setGarde} />
          ) : (
            <StaffLoansPanel focusId={focusId} />
          )}
        </>
      ) : isWatcher ? (
        <div style={card}>
          <StaffLoansOverview />
        </div>
      ) : (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          Les prêts de personnel concernent les chefs de service et la supervision de l'hôpital.
          <div style={{ fontSize: 12, marginTop: 6 }}>
            La décision revient toujours au chef du service propriétaire de l'agent.
          </div>
        </div>
      )}
    </div>
  );
}

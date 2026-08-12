/**
 * Portfolio du service — route /portfolio (point 5).
 *
 * Écran neuf, entièrement en lecture : il ne modifie aucun écran existant et
 * n'ajoute aucun endpoint. `GET /api/portfolio` borne déjà la réponse au service
 * de l'appelant quand celui-ci est chef de service ou surveillant de service
 * (portfolio.controller.js), et renvoie un 403 explicite si le compte n'est
 * rattaché à aucun service — ce cas est affiché tel quel plutôt que masqué
 * derrière une grille vide.
 *
 * Les briques d'affichage sont celles déjà éprouvées par le dashboard
 * surveillant (PortfolioGrid + StaffPortfolioModal) : mêmes cartes, même fiche
 * détaillée, donc aucune divergence de rendu entre les deux écrans.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { portfolioAPI } from '../../api';
import PortfolioGrid from '../../components/portfolio/PortfolioGrid';
import StaffPortfolioModal from '../../components/portfolio/StaffPortfolioModal';
import ContextBadge from '../../components/layout/ContextBadge';

const KPI = ({ label, value, hint, color }) => (
  <div style={{
    background: 'var(--bg-card)', border: '1px solid var(--border-default)',
    borderTop: `3px solid ${color}`, borderRadius: 'var(--border-radius-lg)',
    padding: '14px 16px', minWidth: 0,
  }}>
    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
      {label}
    </p>
    <p style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15, marginTop: 4 }}>
      {value}
    </p>
    {hint && <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</p>}
  </div>
);

const num = (v) => Number(v) || 0;

export default function ServicePortfolioPage() {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(null);

  const { data: res, isLoading, error } = useQuery({
    queryKey: ['portfolio', 'service'],
    queryFn: () => portfolioAPI.getAll(),
  });

  // `getPortfolio` renvoie `{ success, data: [...] }` ; la double lecture couvre
  // aussi une éventuelle enveloppe `{ agents: [...] }`. Mémorisé pour que les
  // agrégats ci-dessous ne se recalculent pas à chaque rendu (le repli `[]`
  // serait sinon un tableau neuf à chaque fois).
  const agents = useMemo(
    () => res?.data?.data?.agents || res?.data?.data || [],
    [res],
  );

  // Le serveur refuse (403) quand le compte n'a pas de service rattaché : c'est
  // une information à montrer, pas une erreur technique à taire.
  const noDepartment = error?.response?.status === 403;
  const errorMessage = error?.response?.data?.message;

  const roles = useMemo(() => {
    const set = new Set();
    agents.forEach((a) => { if (a.role_name) set.add(a.role_name); });
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [agents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents.filter((a) => {
      if (roleFilter && a.role_name !== roleFilter) return false;
      if (!q) return true;
      const name = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
      return name.includes(q)
        || (a.matricule || '').toLowerCase().includes(q)
        || (a.role_name || '').toLowerCase().includes(q)
        || (a.speciality || '').toLowerCase().includes(q)
        || (a.grade || '').toLowerCase().includes(q);
    });
  }, [agents, search, roleFilter]);

  const totals = useMemo(() => agents.reduce((acc, a) => ({
    leaves:   acc.leaves   + (num(a.active_leaves_count) > 0 ? 1 : 0),
    absences: acc.absences + num(a.shift_absences_count),
  }), { leaves: 0, absences: 0 }), [agents]);

  const isFiltering = Boolean(search.trim() || roleFilter);

  return (
    <div>
      {/* Appartenance — hôpital et service du chef. */}
      <ContextBadge variant="header" />

      <div className="page-header">
        <div>
          <h1 className="page-title">👥 Portfolio du service</h1>
          <p className="page-subtitle">
            Tous les membres du service — identité, charge de gardes, congés et absences
          </p>
        </div>
      </div>

      {noDepartment ? (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid #FDE68A', borderLeft: '4px solid #D97706',
          borderRadius: 'var(--border-radius-lg)', padding: '18px 20px',
        }}>
          <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 'var(--font-sm)' }}>
            Aucun service rattaché à votre compte
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)', marginTop: 6 }}>
            {errorMessage || 'Votre compte n\'est associé à aucun service.'} Le portfolio liste les membres
            de votre service : demandez au directeur de vous y rattacher pour y accéder.
          </p>
        </div>
      ) : error ? (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid #FECACA', borderLeft: '4px solid #DC2626',
          borderRadius: 'var(--border-radius-lg)', padding: '18px 20px',
        }}>
          <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 'var(--font-sm)' }}>
            Impossible de charger le portfolio
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)', marginTop: 6 }}>
            {errorMessage || 'Réessayez dans un instant.'}
          </p>
        </div>
      ) : (
        <>
          {/* Synthèse du service — calculée sur l'effectif complet, pas sur le
              filtre. Volontairement pas de compteur de gardes ici : `total_shifts`
              provient de la table `shifts`, que le flux tableur n'alimente pas
              (les gardes vivent dans `schedules.metadata`), il vaudrait 0 pour
              tout le monde. La carte de chaque agent l'affiche déjà telle quelle. */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
            gap: 12, marginBottom: 18,
          }}>
            <KPI label="Effectif" value={agents.length} hint="membres actifs du service" color="var(--color-primary)" />
            <KPI label="Fonctions" value={roles.length} hint="fonctions représentées" color="#0EA5E9" />
            <KPI label="En congé" value={totals.leaves} hint="congé en cours ou à venir" color="#D97706" />
            <KPI label="Absences déclarées" value={totals.absences} hint="signalées en garde" color="#DC2626" />
          </div>

          {/* Filtres */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, margin: 0 }}>Membres du service</h3>
              <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                {filtered.length} agent(s){isFiltering ? ` sur ${agents.length}` : ''} — cliquez une carte pour la fiche détaillée
              </p>
            </div>
            {roles.length > 1 && (
              <select
                className="input"
                style={{ maxWidth: 200 }}
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="">Toutes les fonctions</option>
                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
            <input
              className="input"
              style={{ maxWidth: 260 }}
              placeholder="Nom, matricule, fonction…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {isFiltering && (
              <button
                className="btn btn-secondary"
                onClick={() => { setSearch(''); setRoleFilter(''); }}
              >
                Réinitialiser
              </button>
            )}
          </div>

          {isLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
              Chargement du personnel…
            </div>
          ) : (
            <PortfolioGrid
              agents={filtered}
              onCardClick={setSelectedAgent}
              emptyMessage={isFiltering
                ? 'Aucun agent ne correspond à cette recherche.'
                : 'Aucun personnel actif dans votre service.'}
            />
          )}
        </>
      )}

      {selectedAgent && (
        <StaffPortfolioModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  );
}

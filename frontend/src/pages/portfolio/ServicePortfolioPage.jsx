import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, X } from 'lucide-react';
import { portfolioAPI } from '../../api';
import PortfolioGrid from '../../components/portfolio/PortfolioGrid';
import StaffPortfolioModal from '../../components/portfolio/StaffPortfolioModal';
import ContextBadge from '../../components/layout/ContextBadge';
import { GsEmpty, GsFilterBar, GsPageHeader, GsPanel, GsSkeleton, GsStat, GsStatRail } from '../../components/gs';
import './portfolio.css';

const numberOf = (value) => Number(value) || 0;
const functionOf = (agent) => agent.job_title || agent.speciality || agent.role_name || 'Fonction non renseignée';

export default function ServicePortfolioPage() {
  const [search, setSearch] = useState('');
  const [functionFilter, setFunctionFilter] = useState('all');
  const [selectedAgent, setSelectedAgent] = useState(null);

  const { data: response, isLoading, error } = useQuery({
    queryKey: ['portfolio', 'service'],
    queryFn: () => portfolioAPI.getAll(),
  });
  const agents = useMemo(() => response?.data?.data?.agents || response?.data?.data || [], [response]);
  const functions = useMemo(() => [...new Set(agents.map(functionOf))].sort((a, b) => a.localeCompare(b, 'fr')), [agents]);
  const counts = useMemo(() => agents.reduce((current, agent) => ({
    leaves: current.leaves + (numberOf(agent.active_leaves_count) > 0 ? 1 : 0),
    absences: current.absences + numberOf(agent.shift_absences_count),
  }), { leaves: 0, absences: 0 }), [agents]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('fr');
    return agents.filter((agent) => {
      if (functionFilter !== 'all' && functionOf(agent) !== functionFilter) return false;
      if (!term) return true;
      return [agent.first_name, agent.last_name, agent.matricule, agent.role_name, agent.job_title, agent.speciality, agent.grade]
        .filter(Boolean).join(' ').toLocaleLowerCase('fr').includes(term);
    });
  }, [agents, functionFilter, search]);
  const isFiltering = Boolean(search.trim() || functionFilter !== 'all');
  const noDepartment = error?.response?.status === 403;

  return (
    <div className="gsport-wrap">
      <ContextBadge variant="header" />
      <GsPageHeader
        eyebrow="Registre d’équipe"
        title="Portfolio du service"
        subtitle="Identité, fonction, congés, absences et historique récent des membres accessibles dans votre périmètre."
        meta={[{ label: 'Effectif', value: agents.length }, { label: 'Résultats', value: filtered.length }]}
        rail={!error ? <GsStatRail><GsStat label="Personnel actif" value={agents.length} tone="seal" /><GsStat label="Fonctions représentées" value={functions.length} /><GsStat label="Personnels en congé" value={counts.leaves} tone={counts.leaves ? 'alert' : undefined} /><GsStat label="Absences signalées" value={counts.absences} tone={counts.absences ? 'alert' : undefined} /></GsStatRail> : null}
      />

      {error ? (
        <GsPanel tone="alert">
          <GsEmpty
            bare
            icon={<ShieldAlert size={27} />}
            title={noDepartment ? 'Aucun service rattaché à votre compte' : 'Impossible de charger le portfolio'}
            hint={error.response?.data?.message || (noDepartment ? 'Demandez à la direction de rattacher votre compte à un service.' : 'La connexion au serveur a échoué. Rechargez la page pour réessayer.')}
          />
        </GsPanel>
      ) : (
        <GsPanel
          title="Membres du service"
          sub={`${filtered.length} personnel(s)${isFiltering ? ` sur ${agents.length}` : ''}. Ouvrez une fiche pour consulter les éléments de suivi.`}
          tools={isFiltering ? <button type="button" className="gs-btn is-quiet" onClick={() => { setSearch(''); setFunctionFilter('all'); }}><X size={14} /> Réinitialiser</button> : null}
        >
          <GsFilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Nom, matricule ou fonction' }}
            end={functions.length > 1 ? <label className="gsport-field"><span>Fonction</span><select className="form-control" value={functionFilter} onChange={(event) => setFunctionFilter(event.target.value)}><option value="all">Toutes les fonctions</option>{functions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label> : null}
          />
          {isLoading ? <GsSkeleton variant="block" count={6} /> : <PortfolioGrid agents={filtered} onCardClick={setSelectedAgent} emptyMessage={isFiltering ? 'Aucun personnel ne correspond à cette recherche' : 'Aucun personnel actif dans ce service'} />}
        </GsPanel>
      )}

      {selectedAgent ? <StaffPortfolioModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} /> : null}
    </div>
  );
}

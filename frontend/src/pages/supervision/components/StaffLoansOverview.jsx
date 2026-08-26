/**
 * Coordination des prêts de personnel inter-service (Lot 5) — lecture seule.
 *
 * La DÉCISION reste au chef du service propriétaire (règle II, Lot 1) : ce
 * panneau ne fait que rendre visible au surveillant général — et à la direction,
 * depuis `/staff-loans` — ce qui circule entre les services de l'hôpital. Aucun
 * bouton d'acceptation ici, à dessein.
 *
 * Refonte (phase 4)
 * ─────────────────
 * Quatre couleurs de statut codées en dur et la date de garde en ISO. Le statut
 * passe au filet de gauche : l'ambre pour ce qui attend une décision, le bleu de
 * service pour ce qui est accordé, et un refus s'efface — c'est une décision
 * close, pas une chose à faire.
 *
 * La clé de requête garde son quatrième segment vide pour « Tous » : c'est celle
 * que `LiveGuardBoard` réutilise volontairement pour partager le cache au lieu
 * d'ouvrir une seconde requête identique.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ShieldAlert } from 'lucide-react';
import { supervisionAPI } from '../../../api';
import {
  GsPanel, GsPanelHeader, GsFilterBar, GsEmpty, GsSkeleton, GsBadge,
} from '../../../components/gs';
import { longFrenchDate } from '../../../utils/frenchDates';
import '../supervision.css';

/** Le nom de chaque statut, et le ton qu'il vaut dans le registre. */
const STATUS_META = {
  pending:       { label: 'En attente',   tone: 'alert' },
  approved:      { label: 'Accordé',      tone: 'duty' },
  auto_approved: { label: 'Auto-accordé', tone: 'duty' },
  rejected:      { label: 'Refusé',       tone: 'quiet' },
};

const FILTERS = [
  { id: 'all',      label: 'Tous' },
  { id: 'pending',  label: 'En attente' },
  { id: 'approved', label: 'Accordés' },
  { id: 'rejected', label: 'Refusés' },
];

export default function StaffLoansOverview({ title = 'Prêts de personnel inter-service', focusId = null }) {
  const [status, setStatus] = useState('all');
  const focusRef = useRef(null);

  const { data, isLoading, isError, error } = useQuery({
    // `''` et non `'all'` : `LiveGuardBoard` lit la même clé pour ne pas
    // redemander au serveur une liste que cet écran a déjà chargée.
    queryKey: ['supervision-loans', status === 'all' ? '' : status],
    queryFn: () => supervisionAPI.getLoans(status === 'all' ? undefined : { status }),
  });

  const payload = data?.data?.data;
  const loans = useMemo(() => payload?.loans || [], [payload?.loans]);
  const summary = payload?.summary || {};
  const isForbidden = error?.response?.status === 403;

  useEffect(() => {
    if (focusId && loans.some((loan) => loan.id === focusId)) {
      focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusId, loans]);

  const body = () => {
    if (isForbidden) {
      return (
        <GsEmpty
          bare
          icon={<ShieldAlert size={26} strokeWidth={1.6} />}
          title="Prêts non accessibles"
          hint="La coordination des prêts est réservée à la supervision générale et à la direction. Le chef de service, lui, les traite depuis son propre écran."
        />
      );
    }
    if (isError) {
      return (
        <GsEmpty
          bare
          title="Les prêts n'ont pas pu être chargés"
          hint="La connexion au serveur a échoué. Rechargez la page pour réessayer."
        />
      );
    }
    if (isLoading) return <GsSkeleton variant="rows" count={3} />;
    if (loans.length === 0) {
      return (
        <GsEmpty
          bare
          icon={<ArrowLeftRight size={26} strokeWidth={1.6} />}
          title={status === 'all' ? 'Aucun prêt de personnel enregistré' : 'Aucun prêt dans ce statut'}
          hint={status === 'all'
            ? 'Un prêt naît quand un chef de service demande à affecter un agent d\'un autre service à l\'une de ses gardes. La décision revient au chef propriétaire de l\'agent.'
            : 'Les autres statuts portent peut-être des demandes — retirez le filtre pour voir l\'ensemble.'}
          actions={status === 'all' ? null : (
            <button type="button" className="gs-btn is-quiet" onClick={() => setStatus('all')}>
              Voir tous les prêts
            </button>
          )}
        />
      );
    }

    return (
      <ul className="gsp-loans">
        {loans.map((l) => {
          const meta = STATUS_META[l.status] || { label: l.status, tone: 'quiet' };
          return (
            <li key={l.id} data-status={l.status} data-focus={focusId && l.id === focusId ? 'true' : undefined} ref={focusId && l.id === focusId ? focusRef : undefined}>
              <div className="gsp-top">
                <span className="gsp-title">{l.staffName}</span>
                <GsBadge tone={meta.tone} dot={l.status === 'pending'}>{meta.label}</GsBadge>
              </div>
              {/* Le sens du mouvement : de son service à celui qui l'emprunte. */}
              <p className="gsp-move">
                <span>{l.ownerDepartment || 'Service non précisé'}</span>
                <span>{l.requestingDepartment || 'Service non précisé'}</span>
              </p>
              <p className="gsp-meta">
                {l.shiftDate ? <span>garde du {longFrenchDate(l.shiftDate)}</span> : null}
                {l.scheduleName ? <span>{l.scheduleName}</span> : null}
                {l.requesterName ? <span>demandé par {l.requesterName}</span> : null}
                {l.ownerName ? <span>propriétaire {l.ownerName}</span> : null}
              </p>
              {l.responseReason ? <p className="gsp-quote">« {l.responseReason} »</p> : null}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <GsPanel
      header={(
        <>
          <GsPanelHeader
            title={title}
            sub={summary.total != null
              ? `${summary.total} demande(s) reçue(s), ${summary.pending || 0} en attente de décision. Règle II — la décision revient au chef du service propriétaire de l'agent.`
              : 'Règle II — la décision revient au chef du service propriétaire de l\'agent.'}
          />
          <GsFilterBar
            inset
            label="Statut des prêts"
            filters={FILTERS}
            value={status}
            onChange={setStatus}
            end={(summary.pending || 0) > 0
              ? (
                <GsBadge tone="alert" dot title="Demandes en attente de la décision d'un chef de service">
                  {summary.pending} en attente
                </GsBadge>
              )
              : null}
          />
        </>
      )}
    >
      {body()}
    </GsPanel>
  );
}

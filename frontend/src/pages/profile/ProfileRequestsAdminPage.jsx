import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, FileClock, Hospital, UserRound, X, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { profileAPI } from '../../api';
import Avatar from '../../components/common/Avatar';
import { GsBadge, GsEmpty, GsFilterBar, GsPageHeader, GsPanel, GsSkeleton, GsTable } from '../../components/gs';
import './profile-requests.css';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';
const FIELD_LABELS = {
  first_name: 'Prénom', last_name: 'Nom', first_name_ar: 'Prénom (arabe)', last_name_ar: 'Nom (arabe)',
  phone: 'Téléphone', birth_date: 'Naissance', gender: 'Genre', address: 'Adresse', city: 'Ville',
  id_card_number: 'N° CIN', id_card_expiry: 'Exp. CIN', hire_date: 'Recrutement', speciality: 'Fonction',
  grade: 'Grade', bio: 'Biographie', matricule: 'Matricule',
};
const STATUS = {
  pending: { label: 'En attente', tone: 'alert' },
  approved: { label: 'Approuvée', tone: 'duty' },
  rejected: { label: 'Refusée', tone: 'alert' },
  cancelled: { label: 'Remplacée', tone: 'quiet' },
};
const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function parseObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}
function displayValue(value, field) {
  if (value === null || value === undefined || value === '') return '—';
  if (field?.includes('date') || field?.includes('expiry') || field?.includes('hire')) return String(value).split('T')[0];
  return String(value);
}
function RequestStatus({ status }) {
  const config = STATUS[status] || STATUS.pending;
  return <GsBadge tone={config.tone} dot>{config.label}</GsBadge>;
}

function RequestCard({ request, busy, onApprove, onReject }) {
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const current = parseObject(request.current_data);
  const requested = parseObject(request.requested_data);
  const avatarUrl = request.avatar_url ? (request.avatar_url.startsWith('http') ? request.avatar_url : `${API_BASE}${request.avatar_url}`) : null;

  const reject = () => {
    if (!reason.trim()) return toast.error('Un motif de refus est obligatoire.');
    onReject(request.id, reason.trim());
    setRejecting(false);
    setReason('');
  };

  return (
    <article className={`gspr-card${open ? ' is-open' : ''}`}>
      <button type="button" className="gspr-card__header" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <Avatar avatarUrl={avatarUrl} firstName={request.first_name} lastName={request.last_name} size="md" />
        <span className="gspr-card__identity">
          <strong>{request.first_name} {request.last_name}</strong>
          <small><UserRound size={12} aria-hidden="true" /> {request.role_name || 'Rôle non renseigné'}</small>
          <small><Hospital size={12} aria-hidden="true" /> {request.establishment_name || 'Établissement non renseigné'}</small>
        </span>
        <span className="gspr-card__summary">{request.changed_fields?.length || 0} champ(s)<small>{(request.changed_fields || []).slice(0, 3).map((field) => FIELD_LABELS[field] || field).join(', ')}</small></span>
        <span className="gspr-card__status"><RequestStatus status={request.status} /><time dateTime={request.submitted_at}>{DATE_FORMAT.format(new Date(request.submitted_at))}</time></span>
        {open ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronRight size={17} aria-hidden="true" />}
      </button>

      {open ? (
        <div className="gspr-card__body">
          <GsTable
            label={`Modifications demandées pour ${request.first_name} ${request.last_name}`}
            columns={[
              { key: 'field', label: 'Champ', strong: true },
              { key: 'current', label: 'Actuel' },
              { key: 'requested', label: 'Demandé' },
            ]}
            rows={(request.changed_fields || []).map((field) => ({ field, current: displayValue(current[field], field), requested: displayValue(requested[field], field) }))}
            rowKey="field"
            className="gspr-diff-table"
          />
          {request.rejection_reason ? <p className="gspr-reason">Motif enregistré : {request.rejection_reason}</p> : null}
          {request.status === 'pending' ? (
            <div className="gspr-card__actions">
              <button type="button" className="gs-btn is-primary" disabled={busy} onClick={() => onApprove(request.id)}><Check size={15} aria-hidden="true" /> Approuver</button>
              <button type="button" className="gs-btn is-danger" disabled={busy} onClick={() => setRejecting(true)}><X size={15} aria-hidden="true" /> Refuser</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {rejecting ? (
        <div className="gspr-reject-dialog" role="dialog" aria-modal="true" aria-label="Motif de refus">
          <div className="gspr-reject-dialog__box">
            <div className="gspr-reject-dialog__head"><strong>Refuser la demande</strong><button type="button" onClick={() => setRejecting(false)} aria-label="Fermer"><X size={16} /></button></div>
            <label className="gspr-reject-dialog__field"><span>Motif</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} autoFocus placeholder="Expliquez la décision au personnel…" /></label>
            <div className="gspr-reject-dialog__actions"><button type="button" className="gs-btn" onClick={() => setRejecting(false)}>Annuler</button><button type="button" className="gs-btn is-danger" disabled={!reason.trim() || busy} onClick={reject}><XCircle size={15} aria-hidden="true" /> Confirmer le refus</button></div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function ProfileRequestsAdminPage() {
  const [filter, setFilter] = useState('pending');
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-profile-requests', filter],
    queryFn: () => profileAPI.adminGetRequests({ status: filter }).then((response) => response.data),
    refetchInterval: 30_000,
  });
  const { data: countData } = useQuery({ queryKey: ['admin-pending-count'], queryFn: () => profileAPI.adminPendingCount().then((response) => response.data.data), refetchInterval: 20_000 });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-profile-requests'] });
    queryClient.invalidateQueries({ queryKey: ['admin-pending-count'] });
  };
  const approve = useMutation({ mutationFn: (id) => profileAPI.adminApprove(id), onSuccess: () => { toast.success('Modifications appliquées'); invalidate(); }, onError: (error) => toast.error(error.response?.data?.message || 'Erreur') });
  const reject = useMutation({ mutationFn: ({ id, reason }) => profileAPI.adminReject(id, reason), onSuccess: () => { toast.success('Demande refusée'); invalidate(); }, onError: (error) => toast.error(error.response?.data?.message || 'Erreur') });
  const pending = countData?.count || 0;
  const requests = data?.data || [];
  const filters = [
    { id: 'pending', label: 'En attente', count: pending, tone: 'alert' },
    { id: 'approved', label: 'Approuvées' },
    { id: 'rejected', label: 'Refusées' },
    { id: 'all', label: 'Toutes' },
  ];

  return (
    <div className="gspr-page">
      <GsPageHeader
        eyebrow="Super Admin · Gouvernance"
        title="Demandes de profil"
        subtitle="Examinez chaque changement, comparez les valeurs et rendez une décision immuable."
        meta={[{ label: 'À traiter', value: pending, numeric: true }, { label: 'Vue', value: filter === 'all' ? 'Toutes les demandes' : (STATUS[filter]?.label || filter) }]}
        rail={<GsFilterBar filters={filters} value={filter} onChange={setFilter} label="Filtrer les demandes" />}
      />
      <GsPanel title={filter === 'pending' ? 'File de validation' : 'Demandes archivées'} sub="Les notifications et les décisions restent synchronisées en temps réel." icon={<FileClock size={18} aria-hidden="true" />}>
        {isLoading ? <GsSkeleton variant="block" count={4} /> : requests.length === 0 ? <GsEmpty icon={<Check size={27} aria-hidden="true" />} title={filter === 'pending' ? 'Aucune demande en attente' : 'Aucune demande dans cette vue'} hint={filter === 'pending' ? 'La file est à jour.' : 'Changez le filtre pour consulter un autre état.'} /> : <div className="gspr-list">{requests.map((request) => <RequestCard key={request.id} request={request} busy={approve.isPending || reject.isPending} onApprove={(id) => approve.mutate(id)} onReject={(id, reason) => reject.mutate({ id, reason })} />)}</div>}
      </GsPanel>
    </div>
  );
}

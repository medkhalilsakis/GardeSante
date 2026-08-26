import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, Check, ChevronRight, Clock3, Eye, Plus, RefreshCw, ShieldCheck, Trash2, UserRoundCheck, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { replacementsAPI } from '../../../api';
import { useAuthStore } from '../../../store';
import ReplacementFormModal from './ReplacementFormModal';
import SchedulePreviewModal from './SchedulePreviewModal';
import './Replacements.css';

const parseDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').slice(0, 10));
  return match ? new Date(+match[1], +match[2] - 1, +match[3]) : new Date(value);
};

const fmtDate = (value, long = false) => {
  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', long ? { day: '2-digit', month: 'long', year: 'numeric' } : { day: '2-digit', month: 'short' });
};

const scopeInfo = (replacement) => {
  if (replacement.scope === 'single_day') return { icon: CalendarDays, label: fmtDate(replacement.start_date, true) };
  if (replacement.scope === 'date_range') return { icon: CalendarDays, label: `${fmtDate(replacement.start_date)} au ${fmtDate(replacement.end_date)}` };
  if (replacement.scope === 'time_slot') return { icon: Clock3, label: `${fmtDate(replacement.start_date)} · ${String(replacement.start_time || '').slice(0, 5)}-${String(replacement.end_time || '').slice(0, 5)}` };
  return { icon: RefreshCw, label: 'Toute la durée de la garde' };
};

export default function ReplacementsPanel({ initialScheduleId = null }) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isChef = user?.roleCode === 'department_head' || user?.roleCode === 'super_admin';
  const isSupervisor = ['service_supervisor', 'general_supervisor'].includes(user?.roleCode);
  const canCreate = isChef || isSupervisor;
  const [selectedScheduleId, setSelectedScheduleId] = useState(initialScheduleId || '');
  const [previewSchedule, setPreviewSchedule] = useState(null);
  const [formSchedule, setFormSchedule] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: schedulesResponse, isLoading: schedulesLoading } = useQuery({
    queryKey: ['eligible-schedules'],
    queryFn: () => replacementsAPI.getEligibleSchedules().then((response) => response.data),
  });
  const schedules = useMemo(() => schedulesResponse?.data || [], [schedulesResponse?.data]);

  useEffect(() => {
    if (!schedules.length) return setSelectedScheduleId('');
    const requestedId = initialScheduleId || selectedScheduleId;
    if (!schedules.some((schedule) => String(schedule.id) === String(requestedId))) setSelectedScheduleId(schedules[0].id);
  }, [initialScheduleId, schedules, selectedScheduleId]);

  const activeSchedule = useMemo(() => schedules.find((schedule) => String(schedule.id) === String(selectedScheduleId)) || null, [schedules, selectedScheduleId]);
  const { data: replacementsResponse, isLoading: replacementsLoading } = useQuery({
    queryKey: ['overlay-replacements', selectedScheduleId],
    queryFn: () => replacementsAPI.getOverlay({ scheduleId: selectedScheduleId }).then((response) => response.data),
    enabled: !!selectedScheduleId,
  });
  const replacements = useMemo(() => replacementsResponse?.data || [], [replacementsResponse?.data]);
  const pending = replacements.filter((replacement) => replacement.confirmation_status === 'pending_chef');
  const confirmed = replacements.filter((replacement) => replacement.confirmation_status === 'confirmed');
  const replacedPeopleCount = replacements.reduce((total, replacement) => total + (replacement.items?.length || 0), 0);
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['overlay-replacements'] });
    queryClient.invalidateQueries({ queryKey: ['eligible-schedules'] });
  };

  const confirmMutation = useMutation({
    mutationFn: (id) => replacementsAPI.confirmOverlay(id).then((response) => response.data),
    onSuccess: (response) => { toast.success(response.message || 'Remplacement confirmé'); invalidate(); },
    onError: (error) => toast.error(error?.response?.data?.message || 'Échec de la confirmation'),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => replacementsAPI.rejectOverlay(id, { reason }).then((response) => response.data),
    onSuccess: (response) => { toast.success(response.message || 'Remplacement refusé'); setRejectTarget(null); setRejectReason(''); invalidate(); },
    onError: (error) => toast.error(error?.response?.data?.message || 'Échec du refus'),
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => replacementsAPI.deleteOverlay(id).then((response) => response.data),
    onSuccess: (response) => { toast.success(response.message || 'Remplacement supprimé'); invalidate(); },
    onError: (error) => toast.error(error?.response?.data?.message || 'Suppression impossible'),
  });

  const ReplacementCard = ({ replacement }) => {
    const scope = scopeInfo(replacement);
    const ScopeIcon = scope.icon;
    const isPending = replacement.confirmation_status === 'pending_chef';
    const canDelete = isChef || (isPending && replacement.requested_by === user?.id);
    return (
      <article className={`replacement-card ${isPending ? 'is-pending' : 'is-confirmed'}`}>
        <div className="replacement-card__topline">
          <span className={`replacement-status ${isPending ? 'is-pending' : 'is-confirmed'}`}>{isPending ? <Clock3 size={14} /> : <ShieldCheck size={14} />}{isPending ? 'En attente du chef' : 'Remplacement actif'}</span>
          <span className="replacement-scope"><ScopeIcon size={14} />{scope.label}</span>
        </div>
        <div className="replacement-pairs">
          {(replacement.items || []).map((item) => (
            <div className="replacement-pair" key={item.id}>
              <div className="replacement-person is-origin"><span className="replacement-avatar">{item.absentFirstName?.[0]}{item.absentLastName?.[0]}</span><span><strong>{item.absentLastName} {item.absentFirstName}</strong><small>Personnel d'origine</small></span></div>
              <span className="replacement-arrow"><ArrowRight size={18} /></span>
              <div className="replacement-person is-replacer"><span className="replacement-avatar"><UserRoundCheck size={17} /></span><span><strong>{item.replacementLastName} {item.replacementFirstName}</strong><small>{item.isCrossDepartment && item.fromDepartmentName ? item.fromDepartmentName : 'Remplaçant'}</small></span></div>
            </div>
          ))}
        </div>
        <div className="replacement-card__footer">
          <div className="replacement-meta"><span>Déclaré par {replacement.requested_by_first} {replacement.requested_by_last}</span>{replacement.reason && <span className="replacement-reason">{replacement.reason}</span>}</div>
          <div className="replacement-actions">
            {isChef && isPending && <><button className="replacement-icon-button is-success" title="Confirmer" onClick={() => confirmMutation.mutate(replacement.id)}><Check size={17} /></button><button className="replacement-icon-button is-danger" title="Refuser" onClick={() => setRejectTarget(replacement)}><X size={17} /></button></>}
            {canDelete && !(isChef && isPending) && <button className="replacement-icon-button" title="Supprimer" onClick={() => window.confirm('Supprimer ce remplacement ?') && deleteMutation.mutate(replacement.id)}><Trash2 size={17} /></button>}
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="replacements-space">
      <section className="replacements-hero">
        <div className="replacements-hero__content"><span className="replacements-eyebrow"><RefreshCw size={15} /> Continuité de service</span><h3>Remplacements sur les gardes en cours</h3><p>Le tableur validé reste intact. Chaque remplaçant est ajouté en surcouche pour conserver une traçabilité complète.</p></div>
        <div className="replacements-hero__stats"><div><strong>{schedules.length}</strong><span>garde{schedules.length > 1 ? 's' : ''} en cours</span></div><div><strong>{replacedPeopleCount}</strong><span>personnel remplacé</span></div><div><strong>{pending.length}</strong><span>en attente</span></div></div>
      </section>

      <section className="replacement-workspace">
        <div className="replacement-schedule-selector">
          <div className="replacement-field"><label htmlFor="replacement-schedule">Garde actuellement en cours</label><div className="replacement-select-wrap"><CalendarDays size={18} /><select id="replacement-schedule" value={selectedScheduleId} onChange={(event) => setSelectedScheduleId(event.target.value)} disabled={!schedules.length}>{!schedules.length && <option value="">Aucune garde en cours</option>}{schedules.map((schedule) => <option value={schedule.id} key={schedule.id}>{schedule.name} · {schedule.department_name}</option>)}</select><ChevronRight size={17} /></div></div>
          <div className="replacement-toolbar"><button className="replacement-secondary-button" disabled={!activeSchedule} onClick={() => setPreviewSchedule(activeSchedule)}><Eye size={17} /> Aperçu du tableur</button>{canCreate && <button className="replacement-primary-button" disabled={!activeSchedule} onClick={() => setFormSchedule(activeSchedule)}><Plus size={18} /> Nouveau remplacement</button>}</div>
        </div>
        {activeSchedule && <div className="replacement-active-schedule"><div className="replacement-active-schedule__icon"><CalendarDays size={22} /></div><div><strong>{activeSchedule.name}</strong><span>{activeSchedule.department_name}</span></div><div className="replacement-active-schedule__period">{fmtDate(activeSchedule.start_date, true)}<ArrowRight size={15} />{fmtDate(activeSchedule.end_date, true)}</div><span className="replacement-live-dot">En cours</span></div>}
      </section>

      {schedulesLoading ? <div className="replacement-empty"><RefreshCw className="replacement-spin" size={26} /><strong>Chargement des gardes en cours</strong></div> : !schedules.length ? <div className="replacement-empty"><CalendarDays size={34} /><strong>Aucune garde en cours</strong><span>Les gardes futures et terminées ne sont pas proposées au remplacement.</span></div> : (
        <div className="replacement-lists">
          {!!pending.length && <section className="replacement-list-section"><div className="replacement-section-title is-pending"><span><Clock3 size={18} /> À confirmer</span><b>{pending.length}</b></div><div className="replacement-card-list">{pending.map((replacement) => <ReplacementCard key={replacement.id} replacement={replacement} />)}</div></section>}
          <section className="replacement-list-section"><div className="replacement-section-title"><span><Users size={18} /> Remplacements actifs</span><b>{confirmed.length}</b></div>{replacementsLoading ? <div className="replacement-empty is-compact"><RefreshCw className="replacement-spin" size={22} /> Chargement</div> : confirmed.length ? <div className="replacement-card-list">{confirmed.map((replacement) => <ReplacementCard key={replacement.id} replacement={replacement} />)}</div> : <div className="replacement-empty is-compact"><UserRoundCheck size={27} /><strong>Aucun remplacement actif</strong><span>La garde sélectionnée suit encore son affectation d'origine.</span></div>}</section>
        </div>
      )}

      {previewSchedule && <SchedulePreviewModal schedule={previewSchedule} replacements={replacements} onClose={() => setPreviewSchedule(null)} />}
      {formSchedule && <ReplacementFormModal schedule={formSchedule} isChef={isChef} onClose={() => setFormSchedule(null)} />}
      {rejectTarget && <div className="replacement-modal-backdrop" onClick={() => setRejectTarget(null)}><div className="replacement-dialog is-small" onClick={(event) => event.stopPropagation()}><div className="replacement-dialog__header"><div><span className="replacement-dialog__eyebrow">Décision du chef</span><h3>Refuser ce remplacement</h3></div><button className="replacement-icon-button" onClick={() => setRejectTarget(null)}><X size={18} /></button></div><div className="replacement-dialog__body"><p className="replacement-dialog__notice is-danger">La proposition sera supprimée et son auteur sera informé.</p><label className="replacement-label">Motif du refus</label><textarea className="replacement-input" rows={4} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Précisez la raison, si nécessaire" /></div><div className="replacement-dialog__footer"><button className="replacement-secondary-button" onClick={() => setRejectTarget(null)}>Annuler</button><button className="replacement-danger-button" disabled={rejectMutation.isPending} onClick={() => rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason })}>Refuser et supprimer</button></div></div></div>}
    </div>
  );
}

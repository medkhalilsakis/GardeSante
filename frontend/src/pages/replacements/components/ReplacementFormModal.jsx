import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, Check, Clock3, Search, ShieldAlert, UserRound, UserRoundCheck, X } from 'lucide-react';
import { replacementsAPI, schedulesAPI } from '../../../api';
import toast from 'react-hot-toast';
import './Replacements.css';

const SCOPES = [
  { key: 'full_period', label: 'Toute la garde', hint: 'Du début à la fin', icon: CalendarDays },
  { key: 'date_range', label: 'Une période', hint: 'Choisir plusieurs jours', icon: CalendarDays },
  { key: 'single_day', label: 'Un seul jour', hint: 'Une date précise', icon: Check },
  { key: 'time_slot', label: 'Un créneau', hint: 'Jour et horaires', icon: Clock3 },
];
const fullName = (person) => `${person.last_name || ''} ${person.first_name || ''}`.trim();
const fmtLong = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').slice(0, 10));
  const date = match ? new Date(+match[1], +match[2] - 1, +match[3]) : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
};

export default function ReplacementFormModal({ schedule, isChef, onClose }) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState('full_period');
  const [startDate, setStartDate] = useState(schedule?.start_date?.slice(0, 10) || '');
  const [endDate, setEndDate] = useState(schedule?.end_date?.slice(0, 10) || '');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [reason, setReason] = useState('');
  const [pairs, setPairs] = useState([]);
  const [originSearch, setOriginSearch] = useState('');
  const [replacementSearch, setReplacementSearch] = useState('');

  const { data: staffResponse, isLoading: staffLoading } = useQuery({ queryKey: ['replacement-schedule-staff', schedule?.id], queryFn: () => replacementsAPI.getScheduleStaff(schedule.id).then((response) => response.data), enabled: !!schedule?.id });
  const scheduleStaff = useMemo(() => staffResponse?.data || [], [staffResponse?.data]);
  const { data: hospitalResponse } = useQuery({ queryKey: ['hospital-staff-replacement', replacementSearch], queryFn: () => schedulesAPI.getHospitalStaff({ search: replacementSearch || undefined, limit: 200 }).then((response) => response.data) });
  const hospitalStaff = useMemo(() => hospitalResponse?.data || [], [hospitalResponse?.data]);
  const selectedIds = useMemo(() => new Set(pairs.map((pair) => pair.absentUserId)), [pairs]);
  const filteredScheduleStaff = useMemo(() => {
    const needle = originSearch.trim().toLowerCase();
    if (!needle) return scheduleStaff;
    return scheduleStaff.filter((person) => `${fullName(person)} ${person.role_name || ''} ${person.department_name || ''}`.toLowerCase().includes(needle));
  }, [originSearch, scheduleStaff]);

  const toggleOrigin = (userId) => setPairs((current) => current.some((pair) => pair.absentUserId === userId) ? current.filter((pair) => pair.absentUserId !== userId) : [...current, { absentUserId: userId, replacementUserId: '' }]);
  const setReplacer = (absentUserId, replacementUserId) => setPairs((current) => current.map((pair) => pair.absentUserId === absentUserId ? { ...pair, replacementUserId } : pair));
  const mutation = useMutation({
    mutationFn: (payload) => replacementsAPI.createOverlay(payload).then((response) => response.data),
    onSuccess: (response) => { toast.success(response.message || 'Remplacement enregistré'); (response.warnings || []).forEach((warning) => toast(warning.message, { icon: '!', duration: 6000 })); queryClient.invalidateQueries({ queryKey: ['overlay-replacements'] }); queryClient.invalidateQueries({ queryKey: ['eligible-schedules'] }); onClose?.(); },
    onError: (error) => toast.error(error?.response?.data?.message || "Échec de l'enregistrement"),
  });
  const submit = () => {
    if (!pairs.length) return toast.error('Sélectionnez au moins un personnel à remplacer.');
    const incomplete = pairs.find((pair) => !pair.replacementUserId);
    if (incomplete) return toast.error(`Choisissez un remplaçant pour ${fullName(scheduleStaff.find((person) => person.id === incomplete.absentUserId) || {})}.`);
    if (scope !== 'full_period' && !startDate) return toast.error('La date est requise.');
    if (scope === 'date_range' && (!endDate || endDate < startDate)) return toast.error('La période sélectionnée est invalide.');
    if (scope === 'time_slot' && (!startTime || !endTime || endTime <= startTime)) return toast.error('Les horaires sélectionnés sont invalides.');
    mutation.mutate({ scheduleId: schedule.id, scope, startDate: scope === 'full_period' ? undefined : startDate, endDate: scope === 'date_range' ? endDate : scope === 'time_slot' ? startDate : undefined, startTime: scope === 'time_slot' ? startTime : undefined, endTime: scope === 'time_slot' ? endTime : undefined, reason: reason || undefined, items: pairs });
  };

  return (
    <div className="replacement-modal-backdrop" onClick={onClose}>
      <div className="replacement-dialog replacement-form-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="replacement-dialog__header"><div><span className="replacement-dialog__eyebrow"><ShieldAlert size={14} /> Nouvelle surcouche</span><h3>Organiser un remplacement</h3><p>{schedule?.name} · {schedule?.department_name}</p></div><button className="replacement-icon-button" onClick={onClose} title="Fermer"><X size={18} /></button></div>
        {!isChef && <div className="replacement-dialog__notice is-warning"><Clock3 size={17} /> Votre proposition sera visible après confirmation du chef de service.</div>}
        <div className="replacement-dialog__body replacement-form-body">
          <section className="replacement-form-section"><div className="replacement-form-section__heading"><span className="replacement-step">1</span><div><h4>Quand le remplacement s'applique-t-il ?</h4><p>La sélection reste limitée à la période de cette garde.</p></div></div><div className="replacement-scope-grid">{SCOPES.map((item) => { const Icon = item.icon; return <button type="button" key={item.key} className={`replacement-scope-card ${scope === item.key ? 'is-selected' : ''}`} onClick={() => setScope(item.key)}><Icon size={19} /><strong>{item.label}</strong><small>{item.hint}</small></button>; })}</div>{scope !== 'full_period' && <div className={`replacement-date-fields ${scope === 'time_slot' ? 'has-time' : ''}`}><label className="replacement-label">{scope === 'date_range' ? 'Du' : 'Date'}<input className="replacement-input" type="date" value={startDate} min={schedule?.start_date?.slice(0, 10)} max={schedule?.end_date?.slice(0, 10)} onChange={(event) => setStartDate(event.target.value)} /></label>{scope === 'date_range' && <label className="replacement-label">Au<input className="replacement-input" type="date" value={endDate} min={startDate || schedule?.start_date?.slice(0, 10)} max={schedule?.end_date?.slice(0, 10)} onChange={(event) => setEndDate(event.target.value)} /></label>}{scope === 'time_slot' && <><label className="replacement-label">De<input className="replacement-input" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><label className="replacement-label">À<input className="replacement-input" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label></>}</div>}{scope === 'full_period' && <div className="replacement-period-note"><CalendarDays size={16} /> Du {fmtLong(schedule?.start_date)} au {fmtLong(schedule?.end_date)}</div>}</section>

          <section className="replacement-form-section"><div className="replacement-form-section__heading"><span className="replacement-step">2</span><div><h4>Qui doit être remplacé ? <b>{pairs.length}</b></h4><p>Sélectionnez une ou plusieurs personnes de la garde d'origine.</p></div></div><div className="replacement-search"><Search size={17} /><input value={originSearch} onChange={(event) => setOriginSearch(event.target.value)} placeholder="Rechercher par nom, rôle ou service" /></div>{staffLoading ? <div className="replacement-loading-line">Chargement du personnel affecté...</div> : <div className="replacement-origin-list">{filteredScheduleStaff.map((person) => { const selected = selectedIds.has(person.id); return <button type="button" className={`replacement-origin-row ${selected ? 'is-selected' : ''}`} key={person.id} onClick={() => toggleOrigin(person.id)}><span className="replacement-check">{selected && <Check size={15} />}</span><span className="replacement-avatar">{person.first_name?.[0]}{person.last_name?.[0]}</span><span className="replacement-person-copy"><strong>{fullName(person)}</strong><small>{person.role_name || 'Personnel'}{person.department_name ? ` · ${person.department_name}` : ''}</small></span>{selected && <UserRoundCheck size={17} />}</button>; })}{!filteredScheduleStaff.length && <div className="replacement-list-empty">Aucun personnel correspondant.</div>}</div>}</section>

          {!!pairs.length && <section className="replacement-form-section"><div className="replacement-form-section__heading"><span className="replacement-step">3</span><div><h4>Associer chaque remplaçant</h4><p>Les personnes de tous les services de l'hôpital sont disponibles.</p></div></div><div className="replacement-search"><Search size={17} /><input value={replacementSearch} onChange={(event) => setReplacementSearch(event.target.value)} placeholder="Rechercher un remplaçant" /></div><div className="replacement-assignment-list">{pairs.map((pair) => { const origin = scheduleStaff.find((person) => person.id === pair.absentUserId); const chosen = hospitalStaff.find((person) => person.id === pair.replacementUserId); return <div className="replacement-assignment" key={pair.absentUserId}><div className="replacement-assignment__origin"><span className="replacement-avatar">{origin?.first_name?.[0]}{origin?.last_name?.[0]}</span><span><strong>{fullName(origin || {})}</strong><small>Personnel d'origine</small></span></div><ArrowRight className="replacement-assignment__arrow" size={19} /><div className="replacement-assignment__select"><UserRound size={16} /><select value={pair.replacementUserId} onChange={(event) => setReplacer(pair.absentUserId, event.target.value)}><option value="">Choisir le remplaçant</option>{hospitalStaff.filter((person) => person.id !== pair.absentUserId).map((person) => <option key={person.id} value={person.id}>{fullName(person)}{person.dept_name ? ` · ${person.dept_name}` : ''}</option>)}</select>{chosen?.dept_name && origin?.department_id && chosen.dept_id !== origin.department_id && <small className="replacement-cross-service">Autre service · {chosen.dept_name}</small>}</div></div>; })}</div></section>}
          <section className="replacement-form-section"><label className="replacement-label">Motif ou précision <span>(facultatif)</span><textarea className="replacement-input" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex. congé exceptionnel, formation, mission..." /></label></section>
        </div>
        <div className="replacement-dialog__footer"><span className="replacement-footer-hint"><ShieldAlert size={15} /> Le tableur d'origine restera consultable.</span><div><button className="replacement-secondary-button" onClick={onClose}>Annuler</button><button className="replacement-primary-button" disabled={mutation.isPending} onClick={submit}>{mutation.isPending ? 'Enregistrement...' : isChef ? 'Enregistrer le remplacement' : 'Envoyer la proposition'}</button></div></div>
      </div>
    </div>
  );
}

import React, { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileClock,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulesAPI } from '../../api';
import { useAuthStore } from '../../store';
import {
  GsBadge,
  GsEmpty,
  GsPageHeader,
  GsPanel,
  GsSkeleton,
  GsStat,
  GsStatRail,
} from '../../components/gs';
import { frenchRange, longFrenchDate } from '../../utils/frenchDates';
import './ScheduleDetailPage.css';

const WEEKDAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

const dateKey = (value) => String(value || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const daysBetween = (start, end) => {
  const first = dateKey(start);
  const last = dateKey(end);
  if (!first || !last || first > last) return [];
  const cursor = new Date(`${first}T12:00:00`);
  const stop = new Date(`${last}T12:00:00`);
  const result = [];
  while (cursor <= stop) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    result.push(key);
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
};

const dayOfWeek = (key) => new Date(`${key}T12:00:00`).getDay();

const stateMeta = (schedule) => {
  const state = schedule?.state || (schedule?.status === 'draft' ? 'brouillon' : '');
  if (state === 'en_cours' || schedule?.status === 'active') return { label: 'En cours', tone: 'duty' };
  if (state === 'soumis' || schedule?.status === 'submitted') return { label: 'En vigueur', tone: 'seal' };
  if (state === 'termine' || schedule?.status === 'archived') return { label: 'Terminé', tone: 'quiet' };
  return { label: 'Brouillon', tone: 'quiet' };
};

const normalizeShift = (shift) => ({
  ...shift,
  userId: shift?.user_id || shift?.userId,
  date: dateKey(shift?.shift_date || shift?.shiftDate),
  label: shift?.shift_type_name || shift?.shiftTypeName || 'De service',
  status: shift?.status || 'planned',
});

export default function ScheduleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuthStore();
  const qc = useQueryClient();
  const canEdit = hasPermission('schedules.update');

  const { data: schedule, isLoading: loadingSchedule } = useQuery({
    queryKey: ['schedule', id],
    queryFn: () => schedulesAPI.getOne(id).then((response) => response.data.data),
    enabled: Boolean(id),
  });

  // Keep the historical cache key for realtime consumers, but read the
  // projection produced from metadata.spreadsheet.rows instead of `/shifts`.
  const { data: shiftsData, isLoading: loadingShifts } = useQuery({
    queryKey: ['schedule-shifts', id],
    queryFn: () => schedulesAPI.getOne(id).then((response) => response.data.data?.shifts || []),
    enabled: Boolean(id),
  });

  const { data: conflicts = [] } = useQuery({
    queryKey: ['schedule-conflicts', id],
    queryFn: () => schedulesAPI.getConflicts(id).then((response) => response.data.data),
    enabled: Boolean(id),
  });

  const shifts = useMemo(() => {
    const source = Array.isArray(shiftsData) && shiftsData.length
      ? shiftsData
      : Array.isArray(schedule?.shifts) ? schedule.shifts : [];
    return source.map(normalizeShift).filter((shift) => shift.userId && shift.date);
  }, [schedule?.shifts, shiftsData]);

  const days = useMemo(() => daysBetween(schedule?.start_date, schedule?.end_date), [schedule?.start_date, schedule?.end_date]);
  const staff = useMemo(() => {
    const byId = new Map();
    shifts.forEach((shift) => {
      if (!byId.has(shift.userId)) {
        byId.set(shift.userId, {
          id: shift.userId,
          firstName: shift.first_name || shift.firstName || '',
          lastName: shift.last_name || shift.lastName || '',
          grade: shift.grade || shift.role_name || '',
        });
      }
    });
    return [...byId.values()].sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'fr'));
  }, [shifts]);
  const shiftMap = useMemo(() => {
    const map = new Map();
    shifts.forEach((shift) => {
      const key = `${shift.userId}|${shift.date}`;
      const current = map.get(key) || [];
      current.push(shift);
      map.set(key, current);
    });
    return map;
  }, [shifts]);
  const coveredDays = useMemo(() => new Set(shifts.map((shift) => shift.date)).size, [shifts]);
  const meta = stateMeta(schedule);

  const submitMutation = useMutation({
    mutationFn: () => schedulesAPI.submit(id, {}),
    onSuccess: (response) => {
      toast.success(response?.data?.message || 'Planning envoyé et mis en vigueur');
      qc.invalidateQueries({ queryKey: ['schedule', id] });
      qc.invalidateQueries({ queryKey: ['schedules'] });
    },
    onError: (error) => toast.error(error?.response?.data?.message || 'Impossible de mettre le planning en vigueur'),
  });

  if (loadingSchedule) {
    return (
      <div className="gsdl-page gs-clamp">
        <GsSkeleton variant="block" count={3} />
      </div>
    );
  }

  if (!schedule) {
    return (
      <div className="gsdl-page gs-clamp">
        <GsEmpty
          icon={<ClipboardList size={28} />}
          title="Planning introuvable"
          hint="Ce planning n'est plus accessible dans votre périmètre."
          actions={<button type="button" className="gs-btn" onClick={() => navigate('/schedules')}><ArrowLeft size={14} /> Retour aux plannings</button>}
        />
      </div>
    );
  }

  const openSpreadsheet = () => navigate(`/chef-de-service?tab=schedules&view=spreadsheet&scheduleId=${encodeURIComponent(id)}`);

  return (
    <div className="gsdl-page gs-clamp">
      <GsPageHeader
        eyebrow="Détail du planning"
        title={schedule.name}
        subtitle={schedule.department_name || schedule.department_name_ar || 'Service non précisé'}
        meta={[
          { icon: <CalendarDays size={14} />, value: frenchRange(dateKey(schedule.start_date), dateKey(schedule.end_date)) },
          { icon: <Users size={14} />, value: `${staff.length} personnel(s)` },
          { value: <GsBadge tone={meta.tone}>{meta.label}</GsBadge> },
        ]}
        actions={(
          <div className="gsdl-actions">
            <button type="button" className="gs-btn" onClick={() => navigate('/schedules')}>
              <ArrowLeft size={14} /> Plannings
            </button>
            {canEdit && ['draft', 'submitted', 'active'].includes(schedule.status) ? (
              <button type="button" className="gs-btn is-primary" onClick={openSpreadsheet}>
                <ClipboardList size={14} /> Ouvrir le tableur
              </button>
            ) : null}
            {schedule.status === 'draft' && hasPermission('schedules.submit') ? (
              <button type="button" className="gs-btn is-primary" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
                <CheckCircle2 size={14} /> {submitMutation.isPending ? 'Envoi...' : 'Mettre en vigueur'}
              </button>
            ) : null}
          </div>
        )}
      />

      {conflicts.length > 0 ? (
        <GsPanel tone="alert" title="Points à vérifier" sub={`${conflicts.length} conflit(s) détecté(s)`} icon={<AlertTriangle size={16} />}>
          <ul className="gsdl-conflict-list">
            {conflicts.slice(0, 8).map((conflict, index) => <li key={conflict.id || `${conflict.type || 'conflict'}-${index}`}>{conflict.message || JSON.stringify(conflict)}</li>)}
          </ul>
        </GsPanel>
      ) : null}

      <GsStatRail>
        <GsStat label="Affectations" value={shifts.length} tone="duty" hint="Personnel × jour" />
        <GsStat label="Personnel de service" value={staff.length} hint="Agents distincts" />
        <GsStat label="Jours couverts" value={coveredDays} hint={`sur ${days.length || 0} jour(s)`} />
        <GsStat label="Conflits" value={conflicts.length} tone={conflicts.length ? 'alert' : 'seal'} hint={conflicts.length ? 'À examiner' : 'Aucun signalement'} />
      </GsStatRail>

      <GsPanel
        title="Registre quotidien"
        sub={loadingShifts ? 'Lecture des affectations...' : 'Une case cochée représente une journée de service dans le Tableur.'}
        icon={<CalendarDays size={16} />}
        flush
      >
        {loadingShifts ? <GsSkeleton variant="rows" count={7} /> : staff.length === 0 ? (
          <GsEmpty
            icon={<FileClock size={26} />}
            title="Aucune affectation enregistrée"
            hint={schedule.status === 'draft' ? 'Ouvrez le tableur pour affecter le personnel et les périodes.' : 'Ce planning ne contient aucune journée de service.'}
            actions={canEdit && schedule.status === 'draft' ? <button type="button" className="gs-btn is-primary" onClick={openSpreadsheet}>Ouvrir le tableur</button> : null}
          />
        ) : (
          <div className="gsdl-grid-wrap">
            <table className="gsdl-grid" aria-label="Affectations par personnel et par jour">
              <thead>
                <tr>
                  <th className="gsdl-person-col" scope="col">Personnel</th>
                  {days.map((day) => {
                    const weekend = [0, 6].includes(dayOfWeek(day));
                    const today = day === localToday();
                    return <th key={day} className={[weekend ? 'is-weekend' : '', today ? 'is-today' : ''].filter(Boolean).join(' ')} scope="col"><span>{WEEKDAYS[dayOfWeek(day)]}</span><b>{day.slice(8)}</b></th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {staff.map((person) => (
                  <tr key={person.id}>
                    <th className="gsdl-person" scope="row">
                      <strong>{person.firstName} {person.lastName}</strong>
                      <span>{person.grade || 'Fonction non précisée'}</span>
                    </th>
                    {days.map((day) => {
                      const entries = shiftMap.get(`${person.id}|${day}`) || [];
                      const weekend = [0, 6].includes(dayOfWeek(day));
                      return (
                        <td key={day} className={weekend ? 'is-weekend' : undefined}>
                          {entries.map((entry) => (
                            <span key={entry.id || `${entry.userId}-${entry.date}-${entry.label}`} className={`gsdl-duty${entry.status === 'cancelled' ? ' is-cancelled' : ''}`} title={`${entry.label} — ${entry.status}`}>
                              {entry.label.slice(0, 3).toUpperCase()}
                            </span>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GsPanel>

      {shifts.length > 0 ? (
        <GsPanel title="Périmètre du registre" sub="Les affectations sont calculées depuis la version actuelle du Tableur." icon={<ClipboardList size={16} />}>
          <div className="gsdl-footnote">
            <span>Du {longFrenchDate(dateKey(schedule.start_date))} au {longFrenchDate(dateKey(schedule.end_date))}</span>
            <span>{shifts.length} affectation(s) matérialisée(s)</span>
          </div>
        </GsPanel>
      ) : null}
    </div>
  );
}

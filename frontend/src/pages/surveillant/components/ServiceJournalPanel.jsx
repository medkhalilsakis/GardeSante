/**
 * Journal de service — le cahier de garde
 * ═══════════════════════════════════════
 * Fil chronologique des événements d'un service. Les absences et les retards
 * apparaissent ici mais ne s'y saisissent pas : ils sont écrits par le module de
 * signalement d'absence, qui applique la règle « garde courante uniquement ». Le
 * composeur n'offre donc que présence, remarque, incident et demande de renfort.
 *
 * Refonte : les six couleurs de type et les six émojis sont remplacés par une
 * pastille d'icône dont le ton dit ce qu'il en est — `--gs-alert` pour ce qui
 * manque ou blesse, `--gs-duty` pour ce qui est tenu, neutre pour le reste. Une
 * remarque et un incident ne sont plus deux couleurs de la même famille.
 *
 * Le filtre par type reste **serveur** (`params.type`) : filtrer les cent
 * dernières entrées dans le navigateur ferait disparaître les incidents anciens
 * sans le dire. En conséquence les pastilles de filtre ne portent pas de
 * compteur — le `counts` renvoyé par l'API décrit l'ensemble déjà filtré.
 *
 * Trois écrans le consomment : `/surveillant` (vue d'ensemble en lecture, puis
 * onglet Journal en écriture) et la supervision générale (lecture, tous
 * services). `scopeNote` leur permet de nommer le filtre réellement appliqué,
 * pour qu'un compteur d'en-tête et le contenu du panneau ne se contredisent pas.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, MessageSquare, PenLine, UserCheck, UserPlus, UserX, Clock, NotebookPen,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { journalAPI } from '../../../api';
import { GsPanel, GsPanelHeader, GsFilterBar, GsEmpty, GsSkeleton, GsBadge } from '../../../components/gs';
import { fullFrenchDate, frenchifyIsoDates } from '../../../utils/frenchDates';
import './service-panels.css';

/**
 * Un type d'événement : son nom, son icône, et son ton.
 *   `alert` — ce qui manque ou blesse (absence, retard, incident, renfort) ;
 *   `duty`  — ce qui est tenu (présence constatée) ;
 *   neutre  — l'écrit courant (remarque).
 */
const TYPE_META = {
  presence:      { label: 'Présence',  Icon: UserCheck,     tone: 'duty' },
  absence:       { label: 'Absence',   Icon: UserX,         tone: 'alert' },
  late:          { label: 'Retard',    Icon: Clock,         tone: 'alert' },
  incident:      { label: 'Incident',  Icon: AlertTriangle, tone: 'alert' },
  remark:        { label: 'Remarque',  Icon: MessageSquare, tone: null },
  reinforcement: { label: 'Renfort',   Icon: UserPlus,      tone: 'alert' },
};

/** Seuls ces types sont saisissables à la main — miroir de MANUAL_EVENT_TYPES côté serveur. */
const COMPOSABLE = ['remark', 'presence', 'incident', 'reinforcement'];

const SEVERITIES = [
  { value: 'info',     label: 'Information' },
  { value: 'warning',  label: 'Avertissement' },
  { value: 'error',    label: 'Grave' },
  { value: 'critical', label: 'Critique' },
];

/** Ce que dit une gravité, en français, plutôt que la valeur brute de la base. */
const SEVERITY_LABEL = {
  warning: 'Avertissement',
  error: 'Grave',
  critical: 'Critique',
};

const FILTERS = [
  { id: 'all',           label: 'Tout' },
  { id: 'incident',      label: 'Incidents' },
  { id: 'absence',       label: 'Absences' },
  { id: 'late',          label: 'Retards' },
  { id: 'remark',        label: 'Remarques' },
  { id: 'reinforcement', label: 'Renforts' },
];

/** Clé `YYYY-MM-DD` du jour, composée des parties locales — jamais `toISOString`. */
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function ServiceJournalPanel({
  departmentId,
  canWrite = false,
  title = 'Journal de service',
  scopeNote,
}) {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState('all');
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ eventType: 'remark', title: '', description: '', severity: 'info' });

  const params = useMemo(() => {
    const p = { limit: 100 };
    if (typeFilter !== 'all') p.type = typeFilter;
    if (departmentId) p.departmentId = departmentId;
    return p;
  }, [typeFilter, departmentId]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['journal', params],
    queryFn: () => journalAPI.getEvents(params),
  });

  const addEvent = useMutation({
    mutationFn: (payload) => journalAPI.addEvent(payload),
    onSuccess: () => {
      toast.success('Événement enregistré');
      setForm({ eventType: 'remark', title: '', description: '', severity: 'info' });
      setComposing(false);
      qc.invalidateQueries({ queryKey: ['journal'] });
      qc.invalidateQueries({ queryKey: ['journal-overview'] });
      qc.invalidateQueries({ queryKey: ['journal-alerts'] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Enregistrement impossible'),
  });

  const payload = data?.data?.data;
  const events = payload?.events || [];
  const isForbidden = error?.response?.status === 403;

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Le titre est obligatoire'); return; }
    if (!departmentId) { toast.error('Aucun service sélectionné'); return; }
    addEvent.mutate({ ...form, title: form.title.trim(), departmentId });
  };

  // Regroupement par jour : le journal se lit par journée de service.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const ev of events) {
      if (!map.has(ev.date)) map.set(ev.date, []);
      map.get(ev.date).push(ev);
    }
    return Array.from(map.entries());
  }, [events]);

  const today = todayKey();
  const filterLabel = FILTERS.find((f) => f.id === typeFilter)?.label;

  const body = () => {
    if (isForbidden) {
      return (
        <GsEmpty
          bare
          icon={<NotebookPen size={26} strokeWidth={1.6} />}
          title="Journal non accessible"
          hint="La lecture du journal est réservée aux surveillants, aux chefs de service et à la supervision générale."
        />
      );
    }
    if (isError) {
      return (
        <GsEmpty
          bare
          title="Le journal n'a pas pu être chargé"
          hint="La connexion au serveur a échoué. Rechargez la page pour réessayer."
        />
      );
    }
    if (isLoading) return <GsSkeleton variant="rows" count={4} />;
    if (events.length === 0) {
      return (
        <GsEmpty
          bare
          icon={<NotebookPen size={26} strokeWidth={1.6} />}
          title={typeFilter === 'all' ? 'Aucune entrée au journal' : `Aucune entrée de type « ${filterLabel} »`}
          hint={typeFilter === 'all'
            ? (canWrite
              ? 'Rien n\'a encore été consigné pour ce service. Une remarque, une présence constatée ou un incident s\'écrit ici.'
              : 'Rien n\'a encore été consigné pour ce service.')
            : 'Les cent dernières entrées ne contiennent aucun événement de ce type.'}
          actions={typeFilter !== 'all'
            ? <button type="button" className="gs-btn is-quiet" onClick={() => setTypeFilter('all')}>Voir tout le journal</button>
            : (canWrite && !composing
              ? <button type="button" className="gs-btn is-primary" onClick={() => setComposing(true)}>Écrire une entrée</button>
              : null)}
        />
      );
    }

    return grouped.map(([date, dayEvents]) => (
      <section className="gsv-day" key={date}>
        <h4 className="gsv-day-head">
          <b>{fullFrenchDate(date)}</b>
          {date === today ? <span className="gsv-today">aujourd'hui</span> : null}
          <span>{dayEvents.length} entrée{dayEvents.length > 1 ? 's' : ''}</span>
        </h4>
        <ul className="gsv-log">
          {dayEvents.map((ev) => {
            const meta = TYPE_META[ev.type] || { label: ev.type, Icon: MessageSquare, tone: null };
            const { Icon } = meta;
            return (
              <li key={ev.id}>
                <span className="gsv-hour">{ev.hour}</span>
                <span className="gsv-mark" data-tone={meta.tone || undefined} title={meta.label}>
                  <Icon size={14} strokeWidth={1.9} aria-hidden="true" />
                </span>
                <div className="gsv-body">
                  <div className="gsv-top">
                    {/* Le serveur compose titre et description au moment de
                        l'écriture, avec des dates ISO dedans (« Garde du
                        2026-08-20 · … »). Elles ne sont pas modifiables —
                        l'historique est immuable — donc on les met en français
                        à la lecture, comme les alertes du même écran. */}
                    <span className="gsv-title">{frenchifyIsoDates(ev.title)}</span>
                    <span className="gsv-kind">{meta.label}</span>
                    {SEVERITY_LABEL[ev.severity]
                      ? <GsBadge tone="alert">{SEVERITY_LABEL[ev.severity]}</GsBadge>
                      : null}
                  </div>
                  {ev.description ? <p className="gsv-desc">{frenchifyIsoDates(ev.description)}</p> : null}
                  <p className="gsv-meta">
                    {ev.userName ? <span>concerne {ev.userName}</span> : null}
                    {ev.reporterName ? <span>saisi par {ev.reporterName}</span> : null}
                    {ev.departmentName ? <span>{ev.departmentName}</span> : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    ));
  };

  return (
    <GsPanel
      header={(
        <>
          <GsPanelHeader
            title={title}
            sub={scopeNote || 'Traçabilité des événements — une entrée consignée n\'est jamais modifiable.'}
            tools={canWrite ? (
              <button
                type="button"
                className={composing ? 'gs-btn is-quiet' : 'gs-btn is-primary'}
                onClick={() => setComposing((v) => !v)}
              >
                {composing ? 'Annuler' : <><PenLine size={14} strokeWidth={2} aria-hidden="true" />Écrire une entrée</>}
              </button>
            ) : null}
          />
          {/* La barre de filtres partage le filet de l'en-tête au lieu d'en
              ajouter un second dans le corps. Le filtre est appliqué par le
              serveur : pas de compteur sur les pastilles, il décrirait
              l'ensemble déjà filtré. */}
          <GsFilterBar
            inset
            label="Nature des entrées"
            filters={FILTERS}
            value={typeFilter}
            onChange={setTypeFilter}
          />
        </>
      )}
    >
      {composing && canWrite ? (
        <form className="gsv-form" onSubmit={submit}>
          <div className="gsv-form-row">
            <select
              className="form-control"
              aria-label="Nature de l'entrée"
              value={form.eventType}
              onChange={(e) => setForm((f) => ({ ...f, eventType: e.target.value }))}
            >
              {COMPOSABLE.map((t) => (
                <option key={t} value={t}>{TYPE_META[t].label}</option>
              ))}
            </select>
            <select
              className="form-control"
              aria-label="Gravité"
              value={form.severity}
              onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
            >
              {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <input
            className="form-control"
            placeholder="Titre de l'entrée"
            aria-label="Titre de l'entrée"
            value={form.title}
            maxLength={255}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <textarea
            className="form-control"
            placeholder="Ce qui s'est passé (facultatif)"
            aria-label="Description"
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <p className="gsv-form-note">
            Une absence ou un retard se signale depuis « Signaler une absence » : la règle
            « garde courante » y est appliquée, et l'alerte de service en découle.
          </p>
          <div className="gsv-form-foot">
            <button type="submit" className="gs-btn is-primary" disabled={addEvent.isPending}>
              {addEvent.isPending ? 'Enregistrement…' : 'Consigner l\'entrée'}
            </button>
          </div>
        </form>
      ) : null}

      {body()}
    </GsPanel>
  );
}

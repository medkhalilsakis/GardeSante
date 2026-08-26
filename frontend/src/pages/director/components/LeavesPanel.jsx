/**
 * Congés du personnel — poser, chercher, consulter
 * ═══════════════════════════════════════════════
 * Le directeur ne regarde pas un congé, il en compare plusieurs : qui est
 * absent, sur quelle période, et le motif est-il justifié. Les cartes — une par
 * congé, filet coloré en haut — interdisaient exactement cela : deux périodes
 * ne s'alignent pas d'une carte à l'autre. Le registre les aligne.
 *
 * Ce qui change, et pourquoi :
 *   • les trois tuiles de mesure disparaissent : « Résultats », « En cours » et
 *     « À venir » sont désormais les compteurs des filtres, au chiffre près ;
 *   • le type de congé perd sa couleur (`type_color`) : c'est une taxonomie, pas
 *     un état, et l'en-tête de colonne le nomme ;
 *   • la position dans le temps garde trois états distincts sans couleur
 *     inventée — « En cours » porte le point, « À venir » est neutre,
 *     « Terminé » est atténué ;
 *   • les dates sont écrites en français (« du 1er au 12 septembre 2026 ») au
 *     lieu du format court abrégé, et la durée en jours est calculée.
 *
 * Rien ne change côté données : mêmes requêtes, mêmes clés de cache, même ordre
 * de validation à la soumission, même plafond de 10 Mo sur le justificatif.
 */

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check, Info, Paperclip, Plus, RotateCcw, X } from 'lucide-react';
import { leavesAPI, usersAPI } from '../../../api';
import { GsPanel, GsTable, GsBadge, GsFilterBar, GsEmpty, GsSkeleton } from '../../../components/gs';
import { frenchRange, longFrenchDate } from '../../../utils/frenchDates';
import toast from 'react-hot-toast';
import './director-panels.css';

const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/api\/?$/, '') || 'http://localhost:5000';
const EMPTY_FORM = {
  userId: '', absenceTypeId: '', startDate: '', endDate: '', reason: '', attachment: null,
};
const EMPTY_FILTERS = {
  search: '', userId: '', absenceTypeId: '', from: '', to: '', reason: '', activeOnly: 'true',
};

const fileUrl = (url) => (!url ? null : (url.startsWith('http') ? url : `${API_BASE}${url}`));

const dayKey = (value) => String(value || '').slice(0, 10);

const todayKey = () => {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
};

/**
 * Position du congé dans le temps. Ce n'est pas une gravité : un congé normal
 * n'est ni une alerte ni une garde. Les trois états se distinguent donc par le
 * point et l'atténuation, pas par une couleur prêtée à un autre sens.
 */
const leaveStage = (leave) => {
  const today = todayKey();
  const from = dayKey(leave.start_date);
  const to = dayKey(leave.end_date);
  if (leave.is_current || (from <= today && to >= today)) return 'current';
  if (from > today) return 'upcoming';
  return 'past';
};

const STAGE_LABEL = { current: 'En cours', upcoming: 'À venir', past: 'Terminé' };

/** Durée en jours, bornes incluses — un congé d'un seul jour compte pour 1. */
const dayCount = (from, to) => {
  const a = dayKey(from);
  const b = dayKey(to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const diff = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(diff / 86400000) + 1;
};

export default function LeavesPanel() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  // Restriction d'affichage, appliquée sur ce qui a été chargé — distincte de
  // `activeOnly`, qui décide ce que le serveur envoie.
  const [stage, setStage] = useState('all');

  const queryParams = useMemo(() => ({
    activeOnly: filters.activeOnly === 'true' ? 'true' : undefined,
    search: filters.search.trim() || undefined,
    userId: filters.userId || undefined,
    absenceTypeId: filters.absenceTypeId || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    reason: filters.reason.trim() || undefined,
    limit: 500,
  }), [filters]);

  const { data: leaves = [], isLoading, isError } = useQuery({
    queryKey: ['leaves', queryParams],
    queryFn: () => leavesAPI.getAll(queryParams).then((response) => response.data.data),
  });

  const { data: types = [] } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => leavesAPI.getTypes().then((response) => response.data.data),
  });

  const { data: staff = [] } = useQuery({
    queryKey: ['users', 'for-leaves'],
    queryFn: () => usersAPI.getAll({ limit: 500 }).then((response) => response.data.data),
  });

  const activeStaff = useMemo(
    () => (staff || []).filter((member) => member.is_active !== false)
      .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, 'fr')),
    [staff]
  );

  const selectedType = types.find((type) => type.id === form.absenceTypeId);

  const staged = useMemo(
    () => leaves.map((leave) => ({ ...leave, stage: leaveStage(leave) })),
    [leaves]
  );
  const shown = stage === 'all' ? staged : staged.filter((leave) => leave.stage === stage);

  const filtersActive = Object.entries(filters).some(([key, value]) => (
    key === 'activeOnly' ? value !== 'true' : Boolean(value)
  ));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['leaves'] });
    qc.invalidateQueries({ queryKey: ['portfolio'] });
  };

  const createMut = useMutation({
    mutationFn: (payload) => leavesAPI.create(payload),
    onSuccess: () => {
      toast.success('Congé enregistré');
      setForm(EMPTY_FORM);
      setShowForm(false);
      invalidate();
    },
    onError: (error) => toast.error(error?.response?.data?.message || 'Enregistrement impossible'),
  });

  const cancelMut = useMutation({
    mutationFn: (id) => leavesAPI.cancel(id),
    onSuccess: () => { toast.success('Congé annulé'); invalidate(); },
    onError: (error) => toast.error(error?.response?.data?.message || 'Annulation impossible'),
  });

  const submit = (event) => {
    event.preventDefault();
    if (!form.userId || !form.absenceTypeId || !form.startDate || !form.endDate) {
      toast.error('Agent, type et période sont obligatoires');
      return;
    }
    if (form.endDate < form.startDate) {
      toast.error('La date de fin doit suivre la date de début');
      return;
    }
    if (selectedType?.requires_justification && !form.attachment) {
      toast.error('Ce type de congé exige une pièce jointe');
      return;
    }
    if (form.attachment && form.attachment.size > 10 * 1024 * 1024) {
      toast.error('La pièce jointe ne doit pas dépasser 10 Mo');
      return;
    }
    const data = new FormData();
    data.append('userId', form.userId);
    data.append('absenceTypeId', form.absenceTypeId);
    data.append('startDate', form.startDate);
    data.append('endDate', form.endDate);
    if (form.reason.trim()) data.append('reason', form.reason.trim());
    if (form.attachment) data.append('attachment', form.attachment);
    createMut.mutate(data);
  };

  // Le compteur d'un filtre annonce ce qui restera après application : il se
  // calcule donc sur l'ensemble déjà chargé et cherché, pas sur la base entière.
  const stageFilters = [
    { id: 'all',      label: 'Tous',     count: staged.length },
    { id: 'current',  label: 'En cours', count: staged.filter((l) => l.stage === 'current').length },
    { id: 'upcoming', label: 'À venir',  count: staged.filter((l) => l.stage === 'upcoming').length },
    // Sans « Tous les congés » côté serveur, aucun congé terminé n'est chargé :
    // le filtre reste visible mais son compteur dit franchement zéro.
    { id: 'past',     label: 'Terminés', count: staged.filter((l) => l.stage === 'past').length },
  ];

  const columns = [
    {
      key: 'agent', label: 'Agent',
      render: (leave) => (
        <div className="gsdp-name">
          <b>{leave.first_name} {leave.last_name}</b>
          <span>{leave.department_name || 'Service non renseigné'}</span>
        </div>
      ),
    },
    {
      key: 'type', label: 'Type de congé',
      render: (leave) => <span className="gsdp-word">{leave.type_name || '—'}</span>,
    },
    {
      key: 'span', label: 'Période',
      render: (leave) => {
        const days = dayCount(leave.start_date, leave.end_date);
        const range = frenchRange(dayKey(leave.start_date), dayKey(leave.end_date));
        return (
          <div className="gsdp-span">
            <b>{range || longFrenchDate(dayKey(leave.start_date))}</b>
            {days ? <span>{days} jour{days > 1 ? 's' : ''}</span> : null}
          </div>
        );
      },
    },
    {
      key: 'reason', label: 'Motif',
      render: (leave) => (leave.reason
        ? <span className="gsdp-reason">{leave.reason}</span>
        : <span className="gsdp-reason is-void">Non renseigné</span>),
    },
    {
      key: 'clip', label: 'Justificatif',
      render: (leave) => (leave.justification_url ? (
        <a className="gsdp-clip" href={fileUrl(leave.justification_url)} target="_blank" rel="noreferrer">
          <Paperclip size={12} strokeWidth={2.2} /> Ouvrir
        </a>
      ) : (
        <span className="gsdp-word is-void">Aucun</span>
      )),
    },
    {
      key: 'stage', label: 'Statut',
      render: (leave) => (
        <GsBadge
          tone={leave.stage === 'past' ? 'quiet' : undefined}
          dot={leave.stage === 'current'}
          title={leave.stage === 'current' ? "L'agent est absent aujourd'hui" : undefined}
        >
          {STAGE_LABEL[leave.stage]}
        </GsBadge>
      ),
    },
    {
      key: 'acts', label: '', align: 'right',
      render: (leave) => (
        <div className="gsdp-acts">
          <button
            type="button"
            className="gs-btn is-quiet"
            disabled={cancelMut.isPending}
            onClick={() => {
              if (window.confirm(`Annuler le congé de ${leave.first_name} ${leave.last_name} ?`)) {
                cancelMut.mutate(leave.id);
              }
            }}
          >
            Annuler
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="gsdp-stack">
      {/* ══ POSER UN CONGÉ ══ */}
      {showForm && (
        <GsPanel
          title="Poser un congé"
          sub="Le congé prend effet dès l'enregistrement : un agent en congé ne peut plus être affecté à une garde sur la période."
          icon={<Plus size={14} strokeWidth={2.2} />}
          tools={(
            <button type="button" className="gs-btn is-quiet" onClick={() => setShowForm(false)}>
              <X size={13} strokeWidth={2.2} /> Fermer
            </button>
          )}
        >
          <form className="gsdp-form" onSubmit={submit}>
            <div className="gsdp-form-grid">
              <label className="gsdp-field">
                <span>Personnel<b className="gsdp-req">*</b></span>
                <select
                  className="form-control"
                  value={form.userId}
                  onChange={(event) => setForm((value) => ({ ...value, userId: event.target.value }))}
                >
                  <option value="">Sélectionner…</option>
                  {activeStaff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.first_name} {member.last_name}{member.role_name ? ` · ${member.role_name}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gsdp-field">
                <span>Type de congé<b className="gsdp-req">*</b></span>
                <select
                  className="form-control"
                  value={form.absenceTypeId}
                  onChange={(event) => setForm((value) => ({ ...value, absenceTypeId: event.target.value }))}
                >
                  <option value="">Sélectionner…</option>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}{type.requires_justification ? ' · justificatif requis' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gsdp-field">
                <span>Date de début<b className="gsdp-req">*</b></span>
                <input
                  className="form-control"
                  type="date"
                  value={form.startDate}
                  onChange={(event) => setForm((value) => ({ ...value, startDate: event.target.value }))}
                />
              </label>
              <label className="gsdp-field">
                <span>Date de fin<b className="gsdp-req">*</b></span>
                <input
                  className="form-control"
                  type="date"
                  value={form.endDate}
                  min={form.startDate || undefined}
                  onChange={(event) => setForm((value) => ({ ...value, endDate: event.target.value }))}
                />
              </label>
            </div>

            {form.startDate && form.endDate && form.endDate >= form.startDate && (
              <div className="gsdp-rule is-seal">
                <Info size={14} strokeWidth={2} aria-hidden="true" />
                <p>
                  Absence de <strong>{dayCount(form.startDate, form.endDate)} jour(s)</strong> —{' '}
                  {frenchRange(form.startDate, form.endDate)}.
                </p>
              </div>
            )}

            <div className="gsdp-form-wide">
              <label className="gsdp-field">
                <span>Motif</span>
                <textarea
                  className="form-control form-control-textarea"
                  rows={3}
                  maxLength={500}
                  value={form.reason}
                  placeholder="Précisez le motif du congé…"
                  onChange={(event) => setForm((value) => ({ ...value, reason: event.target.value }))}
                />
              </label>
              <label className="gsdp-drop">
                <span>Pièce jointe{selectedType?.requires_justification ? <b className="gsdp-req">*</b> : null}</span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
                  onChange={(event) => setForm((value) => ({ ...value, attachment: event.target.files?.[0] || null }))}
                />
                {form.attachment ? (
                  <span className="gsdp-drop-ok">
                    <Check size={11} strokeWidth={3} aria-hidden="true" />
                    {form.attachment.name} · {(form.attachment.size / 1024 / 1024).toFixed(2)} Mo
                  </span>
                ) : (
                  <small className={selectedType?.requires_justification ? 'gsdp-hint is-alert' : 'gsdp-hint'}>
                    {selectedType?.requires_justification
                      ? 'Ce type de congé exige un justificatif.'
                      : 'Image ou PDF, jusqu’à 10 Mo.'}
                  </small>
                )}
              </label>
            </div>

            <div className="gsdp-form-acts">
              <button type="button" className="gs-btn is-quiet" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}>
                Annuler
              </button>
              <button type="submit" className="gs-btn is-primary" disabled={createMut.isPending}>
                {createMut.isPending ? 'Enregistrement…' : 'Enregistrer le congé'}
              </button>
            </div>
          </form>
        </GsPanel>
      )}

      {/* ══ REGISTRE ══ */}
      <GsPanel
        flush
        icon={<CalendarDays size={14} strokeWidth={2} />}
        title="Congés du personnel"
        sub="Les critères décident de ce qui est chargé ; les filtres, de ce qui est affiché."
        tools={!showForm ? (
          <button type="button" className="gs-btn is-primary" onClick={() => setShowForm(true)}>
            <Plus size={13} strokeWidth={2.4} /> Poser un congé
          </button>
        ) : null}
      >
        <div className="gsdp-filters">
          <label className="gsdp-field">
            <span>Recherche</span>
            <input
              type="search"
              className="form-control"
              value={filters.search}
              placeholder="Nom, matricule, service…"
              onChange={(event) => setFilters((value) => ({ ...value, search: event.target.value }))}
            />
          </label>
          <label className="gsdp-field">
            <span>Personnel</span>
            <select
              className="form-control"
              value={filters.userId}
              onChange={(event) => setFilters((value) => ({ ...value, userId: event.target.value }))}
            >
              <option value="">Tous les personnels</option>
              {activeStaff.map((member) => (
                <option key={member.id} value={member.id}>{member.first_name} {member.last_name}</option>
              ))}
            </select>
          </label>
          <label className="gsdp-field">
            <span>Type</span>
            <select
              className="form-control"
              value={filters.absenceTypeId}
              onChange={(event) => setFilters((value) => ({ ...value, absenceTypeId: event.target.value }))}
            >
              <option value="">Tous les types</option>
              {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </label>
          <label className="gsdp-field">
            <span>Début à partir du</span>
            <input
              className="form-control"
              type="date"
              value={filters.from}
              onChange={(event) => setFilters((value) => ({ ...value, from: event.target.value }))}
            />
          </label>
          <label className="gsdp-field">
            <span>Fin jusqu&rsquo;au</span>
            <input
              className="form-control"
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => setFilters((value) => ({ ...value, to: event.target.value }))}
            />
          </label>
          <label className="gsdp-field">
            <span>Motif</span>
            <input
              className="form-control"
              value={filters.reason}
              placeholder="Texte du motif…"
              onChange={(event) => setFilters((value) => ({ ...value, reason: event.target.value }))}
            />
          </label>
          <label className="gsdp-field">
            <span>Congés chargés</span>
            <select
              className="form-control"
              value={filters.activeOnly}
              onChange={(event) => setFilters((value) => ({ ...value, activeOnly: event.target.value }))}
            >
              <option value="true">En cours et à venir</option>
              <option value="">Tous, historique inclus</option>
            </select>
          </label>
          <div className="gsdp-filters-reset">
            <button
              type="button"
              className="gs-btn is-quiet"
              disabled={!filtersActive}
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              <RotateCcw size={13} strokeWidth={2} /> Réinitialiser
            </button>
          </div>
        </div>

        <GsFilterBar
          inset
          label="Restreindre les congés affichés"
          filters={stageFilters}
          value={stage}
          onChange={setStage}
        />

        {isError ? (
          <div className="gsdp-pad">
            <GsEmpty
              title="Les congés n'ont pas pu être chargés"
              hint="La liste n'a pas répondu. Réessayez : aucun congé n'a été modifié."
              actions={(
                <button type="button" className="gs-btn is-quiet" onClick={() => qc.invalidateQueries({ queryKey: ['leaves'] })}>
                  <RotateCcw size={13} strokeWidth={2} /> Recharger
                </button>
              )}
            />
          </div>
        ) : isLoading ? (
          <div className="gsdp-pad"><GsSkeleton variant="rows" count={5} /></div>
        ) : (
          <GsTable
            label="Congés du personnel"
            columns={columns}
            rows={shown}
            rowKey="id"
            caption={shown.length
              ? `${shown.length} congé(s) affiché(s) sur ${staged.length} chargé(s).`
              : undefined}
            empty={(
              <div className="gsdp-pad">
                <GsEmpty
                  icon={<CalendarDays size={24} strokeWidth={1.6} />}
                  title={staged.length
                    ? `Aucun congé « ${STAGE_LABEL[stage] || 'affiché'} »`
                    : 'Aucun congé ne correspond aux critères'}
                  hint={staged.length
                    ? `${staged.length} congé(s) sont chargés, mais aucun n'est dans cet état. Chargez l'historique complet pour voir les congés terminés.`
                    : "Élargissez les critères, ou posez un congé pour l'un des agents de l'hôpital."}
                  actions={staged.length ? (
                    <button type="button" className="gs-btn is-quiet" onClick={() => setStage('all')}>
                      Tout afficher
                    </button>
                  ) : (
                    <>
                      {filtersActive && (
                        <button type="button" className="gs-btn is-quiet" onClick={() => setFilters(EMPTY_FILTERS)}>
                          <RotateCcw size={13} strokeWidth={2} /> Réinitialiser les critères
                        </button>
                      )}
                      <button type="button" className="gs-btn is-primary" onClick={() => setShowForm(true)}>
                        Poser un congé
                      </button>
                    </>
                  )}
                />
              </div>
            )}
          />
        )}
      </GsPanel>
    </div>
  );
}

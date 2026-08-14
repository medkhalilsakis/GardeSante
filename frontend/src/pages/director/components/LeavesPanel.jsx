/** Congés du personnel — création, recherche et consultation par la direction. */
import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Clock3, Paperclip, Plus, Search, X } from 'lucide-react';
import { leavesAPI, usersAPI } from '../../../api';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/api\/?$/, '') || 'http://localhost:5000';
const EMPTY_FORM = {
  userId: '', absenceTypeId: '', startDate: '', endDate: '', reason: '', attachment: null,
};
const EMPTY_FILTERS = {
  search: '', userId: '', absenceTypeId: '', from: '', to: '', reason: '', activeOnly: 'true',
};

const fmt = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').slice(0, 10));
  if (!m) return iso || '—';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

const fileUrl = (url) => !url ? null : (url.startsWith('http') ? url : `${API_BASE}${url}`);
const todayKey = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
};
const leaveStatus = (leave) => {
  const today = todayKey();
  if (leave.is_current || (String(leave.start_date).slice(0, 10) <= today && String(leave.end_date).slice(0, 10) >= today)) return { label: 'En cours', color: '#047857', bg: '#D1FAE5' };
  if (String(leave.start_date).slice(0, 10) > today) return { label: 'À venir', color: '#1D4ED8', bg: '#DBEAFE' };
  return { label: 'Terminé', color: '#64748B', bg: '#F1F5F9' };
};
const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 4 };
const labelStyle = { fontSize: 'var(--font-xs)', fontWeight: 700, color: 'var(--text-secondary)' };

export default function LeavesPanel() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);

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
  const current = leaves.filter((leave) => leave.is_current).length;
  const upcoming = leaves.filter((leave) => leaveStatus(leave).label === 'À venir').length;
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 800, color: 'var(--text-primary)' }}>
            Congés du personnel
          </h3>
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 3 }}>
            {leaves.length} résultat(s) · {current} en cours aujourd'hui
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm((value) => !value)}>
          {showForm ? <><X size={14} /> Fermer</> : <><Plus size={14} /> Poser un congé</>}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
        {[
          { label: 'Résultats affichés', value: leaves.length, icon: <CalendarDays size={17} />, color: 'var(--color-primary)' },
          { label: 'En cours aujourd’hui', value: current, icon: <Clock3 size={17} />, color: '#047857' },
          { label: 'À venir', value: upcoming, icon: <CalendarDays size={17} />, color: '#1D4ED8' },
        ].map(item => <div key={item.label} style={{ padding: '13px 15px', border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: 11 }}><span style={{ width: 34, height: 34, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: `${item.color}14`, color: item.color }}>{item.icon}</span><div><div style={{ fontSize: 20, lineHeight: 1, fontWeight: 800, color: 'var(--text-primary)' }}>{item.value}</div><div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>{item.label}</div></div></div>)}
      </div>

      {showForm && (
        <form onSubmit={submit} className="card" style={{ display: 'grid', gap: 14, padding: 18 }}>
          <div>
            <h4 style={{ margin: 0, fontSize: 'var(--font-md)', color: 'var(--text-primary)' }}>Nouveau congé</h4>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
              Les justificatifs acceptés sont les images et les PDF, jusqu'à 10 Mo.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12 }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Personnel *</span>
              <select className="input" value={form.userId}
                onChange={(event) => setForm((value) => ({ ...value, userId: event.target.value }))}>
                <option value="">Sélectionner…</option>
                {activeStaff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.first_name} {member.last_name}{member.role_name ? ` · ${member.role_name}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Type de congé *</span>
              <select className="input" value={form.absenceTypeId}
                onChange={(event) => setForm((value) => ({ ...value, absenceTypeId: event.target.value }))}>
                <option value="">Sélectionner…</option>
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}{type.requires_justification ? ' · justificatif requis' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Date de début *</span>
              <input className="input" type="date" value={form.startDate}
                onChange={(event) => setForm((value) => ({ ...value, startDate: event.target.value }))} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Date de fin *</span>
              <input className="input" type="date" value={form.endDate} min={form.startDate || undefined}
                onChange={(event) => setForm((value) => ({ ...value, endDate: event.target.value }))} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Motif</span>
              <textarea className="input" rows={3} value={form.reason} maxLength={500}
                placeholder="Précisez le motif du congé…"
                onChange={(event) => setForm((value) => ({ ...value, reason: event.target.value }))} />
            </label>
            <label style={{ ...fieldStyle, justifyContent: 'flex-start', padding: 12, border: '1px dashed var(--border-default)', borderRadius: 8, background: 'var(--bg-elevated)' }}>
              <span style={labelStyle}>
                Pièce jointe {selectedType?.requires_justification ? '*' : '(optionnelle)'}
              </span>
              <input className="input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
                onChange={(event) => setForm((value) => ({ ...value, attachment: event.target.files?.[0] || null }))} />
              {form.attachment && (
                <span style={{ fontSize: 11, color: 'var(--color-success)', fontWeight: 600 }}>
                  ✓ {form.attachment.name} · {(form.attachment.size / 1024 / 1024).toFixed(2)} Mo
                </span>
              )}
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={createMut.isPending}>
              {createMut.isPending ? 'Enregistrement…' : 'Enregistrer le congé'}
            </button>
          </div>
        </form>
      )}

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <h4 style={{ margin: 0, fontSize: 'var(--font-md)', color: 'var(--text-primary)' }}>Rechercher un congé</h4>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
              Filtrez par personnel, période, type ou motif.
            </p>
          </div>
          {filtersActive && (
            <button className="btn btn-ghost btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}><X size={14} /> Réinitialiser</button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Recherche globale</span>
            <div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--text-muted)' }} /><input className="input" style={{ paddingLeft: 34 }} value={filters.search} placeholder="Nom, matricule, service…"
              onChange={(event) => setFilters((value) => ({ ...value, search: event.target.value }))} />
            </div>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Personnel</span>
            <select className="input" value={filters.userId}
              onChange={(event) => setFilters((value) => ({ ...value, userId: event.target.value }))}>
              <option value="">Tous les personnels</option>
              {activeStaff.map((member) => (
                <option key={member.id} value={member.id}>{member.first_name} {member.last_name}</option>
              ))}
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Type</span>
            <select className="input" value={filters.absenceTypeId}
              onChange={(event) => setFilters((value) => ({ ...value, absenceTypeId: event.target.value }))}>
              <option value="">Tous les types</option>
              {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Début à partir du</span>
            <input className="input" type="date" value={filters.from}
              onChange={(event) => setFilters((value) => ({ ...value, from: event.target.value }))} />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Fin jusqu'au</span>
            <input className="input" type="date" value={filters.to} min={filters.from || undefined}
              onChange={(event) => setFilters((value) => ({ ...value, to: event.target.value }))} />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Motif</span>
            <input className="input" value={filters.reason} placeholder="Texte du motif…"
              onChange={(event) => setFilters((value) => ({ ...value, reason: event.target.value }))} />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Période affichée</span>
            <select className="input" value={filters.activeOnly}
              onChange={(event) => setFilters((value) => ({ ...value, activeOnly: event.target.value }))}>
              <option value="true">En cours et à venir</option>
              <option value="">Tous les congés</option>
            </select>
          </label>
        </div>
      </div>

      {isError ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-danger)', fontSize: 'var(--font-sm)' }}>
          Les congés n'ont pas pu être chargés.
        </div>
      ) : isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="skeleton" style={{ height: 170, borderRadius: 12 }} />)}
        </div>
      ) : leaves.length === 0 ? (
        <div style={{
          padding: 42, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          Aucun congé ne correspond aux critères choisis.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>
          {leaves.map((leave) => {
            const status = leaveStatus(leave);
            return (
            <article key={leave.id} className="card" style={{
              display: 'flex', flexDirection: 'column', gap: 12, padding: 16,
              borderTop: `4px solid ${leave.type_color || '#6366F1'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: 'var(--font-md)', color: 'var(--text-primary)' }}>
                    {leave.first_name} {leave.last_name}
                  </h4>
                  <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                    {leave.department_name || 'Service non renseigné'}
                  </p>
                </div>
                <span style={{ fontSize: 9, fontWeight: 800, color: status.color, background: status.bg, borderRadius: 999, padding: '3px 8px', textTransform: 'uppercase' }}>{status.label}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{
                  background: `${leave.type_color || '#6366F1'}20`, color: leave.type_color || '#6366F1',
                  padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                }}>
                  {leave.type_name}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {fmt(leave.start_date)} → {fmt(leave.end_date)}
                </span>
              </div>

              <div style={{ minHeight: 38, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Motif :</strong> {leave.reason || 'Non renseigné'}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                {leave.justification_url ? (
                  <a className="btn btn-ghost btn-sm" href={fileUrl(leave.justification_url)} target="_blank" rel="noreferrer">
                    <Paperclip size={14} /> Voir la pièce jointe
                  </a>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Aucune pièce jointe</span>
                )}
                <button className="btn btn-secondary btn-sm" disabled={cancelMut.isPending}
                  onClick={() => {
                    if (window.confirm(`Annuler le congé de ${leave.first_name} ${leave.last_name} ?`)) cancelMut.mutate(leave.id);
                  }}>
                  Annuler
                </button>
              </div>
            </article>
          );})}
        </div>
      )}
    </div>
  );
}

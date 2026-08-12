/**
 * Congés du personnel (Lot 6) — pose et annulation par le directeur.
 *
 * Premier consommateur de `leavesAPI`, livrée au Lot 1 côté serveur mais sans
 * écran jusqu'ici. La règle I s'applique en aval : un agent en congé est refusé
 * côté serveur à l'affectation, ce panneau est donc la source de cette règle.
 *
 * L'annulation ne supprime rien : le congé passe en `cancelled` et la trace
 * demeure dans l'historique immuable.
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leavesAPI, usersAPI } from '../../../api';
import toast from 'react-hot-toast';

/**
 * Les dates arrivent en 'YYYY-MM-DD' (castées en texte par l'API pour être
 * insensibles au fuseau) : on les reconstruit en heure locale, jamais via
 * `new Date(iso)` qui les lirait en UTC et afficherait la veille.
 */
const fmt = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').slice(0, 10));
  if (!m) return iso || '—';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

const FILTERS = [
  { value: 'current', label: 'En cours et à venir' },
  { value: 'all',     label: 'Tous' },
];

export default function LeavesPanel() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('current');
  const [form, setForm] = useState({ userId: '', absenceTypeId: '', startDate: '', endDate: '', reason: '' });
  const [showForm, setShowForm] = useState(false);

  const { data: leaves = [], isLoading, isError } = useQuery({
    queryKey: ['leaves', filter],
    queryFn: () => leavesAPI
      .getAll(filter === 'current' ? { activeOnly: 'true' } : undefined)
      .then((r) => r.data.data),
  });

  const { data: types = [] } = useQuery({
    queryKey: ['leave-types'],
    queryFn: () => leavesAPI.getTypes().then((r) => r.data.data),
  });

  const { data: staff = [] } = useQuery({
    queryKey: ['users', 'for-leaves'],
    queryFn: () => usersAPI.getAll({ limit: 500 }).then((r) => r.data.data),
  });

  const activeStaff = useMemo(
    () => (staff || []).filter((u) => u.is_active !== false),
    [staff]
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['leaves'] });
    qc.invalidateQueries({ queryKey: ['portfolio'] });
  };

  const createMut = useMutation({
    mutationFn: (payload) => leavesAPI.create(payload),
    onSuccess: () => {
      toast.success('Congé enregistré');
      setForm({ userId: '', absenceTypeId: '', startDate: '', endDate: '', reason: '' });
      setShowForm(false);
      invalidate();
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Enregistrement impossible'),
  });

  const cancelMut = useMutation({
    mutationFn: (id) => leavesAPI.cancel(id),
    onSuccess: () => { toast.success('Congé annulé'); invalidate(); },
    onError: (e) => toast.error(e?.response?.data?.message || 'Annulation impossible'),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.userId || !form.absenceTypeId || !form.startDate || !form.endDate) {
      toast.error('Agent, type et période sont obligatoires');
      return;
    }
    if (form.endDate < form.startDate) {
      toast.error('La date de fin doit suivre la date de début');
      return;
    }
    createMut.mutate(form);
  };

  const current = leaves.filter((l) => l.is_current).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>
            Congés du personnel
          </h3>
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
            {leaves.length} congé(s) · {current} en cours aujourd'hui — un agent en congé ne peut pas être affecté à une garde
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {FILTERS.map((f) => (
            <button key={f.value} onClick={() => setFilter(f.value)}
              className={filter === f.value ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}>
              {f.label}
            </button>
          ))}
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Fermer' : '+ Poser un congé'}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={submit} className="card" style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>Agent *</span>
              <select className="input" value={form.userId}
                onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                <option value="">Sélectionner…</option>
                {activeStaff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.first_name} {u.last_name}{u.role_name ? ` · ${u.role_name}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>Type de congé *</span>
              <select className="input" value={form.absenceTypeId}
                onChange={(e) => setForm({ ...form, absenceTypeId: e.target.value })}>
                <option value="">Sélectionner…</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>Du *</span>
              <input className="input" type="date" value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>Au *</span>
              <input className="input" type="date" value={form.endDate} min={form.startDate || undefined}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>Motif</span>
            <input className="input" value={form.reason} maxLength={300}
              placeholder="Optionnel"
              onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={createMut.isPending}>
              {createMut.isPending ? 'Enregistrement…' : 'Enregistrer le congé'}
            </button>
          </div>
        </form>
      )}

      {isError ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-danger)', fontSize: 'var(--font-sm)' }}>
          Les congés n'ont pas pu être chargés.
        </div>
      ) : isLoading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
          Chargement des congés…
        </div>
      ) : leaves.length === 0 ? (
        <div style={{
          padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          Aucun congé {filter === 'current' ? 'en cours ou à venir' : 'enregistré'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {leaves.map((l) => (
            <div key={l.id} style={{
              display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
              borderLeft: `3px solid ${l.type_color || '#6366F1'}`,
              borderRadius: 'var(--border-radius-sm)', padding: '12px 14px',
            }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {l.first_name} {l.last_name}
                  </span>
                  {l.is_current && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: '#10B981',
                      border: '1px solid #10B981', borderRadius: 6, padding: '1px 6px',
                    }}>
                      EN COURS
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', marginTop: 3 }}>
                  {l.type_name} · du {fmt(l.start_date)} au {fmt(l.end_date)}
                </p>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                  {l.department_name || '—'}{l.reason ? ` · « ${l.reason} »` : ''}
                </p>
              </div>
              <button className="btn btn-secondary btn-sm"
                disabled={cancelMut.isPending}
                onClick={() => {
                  if (window.confirm(`Annuler le congé de ${l.first_name} ${l.last_name} ?`)) cancelMut.mutate(l.id);
                }}>
                Annuler
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

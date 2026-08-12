/**
 * Historique du personnel (Lot 6) — consultation seule par le directeur.
 *
 * « Tous les acteurs ont un historique constant ne peuvent pas le modifier,
 * permet la traçabilité de toute action le fait l'acteur » : aucun bouton
 * d'édition ni de suppression n'existe ici, et il n'en existe pas côté serveur.
 *
 * La portée est bornée par le backend à l'établissement du directeur —
 * `/history/all` et `/history/users` filtrent sur `establishment_id`.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { historyAPI } from '../../../api';

const SEVERITY_COLOR = {
  info:     '#3B82F6',
  warning:  '#F59E0B',
  error:    '#DC2626',
  critical: '#991B1B',
};

const fmtDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function StaffHistoryPanel() {
  const [userId, setUserId] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data: staff = [] } = useQuery({
    queryKey: ['history-users'],
    queryFn: () => historyAPI.getUsersList().then((r) => r.data.data),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['history-categories', 'establishment'],
    queryFn: () => historyAPI
      .getCategories({ scope: 'establishment' })
      .then((r) => r.data.data),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['history-staff', userId, category, search, page],
    queryFn: () => historyAPI.getAll({
      page,
      limit: 40,
      userId: userId || undefined,
      category: category || undefined,
      search: search || undefined,
    }).then((r) => r.data),
  });

  const rows = data?.data || [];
  const total = data?.pagination?.total || 0;
  const pages = Math.max(1, Math.ceil(total / 40));
  const forbidden = error?.response?.status === 403;

  const reset = (fn) => (value) => { fn(value); setPage(1); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>
          Historique du personnel
        </h3>
        <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
          {total} action(s) tracée(s) dans votre établissement — consultation uniquement, aucune trace n'est modifiable
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select className="input" style={{ maxWidth: 260 }} value={userId}
          onChange={(e) => reset(setUserId)(e.target.value)}>
          <option value="">Tous les agents</option>
          {staff.map((u) => (
            <option key={u.id} value={u.id}>
              {u.last_name} {u.first_name}{u.role_name ? ` · ${u.role_name}` : ''}
            </option>
          ))}
        </select>
        <select className="input" style={{ maxWidth: 200 }} value={category}
          onChange={(e) => reset(setCategory)(e.target.value)}>
          <option value="">Toutes les catégories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Rechercher un agent…"
          value={search} onChange={(e) => reset(setSearch)(e.target.value)} />
      </div>

      {forbidden ? (
        <div style={{
          padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          L'historique du personnel n'est pas accessible avec votre rôle.
        </div>
      ) : error ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-danger)', fontSize: 'var(--font-sm)' }}>
          L'historique n'a pas pu être chargé.
        </div>
      ) : isLoading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
          Chargement de l'historique…
        </div>
      ) : rows.length === 0 ? (
        <div style={{
          padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          Aucune action ne correspond à ces filtres
        </div>
      ) : (
        <>
          <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                  {['Date', 'Agent', 'Action', 'Catégorie', 'Description'].map((h) => (
                    <th key={h} style={{
                      padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
                      color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {fmtDateTime(r.created_at)}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 'var(--font-xs)' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {r.first_name} {r.last_name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.role_name || '—'}</div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                        color: SEVERITY_COLOR[r.severity] || '#6366F1',
                        border: `1px solid ${SEVERITY_COLOR[r.severity] || '#6366F1'}55`,
                        borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap',
                      }}>
                        {r.action}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-secondary)' }}>
                      {r.category || '—'}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>
                      {r.description || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
              <button className="btn btn-secondary btn-sm" disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}>← Précédent</button>
              <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
                Page {page} / {pages}
              </span>
              <button className="btn btn-secondary btn-sm" disabled={page >= pages}
                onClick={() => setPage((p) => Math.min(pages, p + 1))}>Suivant →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Statistiques des prêts de personnel (point 5) — un seul panneau pour le
 * directeur et le chef de service.
 *
 * Clone structurel de `ScopedStatsPanel.jsx` : mêmes fenêtres prédéfinies (sûres
 * au fuseau, jamais de `new Date('YYYY-MM-DD')`), mêmes `Kpi` / `Card` /
 * `ChartTooltip`, même gestion gracieuse du 403. La portée n'est pas choisie
 * ici : le serveur la déduit du rôle et renvoie `scopeLabel`, affiché tel quel
 * pour que chaque acteur sache ce qu'il regarde.
 *
 * Lecture seule — aucune écriture depuis ce panneau.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { staffLoansAPI } from '../../api';

const STATUS_META = {
  approved:      { label: 'Acceptés',       color: '#10B981' },
  auto_approved: { label: 'Auto-approuvés', color: '#0EA5E9' },
  rejected:      { label: 'Refusés',        color: '#EF4444' },
  pending:       { label: 'En attente',     color: '#F59E0B' },
};
const STATUS_ORDER = ['approved', 'auto_approved', 'rejected', 'pending'];

const SCOPE_HINTS = {
  platform: 'Tous les prêts de tous les hôpitaux',
  establishment: 'Tous les prêts de l\'établissement',
  departments: 'Les prêts de vos services, en prêt comme en emprunt',
};

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Fenêtres prédéfinies, calculées en chaînes pour éviter tout décalage de fuseau. */
const PRESETS = [
  {
    id: 'month',
    label: 'Ce mois',
    range: () => { const n = new Date(); return { from: `${n.getFullYear()}-${pad(n.getMonth() + 1)}-01`, to: iso(n) }; },
  },
  {
    id: 'quarter',
    label: '3 derniers mois',
    range: () => { const n = new Date(); const s = new Date(n.getFullYear(), n.getMonth() - 2, 1); return { from: iso(s), to: iso(n) }; },
  },
  {
    id: 'semester',
    label: '6 derniers mois',
    range: () => { const n = new Date(); const s = new Date(n.getFullYear(), n.getMonth() - 5, 1); return { from: iso(s), to: iso(n) }; },
  },
  {
    id: 'year',
    label: 'Année',
    range: () => { const n = new Date(); return { from: `${n.getFullYear()}-01-01`, to: `${n.getFullYear()}-12-31` }; },
  },
];

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-default)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
    }}>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color, fontWeight: 600 }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

const Kpi = ({ label, value, hint, accent }) => (
  <div style={{
    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--border-radius-sm)', padding: '12px 14px',
  }}>
    <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</p>
    <p style={{ fontSize: 'var(--font-xl)', fontWeight: 800, color: accent || 'var(--text-primary)', lineHeight: 1.2 }}>{value}</p>
    {hint && <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</p>}
  </div>
);

const Card = ({ title, subtitle, children }) => (
  <div style={{
    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--border-radius-lg)', padding: 16,
  }}>
    <h4 style={{ fontSize: 'var(--font-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h4>
    {subtitle && <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>{subtitle}</p>}
    <div style={{ marginTop: subtitle ? 0 : 10 }}>{children}</div>
  </div>
);

/** Délai de réponse lisible : 3,4 h, ou 2,1 j au-delà d'une journée. */
const formatDelay = (hours) => {
  if (hours === null || hours === undefined) return '—';
  if (hours < 24) return `${hours} h`;
  return `${Math.round((hours / 24) * 10) / 10} j`;
};

const RankTable = ({ rows, firstColumn }) => (
  <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-xs)' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
          {[firstColumn, 'Total', 'Acceptés', 'Refusés', 'En attente', 'Taux'].map((h) => (
            <th key={h} style={{
              textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)',
              fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.04em',
            }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.departmentId || d.departmentName} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <td style={{ padding: '8px 10px', color: 'var(--text-primary)', fontWeight: 600 }}>{d.departmentName}</td>
            <td style={{ padding: '8px 10px', color: 'var(--text-primary)', fontWeight: 700 }}>{d.total}</td>
            <td style={{ padding: '8px 10px', color: '#10B981', fontWeight: 600 }}>
              {d.approved + d.auto_approved}
            </td>
            <td style={{ padding: '8px 10px', color: '#EF4444', fontWeight: 600 }}>{d.rejected}</td>
            <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{d.pending}</td>
            <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>
              {d.acceptanceRate === null ? '—' : `${d.acceptanceRate} %`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default function StaffLoanStatsPanel({ establishmentId, title = 'Statistiques des prêts de personnel' }) {
  const [presetId, setPresetId] = useState('quarter');

  const period = useMemo(
    () => (PRESETS.find((p) => p.id === presetId) || PRESETS[0]).range(),
    [presetId]
  );

  const params = useMemo(() => {
    const p = { ...period };
    if (establishmentId) p.establishmentId = establishmentId;
    return p;
  }, [period, establishmentId]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['staff-loan-stats', params],
    queryFn: () => staffLoansAPI.stats(params),
  });

  const payload = data?.data?.data;
  const summary = payload?.summary || {};
  const timeline = payload?.timeline || [];
  const byLender = payload?.byLender || [];
  const byBorrower = payload?.byBorrower || [];
  const topStaff = payload?.topStaff || [];

  const timelineChart = useMemo(
    () => timeline.map((t) => ({
      // Semaine du lundi — 'MM-DD' suffit en abscisse.
      semaine: String(t.week || '').substring(5),
      Acceptés: (t.approved || 0) + (t.auto_approved || 0),
      Refusés: t.rejected || 0,
      'En attente': t.pending || 0,
    })),
    [timeline]
  );

  const statusChart = useMemo(
    () => STATUS_ORDER
      .map((s) => ({ key: s, name: STATUS_META[s].label, value: summary[s] || 0 }))
      .filter((s) => s.value > 0),
    [summary]
  );

  const lenderChart = useMemo(
    () => byLender.slice(0, 8).map((d) => ({
      name: d.departmentName,
      Prêtés: d.approved + d.auto_approved,
      Refusés: d.rejected,
    })),
    [byLender]
  );

  const rateAccent = summary.acceptanceRate === null
    ? undefined
    : summary.acceptanceRate >= 70 ? 'var(--color-success)'
    : summary.acceptanceRate >= 40 ? 'var(--color-warning)'
    : 'var(--color-danger)';

  const isForbidden = error?.response?.status === 403;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
            {payload?.scopeLabel
              ? `Portée : ${payload.scopeLabel} — ${SCOPE_HINTS[payload.scope] || ''}`
              : 'Portée déterminée par votre rôle'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPresetId(p.id)}
              className={presetId === p.id ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {payload?.period && (
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: -8 }}>
          Période analysée : {payload.period.from} → {payload.period.to} (date de la demande)
        </p>
      )}

      {isForbidden ? (
        <div style={{
          padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          Aucune statistique de prêt n'est disponible pour votre rôle.
        </div>
      ) : isError ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-danger)', fontSize: 'var(--font-sm)' }}>
          Les statistiques n'ont pas pu être chargées.
        </div>
      ) : isLoading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
          Calcul des statistiques…
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <Kpi label="Demandes" value={summary.total ?? 0} hint={`${summary.staffCount ?? 0} agent(s) concerné(s)`} />
            <Kpi label="Acceptés" value={(summary.approved ?? 0) + (summary.auto_approved ?? 0)} hint={`dont ${summary.auto_approved ?? 0} auto-approuvé(s)`} accent="var(--color-success)" />
            <Kpi label="Refusés" value={summary.rejected ?? 0} accent={summary.rejected ? 'var(--color-danger)' : undefined} />
            <Kpi label="En attente" value={summary.pending ?? 0} hint="Hors calcul du taux" accent={summary.pending ? 'var(--color-warning)' : undefined} />
            <Kpi
              label="Taux d'acceptation"
              value={summary.acceptanceRate === null || summary.acceptanceRate === undefined ? '—' : `${summary.acceptanceRate} %`}
              hint={`sur ${summary.decided ?? 0} demande(s) tranchée(s)`}
              accent={rateAccent}
            />
            <Kpi
              label="Délai de réponse"
              value={formatDelay(summary.avgResponseHours)}
              hint={`moyenne sur ${summary.responsesMeasured ?? 0} réponse(s)`}
            />
          </div>

          {(summary.total ?? 0) === 0 ? (
            <div style={{
              padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
              background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
            }}>
              🤝 Aucun prêt de personnel sur cette période
            </div>
          ) : (
            <>
              <Card title="Évolution des demandes" subtitle="Regroupées par semaine (lundi), selon la date de la demande">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={timelineChart}>
                    <defs>
                      <linearGradient id="loanAccepted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="semaine" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="Acceptés" stroke="#10B981" fill="url(#loanAccepted)" strokeWidth={2} />
                    <Area type="monotone" dataKey="Refusés" stroke="#EF4444" fill="#EF444422" strokeWidth={2} />
                    <Area type="monotone" dataKey="En attente" stroke="#F59E0B" fill="#F59E0B22" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
                <Card title="Services prêteurs" subtitle="8 services les plus sollicités pour prêter du personnel">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={lenderChart} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Prêtés" fill="#10B981" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="Refusés" fill="#EF4444" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>

                <Card title="Issue des demandes" subtitle="Répartition sur la période">
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={statusChart}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={false}
                      >
                        {statusChart.map((s) => (
                          <Cell key={s.key} fill={STATUS_META[s.key].color} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </Card>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
                <Card title="Détail — services prêteurs" subtitle="Le service propriétaire de l'agent">
                  <RankTable rows={byLender} firstColumn="Service prêteur" />
                </Card>
                <Card title="Détail — services emprunteurs" subtitle="Le service qui a demandé l'agent">
                  <RankTable rows={byBorrower} firstColumn="Service emprunteur" />
                </Card>
              </div>

              {topStaff.length > 0 && (
                <Card title="Agents les plus prêtés" subtitle="20 agents au maximum">
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-xs)' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                          {['#', 'Agent', 'Service d\'origine', 'Demandes', 'Acceptées', 'Refusées'].map((h) => (
                            <th key={h} style={{
                              textAlign: 'left', padding: '8px 10px', color: 'var(--text-muted)',
                              fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.04em',
                            }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {topStaff.map((s, i) => (
                          <tr key={s.userId || s.name} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 700 }}>{i + 1}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text-primary)', fontWeight: 600 }}>
                              {s.name}
                              {s.roleName && (
                                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {s.roleName}</span>
                              )}
                            </td>
                            <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{s.departmentName || '—'}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text-primary)', fontWeight: 700 }}>{s.total}</td>
                            <td style={{ padding: '8px 10px', color: '#10B981', fontWeight: 600 }}>{s.approved + s.auto_approved}</td>
                            <td style={{ padding: '8px 10px', color: '#EF4444', fontWeight: 600 }}>{s.rejected}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

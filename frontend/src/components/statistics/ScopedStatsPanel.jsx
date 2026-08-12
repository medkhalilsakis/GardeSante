/**
 * Statistiques par portée (Lot 3) — un seul panneau pour les cinq dashboards.
 *
 * La portée n'est jamais choisie par le client : le serveur la déduit du rôle
 * (plateforme, établissement ou services) et renvoie `scopeLabel`, affiché ici
 * pour que chaque acteur sache exactement ce qu'il regarde.
 *
 * Lecture seule — ce panneau ne déclenche aucune écriture.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { scopedStatsAPI } from '../../api';

const COLORS = ['#1B4FCA', '#10B981', '#F59E0B', '#6366F1', '#EC4899', '#0EA5E9'];

const STATE_LABELS = {
  brouillon: 'Brouillon',
  soumis: 'Soumis',
  en_cours: 'En cours',
  termine: 'Terminé',
};

const STATE_COLORS = {
  brouillon: '#8B5CF6',
  soumis: '#3B82F6',
  en_cours: '#10B981',
  termine: '#6B7280',
};

const SCOPE_HINTS = {
  platform: 'Toutes les gardes de tous les hôpitaux',
  establishment: 'Toutes les gardes de l\'établissement',
  departments: 'Les gardes de vos services uniquement',
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
    id: 'month-full',
    label: 'Mois complet',
    range: () => {
      const n = new Date();
      const last = new Date(n.getFullYear(), n.getMonth() + 1, 0);
      return { from: `${n.getFullYear()}-${pad(n.getMonth() + 1)}-01`, to: iso(last) };
    },
  },
  {
    id: 'quarter',
    label: '3 derniers mois',
    range: () => { const n = new Date(); const s = new Date(n.getFullYear(), n.getMonth() - 2, 1); return { from: iso(s), to: iso(n) }; },
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

export default function ScopedStatsPanel({ establishmentId, title = 'Statistiques' }) {
  const [presetId, setPresetId] = useState('month-full');

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
    queryKey: ['scoped-stats', params],
    queryFn: () => scopedStatsAPI.get(params),
  });

  const payload = data?.data?.data;
  const summary = payload?.summary || {};
  const byDepartment = payload?.byDepartment || [];
  const byState = payload?.byState || [];
  const topStaff = payload?.topStaff || [];
  const timeline = payload?.timeline || [];

  const deptChart = useMemo(
    () => byDepartment.slice(0, 8).map((d) => ({ name: d.departmentName, gardes: d.guards, agents: d.staff })),
    [byDepartment]
  );

  const stateChart = useMemo(
    () => byState.map((s) => ({ name: STATE_LABELS[s.state] || s.state, value: s.count, state: s.state })),
    [byState]
  );

  const timelineChart = useMemo(
    () => timeline.map((t) => ({ date: t.date.substring(5), gardes: t.guards })),
    [timeline]
  );

  // Un écart de charge élevé signale une répartition déséquilibrée entre agents.
  const gapAccent = summary.loadGap >= 3 ? 'var(--color-warning)' : 'var(--color-success)';
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
          Période analysée : {payload.period.from} → {payload.period.to}
        </p>
      )}

      {isForbidden ? (
        <div style={{
          padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          Aucune statistique n'est disponible pour votre rôle.
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
            <Kpi label="Gardes" value={summary.totalGuards ?? 0} hint={`${summary.daysCovered ?? 0} jour(s) couvert(s)`} />
            <Kpi label="Agents mobilisés" value={summary.staffCount ?? 0} hint={`${summary.averagePerStaff ?? 0} garde(s) / agent`} />
            <Kpi label="Services" value={summary.departmentsCount ?? 0} hint={`${summary.schedulesCount ?? 0} planning(s)`} />
            <Kpi label="Moyenne / jour" value={summary.averagePerDay ?? 0} />
            <Kpi
              label="Écart de charge"
              value={summary.loadGap ?? 0}
              hint={`min ${summary.minLoad ?? 0} · max ${summary.maxLoad ?? 0}`}
              accent={gapAccent}
            />
            <Kpi label="Repos posés" value={summary.restCells ?? 0} hint="Cellules R, hors gardes" />
          </div>

          {summary.totalGuards === 0 ? (
            <div style={{
              padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
              background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
            }}>
              📊 Aucune garde enregistrée sur cette période
            </div>
          ) : (
            <>
              <Card title="Évolution des gardes" subtitle="Nombre de gardes par jour sur la période">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={timelineChart}>
                    <defs>
                      <linearGradient id="scopedGuards" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1B4FCA" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="#1B4FCA" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="gardes" name="Gardes" stroke="#1B4FCA" fill="url(#scopedGuards)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
                <Card title="Répartition par service" subtitle="8 services les plus sollicités">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={deptChart} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="gardes" name="Gardes" fill="#1B4FCA" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="agents" name="Agents" fill="#10B981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>

                <Card title="État des plannings" subtitle="Répartition des plannings de la période">
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={stateChart}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={false}
                      >
                        {stateChart.map((s, i) => (
                          <Cell key={s.state} fill={STATE_COLORS[s.state] || COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </Card>
              </div>

              <Card title="Charge par agent" subtitle="Classement des agents les plus sollicités (20 max)">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-xs)' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                        {['#', 'Agent', 'Service', 'Gardes', 'Détail'].map((h) => (
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
                        <tr key={s.userId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 700 }}>{i + 1}</td>
                          <td style={{ padding: '8px 10px', color: 'var(--text-primary)', fontWeight: 600 }}>
                            {s.name}
                            {s.roleName && (
                              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {s.roleName}</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{s.departmentName || '—'}</td>
                          <td style={{ padding: '8px 10px', color: 'var(--text-primary)', fontWeight: 700 }}>{s.guards}</td>
                          <td style={{ padding: '8px 10px', color: 'var(--text-muted)' }}>
                            {Object.entries(s.byCode || {}).map(([code, n]) => `${code}×${n}`).join(' · ') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {byDepartment.length > 0 && (
                <Card title="Détail par service">
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-xs)' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                          {['Service', 'Établissement', 'Gardes', 'Agents', 'Gardes / agent'].map((h) => (
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
                        {byDepartment.map((d) => (
                          <tr key={d.departmentId || d.departmentName} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '8px 10px', color: 'var(--text-primary)', fontWeight: 600 }}>{d.departmentName}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{d.establishmentName || '—'}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text-primary)', fontWeight: 700 }}>{d.guards}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{d.staff}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>
                              {d.staff ? Math.round((d.guards / d.staff) * 10) / 10 : '—'}
                            </td>
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

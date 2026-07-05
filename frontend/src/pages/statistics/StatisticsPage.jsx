import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { statisticsAPI } from '../../api';
import { useAuthStore } from '../../store';
import { useTranslation, exportToPDF, exportToExcel } from '../../utils/helpers';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, ResponsiveContainer, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend
} from 'recharts';

const COLORS = ['#1B4FCA', '#10B981', '#F59E0B', '#6366F1', '#EC4899', '#0EA5E9'];

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>{label}</p>
      {payload.map(p => <p key={p.name} style={{ color: p.color, fontWeight: 600 }}>{p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</p>)}
    </div>
  );
};

export default function StatisticsPage() {
  const { user } = useAuthStore();
  const { t } = useTranslation();
  const [year, setYear] = useState(new Date().getFullYear());
  const [period, setPeriod] = useState({ from: new Date(new Date().setDate(1)).toISOString().split('T')[0], to: new Date().toISOString().split('T')[0] });

  const { data: absenceStats } = useQuery({
    queryKey: ['absence-stats', year],
    queryFn: () => statisticsAPI.getAbsenceStats({ year }).then(r => r.data.data),
  });

  const { data: shiftStats = [] } = useQuery({
    queryKey: ['shift-stats-full', period],
    queryFn: () => statisticsAPI.getShiftStats(period).then(r => r.data.data),
  });

  const { data: coverageData = [] } = useQuery({
    queryKey: ['coverage', period],
    queryFn: () => statisticsAPI.getCoverage(period).then(r => r.data.data),
  });

  const monthlyData = absenceStats?.byMonth?.map(m => ({
    month: m.month?.substring(5), // MM
    total: parseInt(m.total),
    approved: parseInt(m.approved),
    rejected: parseInt(m.rejected),
  })) || [];

  const doctorData = shiftStats.slice(0, 10).map(s => ({
    name: `${s.first_name?.[0]}. ${s.last_name}`,
    gardes: parseInt(s.total_shifts) || 0,
    heures: parseFloat(s.total_hours) || 0,
    absences: parseInt(s.absent) || 0,
    tauxAbsence: parseFloat(s.absence_rate) || 0,
  }));

  const handleExportPDF = () => {
    exportToPDF(
      `Rapport statistiques ${year}`,
      ['Médecin', 'Gardes', 'Heures', 'Absences', 'Taux absence'],
      shiftStats.map(s => [
        `${s.first_name} ${s.last_name}`,
        s.total_shifts || 0,
        `${parseFloat(s.total_hours || 0).toFixed(0)}h`,
        s.absent || 0,
        `${s.absence_rate || 0}%`,
      ]),
      `statistiques_${year}`
    );
  };

  const handleExportExcel = () => {
    exportToExcel(
      'Statistiques',
      ['Médecin', 'Gardes', 'Heures', 'Absences', 'Taux absence'],
      shiftStats.map(s => [
        `${s.first_name} ${s.last_name}`,
        s.total_shifts || 0,
        parseFloat(s.total_hours || 0).toFixed(0),
        s.absent || 0,
        `${s.absence_rate || 0}%`,
      ]),
      `statistiques_${year}`
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('nav.statistics')}</h1>
          <p className="page-subtitle">Tableaux de bord analytiques · {user?.establishmentName}</p>
        </div>
        <div className="quick-actions">
          <select className="form-control btn-sm" style={{ width: 'auto' }} value={year} onChange={e => setYear(parseInt(e.target.value))}>
            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={handleExportPDF}>PDF</button>
          <button className="btn btn-ghost btn-sm" onClick={handleExportExcel}>Excel</button>
        </div>
      </div>

      {/* Graphique absences par mois */}
      <div className="card mb-6">
        <div className="card-header">
          <h3 className="card-title">Évolution des absences — {year}</h3>
        </div>
        <div className="card-body">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={monthlyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1B4FCA" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#1B4FCA" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorApproved" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />
              <Area type="monotone" dataKey="total" name="Total" stroke="#1B4FCA" fill="url(#colorTotal)" strokeWidth={2} />
              <Area type="monotone" dataKey="approved" name="Approuvées" stroke="#10B981" fill="url(#colorApproved)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
        {/* Gardes par médecin */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Gardes par médecin</h3>
          </div>
          <div className="card-body" style={{ paddingTop: 0 }}>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={doctorData} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} axisLine={false} tickLine={false} width={70} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="gardes" name="Gardes" fill="#1B4FCA" radius={[0, 4, 4, 0]} />
                <Bar dataKey="absences" name="Absences" fill="#EF4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Types d'absence (Pie) */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Types d'absence</h3>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={absenceStats?.byType || []}
                  dataKey="total"
                  nameKey="name"
                  cx="50%" cy="50%"
                  innerRadius={60} outerRadius={100}
                  paddingAngle={3}
                >
                  {(absenceStats?.byType || []).map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, n) => [v, n]} contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Couverture par service */}
      <div className="card mb-6">
        <div className="card-header">
          <h3 className="card-title">Couverture par service — Période actuelle</h3>
        </div>
        <div className="card-body">
          {coverageData.map((d, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-secondary)' }}>{d.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
                    {d.covered}/{d.total_shifts} gardes couvertes
                  </span>
                  <span style={{
                    fontSize: 'var(--font-sm)', fontWeight: 800,
                    color: (d.coverage_rate || 0) >= 90 ? 'var(--color-success)' :
                           (d.coverage_rate || 0) >= 70 ? 'var(--color-warning)' : 'var(--color-danger)',
                  }}>
                    {d.coverage_rate || 0}%
                  </span>
                </div>
              </div>
              <div style={{ height: 8, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(d.coverage_rate || 0, 100)}%`,
                  background: (d.coverage_rate || 0) >= 90 ? 'var(--color-success)' :
                              (d.coverage_rate || 0) >= 70 ? 'var(--color-warning)' : 'var(--color-danger)',
                  borderRadius: 4, transition: 'width 1s ease',
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tableau détaillé par médecin */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Détail par médecin</h3>
        </div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Médecin</th>
                <th>Spécialité</th>
                <th>Gardes totales</th>
                <th>Heures</th>
                <th>Absences</th>
                <th>Taux absence</th>
                <th>Remplacé(s)</th>
              </tr>
            </thead>
            <tbody>
              {shiftStats.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>Dr. {s.first_name} {s.last_name}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-xs)' }}>{s.speciality || '—'}</td>
                  <td style={{ fontWeight: 700 }}>{s.total_shifts || 0}</td>
                  <td>{parseFloat(s.total_hours || 0).toFixed(0)}h</td>
                  <td>
                    <span style={{ color: (s.absent || 0) > 0 ? 'var(--color-danger)' : 'var(--text-muted)' }}>
                      {s.absent || 0}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 60, height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${Math.min(s.absence_rate || 0, 100)}%`,
                          background: (s.absence_rate || 0) > 20 ? 'var(--color-danger)' : (s.absence_rate || 0) > 10 ? 'var(--color-warning)' : 'var(--color-success)',
                          borderRadius: 2,
                        }} />
                      </div>
                      <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>
                        {s.absence_rate || 0}%
                      </span>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{s.replaced || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

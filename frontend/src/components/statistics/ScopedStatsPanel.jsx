import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, CalendarRange, FileSpreadsheet, FileText, ShieldAlert, UsersRound } from 'lucide-react';
import { scopedStatsAPI } from '../../api';
import { frenchRange } from '../../utils/frenchDates';
import { exportToExcel, exportToPDF } from '../../utils/helpers';
import { GsEmpty, GsPanel, GsSkeleton, GsStat, GsStatRail, GsTable } from '../gs';
import './scoped-stats.css';

const STATE_LABELS = { brouillon: 'Brouillon', soumis: 'Soumis', en_cours: 'En cours', termine: 'Terminé', suspendu: 'Suspendu' };
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const PRESETS = [
  { id: 'month', label: 'Ce mois', range: () => { const n = new Date(); return { from: `${n.getFullYear()}-${pad(n.getMonth() + 1)}-01`, to: iso(n) }; } },
  { id: 'month-full', label: 'Mois complet', range: () => { const n = new Date(); return { from: `${n.getFullYear()}-${pad(n.getMonth() + 1)}-01`, to: iso(new Date(n.getFullYear(), n.getMonth() + 1, 0)) }; } },
  { id: 'quarter', label: '3 derniers mois', range: () => { const n = new Date(); return { from: iso(new Date(n.getFullYear(), n.getMonth() - 2, 1)), to: iso(n) }; } },
  { id: 'year', label: 'Année', range: () => { const n = new Date(); return { from: `${n.getFullYear()}-01-01`, to: `${n.getFullYear()}-12-31` }; } },
];

function RuleBar({ value, max, tone = 'seal' }) {
  const share = max > 0 ? Math.min(100, Math.max(0, (Number(value) / max) * 100)) : 0;
  return <svg className={`gsscp-rule${tone === 'duty' ? ' is-duty' : ''}${tone === 'alert' ? ' is-alert' : ''}`} viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect className="gsscp-rule-track" x="0" y="0" width="100" height="4" rx="2" /><rect className="gsscp-rule-fill" x="0" y="0" width={share} height="4" rx="2" /></svg>;
}

function ValueList({ rows, empty = 'Aucune donnée' }) {
  if (!rows.length) return <GsEmpty bare title={empty} />;
  const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
  return <div className="gsscp-values">{rows.map((row) => <div className="gsscp-value" key={row.id || row.label}><div className="gsscp-value-head"><span>{row.label}</span><b className="gs-num">{row.value}</b></div><RuleBar value={row.value} max={max} tone={row.tone} />{row.hint ? <small>{row.hint}</small> : null}</div>)}</div>;
}

export default function ScopedStatsPanel({ establishmentId, title = 'Statistiques', showExports = false }) {
  const [presetId, setPresetId] = useState('month-full');
  const period = useMemo(() => (PRESETS.find((preset) => preset.id === presetId) || PRESETS[0]).range(), [presetId]);
  const params = useMemo(() => ({ ...period, ...(establishmentId ? { establishmentId } : {}) }), [period, establishmentId]);
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['scoped-stats', params], queryFn: () => scopedStatsAPI.get(params) });
  const payload = data?.data?.data;
  const summary = payload?.summary || {};
  const byDepartment = payload?.byDepartment || [];
  const byState = payload?.byState || [];
  const topStaff = payload?.topStaff || [];
  const timeline = payload?.timeline || [];
  const isForbidden = error?.response?.status === 403;
  const stateRows = byState.map((state) => ({ label: STATE_LABELS[state.state] || state.state, value: state.count, id: state.state, tone: state.state === 'en_cours' ? 'duty' : state.state === 'suspendu' ? 'alert' : undefined }));
  const departmentRows = byDepartment.slice(0, 8).map((department) => ({ label: department.departmentName, value: department.guards, id: department.departmentId || department.departmentName, hint: `${department.staff} agent(s)` }));
  const timelineRows = timeline.map((point) => ({ label: point.date, value: point.guards, id: point.date }));
  const staffColumns = [
    { key: 'rank', label: '#', num: true, render: (_, index) => index + 1 },
    { key: 'name', label: 'Agent', strong: true, render: (row) => <span className="gsscp-person"><b>{row.name}</b>{row.roleName ? <small>{row.roleName}</small> : null}</span> },
    { key: 'departmentName', label: 'Service', render: (row) => row.departmentName || '—' },
    { key: 'guards', label: 'Gardes', num: true },
  ];
  const departmentColumns = [
    { key: 'departmentName', label: 'Service', strong: true },
    { key: 'establishmentName', label: 'Établissement', render: (row) => row.establishmentName || '—' },
    { key: 'guards', label: 'Gardes', num: true },
    { key: 'staff', label: 'Agents', num: true },
    { key: 'load', label: 'Gardes / agent', num: true, render: (row) => row.staff ? Math.round((row.guards / row.staff) * 10) / 10 : '—' },
  ];
  const exportRows = topStaff.map((staff) => [staff.name, staff.roleName || '—', staff.departmentName || '—', staff.guards]);
  const exportHeaders = ['Agent', 'Rôle', 'Service', 'Gardes'];
  const exportName = `statistiques_${period.from}_${period.to}`;

  return (
    <div className="gsscp-wrap">
      <div className="gsscp-head"><div><span className="gs-eyebrow">Lecture analytique</span><h3 className="gsscp-title">{title}</h3><p>{payload?.scopeLabel ? `Portée : ${payload.scopeLabel}` : 'Portée déterminée par votre rôle'}</p>{payload?.period ? <small>Période analysée : {frenchRange(payload.period.from, payload.period.to)}</small> : null}</div><div className="gsscp-tools"><div className="gsscp-presets">{PRESETS.map((preset) => <button key={preset.id} className={`gs-btn${preset.id === presetId ? ' is-primary' : ''}`} type="button" onClick={() => setPresetId(preset.id)}>{preset.label}</button>)}</div>{showExports ? <div className="gsscp-exports"><button className="gs-btn" type="button" disabled={!topStaff.length} onClick={() => exportToPDF(`Statistiques — ${frenchRange(period.from, period.to)}`, exportHeaders, exportRows, exportName)}><FileText size={14} /> PDF</button><button className="gs-btn" type="button" disabled={!topStaff.length} onClick={() => exportToExcel('Statistiques', exportHeaders, exportRows, exportName)}><FileSpreadsheet size={14} /> Excel</button></div> : null}</div></div>
      {isForbidden ? <GsEmpty icon={<ShieldAlert size={28} />} title="Statistiques indisponibles" hint="Votre rôle ne possède pas de périmètre analytique accessible." /> : isError ? <GsEmpty icon={<ShieldAlert size={28} />} title="Les statistiques n’ont pas pu être chargées" hint="Réessayez après quelques instants." /> : isLoading ? <GsSkeleton variant="block" count={4} /> : (
        <>
          <GsStatRail><GsStat label="Gardes" value={summary.totalGuards ?? 0} tone="seal" hint={`${summary.daysCovered ?? 0} jour(s) couvert(s)`} /><GsStat label="Agents mobilisés" value={summary.staffCount ?? 0} tone="duty" hint={`${summary.averagePerStaff ?? 0} garde(s) / agent`} /><GsStat label="Services" value={summary.departmentsCount ?? 0} hint={`${summary.schedulesCount ?? 0} planning(s)`} /><GsStat label="Moyenne / jour" value={summary.averagePerDay ?? 0} /><GsStat label="Écart de charge" value={summary.loadGap ?? 0} tone={summary.loadGap >= 3 ? 'alert' : undefined} hint={`min ${summary.minLoad ?? 0} · max ${summary.maxLoad ?? 0}`} /></GsStatRail>
          {summary.totalGuards === 0 ? <GsEmpty icon={<CalendarRange size={28} />} title="Aucune garde enregistrée sur cette période" hint="Choisissez une période plus large ou ouvrez un planning concerné." /> : (
            <div className="gsscp-grid">
              <GsPanel title="Évolution des gardes" sub="Nombre de gardes par jour" icon={<BarChart3 size={15} />}><ValueList rows={timelineRows} empty="Aucune garde dans la période" /></GsPanel>
              <GsPanel title="État des plannings" sub="Répartition de la période"><ValueList rows={stateRows} /></GsPanel>
              <GsPanel title="Répartition par service" sub="Services les plus sollicités"><ValueList rows={departmentRows} /></GsPanel>
              <GsPanel title="Charge par agent" sub="Classement des agents les plus sollicités" icon={<UsersRound size={15} />} flush><GsTable columns={staffColumns} rows={topStaff} rowKey="userId" label="Charge par agent" empty={<GsEmpty bare title="Aucun agent mobilisé" />} /></GsPanel>
              {byDepartment.length ? <GsPanel title="Détail par service" sub="Charge moyenne par agent" flush><GsTable columns={departmentColumns} rows={byDepartment} rowKey={(row) => row.departmentId || row.departmentName} label="Détail par service" /></GsPanel> : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}

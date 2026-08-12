import React, { useState, useEffect } from 'react';
import { portfolioAPI } from '../../api';

/**
 * Modal détaillée d'un agent : identité, statistiques de gardes, absences, congés, historique
 */
export default function StaffPortfolioModal({ agent, onClose }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('stats');

  useEffect(() => {
    if (!agent?.id) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await portfolioAPI.getUserDetails(agent.id);
        if (!cancelled) setDetails(res.data.data);
      } catch (err) {
        if (!cancelled) setError('Impossible de charger les détails de cet agent.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [agent?.id]);

  if (!agent) return null;

  const initials = `${agent.first_name?.[0] || ''}${agent.last_name?.[0] || ''}`.toUpperCase();

  const fmtDate = (d) => {
    if (!d) return '—';
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-');
    if (!y || !m || !day) return s;
    return new Date(+y, +m - 1, +day).toLocaleDateString('fr-FR');
  };

  const tabs = [
    { key: 'stats', label: '📊 Statistiques' },
    { key: 'leaves', label: '🌴 Congés' },
    { key: 'absences', label: '⚠️ Absences' },
    { key: 'history', label: '📜 Historique' }
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--bg-card)', borderRadius: 'var(--border-radius-lg)',
          boxShadow: 'var(--shadow-xl)', width: '100%', maxWidth: 720,
          maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden'
        }}
      >
        {/* En-tête */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', backgroundColor: 'var(--border-subtle)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 22, color: 'var(--text-muted)', flexShrink: 0, overflow: 'hidden'
          }}>
            {agent.avatar_url
              ? <img src={agent.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--font-lg, 18px)', color: 'var(--text-primary)' }}>
              {agent.first_name} {agent.last_name}
            </div>
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-muted)' }}>
              {agent.role_name}{agent.grade ? ` · ${agent.grade}` : ''}
            </div>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
              {agent.email}{agent.phone ? ` · ${agent.phone}` : ''}
              {agent.matricule ? ` · Mat. ${agent.matricule}` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', fontSize: 22, cursor: 'pointer',
              color: 'var(--text-muted)', lineHeight: 1, padding: 4
            }}
            aria-label="Fermer"
          >×</button>
        </div>

        {/* Onglets */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 24px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px 12px', fontSize: 'var(--font-sm)',
                fontWeight: tab === t.key ? 600 : 400,
                color: tab === t.key ? 'var(--color-primary)' : 'var(--text-muted)',
                borderBottom: tab === t.key ? '2px solid var(--color-primary)' : '2px solid transparent'
              }}
            >{t.label}</button>
          ))}
        </div>

        {/* Contenu */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>Chargement…</div>}
          {error && <div style={{ color: '#DC2626', fontSize: 'var(--font-sm)' }}>{error}</div>}

          {!loading && !error && details && (
            <>
              {tab === 'stats' && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
                    {[
                      { label: 'Gardes totales', value: details.shiftsStats.total_shifts, color: 'var(--color-primary)' },
                      { label: '30 derniers jours', value: details.shiftsStats.shifts_last_month, color: '#10B981' },
                      { label: 'Absences signalées', value: details.shiftAbsences.length, color: '#EF4444' },
                      { label: 'Congés à venir', value: details.leaves.length, color: '#F59E0B' }
                    ].map(kpi => (
                      <div key={kpi.label} style={{
                        padding: 14, borderRadius: 'var(--border-radius-lg)',
                        border: '1px solid var(--border-subtle)', textAlign: 'center'
                      }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
                        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{kpi.label}</div>
                      </div>
                    ))}
                  </div>

                  {details.shiftsStats.monthly_breakdown?.length > 0 && (
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-sm)', marginBottom: 10 }}>Répartition par mois</div>
                      {details.shiftsStats.monthly_breakdown.map(m => (
                        <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', width: 64 }}>{m.month}</span>
                          <div style={{ flex: 1, height: 8, backgroundColor: 'var(--border-subtle)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{
                              width: `${Math.min(100, (m.count / Math.max(...details.shiftsStats.monthly_breakdown.map(x => x.count))) * 100)}%`,
                              height: '100%', backgroundColor: 'var(--color-primary)'
                            }} />
                          </div>
                          <span style={{ fontSize: 'var(--font-xs)', fontWeight: 600, width: 24, textAlign: 'right' }}>{m.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'leaves' && (
                details.leaves.length === 0
                  ? <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>Aucun congé en cours ou à venir.</div>
                  : details.leaves.map(l => (
                    <div key={l.id} style={{
                      padding: 12, marginBottom: 8, borderRadius: 'var(--border-radius-lg)',
                      border: '1px solid var(--border-subtle)', borderLeft: `3px solid ${l.color || '#10B981'}`
                    }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-sm)' }}>{l.type_name}</div>
                      <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                        Du {fmtDate(l.start_date)} au {fmtDate(l.end_date)} · {l.status}
                      </div>
                    </div>
                  ))
              )}

              {tab === 'absences' && (
                details.shiftAbsences.length === 0
                  ? <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>Aucune absence signalée.</div>
                  : details.shiftAbsences.map(a => (
                    <div key={a.id} style={{
                      padding: 12, marginBottom: 8, borderRadius: 'var(--border-radius-lg)',
                      border: '1px solid var(--border-subtle)', borderLeft: '3px solid #EF4444'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 'var(--font-sm)' }}>{a.type_name}</span>
                        <span style={{
                          fontSize: 'var(--font-xs)', fontWeight: 600,
                          color: a.is_justified ? '#10B981' : '#DC2626'
                        }}>
                          {a.is_justified ? 'Justifiée' : 'Non justifiée'}
                        </span>
                      </div>
                      <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                        {fmtDate(a.start_date)}
                        {a.start_time ? ` · ${String(a.start_time).slice(0, 5)}` : ''}
                        {a.end_time ? ` → ${String(a.end_time).slice(0, 5)}` : ''}
                      </div>
                      {a.reason && (
                        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-primary)', marginTop: 6 }}>{a.reason}</div>
                      )}
                    </div>
                  ))
              )}

              {tab === 'history' && (
                details.recentHistory.length === 0
                  ? <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>Aucune action enregistrée.</div>
                  : details.recentHistory.map((h, i) => (
                    <div key={i} style={{
                      padding: '10px 12px', marginBottom: 6, borderRadius: 'var(--border-radius-lg)',
                      border: '1px solid var(--border-subtle)', fontSize: 'var(--font-xs)'
                    }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{h.action}</div>
                      {h.description && <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{h.description}</div>}
                      <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                        {new Date(h.created_at).toLocaleString('fr-FR')} · {h.category}
                      </div>
                    </div>
                  ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

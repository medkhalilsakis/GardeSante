import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { replacementsAPI } from '../../api';
import { useAuthStore } from '../../store';
import { useTranslation, formatDate, getStatusBadgeClass } from '../../utils/helpers';
import toast from 'react-hot-toast';

const urgencyConfig = {
  critical: { color: 'var(--color-danger)', label: 'CRITIQUE', bg: 'var(--color-danger-20)' },
  high:     { color: 'var(--color-warning)', label: 'Élevé', bg: 'var(--color-warning-10)' },
  normal:   { color: 'var(--color-primary-light)', label: 'Normal', bg: 'var(--color-primary-10)' },
  low:      { color: 'var(--text-muted)', label: 'Faible', bg: 'rgba(255,255,255,0.04)' },
};

export default function ReplacementsPage() {
  const { user, hasPermission } = useAuthStore();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ status: 'pending', urgency: '' });
  const [selectedReplacement, setSelectedReplacement] = useState(null);

  const canApprove = hasPermission('replacements.approve');

  const { data: replData, isLoading } = useQuery({
    queryKey: ['replacements', filters],
    queryFn: () => replacementsAPI.getAll({ ...filters, limit: 50 }).then(r => r.data),
    refetchInterval: 30000,
  });

  const replacements = replData?.data || [];

  const acceptMutation = useMutation({
    mutationFn: ({ id, replacementUserId }) => replacementsAPI.accept(id, { replacementUserId }),
    onSuccess: () => {
      toast.success('Remplacement validé et nouvelle garde créée !');
      qc.invalidateQueries(['replacements']);
      setSelectedReplacement(null);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erreur'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id) => replacementsAPI.reject(id),
    onSuccess: () => { toast.success('Remplacement rejeté'); qc.invalidateQueries(['replacements']); },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('replacements.title')}</h1>
          <p className="page-subtitle">{replacements.length} remplacement(s)</p>
        </div>
      </div>

      {/* Filtres rapides */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { status: 'pending', label: 'En attente' },
          { status: 'accepted', label: 'Acceptés' },
          { status: 'rejected', label: 'Rejetés' },
          { status: '', label: 'Tous' },
        ].map(f => (
          <button
            key={f.status}
            className={`btn btn-sm ${filters.status === f.status ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilters(prev => ({ ...prev, status: f.status }))}
          >
            {f.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {['critical', 'high', 'normal', ''].map(u => (
          <button
            key={u}
            className={`btn btn-sm ${filters.urgency === u ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilters(prev => ({ ...prev, urgency: u }))}
            style={u && filters.urgency !== u ? { color: urgencyConfig[u]?.color } : {}}
          >
            {u ? urgencyConfig[u]?.label : 'Toute urgence'}
          </button>
        ))}
      </div>

      {/* Cartes de remplacement */}
      {isLoading ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 120, borderRadius: 12 }} />
          ))}
        </div>
      ) : replacements.length === 0 ? (
        <div className="card" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--font-3xl)', marginBottom: 8 }}>✅</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-md)' }}>
            Aucun remplacement {filters.status === 'pending' ? 'en attente' : ''}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {replacements.map(r => {
            const urgency = urgencyConfig[r.urgency] || urgencyConfig.normal;
            return (
              <div key={r.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Barre urgence */}
                <div style={{ height: 4, background: urgency.color }} />
                <div style={{ padding: '16px 24px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <span style={{
                          background: urgency.bg, color: urgency.color,
                          fontSize: 'var(--font-xs)', fontWeight: 800,
                          padding: '3px 8px', borderRadius: 4,
                          letterSpacing: '0.04em',
                        }}>
                          {urgency.label}
                        </span>
                        <span className={`badge ${getStatusBadgeClass(r.status)}`}>{t(`status.${r.status}`)}</span>
                        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
                          Créé le {formatDate(r.created_at)}
                        </span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', alignItems: 'center', fontSize: 'var(--font-sm)' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)' }}>Absent:</span>
                        <span style={{ fontWeight: 700, color: 'var(--color-danger)' }}>
                          Dr. {r.absent_first} {r.absent_last}
                          {r.absent_speciality && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>({r.absent_speciality})</span>}
                        </span>

                        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)' }}>Service:</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{r.department_name}</span>

                        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)' }}>Garde:</span>
                        <span>
                          <strong>{formatDate(r.shift_date)}</strong>
                          {' '}<span style={{ color: 'var(--text-secondary)' }}>{r.shift_type_name}</span>
                          {' · '}<span style={{ color: r.shift_color || 'var(--color-primary-light)', fontSize: 'var(--font-xs)' }}>
                            {r.start_time?.substring(0,5)}–{r.end_time?.substring(0,5)}
                          </span>
                        </span>

                        {r.replacement_first && (
                          <>
                            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)' }}>Remplaçant:</span>
                            <span style={{ fontWeight: 700, color: 'var(--color-success)' }}>
                              Dr. {r.replacement_first} {r.replacement_last}
                            </span>
                          </>
                        )}

                        {r.notes && (
                          <>
                            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-xs)' }}>Note:</span>
                            <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-xs)' }}>{r.notes}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    {r.status === 'pending' && canApprove && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => setSelectedReplacement(r)}
                        >
                          {t('replacements.assign')}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => rejectMutation.mutate(r.id)}
                          disabled={rejectMutation.isPending}
                        >
                          {t('common.reject')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Assigner Remplaçant */}
      {selectedReplacement && (
        <AssignModal
          replacement={selectedReplacement}
          onClose={() => setSelectedReplacement(null)}
          onAccept={({ id, replacementUserId }) => acceptMutation.mutate({ id, replacementUserId })}
          isPending={acceptMutation.isPending}
        />
      )}
    </div>
  );
}

function AssignModal({ replacement, onClose, onAccept, isPending }) {
  const { t } = useTranslation();
  const [selectedUserId, setSelectedUserId] = useState('');

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['candidates', replacement.id],
    queryFn: () => replacementsAPI.getCandidates(replacement.id).then(r => r.data.data),
  });

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{t('replacements.candidates')}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{
            background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 16px', marginBottom: 16,
            fontSize: 'var(--font-sm)', color: 'var(--text-secondary)',
          }}>
            Remplacement pour <strong style={{ color: 'var(--text-primary)' }}>Dr. {replacement.absent_first} {replacement.absent_last}</strong>
            {' '} — {replacement.department_name} — {formatDate(replacement.shift_date)} ({replacement.shift_type_name})
          </div>

          {isLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin" style={{ display: 'inline-block' }}>
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
              </svg>
              <p style={{ marginTop: 8 }}>Calcul des candidats...</p>
            </div>
          ) : candidates.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>Aucun candidat disponible</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {candidates.map(c => (
                <label key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px',
                  background: selectedUserId === c.id ? 'var(--color-primary-10)' : 'var(--bg-elevated)',
                  border: `1px solid ${selectedUserId === c.id ? 'var(--color-primary)' : 'var(--border-subtle)'}`,
                  borderRadius: 8, cursor: 'pointer', transition: 'all var(--transition-fast)',
                }}>
                  <input type="radio" name="candidate" value={c.id} checked={selectedUserId === c.id} onChange={e => setSelectedUserId(e.target.value)} style={{ display: 'none' }} />
                  <div className="avatar avatar-sm" style={{ background: 'var(--color-success-10)', color: 'var(--color-success)', flexShrink: 0 }}>
                    {c.first_name?.[0]}{c.last_name?.[0]}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 'var(--font-sm)' }}>
                      Dr. {c.first_name} {c.last_name}
                    </p>
                    <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>
                      {c.grade} {c.speciality ? `· ${c.speciality}` : ''} · {c.recent_shifts || 0} garde(s) récente(s)
                    </p>
                  </div>
                  <div style={{
                    background: c.score >= 80 ? 'var(--color-success-10)' : c.score >= 50 ? 'var(--color-warning-10)' : 'var(--color-danger-10)',
                    color: c.score >= 80 ? 'var(--color-success)' : c.score >= 50 ? 'var(--color-warning)' : 'var(--color-danger)',
                    padding: '4px 10px', borderRadius: 6, fontSize: 'var(--font-xs)', fontWeight: 700,
                  }}>
                    Score: {c.score}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={!selectedUserId || isPending}
            onClick={() => onAccept({ id: replacement.id, replacementUserId: selectedUserId })}
          >
            {isPending ? t('common.loading') : t('replacements.assign')}
          </button>
        </div>
      </div>
    </div>
  );
}

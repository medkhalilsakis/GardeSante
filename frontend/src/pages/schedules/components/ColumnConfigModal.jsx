import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { scheduleConfigAPI } from '../../../api';
import toast from 'react-hot-toast';

/**
 * ColumnConfigModal
 * - Toggle visible/hidden columns
 * - Add new custom column with type detection
 */

const TYPE_LABELS = {
  text:       { label: 'Texte',     icon: 'T',  color: '#6B7280' },
  number:     { label: 'Nombre',    icon: '#',  color: '#3B82F6' },
  date:       { label: 'Date',      icon: '📅', color: '#8B5CF6' },
  time:       { label: 'Heure',     icon: '⏰', color: '#0891B2' },
  person:     { label: 'Personne',  icon: '👤', color: '#059669' },
  phone:      { label: 'Telephone', icon: '📞', color: '#D97706' },
  select:     { label: 'Liste',     icon: '☰',  color: '#7C3AED' },
  boolean:    { label: 'Oui/Non',   icon: '✓',  color: '#10B981' },
  shift_type: { label: 'Type garde',icon: '🏥', color: '#EF4444' },
};

export default function ColumnConfigModal({ columns, hiddenCols, onToggle, onShowAll, onClose }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState('manage'); // 'manage' | 'add'
  const [newCol, setNewCol] = useState({ label: '', code: '', dataType: 'text', options: '' });
  const [detected, setDetected] = useState(null);
  const [detecting, setDetecting] = useState(false);

  // Detect column type from label
  const detectType = async (label) => {
    if (!label.trim()) return;
    setDetecting(true);
    try {
      const res = await scheduleConfigAPI.detectColumn(label);
      const d = res.data.data;
      setDetected(d);
      setNewCol(c => ({
        ...c,
        code: d.suggestedCode || label.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        dataType: d.suggestedType || 'text',
      }));
    } catch {
      setNewCol(c => ({ ...c, code: label.toLowerCase().replace(/[^a-z0-9]/g, '_') }));
    } finally {
      setDetecting(false);
    }
  };

  // Create column
  const createMut = useMutation({
    mutationFn: (data) => scheduleConfigAPI.createColumn(data),
    onSuccess: () => {
      toast.success('Colonne ajoutee');
      qc.invalidateQueries(['schedule-columns']);
      setMode('manage');
      setNewCol({ label: '', code: '', dataType: 'text', options: '' });
      setDetected(null);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });

  const inputSt = {
    width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
    color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-card)', borderRadius: 16, width: 500, maxHeight: '80vh',
        boxShadow: '0 20px 60px rgba(0,0,0,.25)', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
              {mode === 'manage' ? 'Gestion des colonnes' : 'Ajouter une colonne'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {mode === 'manage'
                ? 'Affichez ou masquez les colonnes du tableur'
                : 'Le systeme detecte automatiquement le type de la colonne'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', padding: 4 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 22px' }}>
          {mode === 'manage' ? (
            <>
              {/* Toggle all */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{columns.length} colonnes configurees</span>
                <button onClick={onShowAll} style={{ fontSize: 12, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
                  Tout afficher
                </button>
              </div>

              {/* Column list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {columns.filter(c => c.is_active).map(col => {
                  const hidden = hiddenCols.includes(col.code);
                  const typeInfo = TYPE_LABELS[col.data_type] || TYPE_LABELS.text;
                  return (
                    <div key={col.id || col.code}
                      onClick={() => !col.is_system && onToggle(col.code)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                        borderRadius: 10, cursor: col.is_system ? 'default' : 'pointer',
                        background: hidden ? 'var(--bg-elevated)' : 'rgba(27,79,202,.04)',
                        border: `1px solid ${hidden ? 'var(--border-subtle)' : 'var(--color-primary)'}`,
                        opacity: hidden ? 0.5 : 1, transition: 'all .15s',
                      }}>
                      {/* Toggle */}
                      <div style={{
                        width: 20, height: 20, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: hidden ? 'var(--bg-elevated)' : 'var(--color-primary)',
                        color: '#fff', fontSize: 12, border: `1px solid ${hidden ? 'var(--border-subtle)' : 'var(--color-primary)'}`,
                      }}>
                        {!hidden && '✓'}
                      </div>
                      {/* Type badge */}
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                        background: typeInfo.color + '18', color: typeInfo.color,
                      }}>
                        {typeInfo.icon} {typeInfo.label}
                      </span>
                      {/* Label */}
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{col.label}</span>
                      {/* System lock */}
                      {col.is_system && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>🔒 Systeme</span>}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              {/* Add column form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
                    Nom de la colonne
                  </label>
                  <input
                    type="text" placeholder="Ex: Horaire de debut, Specialite, Equipe..."
                    value={newCol.label} style={inputSt}
                    onChange={e => { setNewCol(c => ({ ...c, label: e.target.value })); detectType(e.target.value); }}
                  />
                </div>

                {/* Detection result */}
                {detecting && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 12, height: 12, border: '2px solid var(--border-subtle)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', display: 'inline-block' }} />
                    Detection du type...
                  </div>
                )}
                {detected && !detecting && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1D4ED8', marginBottom: 4 }}>
                      🤖 Type detecte : {TYPE_LABELS[detected.suggestedType]?.label || detected.suggestedType}
                      <span style={{ fontWeight: 400, marginLeft: 6 }}>({Math.round((detected.confidence || 0) * 100)}% confiance)</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#3B82F6' }}>
                      Vous pouvez modifier le type ci-dessous si la detection est incorrecte.
                    </div>
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
                    Type de donnee
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                    {Object.entries(TYPE_LABELS).map(([key, info]) => (
                      <button key={key} onClick={() => setNewCol(c => ({ ...c, dataType: key }))}
                        style={{
                          padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${newCol.dataType === key ? info.color : 'var(--border-subtle)'}`,
                          background: newCol.dataType === key ? info.color + '10' : 'transparent',
                          cursor: 'pointer', fontSize: 11, fontWeight: 700, color: info.color,
                          display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center',
                        }}>
                        {info.icon} {info.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Options for select type */}
                {newCol.dataType === 'select' && (
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
                      Options (separees par des virgules)
                    </label>
                    <input type="text" placeholder="Ex: Matin, Apres-midi, Nuit" value={newCol.options}
                      onChange={e => setNewCol(c => ({ ...c, options: e.target.value }))} style={inputSt} />
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
                    Code technique (auto-genere)
                  </label>
                  <input type="text" value={newCol.code}
                    onChange={e => setNewCol(c => ({ ...c, code: e.target.value }))} style={{ ...inputSt, fontFamily: 'monospace' }} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {mode === 'manage' ? (
            <>
              <button onClick={() => setMode('add')}
                style={{ padding: '9px 18px', borderRadius: 8, border: '1px dashed var(--color-primary)', background: 'rgba(27,79,202,.04)', color: 'var(--color-primary)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                + Nouvelle colonne
              </button>
              <button onClick={onClose}
                style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Fermer
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { setMode('manage'); setDetected(null); setNewCol({ label: '', code: '', dataType: 'text', options: '' }); }}
                style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                Retour
              </button>
              <button
                disabled={!newCol.label.trim() || !newCol.code.trim() || createMut.isPending}
                onClick={() => {
                  const payload = {
                    code: newCol.code, label: newCol.label, dataType: newCol.dataType,
                    validationRules: newCol.dataType === 'select' && newCol.options
                      ? { options: newCol.options.split(',').map(s => s.trim()).filter(Boolean) }
                      : {},
                  };
                  createMut.mutate(payload);
                }}
                style={{
                  padding: '9px 18px', borderRadius: 8, border: 'none',
                  background: 'var(--color-primary)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  opacity: !newCol.label.trim() || !newCol.code.trim() ? 0.5 : 1,
                }}>
                {createMut.isPending ? 'Ajout...' : 'Ajouter la colonne'}
              </button>
            </>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

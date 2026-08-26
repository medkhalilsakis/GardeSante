import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Calendar, Check, Clock, Hash, Info, List, Lock, Phone, Stethoscope, Type, User, X,
} from 'lucide-react';
import { scheduleConfigAPI } from '../../../api';
import toast from 'react-hot-toast';

/**
 * ColumnConfigModal
 * - Toggle visible/hidden columns
 * - Add new custom column with type detection
 */

/* Neuf types de données : une taxonomie, donc les couleurs d'identité
   `--gs-id-*` et non les tons sémantiques. `--gs-id-1/2/4` sont écartés, ils
   sont identiques au cachet, au service et à l'alerte en thème clair. Il reste
   sept teintes pour huit types colorés : la date et l'heure partagent la même,
   ce qui est juste — elles disent toutes deux un moment, et l'icône les sépare.
   Les icônes viennent de la même bibliothèque que le reste de la plateforme :
   les émoji d'origine ne s'affichaient pas deux fois pareil d'un poste à
   l'autre. */
const TYPE_LABELS = {
  text:       { label: 'Texte',      Icon: Type,        color: 'var(--gs-ink-faint)' },
  number:     { label: 'Nombre',     Icon: Hash,        color: 'var(--gs-id-8)' },
  date:       { label: 'Date',       Icon: Calendar,    color: 'var(--gs-id-3)' },
  time:       { label: 'Heure',      Icon: Clock,       color: 'var(--gs-id-3)' },
  person:     { label: 'Personne',   Icon: User,        color: 'var(--gs-id-5)' },
  phone:      { label: 'Téléphone',  Icon: Phone,       color: 'var(--gs-id-10)' },
  select:     { label: 'Liste',      Icon: List,        color: 'var(--gs-id-7)' },
  boolean:    { label: 'Oui/Non',    Icon: Check,       color: 'var(--gs-id-9)' },
  shift_type: { label: 'Type garde', Icon: Stethoscope, color: 'var(--gs-id-6)' },
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
      toast.success('Colonne ajoutée');
      qc.invalidateQueries(['schedule-columns']);
      setMode('manage');
      setNewCol({ label: '', code: '', dataType: 'text', options: '' });
      setDetected(null);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });

  /* Pas de `outline: 'none'` : un style en ligne bat la règle de la couche de
     jetons, et le champ perdait son seul repère au clavier. */
  const inputSt = {
    width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--gs-rule)', background: 'var(--gs-paper-alt)',
    color: 'var(--gs-ink)', boxSizing: 'border-box',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-overlay)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--gs-paper)', borderRadius: 16, width: 500, maxHeight: '80vh',
        boxShadow: 'var(--gs-shadow-lift)', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--gs-rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'var(--gs-display)', fontSize: 16, fontWeight: 700, letterSpacing: '-.015em', color: 'var(--gs-ink)' }}>
              {mode === 'manage' ? 'Gestion des colonnes' : 'Ajouter une colonne'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--gs-ink-faint)', marginTop: 2 }}>
              {mode === 'manage'
                ? 'Affichez ou masquez les colonnes du tableur'
                : 'Le type de la colonne est déduit de son nom'}
            </div>
          </div>
          <button onClick={onClose} title="Fermer" style={{ display: 'flex', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gs-ink-faint)', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 22px' }}>
          {mode === 'manage' ? (
            <>
              {/* Toggle all */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--gs-ink-faint)' }}>{columns.length} colonnes configurées</span>
                <button onClick={onShowAll} style={{ fontSize: 12, color: 'var(--gs-seal)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
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
                        background: hidden ? 'var(--gs-paper-alt)' : 'var(--gs-seal-wash)',
                        border: `1px solid ${hidden ? 'var(--gs-rule)' : 'var(--gs-seal)'}`,
                        opacity: hidden ? 0.5 : 1, transition: 'all .15s',
                      }}>
                      {/* Toggle */}
                      <div style={{
                        width: 20, height: 20, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: hidden ? 'var(--gs-paper-alt)' : 'var(--gs-seal)',
                        color: 'var(--gs-on-tone)', border: `1px solid ${hidden ? 'var(--gs-rule)' : 'var(--gs-seal)'}`,
                      }}>
                        {!hidden && <Check size={13} strokeWidth={3} />}
                      </div>
                      {/* Type badge */}
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                        background: `color-mix(in srgb, ${typeInfo.color} 14%, transparent)`, color: typeInfo.color,
                      }}>
                        <typeInfo.Icon size={11} /> {typeInfo.label}
                      </span>
                      {/* Label */}
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--gs-ink)' }}>{col.label}</span>
                      {/* System lock */}
                      {col.is_system && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--gs-ink-faint)' }}>
                          <Lock size={10} /> Système
                        </span>
                      )}
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
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gs-ink-soft)', marginBottom: 5 }}>
                    Nom de la colonne
                  </label>
                  <input
                    type="text" placeholder="Ex : Horaire de début, Spécialité, Équipe…"
                    value={newCol.label} style={inputSt}
                    onChange={e => { setNewCol(c => ({ ...c, label: e.target.value })); detectType(e.target.value); }}
                  />
                </div>

                {/* Detection result */}
                {detecting && (
                  <div style={{ fontSize: 12, color: 'var(--gs-ink-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 12, height: 12, border: '2px solid var(--gs-rule)', borderTopColor: 'var(--gs-seal)', borderRadius: '50%', animation: 'spin 1s linear infinite', display: 'inline-block' }} />
                    Lecture du nom…
                  </div>
                )}
                {detected && !detecting && (
                  <div style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: 'color-mix(in srgb, var(--gs-seal) 8%, var(--gs-paper))',
                    border: '1px solid color-mix(in srgb, var(--gs-seal) 26%, transparent)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--gs-seal)', marginBottom: 4 }}>
                      <Info size={13} />
                      Type retenu : {TYPE_LABELS[detected.suggestedType]?.label || detected.suggestedType}
                      <span style={{ fontWeight: 400 }}>({Math.round((detected.confidence || 0) * 100)} % de correspondance)</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--gs-ink-soft)' }}>
                      Changez-le ci-dessous s'il ne correspond pas à ce que la colonne contient.
                    </div>
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gs-ink-soft)', marginBottom: 5 }}>
                    Type de donnée
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                    {Object.entries(TYPE_LABELS).map(([key, info]) => (
                      <button key={key} onClick={() => setNewCol(c => ({ ...c, dataType: key }))}
                        style={{
                          padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${newCol.dataType === key ? info.color : 'var(--gs-rule)'}`,
                          background: newCol.dataType === key ? `color-mix(in srgb, ${info.color} 12%, transparent)` : 'transparent',
                          cursor: 'pointer', fontSize: 11, fontWeight: 700, color: info.color,
                          display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center',
                        }}>
                        <info.Icon size={12} /> {info.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Options for select type */}
                {newCol.dataType === 'select' && (
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gs-ink-soft)', marginBottom: 5 }}>
                      Options (séparées par des virgules)
                    </label>
                    <input type="text" placeholder="Ex : Matin, Après-midi, Nuit" value={newCol.options}
                      onChange={e => setNewCol(c => ({ ...c, options: e.target.value }))} style={inputSt} />
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--gs-ink-soft)', marginBottom: 5 }}>
                    Code technique (généré automatiquement)
                  </label>
                  <input type="text" value={newCol.code}
                    onChange={e => setNewCol(c => ({ ...c, code: e.target.value }))} style={{ ...inputSt, fontFamily: 'var(--gs-data)' }} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--gs-rule)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {mode === 'manage' ? (
            <>
              <button onClick={() => setMode('add')}
                style={{ padding: '9px 18px', borderRadius: 8, border: '1px dashed var(--gs-seal)', background: 'var(--gs-seal-wash)', color: 'var(--gs-seal)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                + Nouvelle colonne
              </button>
              <button onClick={onClose}
                style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--gs-seal)', color: 'var(--gs-on-tone)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Fermer
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { setMode('manage'); setDetected(null); setNewCol({ label: '', code: '', dataType: 'text', options: '' }); }}
                style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--gs-rule)', background: 'transparent', color: 'var(--gs-ink-soft)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
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
                  background: 'var(--gs-seal)', color: 'var(--gs-on-tone)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  opacity: !newCol.label.trim() || !newCol.code.trim() ? 0.5 : 1,
                }}>
                {createMut.isPending ? 'Ajout…' : 'Ajouter la colonne'}
              </button>
            </>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

import React, { useState, useRef } from 'react';
import { scheduleBuilderAPI } from '../../../api';
import toast from 'react-hot-toast';

// ── Guide content ────────────────────────────────────────────────────
const REQUIRED_COLS = [
  { col: 'Nom',           example: 'Ben Ali',          note: 'Nom de famille (obligatoire)' },
  { col: 'Prenom',        example: 'Khalil',           note: 'Prénom (obligatoire)' },
  { col: 'Matricule',     example: 'MED-2024-001',     note: 'Identifiant unique (recommandé)' },
];
const OPTIONAL_COLS = [
  { col: 'Telephone',     example: '+216 22 333 444',  note: 'Numéro de contact' },
  { col: 'Role',          example: 'Médecin',          note: 'Fonction dans le service' },
  { col: '01/08/2026',    example: 'J',                note: 'Garde du jour (J=Jour, N=Nuit, S=Soir, G=Garde, R=Repos)' },
  { col: '02/08/2026',    example: 'N',                note: 'Colonne pour chaque jour de la période' },
  { col: '...',           example: '...',              note: 'Répéter pour chaque jour' },
];

const SHIFT_CODES = [
  { code: 'J', label: 'Jour',    color: '#DBEAFE', text: '#1D4ED8' },
  { code: 'N', label: 'Nuit',    color: '#EDE9FE', text: '#6D28D9' },
  { code: 'S', label: 'Soir',    color: '#D1FAE5', text: '#065F46' },
  { code: 'G', label: 'Garde',   color: '#FEF3C7', text: '#92400E' },
  { code: 'R', label: 'Repos',   color: '#F3F4F6', text: '#6B7280' },
];

const EXAMPLE_DATA = [
  { nom: 'Ben Ali', prenom: 'Khalil', mat: 'MED-001', tel: '+216 22 111', role: 'Médecin', '01/08': 'J', '02/08': 'N', '03/08': '' },
  { nom: 'Hamdi',   prenom: 'Sara',   mat: 'INF-002', tel: '+216 25 222', role: 'Infirmier', '01/08': '',  '02/08': 'J', '03/08': 'N' },
  { nom: 'Mansour', prenom: 'Ali',    mat: 'MED-003', tel: '+216 28 333', role: 'Médecin', '01/08': 'R',  '02/08': '',  '03/08': 'J' },
];

const CONFIDENCE_DOT = { high: '#10B981', medium: '#F59E0B', low: '#EF4444' };
const confLevel = (c) => c >= 0.8 ? 'high' : c >= 0.5 ? 'medium' : 'low';

export default function ImportModal({ departmentId, onClose, onImported }) {
  const fileRef = useRef(null);
  const [step, setStep] = useState('guide');  // guide | upload | preview | importing | done
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  // ── File handling ────────────────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      toast.error('Format non supporté. Utilisez Excel (.xlsx) ou CSV (.csv)');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await scheduleBuilderAPI.importPreview(formData);
      setPreview(res.data.data);
      setStep('preview');
      toast.success(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur de lecture du fichier');
    } finally { setUploading(false); }
  };

  const confirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    setStep('importing');
    try {
      const res = await scheduleBuilderAPI.importConfirm({
        departmentId,
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        shiftTypeId: null,
        columnMappings: preview.columnMappings,
        rows: preview.preview.filter(r => r.isMatched),
      });
      setResult(res.data.data);
      setStep('done');
      toast.success(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur d\'import');
      setStep('preview');
    } finally { setImporting(false); }
  };

  const downloadTemplate = () => {
    const token = localStorage.getItem('token');
    window.open(`${scheduleBuilderAPI.exportExcelUrl?.('template') || '/api/schedule-builder/import/template'}?token=${token}`, '_blank');
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(6px)',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-card)', borderRadius: 20, width: 720, maxHeight: '90vh',
        boxShadow: '0 30px 70px rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: '18px 24px', borderBottom: '1px solid var(--border-subtle)',
          background: 'linear-gradient(135deg, #1E293B, #0F172A)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>
              {{
                guide: '📋 Guide d\'import — Préparez votre fichier',
                upload: '📤 Importer un planning',
                preview: '🔍 Aperçu et correspondances',
                importing: '⏳ Import en cours...',
                done: '✅ Import terminé',
              }[step] || 'Importer'}
            </div>
            {step === 'guide' && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>Lisez d'abord ce guide pour préparer votre fichier correctement</div>}
          </div>
          {/* Step pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {['guide', 'upload', 'preview'].map((s, i) => (
              <React.Fragment key={s}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', fontSize: 10, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: step === s ? 'var(--color-primary)' : ['done', 'importing', 'preview'].includes(step) && i < ['guide', 'upload', 'preview'].indexOf(step) ? '#10B981' : 'rgba(255,255,255,.15)',
                  color: '#fff',
                }}>
                  {i + 1}
                </div>
                {i < 2 && <div style={{ width: 20, height: 2, background: 'rgba(255,255,255,.15)' }} />}
              </React.Fragment>
            ))}
            <button onClick={onClose} style={{ marginLeft: 8, background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8, padding: '5px 9px', cursor: 'pointer', color: '#94A3B8', fontSize: 15 }}>✕</button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>

          {/* ══ GUIDE ══════════════════════════════════════════════════ */}
          {step === 'guide' && (
            <div>
              {/* Intro */}
              <div style={{ padding: '14px 18px', borderRadius: 12, background: '#EFF6FF', border: '1px solid #BFDBFE', marginBottom: 20, display: 'flex', gap: 12 }}>
                <span style={{ fontSize: 24, flexShrink: 0 }}>💡</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#1E40AF', marginBottom: 4 }}>Comment préparer votre fichier ?</div>
                  <div style={{ fontSize: 12, color: '#3B82F6', lineHeight: 1.6 }}>
                    Votre fichier Excel ou CSV doit contenir <strong>une ligne par personne</strong>.<br />
                    La <strong>première ligne</strong> doit être les en-têtes de colonnes.<br />
                    Chaque jour de la période est <strong>une colonne distincte</strong> avec la date en en-tête.<br />
                    Remplissez les codes de garde dans les cellules correspondantes.
                  </div>
                </div>
              </div>

              {/* Required columns */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#EF4444' }}>*</span> Colonnes requises / recommandées
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#1E293B' }}>
                      {['En-tête colonne', 'Exemple', 'Description'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', color: '#CBD5E1', fontWeight: 700, textAlign: 'left', fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {REQUIRED_COLS.map((c, i) => (
                      <tr key={c.col} style={{ background: i % 2 === 0 ? '#F8FAFC' : '#fff', borderBottom: '1px solid #E2E8F0' }}>
                        <td style={{ padding: '7px 12px' }}>
                          <span style={{ fontWeight: 700, color: '#1E293B' }}>{c.col}</span>
                          {c.col !== 'Matricule' && <span style={{ color: '#EF4444', fontWeight: 900, marginLeft: 3 }}>*</span>}
                        </td>
                        <td style={{ padding: '7px 12px' }}>
                          <code style={{ background: '#EFF6FF', color: '#1D4ED8', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{c.example}</code>
                        </td>
                        <td style={{ padding: '7px 12px', color: '#64748B' }}>{c.note}</td>
                      </tr>
                    ))}
                    {OPTIONAL_COLS.map((c, i) => (
                      <tr key={c.col + i} style={{ background: i % 2 === 0 ? '#FAFAFA' : '#F9FAFB', borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '7px 12px' }}>
                          <span style={{ fontWeight: 600, color: '#475569' }}>{c.col}</span>
                          <span style={{ fontSize: 10, color: '#94A3B8', marginLeft: 6 }}>(optionnel)</span>
                        </td>
                        <td style={{ padding: '7px 12px' }}>
                          <code style={{ background: '#F0FDF4', color: '#065F46', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{c.example}</code>
                        </td>
                        <td style={{ padding: '7px 12px', color: '#94A3B8', fontSize: 11 }}>{c.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Shift codes */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>📌 Codes de garde acceptés</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {SHIFT_CODES.map(c => (
                    <div key={c.code} style={{ padding: '8px 14px', borderRadius: 10, background: c.color, display: 'flex', alignItems: 'center', gap: 8, border: '1px solid rgba(0,0,0,.06)' }}>
                      <span style={{ fontSize: 18, fontWeight: 900, color: c.text }}>{c.code}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: c.text }}>{c.label}</span>
                    </div>
                  ))}
                  <div style={{ padding: '8px 14px', borderRadius: 10, background: '#F8FAFC', border: '1px dashed #CBD5E1', fontSize: 12, color: '#94A3B8', display: 'flex', alignItems: 'center' }}>
                    Vide = pas de garde ce jour
                  </div>
                </div>
              </div>

              {/* Example preview */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>👀 Exemple de fichier attendu</div>
                <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: '#1E293B' }}>
                        {['Nom', 'Prenom', 'Matricule', 'Telephone', 'Role', '01/08', '02/08', '03/08'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', color: '#CBD5E1', fontWeight: 700, borderRight: '1px solid #334155', whiteSpace: 'nowrap', fontSize: 10 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {EXAMPLE_DATA.map((row, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
                          {[row.nom, row.prenom, row.mat, row.tel, row.role].map((v, j) => (
                            <td key={j} style={{ padding: '6px 10px', borderRight: '1px solid #F1F5F9', fontWeight: j < 2 ? 700 : 400 }}>{v}</td>
                          ))}
                          {[row['01/08'], row['02/08'], row['03/08']].map((code, j) => {
                            const col = code ? SHIFT_CODES.find(c => c.code === code) : null;
                            return (
                              <td key={j} style={{ padding: '4px 10px', textAlign: 'center', borderRight: '1px solid #F1F5F9', background: col?.color }}>
                                {code ? <span style={{ fontWeight: 800, color: col?.text }}>{code}</span> : <span style={{ color: '#CBD5E1' }}>—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Warning */}
              <div style={{ padding: '12px 16px', borderRadius: 10, background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 12, color: '#92400E', display: 'flex', gap: 10 }}>
                <span style={{ fontSize: 18 }}>⚠️</span>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 3 }}>Points importants</div>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', lineHeight: 1.8 }}>
                    <li>La <strong>première ligne</strong> doit obligatoirement être les en-têtes (Nom, Prenom, etc.)</li>
                    <li>Le fichier ne doit pas contenir de <strong>cellules fusionnées</strong></li>
                    <li>Les dates doivent être en format <strong>JJ/MM/AAAA</strong> ou <strong>AAAA-MM-JJ</strong></li>
                    <li>La correspondance avec le personnel est faite par <strong>Nom + Prénom</strong> ou <strong>Matricule</strong></li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ══ UPLOAD ═════════════════════════════════════════════════ */}
          {step === 'upload' && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); }}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? 'var(--color-primary)' : 'var(--border-subtle)'}`,
                borderRadius: 16, padding: '60px 40px', textAlign: 'center',
                cursor: 'pointer', transition: 'all .2s',
                background: dragOver ? 'rgba(27,79,202,.05)' : 'var(--bg-elevated)',
              }}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden
                onChange={e => handleFile(e.target.files?.[0])} />

              {uploading ? (
                <div>
                  <div style={{ width: 40, height: 40, border: '3px solid var(--border-subtle)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>Analyse du fichier...</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 52, marginBottom: 14 }}>📤</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>Glissez votre fichier ici</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>ou cliquez pour sélectionner</div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {[
                      { label: 'Excel .xlsx', icon: '📊', color: '#059669' },
                      { label: 'Excel .xls', icon: '📊', color: '#059669' },
                      { label: 'CSV .csv', icon: '📋', color: '#0891B2' },
                    ].map(f => (
                      <span key={f.label} style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: f.color + '12', color: f.color, border: `1px solid ${f.color}30` }}>
                        {f.icon} {f.label}
                      </span>
                    ))}
                  </div>
                  <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-muted)' }}>Taille max : 10 Mo</div>
                </>
              )}
            </div>
          )}

          {/* ══ PREVIEW ════════════════════════════════════════════════ */}
          {step === 'preview' && preview && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                {[
                  { label: 'Lignes détectées',    value: preview.totalRows,    color: '#3B82F6' },
                  { label: 'Personnel identifié', value: preview.matchedCount, color: '#10B981' },
                  { label: 'Non reconnu',          value: preview.unmatchedCount, color: '#F59E0B' },
                ].map(s => (
                  <div key={s.label} style={{ padding: '12px 16px', borderRadius: 10, background: s.color + '08', border: `1px solid ${s.color}25` }}>
                    <div style={{ fontSize: 24, fontWeight: 900, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Columns */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 7 }}>Colonnes détectées ({preview.columnMappings.length})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {preview.columnMappings.map(col => {
                    const lvl = confLevel(col.confidence);
                    return (
                      <div key={col.originalHeader} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: CONFIDENCE_DOT[lvl] + '12', border: `1px solid ${CONFIDENCE_DOT[lvl]}30`, color: 'var(--text-primary)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: CONFIDENCE_DOT[lvl] }} />
                        {col.originalHeader}
                        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>→ {col.suggestedType}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Table preview */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 7 }}>Aperçu des données (15 premières lignes)</div>
                <div style={{ overflow: 'auto', maxHeight: 250, borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th style={ghSt}>#</th>
                        <th style={ghSt}>Statut</th>
                        {preview.headers.slice(0, 6).map(h => <th key={h} style={ghSt}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.slice(0, 15).map((row, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-elevated)' }}>
                          <td style={gtSt}>{i + 1}</td>
                          <td style={gtSt}>
                            {row.isMatched ? (
                              <span style={{ color: '#10B981', fontWeight: 700, fontSize: 10 }}>✓ {row.matchedUserName}</span>
                            ) : (
                              <span style={{ color: '#F59E0B', fontWeight: 600, fontSize: 10 }}>⚠ Non reconnu</span>
                            )}
                          </td>
                          {preview.headers.slice(0, 6).map(h => (
                            <td key={h} style={gtSt}>{String(row.data[h] || '').slice(0, 25)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ══ IMPORTING ══════════════════════════════════════════════ */}
          {step === 'importing' && (
            <div style={{ textAlign: 'center', padding: '50px 20px' }}>
              <div style={{ width: 48, height: 48, border: '4px solid var(--border-subtle)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 20px' }} />
              <div style={{ fontSize: 16, fontWeight: 700 }}>Import en cours...</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>Création du planning et insertion des gardes</div>
            </div>
          )}

          {/* ══ DONE ═══════════════════════════════════════════════════ */}
          {step === 'done' && result && (
            <div style={{ textAlign: 'center', padding: '30px 20px' }}>
              <div style={{ fontSize: 56, marginBottom: 14 }}>🎉</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#10B981', marginBottom: 16 }}>Import réussi !</div>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                <div style={{ padding: '12px 20px', borderRadius: 10, background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: '#059669' }}>{result.insertedCount}</div>
                  <div style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>Gardes importées</div>
                </div>
                {result.skippedCount > 0 && (
                  <div style={{ padding: '12px 20px', borderRadius: 10, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                    <div style={{ fontSize: 28, fontWeight: 900, color: '#D97706' }}>{result.skippedCount}</div>
                    <div style={{ fontSize: 11, color: '#D97706', fontWeight: 600 }}>Ignorées</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>

          {/* Left actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 'guide' && (
              <button onClick={downloadTemplate}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #059669', background: 'rgba(5,150,105,.06)', color: '#059669', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                📥 Télécharger le modèle Excel
              </button>
            )}
            {step === 'preview' && (
              <button onClick={() => { setStep('upload'); setPreview(null); }}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                Changer de fichier
              </button>
            )}
          </div>

          {/* Right actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 'guide' && (
              <>
                <button onClick={onClose}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                  Fermer
                </button>
                <button onClick={() => setStep('upload')}
                  style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  Continuer → Importer le fichier
                </button>
              </>
            )}
            {step === 'upload' && (
              <button onClick={() => setStep('guide')}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                ← Guide
              </button>
            )}
            {step === 'preview' && (
              <button onClick={confirmImport} disabled={!preview?.matchedCount}
                style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: preview?.matchedCount > 0 ? 'var(--color-primary)' : '#D1D5DB', color: '#fff', fontWeight: 700, fontSize: 12, cursor: preview?.matchedCount > 0 ? 'pointer' : 'not-allowed' }}>
                Importer {preview?.matchedCount || 0} ligne(s)
              </button>
            )}
            {step === 'done' && (
              <button onClick={() => { onImported?.(result?.scheduleId); onClose(); }}
                style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                Ouvrir le planning
              </button>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const ghSt = {
  padding: '7px 10px', fontSize: 10, fontWeight: 700, textAlign: 'left',
  background: '#1E293B', color: '#CBD5E1', position: 'sticky', top: 0,
  textTransform: 'uppercase', letterSpacing: '.04em',
};
const gtSt = {
  padding: '5px 10px', fontSize: 11, borderBottom: '1px solid var(--border-subtle)',
  whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis',
};

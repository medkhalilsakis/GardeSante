import React, { useState, useRef, useEffect } from 'react';
import { scheduleBuilderAPI } from '../../../api';
import toast from 'react-hot-toast';

// ── Codes de garde universels ──────────────────────────────────────────
const SHIFT_CODES = [
  { code: 'J', label: 'Jour (Garde de jour)', color: '#DBEAFE', text: '#1D4ED8' },
  { code: 'N', label: 'Nuit (Garde de nuit)', color: '#EDE9FE', text: '#6D28D9' },
  { code: 'S', label: 'Soir (Service du soir)', color: '#D1FAE5', text: '#065F46' },
  { code: 'G', label: 'Garde (Garde 24h / Générale)', color: '#FEF3C7', text: '#92400E' },
  { code: 'R', label: 'Repos (Jour de repos)', color: '#F3F4F6', text: '#6B7280' },
];

const EXAMPLE_DATA = [
  { nom: 'Ben Ali', prenom: 'Khalil', mat: 'MED-001', role: 'Médecin', '01/08/2026': 'J', '02/08/2026': 'N', '03/08/2026': '' },
  { nom: 'Hamdi',   prenom: 'Sara',   mat: 'INF-002', role: 'Infirmier', '01/08/2026': '',  '02/08/2026': 'J', '03/08/2026': 'N' },
  { nom: 'Mansour', prenom: 'Ali',    mat: 'AID-003', role: 'Aide-soignant', '01/08/2026': 'R',  '02/08/2026': '',  '03/08/2026': 'J' },
];

function GuideExampleTwo() {
  const headers = ['Nom', 'Prenom', 'Matricule', 'Telephone', 'Role', 'Périodes', 'Remarque'];
  const rows = [
    ['Ben Ali', 'Khalil', 'MED-001', '+216 22 111 222', 'Médecin', '01/08/2026 au 31/08/2026', 'Garde de jour'],
    ['Hamdi', 'Sara', 'INF-002', '+216 25 333 444', 'Infirmier', '05/08/2026 au 10/08/2026; 18/08/2026 au 20/08/2026', 'Service de nuit']
  ];
  return (
    <div>
      <div style={{ padding: '12px 16px', borderRadius: 10, background: '#F0FDF4', border: '1px solid #BBF7D0', marginBottom: 14 }}>
        <strong style={{ color: '#166534', fontSize: 13 }}>Exemple — Colonnes par Périodes Individuelles</strong>
        <div style={{ fontSize: 11, color: '#15803D', marginTop: 4 }}>
          Une ligne par agent. Une seule plage ou plusieurs plages séparées par un point-virgule sont acceptées.
        </div>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#1E293B', color: '#CBD5E1' }}>
              {headers.map(h => <th key={h} style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontSize: 10, textAlign: 'left' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ background: i % 2 ? '#F8FAFC' : '#fff' }}>
                {row.map((cell, j) => <td key={j} style={{ padding: '7px 10px', borderTop: '1px solid #E2E8F0', whiteSpace: 'nowrap', fontWeight: j < 2 ? 700 : 400 }}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ImportModal({ departmentId, scheduleId, onClose, onImported }) {
  const fileRef = useRef(null);
  const [step, setStep] = useState('guide');  // guide | upload | preview | importing | done
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [guideExample, setGuideExample] = useState('example1');

  // Champs de configuration d'importation
  const [importTitle, setImportTitle] = useState('');
  const [importScheduleType, setImportScheduleType] = useState('normal');
  const [importStartDate, setImportStartDate] = useState('');
  const [importEndDate, setImportEndDate] = useState('');

  useEffect(() => {
    if (preview) {
      setImportTitle(preview.suggestedTitle || 'Planning Importé');
      setImportScheduleType(preview.suggestedScheduleType || 'normal');
      setImportStartDate(preview.detectedStartDate || new Date().toISOString().split('T')[0]);
      setImportEndDate(preview.detectedEndDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]);
    }
  }, [preview]);

  // ── Handling upload ──────────────────────────────────────────────
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
      toast.error(err.response?.data?.message || 'Erreur lors de la lecture du fichier');
    } finally { setUploading(false); }
  };

  const confirmImport = async () => {
    if (!preview) return;
    setImporting(true);
    setStep('importing');
    try {
      const res = await scheduleBuilderAPI.importConfirm({
        departmentId,
        scheduleId,
        name: importTitle,
        startDate: importStartDate,
        endDate: importEndDate,
        scheduleType: importScheduleType,
        rows: preview.rows || [],
      });
      setResult(res.data.data);
      setStep('done');
      toast.success(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'enregistrement de l\'import');
      setStep('preview');
    } finally { setImporting(false); }
  };

  const downloadTemplate = () => {
    const token = localStorage.getItem('token');
    const url = `/api/schedule-builder/import/template?departmentId=${departmentId || ''}&token=${token}`;
    window.open(url, '_blank');
  };

  const inputStyle = {
    width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
    color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box'
  };

  const is100PercentAdaptable = preview && preview.unmatchedCount === 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 6000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(5px)',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-card)', borderRadius: 20, width: 800, maxHeight: '90vh',
        boxShadow: '0 30px 70px rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', border: '1px solid var(--border-subtle)'
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
                guide: '📋 Guide d\'importation Excel / CSV mise à jour',
                upload: '📤 Sélectionner un fichier Excel ou CSV',
                preview: '🔍 Analyse & Adaptation du Planning',
                importing: '⏳ Importation et Génération du Tableur...',
                done: '✅ Planning prêt et synchronisé',
              }[step] || 'Importer'}
            </div>
            {step === 'guide' && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>Prise en charge des plannings Normaux & Spéciaux (Week-ends & Fériés) avec adaptabilité 100%</div>}
          </div>
          {/* Step pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {['guide', 'upload', 'preview'].map((s, i) => (
              <React.Fragment key={s}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', fontSize: 11, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: step === s ? 'var(--color-primary)' : ['done', 'importing', 'preview'].includes(step) && i < ['guide', 'upload', 'preview'].indexOf(step) ? '#10B981' : 'rgba(255,255,255,.15)',
                  color: '#fff',
                }}>
                  {i + 1}
                </div>
                {i < 2 && <div style={{ width: 20, height: 2, background: 'rgba(255,255,255,.15)' }} />}
              </React.Fragment>
            ))}
            <button onClick={onClose} style={{ marginLeft: 8, background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', color: '#94A3B8', fontSize: 16 }}>✕</button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>

          {/* ══ GUIDE ══════════════════════════════════════════════════ */}
          {step === 'guide' && (
            <div>
              {/* Feature highlight banner */}
              <div style={{ padding: '16px 20px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(16,185,129,.1), rgba(6,182,212,.1))', border: '1.5px solid #10B981', marginBottom: 20 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#047857', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>⚡ Adaptabilité et Souplesse d'Importation (100%)</span>
                </div>
                <div style={{ fontSize: 12, color: '#065F46', marginTop: 6, lineHeight: 1.6 }}>
                  • <strong>Validation directe si 100% adaptable</strong> : Si tous les membres sont reconnus et la période valide, le planning est validé et prêt à l'emploi.<br />
                  • <strong>Ajustement flexible dans le Tableur</strong> : Sinon, vous pouvez le valider et corriger les colonnes ou membres directement dans le Tableur interactif, ou choisir un autre fichier à tout moment.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button onClick={() => setGuideExample('example1')} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', cursor: 'pointer', fontWeight: 700, background: guideExample === 'example1' ? 'var(--color-primary)' : 'var(--bg-elevated)', color: guideExample === 'example1' ? '#fff' : 'var(--text-primary)' }}>Format 1 — Grille par dates (Recommandé)</button>
                <button onClick={() => setGuideExample('example2')} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', cursor: 'pointer', fontWeight: 700, background: guideExample === 'example2' ? 'var(--color-primary)' : 'var(--bg-elevated)', color: guideExample === 'example2' ? '#fff' : 'var(--text-primary)' }}>Format 2 — Colonnes de périodes</button>
              </div>

              {guideExample === 'example2' && <GuideExampleTwo />}

              <div style={{ display: guideExample === 'example1' ? 'block' : 'none' }}>
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: 'var(--text-primary)' }}>📌 Codes de gardes universels</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {SHIFT_CODES.map(c => (
                      <div key={c.code} style={{ padding: '6px 12px', borderRadius: 8, background: c.color, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 900, color: c.text }}>{c.code}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: c.text }}>{c.label}</span>
                      </div>
                    ))}
                    <div style={{ padding: '6px 12px', borderRadius: 8, background: '#F8FAFC', border: '1px dashed #CBD5E1', fontSize: 11, color: '#94A3B8' }}>
                      Cellule vide = pas de garde
                    </div>
                  </div>
                </div>

                <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border-subtle)', marginBottom: 16 }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: '#1E293B', color: '#CBD5E1' }}>
                        {['Nom', 'Prenom', 'Matricule', 'Role', '01/08/2026', '02/08/2026', '03/08/2026'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', fontWeight: 700, borderRight: '1px solid #334155', whiteSpace: 'nowrap', textAlign: 'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {EXAMPLE_DATA.map((row, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC' }}>
                          {[row.nom, row.prenom, row.mat, row.role].map((v, j) => (
                            <td key={j} style={{ padding: '6px 10px', borderRight: '1px solid #F1F5F9', fontWeight: j < 2 ? 700 : 400 }}>{v}</td>
                          ))}
                          {[row['01/08/2026'], row['02/08/2026'], row['03/08/2026']].map((code, j) => {
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
                borderRadius: 16, padding: '50px 30px', textAlign: 'center',
                cursor: 'pointer', transition: 'all .2s',
                background: dragOver ? 'rgba(27,79,202,.05)' : 'var(--bg-elevated)',
              }}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden
                onChange={e => handleFile(e.target.files?.[0])} />

              {uploading ? (
                <div>
                  <div style={{ width: 40, height: 40, border: '3px solid var(--border-subtle)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>Analyse et correspondance en cours...</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>📤</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>Glissez votre fichier Excel ou CSV ici</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>ou cliquez pour parcourir vos fichiers</div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {[
                      { label: 'Excel (.xlsx)', icon: '📊', color: '#059669' },
                      { label: 'Excel (.xls)',  icon: '📊', color: '#059669' },
                      { label: 'CSV (.csv)',    icon: '📋', color: '#0891B2' },
                    ].map(f => (
                      <span key={f.label} style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: f.color + '12', color: f.color, border: `1px solid ${f.color}30` }}>
                        {f.icon} {f.label}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ══ PREVIEW & CONFIGURATION ════════════════════════════════ */}
          {step === 'preview' && preview && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* Adaptability Banner */}
              {is100PercentAdaptable ? (
                <div style={{ padding: '14px 18px', borderRadius: 12, background: '#ECFDF5', border: '1.5px solid #10B981', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22 }}>✨</span>
                    <div>
                      <strong style={{ color: '#047857', fontSize: 13 }}>Fichier 100% Adaptable !</strong>
                      <div style={{ fontSize: 11, color: '#065F46', marginTop: 2 }}>
                        Tous les membres ({preview.matchedCount}) sont identifiés et la période est valide. Vous pouvez valider directement !
                      </div>
                    </div>
                  </div>
                  <span style={{ padding: '4px 10px', borderRadius: 20, background: '#10B981', color: '#fff', fontSize: 11, fontWeight: 800 }}>100% Valide</span>
                </div>
              ) : (
                <div style={{ padding: '14px 18px', borderRadius: 12, background: '#FFFBEB', border: '1.5px solid #F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22 }}>ℹ️</span>
                    <div>
                      <strong style={{ color: '#B45309', fontSize: 13 }}>Adaptation partielle ({preview.matchedCount} / {preview.totalRows} membres reconnus)</strong>
                      <div style={{ fontSize: 11, color: '#92400E', marginTop: 2 }}>
                        {preview.unmatchedCount} ligne(s) non reconnue(s) seront intégrées comme lignes personnalisées. Vous pourrez les modifier dans le Tableur ou changer de fichier.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Formulaire de configuration */}
              <div style={{ padding: 18, borderRadius: 14, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <h4 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 800, color: 'var(--color-primary)' }}>
                  ⚙️ Paramètres du Planning à créer / mettre à jour
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5, gridColumn: '1 / -1' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Titre du planning *</span>
                    <input type="text" style={inputStyle} value={importTitle} onChange={e => setImportTitle(e.target.value)} placeholder="Ex: Gardes Urgences Août 2026" />
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Type de planning *</span>
                    <select style={inputStyle} value={importScheduleType} onChange={e => setImportScheduleType(e.target.value)}>
                      <option value="normal">📋 Planning Normal (Tous les jours)</option>
                      <option value="special_weekend_holiday">⚡ Planning Spécial (Week-ends & Jours Fériés uniquement)</option>
                    </select>
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Début *</span>
                      <input type="date" style={inputStyle} value={importStartDate} onChange={e => setImportStartDate(e.target.value)} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Fin *</span>
                      <input type="date" style={inputStyle} value={importEndDate} onChange={e => setImportEndDate(e.target.value)} />
                    </label>
                  </div>
                </div>
              </div>

              {/* Table preview */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 7, color: 'var(--text-secondary)' }}>
                  Aperçu des membres et correspondances ({preview.rows.length} lignes) :
                </div>
                <div style={{ overflow: 'auto', maxHeight: 200, borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: '#1E293B', color: '#CBD5E1' }}>
                        <th style={{ padding: '7px 10px', textAlign: 'left' }}>#</th>
                        <th style={{ padding: '7px 10px', textAlign: 'left' }}>Statut BD</th>
                        <th style={{ padding: '7px 10px', textAlign: 'left' }}>Nom & Prénom</th>
                        <th style={{ padding: '7px 10px', textAlign: 'left' }}>Matricule</th>
                        <th style={{ padding: '7px 10px', textAlign: 'left' }}>Fonction</th>
                        <th style={{ padding: '7px 10px', textAlign: 'center' }}
                          title="Colonne « Garde a domicile » du fichier (facultative). Décochée = garde à l'hôpital, en présence. Vous pouvez la corriger ici avant de valider.">
                          Domicile
                        </th>
                        <th style={{ padding: '7px 10px', textAlign: 'center' }}>Gardes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)', background: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-elevated)' }}>
                          <td style={{ padding: '6px 10px', fontWeight: 700 }}>{row.rowIndex}</td>
                          <td style={{ padding: '6px 10px' }}>
                            {row.isMatched ? (
                              <span style={{ color: '#10B981', fontWeight: 800, fontSize: 11 }}>✓ {row.matchedUserName}</span>
                            ) : (
                              <span style={{ color: '#F59E0B', fontWeight: 700, fontSize: 11 }}>👤 Ligne personnalisée</span>
                            )}
                          </td>
                          <td style={{ padding: '6px 10px', fontWeight: 700 }}>{row.lastName} {row.firstName}</td>
                          <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>{row.matricule || '—'}</td>
                          <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>{row.roleName || '—'}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                            {/* Les lignes de l'aperçu repartent verbatim à la
                                validation : cocher ici suffit à corriger un
                                fichier qui n'avait pas la colonne. */}
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontWeight: 700, color: row.atHome === true ? '#7C3AED' : 'var(--text-muted)' }}
                              title={row.atHome === true ? 'Garde à domicile (astreinte)' : "Garde à l'hôpital, en présence"}>
                              <input type="checkbox" checked={row.atHome === true}
                                onChange={(e) => {
                                  const atHome = e.target.checked;
                                  setPreview(prev => prev && ({
                                    ...prev,
                                    rows: prev.rows.map((r, j) => (j === i ? { ...r, atHome } : r)),
                                  }));
                                }}
                                style={{ cursor: 'pointer', accentColor: '#7C3AED', margin: 0 }} />
                              {row.atHome === true ? '🏠' : '—'}
                            </label>
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 800, color: 'var(--color-primary)' }}>
                            {Object.keys(row.shifts || {}).length} date(s)
                          </td>
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
              <div style={{ fontSize: 16, fontWeight: 800 }}>Validation et synchronisation du Tableur...</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>Injection des membres et génération de la vue interactive.</div>
            </div>
          )}

          {/* ══ DONE ═══════════════════════════════════════════════════ */}
          {step === 'done' && result && (
            <div style={{ textAlign: 'center', padding: '30px 20px' }}>
              <div style={{ fontSize: 56, marginBottom: 14 }}>🎉</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#10B981', marginBottom: 16 }}>Planning validé et importé avec succès !</div>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-secondary)' }}>
                Le planning « <strong>{result.name}</strong> » est maintenant disponible. Vous pouvez le consulter ou ajuster ses lignes/colonnes dans le Tableur.
              </p>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                <div style={{ padding: '14px 22px', borderRadius: 12, background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: '#059669' }}>{result.totalRows}</div>
                  <div style={{ fontSize: 11, color: '#059669', fontWeight: 700 }}>Lignes dans le Tableur</div>
                </div>
                <div style={{ padding: '14px 22px', borderRadius: 12, background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: '#1D4ED8' }}>{result.insertedShiftsCount}</div>
                  <div style={{ fontSize: 11, color: '#1D4ED8', fontWeight: 700 }}>Gardes planifiées</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card)' }}>

          {/* Left actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 'guide' && (
              <button onClick={downloadTemplate}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #059669', background: 'rgba(5,150,105,.06)', color: '#059669', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                📥 Modèle Excel pré-rempli
              </button>
            )}
            {step === 'preview' && (
              <button onClick={() => { setStep('upload'); setPreview(null); }}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                📁 Choisir un autre fichier
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
                  Continuer → Sélectionner le fichier
                </button>
              </>
            )}
            {step === 'upload' && (
              <button onClick={() => setStep('guide')}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                ← Revenir au guide
              </button>
            )}
            {step === 'preview' && (
              <button onClick={confirmImport}
                style={{
                  padding: '9px 24px', borderRadius: 8, border: 'none',
                  background: is100PercentAdaptable ? 'linear-gradient(135deg, #10B981, #059669)' : 'var(--color-primary)',
                  color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(16,185,129,.3)'
                }}>
                {is100PercentAdaptable ? '✨ Valider & Créer directement le planning' : '✓ Valider & Éditer dans le Tableur'}
              </button>
            )}
            {step === 'done' && (
              <button onClick={() => { onImported?.(result?.scheduleId); onClose(); }}
                style={{ padding: '9px 24px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer', boxShadow: '0 4px 12px rgba(27,79,202,.3)' }}>
                📊 Ouvrir le Tableur
              </button>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

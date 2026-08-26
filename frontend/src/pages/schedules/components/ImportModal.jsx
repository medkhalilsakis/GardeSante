import React, { useState, useRef, useEffect } from 'react';
import { scheduleBuilderAPI, API_BASE_URL } from '../../../api';
import { useAuthStore } from '../../../store';
import toast from 'react-hot-toast';
import './ImportModal.css';

// ── Marquage des journées de service ───────────────────────────────────
// Il n'y a plus de code de garde : une case marquée signifie « de service »,
// une case vide « pas de service ». N'importe quel marqueur non vide est accepté
// à la lecture (X, x, ✓, 1…), le modèle téléchargeable propose « X ».
// La couleur du marqueur appartient désormais à la feuille de style : c'est
// « de service », donc le ton du service, comme partout ailleurs.
const DUTY_MARK = { mark: 'X', label: 'De service ce jour-là' };

const EXAMPLE_DATA = [
  { nom: 'Ben Ali', prenom: 'Khalil', mat: 'MED-001', role: 'Médecin', '01/08/2026': 'X', '02/08/2026': 'X', '03/08/2026': '' },
  { nom: 'Hamdi',   prenom: 'Sara',   mat: 'INF-002', role: 'Infirmier', '01/08/2026': '',  '02/08/2026': 'X', '03/08/2026': 'X' },
  { nom: 'Mansour', prenom: 'Ali',    mat: 'AID-003', role: 'Aide-soignant', '01/08/2026': 'X',  '02/08/2026': '',  '03/08/2026': 'X' },
];

const STEP_TITLES = {
  guide: 'Guide d\'importation Excel / CSV',
  upload: 'Sélectionner un fichier Excel ou CSV',
  preview: 'Analyse et adaptation du planning',
  importing: 'Importation et génération du tableur',
  done: 'Planning prêt et synchronisé',
};

const STEP_ORDER = ['guide', 'upload', 'preview'];

function GuideExampleTwo() {
  const headers = ['Nom', 'Prenom', 'Matricule', 'Telephone', 'Role', 'Périodes', 'Remarque'];
  const rows = [
    ['Ben Ali', 'Khalil', 'MED-001', '+216 22 111 222', 'Médecin', '01/08/2026 au 31/08/2026', 'Garde de jour'],
    ['Hamdi', 'Sara', 'INF-002', '+216 25 333 444', 'Infirmier', '05/08/2026 au 10/08/2026; 18/08/2026 au 20/08/2026', 'Service de nuit']
  ];
  return (
    <div>
      <div className="gsi-example-note">
        <strong>Exemple — colonnes par périodes individuelles</strong>
        <div>Une ligne par agent. Une seule plage ou plusieurs plages séparées par un point-virgule sont acceptées.</div>
      </div>
      <div className="gsi-table-wrap">
        <table className="gsi-table">
          <thead>
            <tr>
              {headers.map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => <td key={j} className={j < 2 ? 'is-name' : undefined}>{cell}</td>)}
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
    }
  };

  // Le modèle se télécharge en ouvrant l'URL, donc sans passer par l'instance
  // Axios : le jeton doit être posé à la main. Il vit dans le magasin d'auth
  // (`accessToken`), pas sous une clé `token` du stockage local — et l'adresse
  // se construit sur la même base que le reste de l'API, sinon un build servi
  // ailleurs que le backend demande le fichier à sa propre origine.
  const downloadTemplate = () => {
    const { accessToken } = useAuthStore.getState();
    if (!accessToken) {
      toast.error('Session expirée — reconnectez-vous pour télécharger le modèle');
      return;
    }
    const params = new URLSearchParams({ departmentId: departmentId || '', token: accessToken });
    window.open(`${API_BASE_URL}/schedule-builder/import/template?${params}`, '_blank');
  };

  const is100PercentAdaptable = preview && preview.unmatchedCount === 0;
  const currentStepIndex = STEP_ORDER.indexOf(step);

  return (
    <div className="gsi-overlay" onClick={onClose}>
      <div className="gsi-modal" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="gsi-head">
          <div>
            <div className="gsi-head__title">{STEP_TITLES[step] || 'Importer'}</div>
            {step === 'guide' && (
              <div className="gsi-head__sub">
                Plannings normaux et spéciaux (week-ends et jours fériés), avec reprise intégrale du fichier.
              </div>
            )}
          </div>
          {/* Step pills */}
          <div className="gsi-steps">
            {STEP_ORDER.map((s, i) => {
              const done = ['done', 'importing', 'preview'].includes(step) && i < currentStepIndex;
              return (
                <React.Fragment key={s}>
                  <div className={`gsi-step${step === s ? ' is-current' : done ? ' is-done' : ''}`}>{i + 1}</div>
                  {i < 2 && <div className="gsi-step-link" />}
                </React.Fragment>
              );
            })}
            <button type="button" className="gsi-close" onClick={onClose} aria-label="Fermer">✕</button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="gsi-body">

          {/* ══ GUIDE ══════════════════════════════════════════════════ */}
          {step === 'guide' && (
            <div>
              {/* Feature highlight banner */}
              <div className="gsi-banner">
                <div className="gsi-banner__title">Le fichier est repris tel quel</div>
                <div className="gsi-banner__text">
                  • <strong>Validation directe</strong> : si tous les membres sont reconnus et la période valide, le planning est créé et prêt à l'emploi.<br />
                  • <strong>Ajustement dans le tableur</strong> : sinon, validez quand même et corrigez les colonnes ou les membres dans le tableur, ou choisissez un autre fichier.
                </div>
              </div>

              <div className="gs-tabs gsi-tabs">
                <button type="button" className="gs-tab" aria-current={guideExample === 'example1' ? 'page' : undefined} onClick={() => setGuideExample('example1')}>
                  Format 1 — grille par dates (recommandé)
                </button>
                <button type="button" className="gs-tab" aria-current={guideExample === 'example2' ? 'page' : undefined} onClick={() => setGuideExample('example2')}>
                  Format 2 — colonnes de périodes
                </button>
              </div>

              {guideExample === 'example2' && <GuideExampleTwo />}

              {/* Le format 1 reste monté et seulement masqué : son tableau est
                  large, le remonter à chaque bascule ferait sauter la boîte. */}
              <div className={guideExample === 'example1' ? undefined : 'gsi-hidden'}>
                <div className="gsi-section-title">Marquage des journées de service</div>
                <div className="gsi-legend">
                  <div className="gsi-legend__item">
                    <span className="gsi-legend__mark">{DUTY_MARK.mark}</span>
                    <span>{DUTY_MARK.label}</span>
                  </div>
                  <div className="gsi-legend__item is-quiet">Cellule vide = pas de service</div>
                  <div className="gsi-legend__item is-quiet">Tout autre marqueur (x, ✓, 1…) est accepté</div>
                </div>

                <div className="gsi-table-wrap">
                  <table className="gsi-table">
                    <thead>
                      <tr>
                        {['Nom', 'Prenom', 'Matricule', 'Role', '01/08/2026', '02/08/2026', '03/08/2026'].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {EXAMPLE_DATA.map((row, i) => (
                        <tr key={i}>
                          {[row.nom, row.prenom, row.mat, row.role].map((v, j) => (
                            <td key={j} className={j < 2 ? 'is-name' : undefined}>{v}</td>
                          ))}
                          {[row['01/08/2026'], row['02/08/2026'], row['03/08/2026']].map((mark, j) => (
                            <td key={j} className={mark ? 'is-duty' : 'is-off'}>{mark || '—'}</td>
                          ))}
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
              className={`gsi-drop${dragOver ? ' is-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); }}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden
                onChange={e => handleFile(e.target.files?.[0])} />

              {uploading ? (
                <div>
                  <div className="gsi-spinner" />
                  <div className="gsi-drop__hint">Analyse et correspondance en cours…</div>
                </div>
              ) : (
                <>
                  <div className="gsi-drop__title">Glissez votre fichier Excel ou CSV ici</div>
                  <div className="gsi-drop__hint">ou cliquez pour parcourir vos fichiers</div>
                  <div className="gsi-formats">
                    {['.xlsx', '.xls', '.csv'].map(ext => (
                      <span key={ext} className="gsi-format">{ext}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ══ PREVIEW & CONFIGURATION ════════════════════════════════ */}
          {step === 'preview' && preview && (
            <div className="gsi-preview">

              {/* Adaptability Banner */}
              {is100PercentAdaptable ? (
                <div className="gsi-verdict is-full">
                  <div>
                    <strong>Fichier intégralement repris</strong>
                    <p>Les {preview.matchedCount} membres sont identifiés et la période est valide. Vous pouvez valider directement.</p>
                  </div>
                  <span className="gsi-verdict__badge">100 %</span>
                </div>
              ) : (
                <div className="gsi-verdict is-partial">
                  <div>
                    <strong>Adaptation partielle — {preview.matchedCount} / {preview.totalRows} membres reconnus</strong>
                    <p>
                      {preview.unmatchedCount} ligne(s) non reconnue(s) seront intégrées comme lignes personnalisées.
                      Vous pourrez les modifier dans le tableur ou changer de fichier.
                    </p>
                  </div>
                </div>
              )}

              {/* Formulaire de configuration */}
              <div className="gsi-config">
                <h4>Paramètres du planning à créer ou mettre à jour</h4>
                <div className="gsi-grid">
                  <label className="gsi-field is-wide">
                    <span>Titre du planning *</span>
                    <input type="text" value={importTitle} onChange={e => setImportTitle(e.target.value)} placeholder="Ex : Gardes Urgences Août 2026" />
                  </label>

                  <label className="gsi-field">
                    <span>Type de planning *</span>
                    <select value={importScheduleType} onChange={e => setImportScheduleType(e.target.value)}>
                      <option value="normal">Planning normal (tous les jours)</option>
                      <option value="special_weekend_holiday">Planning spécial (week-ends et jours fériés)</option>
                    </select>
                  </label>

                  <div className="gsi-grid is-tight">
                    <label className="gsi-field">
                      <span>Début *</span>
                      <input type="date" value={importStartDate} onChange={e => setImportStartDate(e.target.value)} />
                    </label>
                    <label className="gsi-field">
                      <span>Fin *</span>
                      <input type="date" value={importEndDate} onChange={e => setImportEndDate(e.target.value)} />
                    </label>
                  </div>
                </div>
              </div>

              {/* Table preview */}
              <div>
                <div className="gsi-section-title">
                  Aperçu des membres et correspondances — {preview.rows.length} lignes
                </div>
                <div className="gsi-table-wrap is-scroll">
                  <table className="gsi-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Statut BD</th>
                        <th>Nom et prénom</th>
                        <th>Matricule</th>
                        <th>Fonction</th>
                        <th className="is-centered"
                          title="Colonne « Garde a domicile » du fichier (facultative). Décochée = garde à l'hôpital, en présence. Vous pouvez la corriger ici avant de valider.">
                          Domicile
                        </th>
                        <th className="is-centered">Gardes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, i) => (
                        <tr key={i}>
                          <td className="is-num">{row.rowIndex}</td>
                          <td>
                            {row.isMatched ? (
                              <span className="gsi-status is-matched">✓ {row.matchedUserName}</span>
                            ) : (
                              <span className="gsi-status is-custom">Ligne personnalisée</span>
                            )}
                          </td>
                          <td className="is-name">{row.lastName} {row.firstName}</td>
                          <td className="is-num">{row.matricule || '—'}</td>
                          <td>{row.roleName || '—'}</td>
                          <td className="is-centered">
                            {/* Les lignes de l'aperçu repartent verbatim à la
                                validation : cocher ici suffit à corriger un
                                fichier qui n'avait pas la colonne. */}
                            <label className={`gsi-home${row.atHome === true ? ' is-on' : ''}`}
                              title={row.atHome === true ? 'Garde à domicile (astreinte)' : "Garde à l'hôpital, en présence"}>
                              <input type="checkbox" checked={row.atHome === true}
                                onChange={(e) => {
                                  const atHome = e.target.checked;
                                  setPreview(prev => prev && ({
                                    ...prev,
                                    rows: prev.rows.map((r, j) => (j === i ? { ...r, atHome } : r)),
                                  }));
                                }} />
                              {row.atHome === true ? 'Domicile' : '—'}
                            </label>
                          </td>
                          <td className="is-centered is-num">
                            {Object.keys(row.shifts || {}).length}
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
            <div className="gsi-wait">
              <div className="gsi-spinner is-lg" />
              <div className="gsi-wait__title">Validation et synchronisation du tableur…</div>
              <div className="gsi-wait__hint">Injection des membres et génération de la vue interactive.</div>
            </div>
          )}

          {/* ══ DONE ═══════════════════════════════════════════════════ */}
          {step === 'done' && result && (
            <div className="gsi-done">
              <div className="gsi-done__title">Planning validé et importé</div>
              <p>
                Le planning « <strong>{result.name}</strong> » est disponible.
                Vous pouvez le consulter ou ajuster ses lignes et ses colonnes dans le tableur.
              </p>
              <div className="gsi-stats">
                <div className="gsi-stat">
                  <strong>{result.totalRows}</strong>
                  <span>Lignes dans le tableur</span>
                </div>
                <div className="gsi-stat is-duty">
                  <strong>{result.dutyDaysCount}</strong>
                  <span>Journées de service</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="gsi-foot">

          {/* Left actions */}
          <div>
            {step === 'guide' && (
              <button type="button" className="gs-btn" onClick={downloadTemplate}>
                Modèle Excel pré-rempli
              </button>
            )}
            {step === 'preview' && (
              <button type="button" className="gs-btn" onClick={() => { setStep('upload'); setPreview(null); }}>
                Choisir un autre fichier
              </button>
            )}
          </div>

          {/* Right actions */}
          <div>
            {step === 'guide' && (
              <>
                <button type="button" className="gs-btn is-quiet" onClick={onClose}>Fermer</button>
                <button type="button" className="gs-btn is-primary" onClick={() => setStep('upload')}>
                  Continuer — sélectionner le fichier
                </button>
              </>
            )}
            {step === 'upload' && (
              <button type="button" className="gs-btn" onClick={() => setStep('guide')}>
                Revenir au guide
              </button>
            )}
            {step === 'preview' && (
              <button type="button" className="gs-btn is-primary" onClick={confirmImport}>
                {is100PercentAdaptable ? 'Valider et créer le planning' : 'Valider et éditer dans le tableur'}
              </button>
            )}
            {step === 'done' && (
              <button type="button" className="gs-btn is-primary" onClick={() => { onImported?.(result?.scheduleId); onClose(); }}>
                Ouvrir le tableur
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

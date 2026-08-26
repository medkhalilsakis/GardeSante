/**
 * Référentiels nationaux (Lot X4) — Super Admin.
 *
 * Ce que cet écran apporte, et qui n'existait nulle part :
 *
 *   • CONFORMITÉ — pour chaque établissement, a-t-il de quoi travailler ? Le
 *     tableur n'a plus besoin des types de garde (il ne connaît que « de service
 *     / pas de service »), mais un hôpital qui en manque est un hôpital où les
 *     imports et exports Excel et les remplacements n'ont aucun type auquel se
 *     rattacher. Cet écran le montre avant que l'utilisateur ne le découvre.
 *   • AMORÇAGE en un clic, pour un établissement ou pour tous ceux qui manquent.
 *   • HARMONISATION des horaires, libellés et couleurs des types de garde et
 *     d'absence.
 *   • DROITS — la matrice rôles × permissions telle qu'elle est réellement en
 *     base, en lecture seule.
 *
 * Fichier NEUF et autonome. `SuperAdminDashboard.jsx` ne reçoit qu'un import, un
 * bouton d'onglet et une branche de rendu. Aucun autre composant n'est modifié.
 */
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, ChevronRight, Clock3, Layers, Lock, Palette,
  Pencil, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, UserX, Wand2, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { adminAPI } from '../../../api';
import './ReferentielsSection.css';

const TABS = [
  { id: 'conformite', label: 'Conformité', icon: ShieldCheck },
  { id: 'garde',      label: 'Types de garde', icon: Clock3 },
  { id: 'absence',    label: "Types d'absence", icon: UserX },
  { id: 'droits',     label: 'Droits par rôle', icon: Lock },
];

const MODULE_LABELS = {
  establishments: 'Établissements',
  users: 'Comptes',
  departments: 'Services',
  schedules: 'Plannings',
  shifts: 'Gardes',
  absences: 'Absences',
  replacements: 'Remplacements',
  stats: 'Statistiques',
  remarks: 'Remarques',
  audit: 'Traçabilité',
};

const CELL_LABEL = {
  all: 'Accordé partout',
  partial: 'Accordé partiellement',
  none: 'Non accordé',
};

const nf = (n) => Number(n || 0).toLocaleString('fr-FR');
const errMsg = (e) => e?.response?.data?.message || 'Erreur';

/** Formulaire vierge d'un type de garde. */
const emptyShift = () => ({
  code: '', name: '', nameAr: '',
  startTime: '08:00', endTime: '16:00', durationHours: '',
  color: '#3B82F6', isActive: true,
});

/** Formulaire vierge d'un type d'absence. */
const emptyAbsence = () => ({
  code: '', name: '', nameAr: '',
  requiresJustification: true, isPaid: true, isLeave: true,
  color: '#EF4444', isActive: true,
});

// ══════════════════════════════════════════════════════════════
// Briques d'affichage
// ══════════════════════════════════════════════════════════════
const Card = ({ icon: Icon, label, value, sub, color = 'var(--gs-seal)' }) => (
  <div className="rf-card" style={{ '--rf-accent': color }}>
    <div className="rf-card-top">
      <Icon size={14} aria-hidden="true" />
      <span className="rf-card-label">{label}</span>
    </div>
    <div className="rf-card-value">{nf(value)}</div>
    {sub && <div className="rf-card-sub">{sub}</div>}
  </div>
);

const Note = ({ tone = 'info', icon: Icon = AlertTriangle, children }) => (
  <div className={`rf-note rf-note-${tone}`}>
    <Icon size={15} aria-hidden="true" style={{ flex: '0 0 auto', marginTop: 1 }} />
    <span>{children}</span>
  </div>
);

const Field = ({ label, hint, children }) => (
  <label className="rf-field">
    <span className="rf-field-label">{label}</span>
    {children}
    {hint && <span className="rf-field-hint">{hint}</span>}
  </label>
);

const Check = ({ label, checked, onChange, disabled, hint }) => (
  <label className={`rf-check${disabled ? ' rf-check-off' : ''}`}>
    <input type="checkbox" checked={Boolean(checked)} disabled={disabled}
      onChange={(e) => onChange(e.target.checked)} />
    <span>
      {label}
      {hint && <em>{hint}</em>}
    </span>
  </label>
);

/** Sélecteur d'établissement partagé par les deux éditeurs. */
const EstPicker = ({ establishments, value, onChange }) => (
  <div className="rf-picker">
    <span className="rf-picker-label">Établissement</span>
    <select className="rf-select rf-select-wide" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {establishments.map((est) => (
        <option key={est.id} value={est.id}>
          {est.name}
          {est.governorate ? ` — ${est.governorate}` : ''}
          {est.isActive ? '' : ' (inactif)'}
        </option>
      ))}
    </select>
  </div>
);

// ══════════════════════════════════════════════════════════════
// Onglet « Conformité »
// ══════════════════════════════════════════════════════════════
const ConformiteTab = ({ overview, onSeedAll, onSeedOne, seeding, onOpen }) => {
  const { establishments, summary, standards } = overview;
  const toFix = establishments.filter((e) => !e.ready);

  if (establishments.length === 0) {
    return (
      <div className="rf-state">
        Aucun établissement enregistré pour l'instant.
        <p className="rf-state-hint">
          Les référentiels apparaîtront dès la création du premier établissement — ses types de
          garde et d'absence sont désormais amorcés automatiquement.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rf-grid">
        <Card icon={Layers} label="Établissements" value={summary.establishments} color="var(--gs-seal)"
          sub="hors compte plateforme" />
        <Card icon={CheckCircle2} label="Prêts à travailler" value={summary.ready} color="var(--gs-duty)"
          sub="types de garde et d'absence au complet" />
        <Card icon={Clock3} label="Types de garde manquants" value={summary.missingShiftTypes} color="var(--gs-alert-strong)"
          sub="imports, exports et remplacements incomplets" />
        <Card icon={UserX} label="Types d'absence manquants" value={summary.missingAbsenceTypes} color="var(--gs-alert)"
          sub="appel du jour et congés incomplets" />
      </div>

      {toFix.length > 0 ? (
        <div className="rf-fix">
          <Note tone="warn">
            <strong>{nf(toFix.length)} établissement(s)</strong> n'ont pas tous leurs référentiels.
            Sans les types de garde {standards.shiftCodes.join(' / ')}, les imports et exports Excel
            et les remplacements n'ont plus de type auquel se rattacher ; sans les types d'absence,
            l'appel du jour ne peut pointer ni retard ni absence.
          </Note>
          <button type="button" className="rf-btn rf-btn-primary" disabled={seeding} onClick={onSeedAll}>
            <Wand2 size={14} aria-hidden="true" />
            {seeding ? 'Amorçage…' : 'Amorcer les référentiels manquants'}
          </button>
        </div>
      ) : (
        <Note tone="ok" icon={CheckCircle2}>
          Tous les établissements disposent de leurs types de garde et d'absence standards : imports,
          exports, remplacements et appel du jour ont partout ce qu'il leur faut.
        </Note>
      )}

      <div className="rf-table-wrap">
        <table className="rf-table">
          <thead>
            <tr>
              <th>Établissement</th>
              <th className="rf-num">Services</th>
              <th className="rf-num">Rôles</th>
              <th>Types de garde</th>
              <th>Types d'absence</th>
              <th>État</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {establishments.map((est) => (
              <tr key={est.id} className={est.ready ? undefined : 'rf-row-warn'}>
                <td>
                  <button type="button" className="rf-link" onClick={() => onOpen(est.id)}>
                    {est.name}
                  </button>
                  <div className="rf-cell-sub">
                    {est.code}
                    {est.governorate ? ` · ${est.governorate}` : ''}
                    {est.isActive ? '' : ' · inactif'}
                  </div>
                </td>
                <td className="rf-num">{nf(est.departments)}</td>
                <td className="rf-num">{nf(est.roles)}</td>
                <td>
                  <span className="rf-count">{nf(est.shiftTypes.active)} actif(s)</span>
                  {est.shiftTypes.missing.length > 0 && (
                    <div className="rf-missing">manque {est.shiftTypes.missing.join(', ')}</div>
                  )}
                </td>
                <td>
                  <span className="rf-count">{nf(est.absenceTypes.active)} actif(s)</span>
                  {est.absenceTypes.missing.length > 0 && (
                    <div className="rf-missing">
                      manque {est.absenceTypes.missing.length} type(s)
                    </div>
                  )}
                </td>
                <td>
                  {est.ready ? (
                    <span className="rf-badge rf-badge-ok">
                      <CheckCircle2 size={11} aria-hidden="true" /> Prêt
                    </span>
                  ) : (
                    <span className="rf-badge rf-badge-warn">
                      <AlertTriangle size={11} aria-hidden="true" /> À amorcer
                    </span>
                  )}
                </td>
                <td className="rf-actions-cell">
                  {!est.ready && (
                    <button type="button" className="rf-btn rf-btn-mini" disabled={seeding}
                      onClick={() => onSeedOne(est.id)} title="Créer les types standards manquants">
                      <Sparkles size={12} aria-hidden="true" /> Amorcer
                    </button>
                  )}
                  <button type="button" className="rf-btn rf-btn-mini rf-btn-ghost"
                    onClick={() => onOpen(est.id)}>
                    Ouvrir <ChevronRight size={12} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="rf-footnote">
        L'amorçage est strictement additif : il crée les types absents et ne réécrit jamais un
        horaire, un libellé ou une couleur déjà personnalisés par un établissement.
      </p>
    </>
  );
};

// ══════════════════════════════════════════════════════════════
// Onglet « Types de garde »
// ══════════════════════════════════════════════════════════════
const ShiftTypesTab = ({ establishments, estId, setEstId, standards }) => {
  const qc = useQueryClient();
  const [form, setForm] = useState(null);       // null | { …, id? }

  const { data: types = [], isLoading } = useQuery({
    queryKey: ['admin-shift-types', estId],
    queryFn: () => adminAPI.getShiftTypes({ establishmentId: estId }).then((r) => r.data.data),
    enabled: Boolean(estId),
  });

  const done = (msg) => (r) => {
    toast.success(r.data.message || msg);
    setForm(null);
    qc.invalidateQueries({ queryKey: ['admin-shift-types'] });
    qc.invalidateQueries({ queryKey: ['admin-referentiels'] });
  };
  const oops = (e) => toast.error(errMsg(e));

  const create = useMutation({
    mutationFn: (d) => adminAPI.createShiftType({ ...d, establishmentId: estId }),
    onSuccess: done('Type de garde créé'), onError: oops,
  });
  const update = useMutation({
    mutationFn: ({ id, ...d }) => adminAPI.updateShiftType(id, d),
    onSuccess: done('Type de garde mis à jour'), onError: oops,
  });
  const remove = useMutation({
    mutationFn: (id) => adminAPI.deleteShiftType(id),
    onSuccess: done('Type de garde supprimé'), onError: oops,
  });

  const busy = create.isPending || update.isPending || remove.isPending;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = (e) => {
    e.preventDefault();
    const payload = {
      code: form.code, name: form.name, nameAr: form.nameAr || null,
      startTime: form.startTime, endTime: form.endTime,
      durationHours: form.durationHours === '' ? null : Number(form.durationHours),
      color: form.color, isActive: form.isActive,
    };
    if (form.id) update.mutate({ id: form.id, ...payload });
    else create.mutate(payload);
  };

  const missing = establishments.find((e) => e.id === estId)?.shiftTypes.missing || [];

  return (
    <>
      <div className="rf-toolbar">
        <EstPicker establishments={establishments} value={estId} onChange={(v) => { setEstId(v); setForm(null); }} />
        <button type="button" className="rf-btn rf-btn-primary" disabled={!estId || busy}
          onClick={() => setForm(emptyShift())}>
          <Plus size={14} aria-hidden="true" /> Nouveau type
        </button>
      </div>

      <Note tone="info">
        Le tableur de garde ne connaît plus qu'une seule notion — <strong>l'agent est de service, ou
        il ne l'est pas</strong> — et n'utilise donc aucun de ces codes. Les types
        <strong> {standards.shiftCodes.join(', ')}</strong> restent néanmoins protégés (ni renommés,
        ni désactivés, ni supprimés) car ils alimentent la table des gardes, les statistiques bâties
        sur elle et les remplacements ; leurs horaires, libellés et couleurs restent modifiables. Un
        type créé ici sert aux imports et exports Excel, jamais à la saisie du tableur.
      </Note>

      {missing.length > 0 && (
        <Note tone="warn">
          Types standards absents de cet établissement : <strong>{missing.join(', ')}</strong>.
          Utilisez « Amorcer » depuis l'onglet Conformité, ou créez-les à la main ci-dessous.
        </Note>
      )}

      {form && (
        <form className="rf-form" onSubmit={submit}>
          <div className="rf-form-head">
            <strong>{form.id ? `Modifier « ${form.code} »` : 'Nouveau type de garde'}</strong>
            <button type="button" className="rf-icon-btn" onClick={() => setForm(null)} aria-label="Fermer">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="rf-form-grid">
            <Field label="Code" hint={form.locked ? 'Code du tableur : non modifiable' : '1 à 10 lettres ou chiffres'}>
              <input className="rf-input" value={form.code} maxLength={10} required disabled={form.locked}
                onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Libellé">
              <input className="rf-input" value={form.name} required
                onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Libellé arabe" hint="facultatif">
              <input className="rf-input" dir="rtl" value={form.nameAr || ''}
                onChange={(e) => set({ nameAr: e.target.value })} />
            </Field>
            <Field label="Début">
              <input className="rf-input" type="time" value={form.startTime} required
                onChange={(e) => set({ startTime: e.target.value })} />
            </Field>
            <Field label="Fin">
              <input className="rf-input" type="time" value={form.endTime} required
                onChange={(e) => set({ endTime: e.target.value })} />
            </Field>
            <Field label="Durée (heures)" hint="vide = déduite des horaires">
              <input className="rf-input" type="number" min="0.5" max="24" step="0.5"
                value={form.durationHours}
                onChange={(e) => set({ durationHours: e.target.value })} />
            </Field>
            <Field label="Couleur">
              <div className="rf-color">
                <input type="color" value={form.color} onChange={(e) => set({ color: e.target.value })} />
                <span>{form.color?.toUpperCase()}</span>
              </div>
            </Field>
          </div>
          <div className="rf-form-foot">
            <Check label="Type actif" checked={form.isActive} disabled={form.locked}
              hint={form.locked ? ' — un code du tableur doit rester actif' : undefined}
              onChange={(v) => set({ isActive: v })} />
            <div className="rf-form-actions">
              <button type="button" className="rf-btn rf-btn-ghost" onClick={() => setForm(null)}>Annuler</button>
              <button type="submit" className="rf-btn rf-btn-primary" disabled={busy}>
                {busy ? 'Enregistrement…' : form.id ? 'Enregistrer' : 'Créer le type'}
              </button>
            </div>
          </div>
        </form>
      )}

      {!estId ? (
        <div className="rf-state">Sélectionnez un établissement.</div>
      ) : isLoading ? (
        <div className="rf-state">Chargement des types de garde…</div>
      ) : types.length === 0 ? (
        <div className="rf-state">
          Aucun type de garde dans cet établissement.
          <p className="rf-state-hint">
            En l'état, aucun tableur ne peut y être enregistré. Amorcez les types standards depuis
            l'onglet Conformité.
          </p>
        </div>
      ) : (
        <div className="rf-table-wrap">
          <table className="rf-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Libellé</th>
                <th>Horaires</th>
                <th className="rf-num">Durée</th>
                <th className="rf-num">Utilisations</th>
                <th>État</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className={t.isActive ? undefined : 'rf-row-off'}>
                  <td>
                    <span className="rf-code" style={{ background: t.color }}>{t.code}</span>
                    {t.isStandard && (
                      <span className="rf-tag" title="Code du tableur de garde — protégé">
                        <Lock size={9} aria-hidden="true" /> tableur
                      </span>
                    )}
                  </td>
                  <td>
                    {t.name}
                    {t.nameAr && <div className="rf-cell-sub" dir="rtl">{t.nameAr}</div>}
                  </td>
                  <td className="rf-mono">
                    {t.startTime} → {t.endTime}
                    {t.isOvernight && <div className="rf-cell-sub">passe minuit</div>}
                  </td>
                  <td className="rf-num">{t.durationHours} h</td>
                  <td className="rf-num">{nf(t.usageCount)}</td>
                  <td>
                    {t.isActive
                      ? <span className="rf-badge rf-badge-ok">Actif</span>
                      : <span className="rf-badge rf-badge-off">Inactif</span>}
                  </td>
                  <td className="rf-actions-cell">
                    <button type="button" className="rf-icon-btn" title="Modifier"
                      onClick={() => setForm({
                        id: t.id, code: t.code, name: t.name, nameAr: t.nameAr || '',
                        startTime: t.startTime, endTime: t.endTime,
                        durationHours: String(t.durationHours ?? ''),
                        color: t.color || '#3B82F6', isActive: t.isActive,
                        locked: t.isStandard,
                      })}>
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                    <button type="button" className="rf-icon-btn rf-icon-danger"
                      disabled={busy || t.isStandard || t.usageCount > 0}
                      title={
                        t.isStandard
                          ? 'Code du tableur de garde : suppression impossible'
                          : t.usageCount > 0
                            ? `Utilisé par ${t.usageCount} garde(s) : désactivez-le plutôt`
                            : 'Supprimer'
                      }
                      onClick={() => {
                        if (window.confirm(`Supprimer définitivement le type « ${t.code} — ${t.name} » ?`)) {
                          remove.mutate(t.id);
                        }
                      }}>
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

// ══════════════════════════════════════════════════════════════
// Onglet « Types d'absence »
// ══════════════════════════════════════════════════════════════
const AbsenceTypesTab = ({ establishments, estId, setEstId, standards }) => {
  const qc = useQueryClient();
  const [form, setForm] = useState(null);

  const { data: types = [], isLoading } = useQuery({
    queryKey: ['admin-absence-types', estId],
    queryFn: () => adminAPI.getAbsenceTypes({ establishmentId: estId }).then((r) => r.data.data),
    enabled: Boolean(estId),
  });

  const done = (msg) => (r) => {
    toast.success(r.data.message || msg);
    setForm(null);
    qc.invalidateQueries({ queryKey: ['admin-absence-types'] });
    qc.invalidateQueries({ queryKey: ['admin-referentiels'] });
  };
  const oops = (e) => toast.error(errMsg(e));

  const create = useMutation({
    mutationFn: (d) => adminAPI.createAbsenceType({ ...d, establishmentId: estId }),
    onSuccess: done('Type créé'), onError: oops,
  });
  const update = useMutation({
    mutationFn: ({ id, ...d }) => adminAPI.updateAbsenceType(id, d),
    onSuccess: done('Type mis à jour'), onError: oops,
  });
  const remove = useMutation({
    mutationFn: (id) => adminAPI.deleteAbsenceType(id),
    onSuccess: done('Type supprimé'), onError: oops,
  });

  const busy = create.isPending || update.isPending || remove.isPending;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = (e) => {
    e.preventDefault();
    const payload = {
      code: form.code, name: form.name, nameAr: form.nameAr || null,
      requiresJustification: form.requiresJustification,
      isPaid: form.isPaid, isLeave: form.isLeave,
      color: form.color, isActive: form.isActive,
    };
    if (form.id) update.mutate({ id: form.id, ...payload });
    else create.mutate(payload);
  };

  const leaves = types.filter((t) => t.isLeave);
  const others = types.filter((t) => !t.isLeave);
  const missing = establishments.find((e) => e.id === estId)?.absenceTypes.missing || [];

  // Fonction de rendu, non composant : un composant redéfini à chaque rendu
  // ferait démonter puis remonter toutes les lignes à chaque frappe du formulaire.
  const renderRows = (rows) => rows.map((t) => (
    <tr key={t.id} className={t.isActive ? undefined : 'rf-row-off'}>
      <td>
        <span className="rf-dot" style={{ background: t.color }} aria-hidden="true" />
        {t.name}
        {t.nameAr && <div className="rf-cell-sub" dir="rtl">{t.nameAr}</div>}
      </td>
      <td className="rf-mono">
        {t.code}
        {t.isProtected && (
          <span className="rf-tag" title="Code utilisé littéralement par l'appel du jour">
            <Lock size={9} aria-hidden="true" /> appel
          </span>
        )}
      </td>
      <td>{t.isLeave ? 'Congé' : 'Garde du jour'}</td>
      <td>{t.isPaid ? 'Rémunéré' : 'Non rémunéré'}</td>
      <td>{t.requiresJustification ? 'Exigé' : '—'}</td>
      <td className="rf-num">{nf(t.usageCount)}</td>
      <td>
        {t.isActive
          ? <span className="rf-badge rf-badge-ok">Actif</span>
          : <span className="rf-badge rf-badge-off">Inactif</span>}
      </td>
      <td className="rf-actions-cell">
        <button type="button" className="rf-icon-btn" title="Modifier"
          onClick={() => setForm({
            id: t.id, code: t.code, name: t.name, nameAr: t.nameAr || '',
            requiresJustification: t.requiresJustification,
            isPaid: t.isPaid, isLeave: t.isLeave,
            color: t.color || '#EF4444', isActive: t.isActive,
            locked: t.isProtected,
          })}>
          <Pencil size={13} aria-hidden="true" />
        </button>
        <button type="button" className="rf-icon-btn rf-icon-danger"
          disabled={busy || t.isProtected || t.usageCount > 0}
          title={
            t.isProtected
              ? "Requis par l'appel du jour : suppression impossible"
              : t.usageCount > 0
                ? `Utilisé par ${t.usageCount} déclaration(s) : désactivez-le plutôt`
                : 'Supprimer'
          }
          onClick={() => {
            if (window.confirm(`Supprimer définitivement le type « ${t.name} » ?`)) remove.mutate(t.id);
          }}>
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </td>
    </tr>
  ));

  return (
    <>
      <div className="rf-toolbar">
        <EstPicker establishments={establishments} value={estId} onChange={(v) => { setEstId(v); setForm(null); }} />
        <button type="button" className="rf-btn rf-btn-primary" disabled={!estId || busy}
          onClick={() => setForm(emptyAbsence())}>
          <Plus size={14} aria-hidden="true" /> Nouveau type
        </button>
      </div>

      <Note tone="info">
        Deux familles cohabitent : les <strong>congés</strong>, qui rendent un agent indisponible et
        interdisent son affectation en garde, et les natures de la <strong>garde du jour</strong>
        (retard, absence injustifiée) utilisées par l'appel. Les codes{' '}
        <strong>{standards.protectedAbsenceCodes.join(' et ')}</strong> sont résolus littéralement
        par l'appel du jour : ils ne peuvent être ni renommés, ni désactivés, ni reclassés en congé.
      </Note>

      {missing.length > 0 && (
        <Note tone="warn">
          Types standards absents : <strong>{missing.join(', ')}</strong>. L'amorçage depuis l'onglet
          Conformité les recrée sans toucher aux types déjà présents.
        </Note>
      )}

      {form && (
        <form className="rf-form" onSubmit={submit}>
          <div className="rf-form-head">
            <strong>{form.id ? `Modifier « ${form.name} »` : "Nouveau type d'absence"}</strong>
            <button type="button" className="rf-icon-btn" onClick={() => setForm(null)} aria-label="Fermer">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="rf-form-grid">
            <Field label="Code" hint={form.locked ? "Code de l'appel du jour : non modifiable" : 'minuscules, chiffres ou _'}>
              <input className="rf-input" value={form.code} maxLength={30} required disabled={form.locked}
                onChange={(e) => set({ code: e.target.value.toLowerCase().replace(/\s+/g, '_') })} />
            </Field>
            <Field label="Libellé">
              <input className="rf-input" value={form.name} required
                onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Libellé arabe" hint="facultatif">
              <input className="rf-input" dir="rtl" value={form.nameAr || ''}
                onChange={(e) => set({ nameAr: e.target.value })} />
            </Field>
            <Field label="Couleur">
              <div className="rf-color">
                <input type="color" value={form.color} onChange={(e) => set({ color: e.target.value })} />
                <span>{form.color?.toUpperCase()}</span>
              </div>
            </Field>
          </div>
          <div className="rf-form-checks">
            <Check label="Congé" checked={form.isLeave} disabled={form.locked}
              hint={form.locked ? ' — relève de la garde du jour' : " — rend l'agent indisponible en garde"}
              onChange={(v) => set({ isLeave: v })} />
            <Check label="Rémunéré" checked={form.isPaid} onChange={(v) => set({ isPaid: v })} />
            <Check label="Justificatif exigé" checked={form.requiresJustification}
              onChange={(v) => set({ requiresJustification: v })} />
            <Check label="Type actif" checked={form.isActive} disabled={form.locked}
              hint={form.locked ? " — requis par l'appel du jour" : undefined}
              onChange={(v) => set({ isActive: v })} />
          </div>
          <div className="rf-form-foot">
            <span className="rf-field-hint">
              Un type déjà utilisé conserve son historique : le renommer ne réécrit aucune déclaration.
            </span>
            <div className="rf-form-actions">
              <button type="button" className="rf-btn rf-btn-ghost" onClick={() => setForm(null)}>Annuler</button>
              <button type="submit" className="rf-btn rf-btn-primary" disabled={busy}>
                {busy ? 'Enregistrement…' : form.id ? 'Enregistrer' : 'Créer le type'}
              </button>
            </div>
          </div>
        </form>
      )}

      {!estId ? (
        <div className="rf-state">Sélectionnez un établissement.</div>
      ) : isLoading ? (
        <div className="rf-state">Chargement des types d'absence…</div>
      ) : types.length === 0 ? (
        <div className="rf-state">
          Aucun type d'absence dans cet établissement.
          <p className="rf-state-hint">
            L'appel du jour ne pourra ni pointer un retard ni déclarer une absence. Amorcez les types
            standards depuis l'onglet Conformité.
          </p>
        </div>
      ) : (
        <div className="rf-table-wrap">
          <table className="rf-table">
            <thead>
              <tr>
                <th>Libellé</th>
                <th>Code</th>
                <th>Famille</th>
                <th>Rémunération</th>
                <th>Justificatif</th>
                <th className="rf-num">Utilisations</th>
                <th>État</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {leaves.length > 0 && (
                <tr className="rf-group-row"><td colSpan={8}>Congés ({nf(leaves.length)})</td></tr>
              )}
              {renderRows(leaves)}
              {others.length > 0 && (
                <tr className="rf-group-row"><td colSpan={8}>Garde du jour ({nf(others.length)})</td></tr>
              )}
              {renderRows(others)}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

// ══════════════════════════════════════════════════════════════
// Onglet « Droits par rôle » — lecture seule
// ══════════════════════════════════════════════════════════════
const DroitsTab = () => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-permission-matrix'],
    queryFn: () => adminAPI.getPermissionMatrix().then((r) => r.data.data),
    staleTime: 300000,
  });

  const [module, setModule] = useState('');

  const shown = useMemo(() => {
    if (!data) return [];
    return module ? data.permissions.filter((p) => p.module === module) : data.permissions;
  }, [data, module]);

  if (isLoading) return <div className="rf-state">Lecture de la matrice des droits…</div>;
  if (isError || !data) return <div className="rf-state">La matrice des droits n'a pas pu être chargée.</div>;

  return (
    <>
      <div className="rf-toolbar">
        <div className="rf-picker">
          <span className="rf-picker-label">Module</span>
          <select className="rf-select" value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">Tous ({data.permissions.length} droits)</option>
            {data.modules.map((m) => (
              <option key={m} value={m}>{MODULE_LABELS[m] || m}</option>
            ))}
          </select>
        </div>
        <div className="rf-legend">
          <span className="rf-legend-item"><i className="rf-sq rf-sq-all" /> accordé partout</span>
          <span className="rf-legend-item"><i className="rf-sq rf-sq-partial" /> partiellement</span>
          <span className="rf-legend-item"><i className="rf-sq rf-sq-none" /> non accordé</span>
        </div>
      </div>

      <Note tone="info" icon={Lock}>
        Lecture seule. Cette matrice est câblée dans la fonction SQL{' '}
        <code>create_roles_for_establishment</code> et appliquée à la création de chaque
        établissement — cet écran la restitue telle qu'elle est réellement en base.
        «&nbsp;Partiellement&nbsp;» signale un droit accordé dans certains établissements
        seulement : une divergence à connaître, pas un réglage à corriger ici.
      </Note>

      <div className="rf-table-wrap rf-matrix-wrap">
        <table className="rf-table rf-matrix">
          <thead>
            <tr>
              <th className="rf-matrix-head">Droit</th>
              {data.roles.map((r) => (
                <th key={r.code} className="rf-matrix-role" title={`${r.name} — niveau ${r.level}`}>
                  <span>{r.name}</span>
                  <em>{r.isGlobal ? 'plateforme' : `${nf(r.establishments)} étab.`}</em>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.modules
              .filter((m) => !module || m === module)
              .map((m) => (
                <React.Fragment key={m}>
                  <tr className="rf-group-row">
                    <td colSpan={data.roles.length + 1}>{MODULE_LABELS[m] || m}</td>
                  </tr>
                  {shown.filter((p) => p.module === m).map((p) => (
                    <tr key={p.code}>
                      <td className="rf-matrix-head">
                        {p.description || p.action}
                        <div className="rf-cell-sub rf-mono">{p.code}</div>
                      </td>
                      {data.roles.map((r) => {
                        const state = r.cells[p.code] || 'none';
                        return (
                          <td key={r.code} className="rf-matrix-cell">
                            <span className={`rf-sq rf-sq-${state}`} title={`${r.name} — ${CELL_LABEL[state]}`} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="rf-matrix-head">Total accordé</td>
              {data.roles.map((r) => (
                <td key={r.code} className="rf-matrix-cell rf-matrix-total">
                  {nf(r.granted)}
                  {r.partial > 0 && <em>+{nf(r.partial)}</em>}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
};

// ══════════════════════════════════════════════════════════════
// Composant principal
// ══════════════════════════════════════════════════════════════
export default function ReferentielsSection() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('conformite');
  const [estId, setEstId] = useState('');

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['admin-referentiels'],
    queryFn: () => adminAPI.getReferentiels().then((r) => r.data.data),
    staleTime: 30000,
  });

  const seed = useMutation({
    mutationFn: (payload) => adminAPI.seedReferentiels(payload),
    onSuccess: (r) => {
      toast.success(r.data.message || 'Référentiels amorcés');
      qc.invalidateQueries({ queryKey: ['admin-referentiels'] });
      qc.invalidateQueries({ queryKey: ['admin-shift-types'] });
      qc.invalidateQueries({ queryKey: ['admin-absence-types'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const establishments = data?.establishments || [];
  // Établissement courant : celui choisi, sinon le premier à corriger, sinon le premier.
  const currentEst = estId || establishments.find((e) => !e.ready)?.id || establishments[0]?.id || '';

  const openEst = (id) => { setEstId(id); setTab('garde'); };

  if (isLoading) return <div className="rf-state">Lecture des référentiels de la plateforme…</div>;
  if (isError || !data) {
    return (
      <div className="rf-state">
        Les référentiels n'ont pas pu être chargés.
        <p className="rf-state-hint">Réessayez dans un instant — aucune donnée n'a été modifiée.</p>
      </div>
    );
  }

  return (
    <div className="rf-wrap">
      <div className="rf-head">
        <div>
          <h2 className="rf-head-title">Référentiels nationaux</h2>
          <p className="rf-head-sub">
            Types de garde, natures d'absence et droits par rôle · {nf(data.catalogue.permissions)} droits
            répartis sur {nf(data.catalogue.modules)} modules · {nf(data.catalogue.roleCodes)} rôles
          </p>
        </div>
        <button type="button" className="rf-btn rf-btn-ghost" disabled={isFetching} onClick={() => refetch()}>
          <RefreshCw size={13} className={isFetching ? 'rf-spin' : undefined} aria-hidden="true" />
          {isFetching ? 'Actualisation…' : 'Actualiser'}
        </button>
      </div>

      <div className="rf-tabs" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => {
          const alert = id === 'conformite' && data.summary.ready < data.summary.establishments;
          return (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className={`rf-tab${tab === id ? ' rf-tab-on' : ''}`} onClick={() => setTab(id)}>
              <Icon size={13} aria-hidden="true" />
              {label}
              {alert && (
                <span className="rf-tab-badge">
                  {nf(data.summary.establishments - data.summary.ready)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'conformite' && (
        <ConformiteTab
          overview={data}
          seeding={seed.isPending}
          onSeedAll={() => seed.mutate({ scope: 'all' })}
          onSeedOne={(id) => seed.mutate({ establishmentId: id })}
          onOpen={openEst}
        />
      )}

      {tab === 'garde' && (
        <ShiftTypesTab establishments={establishments} estId={currentEst} setEstId={setEstId}
          standards={data.standards} />
      )}

      {tab === 'absence' && (
        <AbsenceTypesTab establishments={establishments} estId={currentEst} setEstId={setEstId}
          standards={data.standards} />
      )}

      {tab === 'droits' && <DroitsTab />}

      {tab !== 'droits' && (
        <p className="rf-footnote">
          <Palette size={11} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 4 }} />
          Chaque création, modification et suppression est inscrite dans l'historique de la
          plateforme avec son auteur, sa date et son adresse IP.
        </p>
      )}
    </div>
  );
}

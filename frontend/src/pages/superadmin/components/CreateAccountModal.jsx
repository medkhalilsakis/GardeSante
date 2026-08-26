/**
 * Créer un compte dans n'importe quel établissement — Super Admin (Lot X6, D1).
 *
 * Le Super Admin pouvait créer un établissement et son directeur, puis plus
 * rien : tout autre compte devait attendre que le directeur se connecte. Sur un
 * réseau en amorçage — un hôpital livré sans surveillant général, un directeur
 * qui n'ouvre pas sa session — la plateforme restait bloquée sans recours.
 *
 * ── Pourquoi l'établissement est demandé en premier ───────────
 * Les rôles sont créés **par établissement** (`create_roles_for_establishment`,
 * migration 012). Le Super Admin est rattaché à l'établissement système, qui n'a
 * aucun rôle : sans établissement cible, la liste des rôles est légitimement
 * vide et `POST /users` refuse la création (« establishmentId requis »). Le
 * formulaire suit donc l'ordre imposé par les données :
 *   établissement → rôle → service → fonction → identité.
 *
 * ── Les règles du serveur sont reproduites, pas contournées ───
 * Chaque contrainte de `users.controller.js` est rejouée ici pour guider au lieu
 * de laisser tomber un 400 :
 *   • `ROLES_REQUIRING_DEPT` et une fonction de catégorie « médical » ⇒ service
 *     obligatoire ;
 *   • `HOSPITAL_WIDE_ROLES` (surveillant général) ⇒ service interdit ;
 *   • `NO_LOGIN_ROLES` ⇒ compte sans accès à la plateforme, annoncé clairement ;
 *   • un seul chef de service par service ⇒ les services déjà pourvus sont
 *     signalés, et le 409 du serveur reste l'autorité finale.
 * Le serveur garde le dernier mot : rien n'est validé côté client seulement.
 *
 * Fichier NEUF. Aucun formulaire existant (Directeur, Chef de service) n'est
 * modifié ; ils continuent d'utiliser leurs propres écrans.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Building2, CheckCircle2, Copy, IdCard, Info, KeyRound, Layers,
  Mail, Phone, ShieldCheck, Stethoscope, UserPlus, X,
} from 'lucide-react';
import {
  departmentsAPI, establishmentsAPI, jobTitlesAPI, usersAPI,
} from '../../../api';
import './CreateAccountModal.css';

// Reprises **à l'identique** de `users.controller.js`. Toute divergence se
// traduirait par un formulaire qui promet ce que le serveur refuse.
const ROLES_REQUIRING_DEPT = ['department_head', 'service_supervisor', 'senior_doctor', 'resident'];
const HOSPITAL_WIDE_ROLES = ['general_supervisor'];
const NO_LOGIN_ROLES = ['senior_doctor', 'resident', 'autre'];
/** `personnel-categories.js` : seule la catégorie « medical » impose un service. */
const CARE_CATEGORIES = ['medical'];

const DEFAULT_PASSWORD = 'GardeSante@2025';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const empty = {
  establishmentId: '', roleCode: '', departmentId: '', jobTitleId: '',
  secondaryRoleCode: '', firstName: '', lastName: '', firstNameAr: '', lastNameAr: '',
  email: '', phone: '', matricule: '', grade: '', password: '',
};

const Field = ({ label, hint, required, error, children }) => (
  <label className="ca-field">
    <span className="ca-label">
      {label}
      {required && <em className="ca-req">obligatoire</em>}
    </span>
    {children}
    {error
      ? <span className="ca-error">{error}</span>
      : hint ? <span className="ca-hint">{hint}</span> : null}
  </label>
);

export default function CreateAccountModal({ open, onClose, establishmentId: initialEst }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [created, setCreated] = useState(null);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  // Réinitialisation à chaque ouverture : un formulaire qui garde les valeurs de
  // la création précédente fait créer deux comptes identiques par inadvertance.
  useEffect(() => {
    if (open) {
      setForm({ ...empty, establishmentId: initialEst || '' });
      setErrors({});
      setCreated(null);
    }
  }, [open, initialEst]);

  const { data: establishments = [] } = useQuery({
    queryKey: ['ca-establishments'],
    queryFn: () => establishmentsAPI.getAll().then((r) => r.data.data || []),
    enabled: open,
    staleTime: 60000,
  });

  const estId = form.establishmentId;

  const { data: roleData, isLoading: rolesLoading } = useQuery({
    queryKey: ['ca-roles', estId],
    queryFn: () => usersAPI.rolesAvailable({ establishmentId: estId }).then((r) => ({
      roles: r.data.data || [],
      secondaryRoles: r.data.secondaryRoles || [],
    })),
    enabled: open && Boolean(estId),
    staleTime: 60000,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['ca-departments', estId],
    queryFn: () => departmentsAPI.getAll({ establishmentId: estId }).then((r) => r.data.data || []),
    enabled: open && Boolean(estId),
    staleTime: 30000,
  });

  const { data: jobTitles = [] } = useQuery({
    queryKey: ['ca-job-titles', estId],
    queryFn: () => jobTitlesAPI.getAll({ establishmentId: estId }).then((r) => r.data.data || []),
    enabled: open && Boolean(estId),
    staleTime: 60000,
  });

  const roles = roleData?.roles || [];
  const secondaryRoles = roleData?.secondaryRoles || [];

  const selectedJobTitle = useMemo(
    () => jobTitles.find((j) => j.id === form.jobTitleId) || null,
    [jobTitles, form.jobTitleId]
  );

  // ── Règles dérivées, dans le même ordre que le serveur ──────
  const hospitalWide = HOSPITAL_WIDE_ROLES.includes(form.roleCode);
  const isCareTitle = selectedJobTitle ? CARE_CATEGORIES.includes(selectedJobTitle.category) : false;
  const needsDept = !hospitalWide
    && (ROLES_REQUIRING_DEPT.includes(form.roleCode) || isCareTitle);
  const noLogin = NO_LOGIN_ROLES.includes(form.roleCode);
  const isHead = form.roleCode === 'department_head';

  // Un service déjà pourvu refusera un second chef (409 côté serveur) : le dire
  // avant l'envoi plutôt que d'attendre le refus. `getDepartments` expose le chef
  // en `head_id` (colonnes brutes de la jointure latérale).
  const takenHeadDepts = useMemo(
    () => new Set(departments.filter((d) => d.head_id).map((d) => d.id)),
    [departments]
  );

  // Le rôle change ⇒ purger ce qui devient interdit ou sans objet.
  useEffect(() => {
    if (hospitalWide && form.departmentId) setForm((f) => ({ ...f, departmentId: '' }));
    if (!isHead && form.secondaryRoleCode) setForm((f) => ({ ...f, secondaryRoleCode: '' }));
  }, [hospitalWide, isHead, form.departmentId, form.secondaryRoleCode]);

  // Un changement d'établissement invalide rôle, service et fonction : ce sont
  // des identifiants propres à l'établissement précédent.
  useEffect(() => {
    setForm((f) => ({ ...f, roleCode: '', departmentId: '', jobTitleId: '', secondaryRoleCode: '' }));
  }, [estId]);

  const create = useMutation({
    mutationFn: (payload) => usersAPI.create(payload),
    onSuccess: (res, payload) => {
      setCreated({
        name: `${payload.firstName} ${payload.lastName}`,
        email: payload.email,
        password: payload.password || DEFAULT_PASSWORD,
        canLogin: res?.data?.data?.can_login !== false,
        establishment: establishments.find((e) => e.id === payload.establishmentId)?.name || '',
      });
      toast.success('Compte créé');
      // Préfixes : l'annuaire national, la conformité (compteur d'agents et
      // ligne « directeur »), le personnel d'établissement et la liste globale
      // des comptes se recalculent tous.
      ['admin-annuaire', 'admin-conformite', 'establishment-personnel', 'users']
        .forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
    },
    onError: (err) => {
      toast.error(err?.response?.data?.message || 'La création a échoué');
    },
  });

  if (!open) return null;

  const validate = () => {
    const e = {};
    if (!form.establishmentId) e.establishmentId = 'Choisissez l\'établissement d\'affectation.';
    if (!form.roleCode) e.roleCode = 'Choisissez le rôle du compte.';
    if (!form.firstName.trim()) e.firstName = 'Prénom requis.';
    if (!form.lastName.trim()) e.lastName = 'Nom requis.';
    if (!form.email.trim()) e.email = 'E-mail requis.';
    else if (!EMAIL_RE.test(form.email.trim())) e.email = 'Format d\'e-mail invalide.';
    if (needsDept && !form.departmentId) {
      e.departmentId = isCareTitle && !ROLES_REQUIRING_DEPT.includes(form.roleCode)
        ? 'Le personnel médical doit être affecté à un service.'
        : 'Ce rôle doit être affecté à un service.';
    }
    if (form.password && form.password.length < 8) {
      e.password = 'Au moins 8 caractères, ou laissez vide pour le mot de passe par défaut.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    create.mutate({
      establishmentId: form.establishmentId,
      roleCode: form.roleCode,
      departmentId: form.departmentId || undefined,
      jobTitleId: form.jobTitleId || undefined,
      secondaryRoleCode: form.secondaryRoleCode || undefined,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      firstNameAr: form.firstNameAr.trim() || undefined,
      lastNameAr: form.lastNameAr.trim() || undefined,
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim() || undefined,
      matricule: form.matricule.trim() || undefined,
      grade: form.grade.trim() || undefined,
      password: form.password || undefined,
    });
  };

  const copyCreds = () => {
    const text = `${created.email} / ${created.password}`;
    navigator.clipboard?.writeText(text)
      .then(() => toast.success('Identifiants copiés'))
      .catch(() => toast.error('Copie impossible — notez les identifiants manuellement'));
  };

  const estName = establishments.find((e) => e.id === estId)?.name;
  const busy = create.isPending;

  return (
    <div className="ca-overlay" role="presentation" onClick={onClose}>
      <div
        className="ca-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Créer un compte"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── En-tête ──────────────────────────────────────── */}
        <div className="ca-head">
          <div className="ca-head-title">
            <UserPlus size={17} aria-hidden="true" />
            <div>
              <h3>Créer un compte</h3>
              <p>Dans n'importe quel établissement du réseau</p>
            </div>
          </div>
          <button type="button" className="ca-close" onClick={onClose} aria-label="Fermer">
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        {created ? (
          // ── Confirmation : les identifiants ne s'affichent qu'une fois ──
          <div className="ca-body">
            <div className="ca-done">
              <CheckCircle2 size={34} aria-hidden="true" />
              <h4>{created.name}</h4>
              <p>Compte créé{created.establishment ? ` dans ${created.establishment}` : ''}.</p>
            </div>

            {created.canLogin ? (
              <div className="ca-creds">
                <div className="ca-cred">
                  <span>Identifiant</span>
                  <strong>{created.email}</strong>
                </div>
                <div className="ca-cred">
                  <span>Mot de passe</span>
                  <strong>{created.password}</strong>
                </div>
                <button type="button" className="ca-btn ca-btn-ghost" onClick={copyCreds}>
                  <Copy size={13} aria-hidden="true" /> Copier
                </button>
              </div>
            ) : (
              <p className="ca-note ca-note-info">
                <Info size={14} aria-hidden="true" />
                Ce rôle n'ouvre pas d'accès à la plateforme : la personne est enregistrée au
                répertoire et affectable dans un tableur de garde, sans identifiants de connexion.
              </p>
            )}

            <p className="ca-note">
              <AlertTriangle size={14} aria-hidden="true" />
              Transmettez ces identifiants maintenant : ils ne seront plus affichés. Le mot de
              passe est modifiable par la personne dès sa première connexion.
            </p>

            <div className="ca-actions">
              <button
                type="button"
                className="ca-btn ca-btn-ghost"
                onClick={() => { setCreated(null); setForm({ ...empty, establishmentId: estId }); }}
              >
                Créer un autre compte
              </button>
              <button type="button" className="ca-btn ca-btn-primary" onClick={onClose}>
                Terminer
              </button>
            </div>
          </div>
        ) : (
          <form className="ca-body" onSubmit={submit}>
            {/* ── 1. Affectation ─────────────────────────────── */}
            <section className="ca-step">
              <h4 className="ca-step-title">
                <span className="ca-step-num">1</span>
                Affectation
              </h4>

              <Field
                label="Établissement"
                required
                error={errors.establishmentId}
                hint="Les rôles, services et fonctions sont propres à chaque établissement : ce choix conditionne tout le reste du formulaire."
              >
                <select className="ca-input" value={form.establishmentId} onChange={set('establishmentId')}>
                  <option value="">— Choisir un établissement —</option>
                  {establishments.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}{e.code ? ` (${e.code})` : ''}{e.is_active === false ? ' — désactivé' : ''}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Rôle"
                required
                error={errors.roleCode}
                hint={
                  !estId ? 'Choisissez d\'abord un établissement.'
                    : rolesLoading ? 'Chargement des rôles…'
                      : roles.length === 0
                        ? 'Aucun rôle dans cet établissement : ses rôles n\'ont pas été initialisés.'
                        : noLogin ? 'Ce rôle n\'ouvre aucun accès à la plateforme.' : undefined
                }
              >
                <select
                  className="ca-input"
                  value={form.roleCode}
                  onChange={set('roleCode')}
                  disabled={!estId || rolesLoading || roles.length === 0}
                >
                  <option value="">— Choisir un rôle —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.code}>{r.name}</option>
                  ))}
                </select>
              </Field>

              {hospitalWide && (
                <p className="ca-note ca-note-info">
                  <Info size={14} aria-hidden="true" />
                  Le surveillant général couvre tout l'hôpital : il n'est rattaché à aucun service.
                </p>
              )}

              <Field
                label="Service"
                required={needsDept}
                error={errors.departmentId}
                hint={
                  hospitalWide ? 'Sans objet pour ce rôle.'
                    : !estId ? 'Choisissez d\'abord un établissement.'
                      : departments.length === 0
                        ? 'Aucun service actif dans cet établissement — le directeur doit d\'abord en créer un.'
                        : needsDept ? undefined : 'Facultatif pour ce rôle.'
                }
              >
                <select
                  className="ca-input"
                  value={form.departmentId}
                  onChange={set('departmentId')}
                  disabled={hospitalWide || !estId || departments.length === 0}
                >
                  <option value="">{needsDept ? '— Choisir un service —' : '— Aucun service —'}</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {isHead && takenHeadDepts.has(d.id) ? ' — chef déjà en poste' : ''}
                    </option>
                  ))}
                </select>
              </Field>

              {isHead && form.departmentId && takenHeadDepts.has(form.departmentId) && (
                <p className="ca-note ca-note-warn">
                  <AlertTriangle size={14} aria-hidden="true" />
                  Ce service a déjà un chef en poste. La création sera refusée : un service ne
                  peut avoir qu'un seul chef. Passez par « Désigner Chef de Service » pour le
                  remplacer.
                </p>
              )}

              <Field
                label="Fonction hospitalière"
                hint={
                  !estId ? 'Choisissez d\'abord un établissement.'
                    : jobTitles.length === 0
                      ? 'Catalogue de fonctions vide pour cet établissement — réparable depuis « Conformité des établissements ».'
                      : isCareTitle
                        ? 'Fonction soignante : l\'affectation à un service devient obligatoire.'
                        : 'Facultatif. Sert d\'intitulé de poste dans les tableurs et le répertoire.'
                }
              >
                <select
                  className="ca-input"
                  value={form.jobTitleId}
                  onChange={set('jobTitleId')}
                  disabled={!estId || jobTitles.length === 0}
                >
                  <option value="">— Aucune fonction —</option>
                  {jobTitles.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}{j.category_label ? ` · ${j.category_label}` : ''}
                    </option>
                  ))}
                </select>
              </Field>

              {isHead && secondaryRoles.length > 0 && (
                <Field
                  label="Métier réel du chef de service"
                  hint="« Chef de service » est un titre : le métier exercé est enregistré à côté. Purement descriptif, sans droit supplémentaire."
                >
                  <select className="ca-input" value={form.secondaryRoleCode} onChange={set('secondaryRoleCode')}>
                    <option value="">— Non précisé —</option>
                    {secondaryRoles.map((r) => (
                      <option key={r.id} value={r.code}>{r.name}</option>
                    ))}
                  </select>
                </Field>
              )}
            </section>

            {/* ── 2. Identité ────────────────────────────────── */}
            <section className="ca-step">
              <h4 className="ca-step-title">
                <span className="ca-step-num">2</span>
                Identité
              </h4>
              <div className="ca-grid2">
                <Field label="Prénom" required error={errors.firstName}>
                  <input className="ca-input" value={form.firstName} onChange={set('firstName')} autoComplete="off" />
                </Field>
                <Field label="Nom" required error={errors.lastName}>
                  <input className="ca-input" value={form.lastName} onChange={set('lastName')} autoComplete="off" />
                </Field>
                <Field label="Prénom (arabe)" hint="Facultatif">
                  <input className="ca-input" value={form.firstNameAr} onChange={set('firstNameAr')} dir="rtl" autoComplete="off" />
                </Field>
                <Field label="Nom (arabe)" hint="Facultatif">
                  <input className="ca-input" value={form.lastNameAr} onChange={set('lastNameAr')} dir="rtl" autoComplete="off" />
                </Field>
              </div>
            </section>

            {/* ── 3. Contact et accès ────────────────────────── */}
            <section className="ca-step">
              <h4 className="ca-step-title">
                <span className="ca-step-num">3</span>
                Contact et accès
              </h4>
              <div className="ca-grid2">
                <Field label="E-mail" required error={errors.email} hint="Sert d'identifiant de connexion.">
                  <div className="ca-with-icon">
                    <Mail size={14} aria-hidden="true" />
                    <input
                      className="ca-input"
                      type="email"
                      value={form.email}
                      onChange={set('email')}
                      placeholder="prenom.nom@hopital.tn"
                      autoComplete="off"
                    />
                  </div>
                </Field>
                <Field label="Téléphone" hint="Facultatif">
                  <div className="ca-with-icon">
                    <Phone size={14} aria-hidden="true" />
                    <input className="ca-input" value={form.phone} onChange={set('phone')} autoComplete="off" />
                  </div>
                </Field>
                <Field label="Matricule" hint="Facultatif">
                  <div className="ca-with-icon">
                    <IdCard size={14} aria-hidden="true" />
                    <input className="ca-input" value={form.matricule} onChange={set('matricule')} autoComplete="off" />
                  </div>
                </Field>
                <Field label="Grade" hint="Facultatif">
                  <input className="ca-input" value={form.grade} onChange={set('grade')} autoComplete="off" />
                </Field>
              </div>

              <Field
                label="Mot de passe initial"
                error={errors.password}
                hint={noLogin
                  ? 'Sans objet : ce rôle n\'ouvre aucun accès à la plateforme.'
                  : `Laissez vide pour utiliser « ${DEFAULT_PASSWORD} ».`}
              >
                <div className="ca-with-icon">
                  <KeyRound size={14} aria-hidden="true" />
                  <input
                    className="ca-input"
                    type="text"
                    value={form.password}
                    onChange={set('password')}
                    placeholder={DEFAULT_PASSWORD}
                    disabled={noLogin}
                    autoComplete="new-password"
                  />
                </div>
              </Field>
            </section>

            {/* ── Récapitulatif ──────────────────────────────── */}
            {estId && form.roleCode && (
              <div className="ca-recap">
                <span><Building2 size={12} aria-hidden="true" /> {estName}</span>
                <span><ShieldCheck size={12} aria-hidden="true" /> {roles.find((r) => r.code === form.roleCode)?.name}</span>
                {form.departmentId && (
                  <span>
                    <Stethoscope size={12} aria-hidden="true" />
                    {departments.find((d) => d.id === form.departmentId)?.name}
                  </span>
                )}
                {selectedJobTitle && (
                  <span><Layers size={12} aria-hidden="true" /> {selectedJobTitle.name}</span>
                )}
                {noLogin && <span className="ca-recap-warn">sans accès à la plateforme</span>}
              </div>
            )}

            <div className="ca-actions">
              <button type="button" className="ca-btn ca-btn-ghost" onClick={onClose} disabled={busy}>
                Annuler
              </button>
              <button type="submit" className="ca-btn ca-btn-primary" disabled={busy}>
                <UserPlus size={14} aria-hidden="true" />
                {busy ? 'Création…' : 'Créer le compte'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

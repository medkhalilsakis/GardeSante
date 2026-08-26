import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Camera,
  Check,
  CheckCircle2,
  Clock3,
  Eye,
  EyeOff,
  FileClock,
  ImagePlus,
  KeyRound,
  LockKeyhole,
  Mail,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { profileAPI } from '../../api';
import Avatar from '../../components/common/Avatar';
import {
  GsBadge,
  GsEmpty,
  GsPageHeader,
  GsPanel,
  GsSkeleton,
  GsTabRail,
} from '../../components/gs';
import { useAuthStore } from '../../store';
import './profile.css';

const FIELD_LABELS = {
  first_name: 'Prénom',
  last_name: 'Nom',
  first_name_ar: 'Prénom (arabe)',
  last_name_ar: 'Nom (arabe)',
  phone: 'Téléphone',
  birth_date: 'Date de naissance',
  gender: 'Genre',
  address: 'Adresse',
  city: 'Ville',
  id_card_number: 'N° Carte nationale',
  id_card_expiry: 'Expiration CIN',
  hire_date: 'Date de recrutement',
  speciality: 'Fonction déclarée',
  grade: 'Grade',
  bio: 'Biographie',
  matricule: 'Matricule',
};

const STATUS = {
  pending: { label: "En attente d'approbation", shortLabel: 'En attente', tone: 'alert', icon: Clock3 },
  approved: { label: 'Approuvée', shortLabel: 'Approuvée', tone: 'duty', icon: CheckCircle2 },
  rejected: { label: 'Refusée', shortLabel: 'Refusée', tone: 'alert', icon: XCircle },
  cancelled: { label: 'Remplacée par une nouvelle demande', shortLabel: 'Remplacée', tone: 'quiet', icon: FileClock },
};

const REQUEST_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

const TABS = [
  { id: 'avatar', label: 'Photo', icon: <Camera size={15} aria-hidden="true" /> },
  { id: 'profile', label: 'Informations', icon: <UserRound size={15} aria-hidden="true" /> },
  { id: 'security', label: 'Sécurité', icon: <ShieldCheck size={15} aria-hidden="true" /> },
  { id: 'requests', label: 'Demandes', icon: <FileClock size={15} aria-hidden="true" /> },
];

function Field({ label, required = false, hint, children, wide = false }) {
  return (
    <label className={`gsprof-field${wide ? ' gsprof-field--wide' : ''}`}>
      <span>{label}{required ? <b aria-hidden="true">*</b> : null}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function StatusBadge({ status, long = false }) {
  const config = STATUS[status] || STATUS.pending;
  const Icon = config.icon;
  return (
    <GsBadge tone={config.tone} icon={<Icon size={13} aria-hidden="true" />}>
      {long ? config.label : config.shortLabel}
    </GsBadge>
  );
}

function ProfileSummary({ profile, onOpenPhoto }) {
  const pending = profile.pendingRequest?.status === 'pending';
  return (
    <section className="gsprof-summary" aria-label="Identité professionnelle">
      <button type="button" className="gsprof-summary__avatar" onClick={onOpenPhoto} aria-label="Modifier la photo de profil">
        <Avatar avatarUrl={profile.avatar_url} firstName={profile.first_name} lastName={profile.last_name} size="xl" />
        <Camera size={15} aria-hidden="true" />
      </button>
      <div className="gsprof-summary__identity">
        <span className="gs-eyebrow">Identité professionnelle</span>
        <h2>{profile.first_name} {profile.last_name}</h2>
        <p>{profile.role_name || 'Rôle non renseigné'}</p>
      </div>
      <dl className="gsprof-summary__facts">
        <div><dt>Établissement</dt><dd>{profile.establishment_name || 'Non renseigné'}</dd></div>
        <div><dt>Matricule</dt><dd className="gs-num">{profile.matricule || '—'}</dd></div>
        <div><dt>Adresse email</dt><dd>{profile.email}</dd></div>
      </dl>
      {pending ? (
        <div className="gsprof-summary__state">
          <StatusBadge status="pending" long />
          <span>Vos changements restent visibles ici jusqu’à leur décision.</span>
        </div>
      ) : null}
    </section>
  );
}

function AvatarTab({ profile }) {
  const queryClient = useQueryClient();
  const updateAvatar = useAuthStore((state) => state.updateAvatar);
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = useMutation({
    mutationFn: (file) => profileAPI.uploadAvatar(file),
    onSuccess: (response) => {
      const avatarUrl = response.data?.data?.avatarUrl;
      toast.success('Photo de profil mise à jour');
      setPreview(null);
      setPendingFile(null);
      if (inputRef.current) inputRef.current.value = '';
      updateAvatar(avatarUrl);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (error) => toast.error(error.response?.data?.message || "Erreur lors de l'upload"),
  });

  const remove = useMutation({
    mutationFn: () => profileAPI.deleteAvatar(),
    onSuccess: () => {
      toast.success('Photo supprimée');
      setPreview(null);
      setPendingFile(null);
      if (inputRef.current) inputRef.current.value = '';
      updateAvatar(null);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  const chooseFile = (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Format non supporté. Utilisez JPG, PNG ou WebP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Fichier trop volumineux : 5 Mo maximum.');
      return;
    }
    setPendingFile(file);
    const reader = new FileReader();
    reader.onload = (event) => setPreview(event.target.result);
    reader.readAsDataURL(file);
  };

  const cancelPreview = () => {
    setPreview(null);
    setPendingFile(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <GsPanel title="Photo de profil" sub="Une image carrée et nette reste lisible dans l’annuaire comme dans les plannings." icon={<ImagePlus size={18} aria-hidden="true" />} className="gsprof-photo-panel">
      <div
        className={`gsprof-dropzone${dragOver ? ' is-over' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          chooseFile(event.dataTransfer.files[0]);
        }}
      >
        <div className="gsprof-dropzone__preview">
          <Avatar avatarUrl={preview || profile.avatar_url} firstName={profile.first_name} lastName={profile.last_name} size="2xl" />
          <Camera size={17} aria-hidden="true" />
        </div>
        <div className="gsprof-dropzone__copy">
          <strong>{dragOver ? 'Relâchez le fichier ici' : 'Déposez une nouvelle photo'}</strong>
          <span>JPG, PNG ou WebP · 5 Mo maximum · recadrage automatique en 200 × 200 px</span>
        </div>
        <button type="button" className="gs-btn" onClick={() => inputRef.current?.click()}>
          <Upload size={15} aria-hidden="true" /> Choisir un fichier
        </button>
        <input ref={inputRef} className="gsprof-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseFile(event.target.files[0])} />
      </div>

      <div className="gsprof-photo-actions">
        {preview ? (
          <>
            <button type="button" className="gs-btn" onClick={cancelPreview}><X size={15} aria-hidden="true" /> Annuler</button>
            <button type="button" className="gs-btn is-primary" onClick={() => upload.mutate(pendingFile)} disabled={upload.isPending || !pendingFile}>
              <Save size={15} aria-hidden="true" /> {upload.isPending ? 'Enregistrement…' : 'Enregistrer la photo'}
            </button>
          </>
        ) : profile.avatar_url ? (
          <button type="button" className="gs-btn is-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
            <Trash2 size={15} aria-hidden="true" /> {remove.isPending ? 'Suppression…' : 'Supprimer la photo'}
          </button>
        ) : null}
      </div>

      <div className="gsprof-photo-guidance">
        <strong>Repères de cadrage</strong>
        <ul>
          <li><Check size={13} aria-hidden="true" /> visage visible et centré ;</li>
          <li><Check size={13} aria-hidden="true" /> fond simple et lumière régulière ;</li>
          <li><Check size={13} aria-hidden="true" /> image professionnelle récente.</li>
        </ul>
      </div>
    </GsPanel>
  );
}

function ProfileInfoTab({ profile }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    first_name: profile.first_name || '', last_name: profile.last_name || '',
    first_name_ar: profile.first_name_ar || '', last_name_ar: profile.last_name_ar || '',
    phone: profile.phone || '', birth_date: profile.birth_date?.split('T')[0] || '',
    gender: profile.gender || 'non_renseigne', address: profile.address || '', city: profile.city || '',
    id_card_number: profile.id_card_number || '', id_card_expiry: profile.id_card_expiry?.split('T')[0] || '',
    hire_date: profile.hire_date?.split('T')[0] || '', speciality: profile.speciality || '',
    grade: profile.grade || '', matricule: profile.matricule || '', bio: profile.bio || '',
  });

  const requestChange = useMutation({
    mutationFn: (data) => profileAPI.requestChange(data),
    onSuccess: (response) => {
      toast.success(response.data?.message || 'Demande soumise');
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['my-profile-requests'] });
    },
    onError: (error) => toast.error(error.response?.data?.message || 'Erreur'),
  });

  const change = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const submit = (event) => {
    event.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) {
      toast.error('Le prénom et le nom sont requis.');
      return;
    }
    requestChange.mutate(form);
  };

  return (
    <form className="gsprof-form" onSubmit={submit}>
      {profile.pendingRequest ? (
        <div className="gsprof-request-callout" data-status={profile.pendingRequest.status}>
          <StatusBadge status={profile.pendingRequest.status} long />
          <div>
            <strong>Demande en cours de traitement</strong>
            <p>Champs concernés : {profile.pendingRequest.changed_fields?.map((field) => FIELD_LABELS[field] || field).join(', ') || 'non précisés'}.</p>
            {profile.pendingRequest.rejection_reason ? <p>Motif : {profile.pendingRequest.rejection_reason}</p> : null}
          </div>
        </div>
      ) : null}

      <GsPanel title="Cadre professionnel" sub="Ces informations sont administrées par votre établissement et ne sont pas modifiables ici." icon={<Building2 size={18} aria-hidden="true" />} className="gsprof-work-panel">
        <dl className="gsprof-work-grid">
          <div><dt>Établissement</dt><dd>{profile.establishment_name || '—'}</dd></div>
          <div><dt>Code</dt><dd className="gs-num">{profile.establishment_code || '—'}</dd></div>
          <div><dt>Type</dt><dd>{profile.establishment_type || '—'}</dd></div>
          <div><dt>Rôle</dt><dd>{profile.role_name || '—'}</dd></div>
          <div><dt>Email</dt><dd>{profile.email || '—'}</dd></div>
        </dl>
        {profile.departments?.length ? (
          <div className="gsprof-departments">
            <span>Services</span>
            <div>
              {profile.departments.map((department) => (
                <GsBadge key={department.id} tone={department.is_head ? 'seal' : 'quiet'}>
                  {department.name}{department.is_head ? ' · responsable' : ''}
                </GsBadge>
              ))}
            </div>
          </div>
        ) : null}
      </GsPanel>

      <GsPanel title="Informations personnelles" sub="Une modification crée une demande traçable soumise au Super Admin." icon={<UserRound size={18} aria-hidden="true" />}>
        <div className="gsprof-form-grid">
          <Field label="Prénom" required><input value={form.first_name} onChange={change('first_name')} /></Field>
          <Field label="Nom" required><input value={form.last_name} onChange={change('last_name')} /></Field>
          <Field label="Prénom (arabe)"><input dir="rtl" value={form.first_name_ar} onChange={change('first_name_ar')} /></Field>
          <Field label="Nom (arabe)"><input dir="rtl" value={form.last_name_ar} onChange={change('last_name_ar')} /></Field>
          <Field label="Téléphone"><input value={form.phone} onChange={change('phone')} placeholder="+216 …" /></Field>
          <Field label="Genre"><select value={form.gender} onChange={change('gender')}><option value="non_renseigne">Non renseigné</option><option value="homme">Homme</option><option value="femme">Femme</option></select></Field>
          <Field label="Date de naissance"><input type="date" value={form.birth_date} onChange={change('birth_date')} /></Field>
          <Field label="Date de recrutement"><input type="date" value={form.hire_date} onChange={change('hire_date')} /></Field>
          <Field label="Matricule"><input value={form.matricule} onChange={change('matricule')} /></Field>
          <Field label="N° Carte nationale"><input value={form.id_card_number} onChange={change('id_card_number')} /></Field>
          <Field label="Expiration CIN"><input type="date" value={form.id_card_expiry} onChange={change('id_card_expiry')} /></Field>
          <Field label="Fonction / titre"><input value={form.speciality} onChange={change('speciality')} /></Field>
          <Field label="Grade"><input value={form.grade} onChange={change('grade')} /></Field>
          <Field label="Ville"><input value={form.city} onChange={change('city')} /></Field>
          <Field label="Adresse" wide><textarea value={form.address} onChange={change('address')} /></Field>
          <Field label="Biographie / notes" wide><textarea value={form.bio} onChange={change('bio')} /></Field>
        </div>
      </GsPanel>

      <div className="gsprof-form-actions">
        <span>Les anciennes demandes restent dans l’historique, sans réécriture.</span>
        <button type="submit" className="gs-btn is-primary" disabled={requestChange.isPending}>
          <Upload size={15} aria-hidden="true" /> {requestChange.isPending ? 'Soumission…' : 'Soumettre les modifications'}
        </button>
      </div>
    </form>
  );
}

function SecurityTab({ profile }) {
  const updateUser = useAuthStore((state) => state.updateUser);
  const [email, setEmail] = useState(profile.email || '');
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);

  const updateEmail = useMutation({
    mutationFn: (data) => profileAPI.updateCredentials(data),
    onSuccess: () => { toast.success('Adresse email mise à jour'); updateUser({ email }); },
    onError: (error) => toast.error(error.response?.data?.message || 'Erreur'),
  });
  const updatePassword = useMutation({
    mutationFn: (data) => profileAPI.updateCredentials(data),
    onSuccess: () => {
      toast.success('Mot de passe modifié. Reconnectez-vous sur vos autres appareils.');
      setPassword({ current: '', next: '', confirm: '' });
    },
    onError: (error) => toast.error(error.response?.data?.message || 'Erreur'),
  });

  const passwordChecks = [
    { label: '8 caractères minimum', ok: password.next.length >= 8 },
    { label: 'une majuscule', ok: /[A-Z]/.test(password.next) },
    { label: 'un chiffre', ok: /[0-9]/.test(password.next) },
    { label: 'un caractère spécial', ok: /[^A-Za-z0-9]/.test(password.next) },
  ];

  const submitPassword = (event) => {
    event.preventDefault();
    if (password.next !== password.confirm) return toast.error('Les mots de passe ne correspondent pas.');
    if (password.next.length < 8) return toast.error('Le mot de passe doit contenir au moins 8 caractères.');
    updatePassword.mutate({ currentPassword: password.current, newPassword: password.next });
  };

  return (
    <div className="gsprof-security-grid">
      <GsPanel title="Adresse email" sub="Cette modification est immédiate et sert à votre prochaine connexion." icon={<Mail size={18} aria-hidden="true" />}>
        <div className="gsprof-inline-form">
          <Field label="Nouvelle adresse email"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          <button type="button" className="gs-btn is-primary" disabled={updateEmail.isPending || !email || email === profile.email} onClick={() => updateEmail.mutate({ email })}>
            <Save size={15} aria-hidden="true" /> {updateEmail.isPending ? 'Enregistrement…' : "Mettre à jour l'email"}
          </button>
        </div>
      </GsPanel>

      <GsPanel title="Mot de passe" sub="La modification révoque les sessions renouvelables sur vos autres appareils." icon={<LockKeyhole size={18} aria-hidden="true" />}>
        <form className="gsprof-password-form" onSubmit={submitPassword}>
          <Field label="Mot de passe actuel" required>
            <div className="gsprof-password-input">
              <input type={showPassword ? 'text' : 'password'} value={password.current} onChange={(event) => setPassword((current) => ({ ...current, current: event.target.value }))} />
              <button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Masquer les mots de passe' : 'Afficher les mots de passe'}>
                {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
          </Field>
          <Field label="Nouveau mot de passe" required><input type={showPassword ? 'text' : 'password'} value={password.next} onChange={(event) => setPassword((current) => ({ ...current, next: event.target.value }))} /></Field>
          <Field label="Confirmation" required><input type={showPassword ? 'text' : 'password'} value={password.confirm} onChange={(event) => setPassword((current) => ({ ...current, confirm: event.target.value }))} /></Field>
          {password.next ? (
            <ul className="gsprof-password-checks">
              {passwordChecks.map((check) => <li key={check.label} data-valid={check.ok ? 'true' : 'false'}>{check.ok ? <Check size={13} aria-hidden="true" /> : <span aria-hidden="true" />}{check.label}</li>)}
            </ul>
          ) : null}
          <button type="submit" className="gs-btn is-danger" disabled={updatePassword.isPending || !password.current || !password.next || password.next !== password.confirm}>
            <KeyRound size={15} aria-hidden="true" /> {updatePassword.isPending ? 'Modification…' : 'Changer le mot de passe'}
          </button>
        </form>
      </GsPanel>
    </div>
  );
}

function RequestsTab() {
  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['my-profile-requests'],
    queryFn: () => profileAPI.getMyRequests().then((response) => response.data.data || []),
  });

  if (isLoading) return <GsSkeleton variant="block" count={3} />;
  if (!requests.length) {
    return <GsEmpty icon={<FileClock size={27} aria-hidden="true" />} title="Aucune demande de modification" hint="Les changements soumis depuis l’onglet Informations apparaîtront ici avec leur décision." />;
  }

  return (
    <GsPanel title="Historique des demandes" sub="Le journal reste immuable : une nouvelle demande remplace la demande en attente sans effacer les précédentes." icon={<FileClock size={18} aria-hidden="true" />} flush>
      <ol className="gsprof-request-list">
        {requests.map((request) => (
          <li key={request.id} data-status={request.status}>
            <div className="gsprof-request-list__head">
              <StatusBadge status={request.status} />
              <time dateTime={request.submitted_at}>{REQUEST_DATE.format(new Date(request.submitted_at))}</time>
            </div>
            <div className="gsprof-request-list__fields">{(request.changed_fields || []).map((field) => <span key={field}>{FIELD_LABELS[field] || field}</span>)}</div>
            {request.reviewer_first || request.reviewer_last ? <p>Décision enregistrée par {[request.reviewer_first, request.reviewer_last].filter(Boolean).join(' ')}.</p> : null}
            {request.rejection_reason ? <p className="gsprof-request-list__reason">Motif : {request.rejection_reason}</p> : null}
          </li>
        ))}
      </ol>
    </GsPanel>
  );
}

export default function ProfilePage() {
  const [tab, setTab] = useState('avatar');
  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['profile'],
    queryFn: () => profileAPI.getProfile().then((response) => response.data.data),
    staleTime: 30_000,
  });

  if (isLoading) return <div className="gsprof-page"><GsSkeleton variant="rail" count={3} /><GsSkeleton variant="block" count={3} /></div>;
  if (error || !profile) {
    return (
      <div className="gsprof-page">
        <GsEmpty icon={<XCircle size={27} aria-hidden="true" />} title="Impossible de charger le profil" hint="Vérifiez votre connexion, puis rechargez la page." actions={<button type="button" className="gs-btn" onClick={() => window.location.reload()}>Réessayer</button>} />
      </div>
    );
  }

  return (
    <div className="gsprof-page">
      <GsPageHeader
        eyebrow="Mon espace"
        title="Mon profil"
        subtitle="Votre identité, vos accès et toutes les demandes de modification dans un même dossier."
        meta={[{ label: 'Établissement', value: profile.establishment_name || 'Non renseigné' }, { label: 'Rôle', value: profile.role_name || 'Non renseigné' }]}
      >
        <GsTabRail tabs={TABS} value={tab} onChange={setTab} label="Sections du profil" />
      </GsPageHeader>
      <ProfileSummary profile={profile} onOpenPhoto={() => setTab('avatar')} />
      <div className="gsprof-content">
        {tab === 'avatar' ? <AvatarTab profile={profile} /> : null}
        {tab === 'profile' ? <ProfileInfoTab profile={profile} /> : null}
        {tab === 'security' ? <SecurityTab profile={profile} /> : null}
        {tab === 'requests' ? <RequestsTab /> : null}
      </div>
    </div>
  );
}

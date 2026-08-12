import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profileAPI } from '../../api';
import { useAuthStore } from '../../store';
import Avatar from '../../components/common/Avatar';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';

// ─── Étiquettes des champs ────────────────────────────────────
const FIELD_LABELS = {
  first_name:'Prénom', last_name:'Nom', first_name_ar:'Prénom (ar)', last_name_ar:'Nom (ar)',
  phone:'Téléphone', birth_date:'Date de naissance', gender:'Genre',
  address:'Adresse', city:'Ville', id_card_number:'N° Carte Nationale',
  id_card_expiry:'Expiration CIN', hire_date:'Date de recrutement',
  speciality:'Spécialité', grade:'Grade', bio:'Biographie', matricule:'Matricule',
};

const STATUS_STYLE = {
  pending:  { bg:'#D9770618', color:'#D97706', label:"En attente d'approbation", icon:'⏳' },
  approved: { bg:'#05966920', color:'#059669', label:'Approuvée',                icon:'✅' },
  rejected: { bg:'#EF444420', color:'#EF4444', label:'Refusée',                  icon:'❌' },
};

// ─── Form inputs ──────────────────────────────────────────────
const Field = ({ label, required, children, hint }) => (
  <div style={{ marginBottom: 16 }}>
    <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-muted)',
      textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
      {label}{required && <span style={{ color:'var(--color-danger)', marginLeft:3 }}>*</span>}
    </label>
    {children}
    {hint && <p style={{ fontSize:11, color:'var(--text-muted)', marginTop:3 }}>{hint}</p>}
  </div>
);
const inp = {
  width:'100%', background:'var(--bg-input)', border:'1px solid var(--border-default)',
  borderRadius:8, padding:'9px 12px', color:'var(--text-primary)', fontSize:'var(--font-sm)',
  outline:'none', boxSizing:'border-box', fontFamily:'inherit', transition:'border-color 0.15s',
};
const Input    = (p) => <input    {...p} style={{ ...inp, ...p.style }}
  onFocus={e => e.target.style.borderColor='var(--color-primary)'}
  onBlur={e  => e.target.style.borderColor='var(--border-default)'} />;
const Select   = ({ children, ...p }) => <select   {...p} style={{ ...inp }}>{children}</select>;
const Textarea = (p) => <textarea {...p} style={{ ...inp, minHeight:72, resize:'vertical', ...p.style }} />;

// ══════════════════════════════════════════════════════════════
// Onglet avatar
// ══════════════════════════════════════════════════════════════
function AvatarTab({ profile }) {
  const qc = useQueryClient();
  const { updateAvatar } = useAuthStore();
  const fileRef = useRef();
  const [preview, setPreview] = useState(null);
  // Le fichier choisi est conservé ici et non relu depuis l'input : un fichier
  // glissé-déposé n'alimente PAS `fileRef.current.files`, donc l'upload restait
  // sans effet pour ce chemin-là.
  const [pendingFile, setPendingFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const avatarUrl = preview
    ? preview
    : profile.avatar_url
      ? (profile.avatar_url.startsWith('http') ? profile.avatar_url : `${API_BASE}${profile.avatar_url}`)
      : null;

  const uploadMut = useMutation({
    mutationFn: (file) => profileAPI.uploadAvatar(file),
    onSuccess: (res) => {
      toast.success('Photo de profil mise à jour');
      setPreview(null);
      setPendingFile(null);
      if (fileRef.current) fileRef.current.value = '';
      updateAvatar(res.data.data.avatarUrl);
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Erreur lors de l\'upload'),
  });

  const deleteMut = useMutation({
    mutationFn: () => profileAPI.deleteAvatar(),
    onSuccess: () => {
      toast.success('Photo supprimée');
      setPreview(null);
      setPendingFile(null);
      if (fileRef.current) fileRef.current.value = '';
      updateAvatar(null);
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  const handleFile = (file) => {
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      return toast.error('Format non supporté (JPG, PNG, WebP)');
    }
    if (file.size > 5 * 1024 * 1024) return toast.error('Fichier trop volumineux (max 5 Mo)');
    setPendingFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleCancel = () => {
    setPreview(null);
    setPendingFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleUpload = () => {
    // Le fichier vient de l'état, pas de l'input : cela couvre aussi bien le
    // clic que le glisser-déposer.
    if (!pendingFile) return;
    uploadMut.mutate(pendingFile);
  };

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      {/* Zone d'upload */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--color-primary)' : 'var(--border-default)'}`,
          borderRadius: 16, padding: 36, textAlign: 'center',
          cursor: 'pointer', transition: 'all 0.2s',
          background: dragOver ? 'var(--color-primary-10)' : 'var(--bg-elevated)',
          marginBottom: 24,
        }}
      >
        {/* Aperçu */}
        <div style={{ display:'flex', justifyContent:'center', marginBottom:16, position:'relative' }}>
          <Avatar
            avatarUrl={avatarUrl}
            firstName={profile.first_name}
            lastName={profile.last_name}
            size="2xl"
            style={{
              border: '4px solid var(--color-primary)',
              boxShadow: '0 0 0 4px var(--color-primary-10)',
            }}
          />
          {/* Icône caméra overlay */}
          <div style={{
            position:'absolute', bottom:0, right:'calc(50% - 48px - 12px)',
            background:'var(--color-primary)', borderRadius:'50%', width:30, height:30,
            display:'flex', alignItems:'center', justifyContent:'center',
            border:'2px solid var(--bg-card)', boxShadow:'var(--shadow-md)',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
        </div>

        <p style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:4, fontSize:'var(--font-sm)' }}>
          {dragOver ? 'Déposez ici…' : 'Cliquez ou glissez-déposez une image'}
        </p>
        <p style={{ fontSize:11, color:'var(--text-muted)' }}>JPG, PNG, WebP — max 5 Mo · Recadrée en 200×200px</p>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
          style={{ display:'none' }} onChange={e => handleFile(e.target.files[0])} />
      </div>

      {/* Actions */}
      <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
        {preview ? (
          <>
            <button className="btn btn-secondary" onClick={handleCancel}>Annuler</button>
            <button className="btn btn-primary" onClick={handleUpload} disabled={uploadMut.isPending || !pendingFile}>
              {uploadMut.isPending ? '⏳ Upload…' : '💾 Enregistrer cette photo'}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>
              📷 Changer la photo
            </button>
            {profile.avatar_url && (
              <button className="btn btn-danger" onClick={e => { e.stopPropagation(); deleteMut.mutate(); }}
                disabled={deleteMut.isPending}>
                🗑️ Supprimer
              </button>
            )}
          </>
        )}
      </div>

      {/* Conseils */}
      <div style={{
        marginTop:28, background:'var(--bg-elevated)', borderRadius:10,
        padding:'14px 18px', border:'1px solid var(--border-subtle)',
      }}>
        <p style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', marginBottom:8, textTransform:'uppercase' }}>
          Conseils pour une bonne photo
        </p>
        {['Utilisez une photo de profil professionnelle',
          'Votre visage doit être bien visible et centré',
          'Fond uni de préférence',
          'L\'image sera recadrée automatiquement en carré 200×200px'].map(tip => (
          <p key={tip} style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:4 }}>
            ✓ {tip}
          </p>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Onglet infos personnelles (avec approbation)
// ══════════════════════════════════════════════════════════════
function ProfileInfoTab({ profile }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    first_name: profile.first_name || '', last_name: profile.last_name || '',
    first_name_ar: profile.first_name_ar || '', last_name_ar: profile.last_name_ar || '',
    phone: profile.phone || '', birth_date: profile.birth_date?.split('T')[0] || '',
    gender: profile.gender || 'non_renseigne', address: profile.address || '',
    city: profile.city || '', id_card_number: profile.id_card_number || '',
    id_card_expiry: profile.id_card_expiry?.split('T')[0] || '',
    hire_date: profile.hire_date?.split('T')[0] || '',
    speciality: profile.speciality || '', grade: profile.grade || '',
    matricule: profile.matricule || '', bio: profile.bio || '',
  });

  const mutation = useMutation({
    mutationFn: (data) => profileAPI.requestChange(data),
    onSuccess: (res) => { toast.success(res.data.message || 'Demande soumise'); qc.invalidateQueries({ queryKey: ['profile'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.first_name || !form.last_name) return toast.error('Prénom et Nom requis');
    mutation.mutate(form);
  };

  const pending = profile.pendingRequest;

  return (
    <form onSubmit={handleSubmit}>
      {/* Bandeau statut demande */}
      {pending && (
        <div style={{
          background: STATUS_STYLE[pending.status]?.bg,
          border:`1px solid ${STATUS_STYLE[pending.status]?.color}44`,
          borderRadius:10, padding:'14px 18px', marginBottom:24, display:'flex', gap:12,
        }}>
          <span style={{ fontSize:20 }}>{STATUS_STYLE[pending.status]?.icon}</span>
          <div>
            <p style={{ fontWeight:700, color:STATUS_STYLE[pending.status]?.color, fontSize:'var(--font-sm)' }}>
              {STATUS_STYLE[pending.status]?.label}
            </p>
            <p style={{ fontSize:11, color:'var(--text-secondary)', marginTop:3 }}>
              Champs : <strong>{pending.changed_fields?.map(f => FIELD_LABELS[f]||f).join(', ')}</strong>
            </p>
            {pending.rejection_reason && (
              <p style={{ fontSize:11, color:'var(--color-danger)', marginTop:3 }}>Motif : {pending.rejection_reason}</p>
            )}
          </div>
        </div>
      )}

      {/* Infos établissement (non modifiables) */}
      <div style={{ background:'var(--bg-elevated)', borderRadius:10, padding:'16px 20px',
        marginBottom:24, border:'1px solid var(--border-subtle)' }}>
        <p style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>
          🏥 Établissement · {profile.establishment_name}
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:12 }}>
          {[['Rôle', profile.role_name], ['Code', profile.establishment_code],
            ['Type', profile.establishment_type], ['Email', profile.email]].map(([l, v]) => (
            <div key={l}>
              <p style={{ fontSize:10, color:'var(--text-muted)' }}>{l}</p>
              <p style={{ fontWeight:600, color:'var(--text-primary)', fontSize:'var(--font-sm)' }}>{v || '—'}</p>
            </div>
          ))}
        </div>
        {profile.departments?.length > 0 && (
          <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid var(--border-subtle)' }}>
            <p style={{ fontSize:10, color:'var(--text-muted)', marginBottom:6 }}>Services</p>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {profile.departments.map(d => (
                <span key={d.id} style={{
                  background: d.is_head ? 'var(--color-primary-10)' : 'var(--bg-card)',
                  border:`1px solid ${d.is_head ? 'var(--color-primary)' : 'var(--border-default)'}`,
                  borderRadius:6, padding:'2px 10px', fontSize:11, fontWeight:600,
                  color: d.is_head ? 'var(--color-primary-light)' : 'var(--text-secondary)',
                }}>
                  {d.is_head ? '👑 ' : ''}{d.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Formulaire */}
      <div style={{ background:'var(--bg-card)', border:'1px solid var(--border-default)', borderRadius:12, padding:24, marginBottom:20 }}>
        <p style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', marginBottom:20 }}>
          ✏️ Informations personnelles
          <span style={{ color:'var(--color-warning)', textTransform:'none', fontSize:10, fontStyle:'italic', marginLeft:8 }}>
            — Nécessite l'approbation du Super Admin
          </span>
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 20px' }}>
          <Field label="Prénom" required><Input value={form.first_name} onChange={e=>setForm(f=>({...f,first_name:e.target.value}))} /></Field>
          <Field label="Nom" required><Input value={form.last_name} onChange={e=>setForm(f=>({...f,last_name:e.target.value}))} /></Field>
          <Field label="Prénom (arabe)"><Input value={form.first_name_ar} onChange={e=>setForm(f=>({...f,first_name_ar:e.target.value}))} dir="rtl" placeholder="الاسم الأول" /></Field>
          <Field label="Nom (arabe)"><Input value={form.last_name_ar} onChange={e=>setForm(f=>({...f,last_name_ar:e.target.value}))} dir="rtl" placeholder="اللقب" /></Field>
          <Field label="Téléphone"><Input value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="+213 …" /></Field>
          <Field label="Genre">
            <Select value={form.gender} onChange={e=>setForm(f=>({...f,gender:e.target.value}))}>
              <option value="non_renseigne">Non renseigné</option>
              <option value="homme">Homme</option>
              <option value="femme">Femme</option>
            </Select>
          </Field>
          <Field label="Date de naissance"><Input type="date" value={form.birth_date} onChange={e=>setForm(f=>({...f,birth_date:e.target.value}))} /></Field>
          <Field label="Date de recrutement"><Input type="date" value={form.hire_date} onChange={e=>setForm(f=>({...f,hire_date:e.target.value}))} /></Field>
          <Field label="Matricule"><Input value={form.matricule} onChange={e=>setForm(f=>({...f,matricule:e.target.value}))} /></Field>
          <Field label="N° Carte Nationale"><Input value={form.id_card_number} onChange={e=>setForm(f=>({...f,id_card_number:e.target.value}))} /></Field>
          <Field label="Expiration CIN"><Input type="date" value={form.id_card_expiry} onChange={e=>setForm(f=>({...f,id_card_expiry:e.target.value}))} /></Field>
          <Field label="Spécialité"><Input value={form.speciality} onChange={e=>setForm(f=>({...f,speciality:e.target.value}))} /></Field>
          <Field label="Grade"><Input value={form.grade} onChange={e=>setForm(f=>({...f,grade:e.target.value}))} /></Field>
          <Field label="Ville"><Input value={form.city} onChange={e=>setForm(f=>({...f,city:e.target.value}))} /></Field>
        </div>
        <Field label="Adresse"><Textarea value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} placeholder="Rue, quartier, commune…" /></Field>
        <Field label="Bio / Notes"><Textarea value={form.bio} onChange={e=>setForm(f=>({...f,bio:e.target.value}))} style={{ minHeight:56 }} /></Field>
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end' }}>
        <button type="submit" className="btn btn-primary" style={{ minWidth:220 }} disabled={mutation.isPending}>
          {mutation.isPending ? '⏳ Soumission…' : '📤 Soumettre pour approbation'}
        </button>
      </div>
    </form>
  );
}

// ══════════════════════════════════════════════════════════════
// Onglet Sécurité (email + mdp directs)
// ══════════════════════════════════════════════════════════════
function SecurityTab({ profile }) {
  const { user, updateUser } = useAuthStore();
  const [email, setEmail]   = useState(profile.email);
  const [pwd, setPwd]       = useState({ current:'', next:'', confirm:'' });
  const [showPwd, setShow]  = useState(false);

  const emailMut = useMutation({
    mutationFn: (d) => profileAPI.updateCredentials(d),
    onSuccess: () => { toast.success('Email mis à jour'); updateUser({ email }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });

  const pwdMut = useMutation({
    mutationFn: (d) => profileAPI.updateCredentials(d),
    onSuccess: () => { toast.success('Mot de passe changé — reconnectez-vous'); setPwd({ current:'', next:'', confirm:'' }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });

  const checks = [
    { ok: pwd.next.length >= 8,              label: '8 caractères min.' },
    { ok: /[A-Z]/.test(pwd.next),            label: 'Majuscule' },
    { ok: /[0-9]/.test(pwd.next),            label: 'Chiffre' },
    { ok: /[^A-Za-z0-9]/.test(pwd.next),    label: 'Caractère spécial' },
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* Email */}
      <div style={{ background:'var(--bg-card)', border:'1px solid var(--border-default)', borderRadius:12, padding:24 }}>
        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:18 }}>
          <div style={{ background:'var(--color-info-10)', color:'var(--color-info)', borderRadius:8, padding:8, display:'flex' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
            </svg>
          </div>
          <div>
            <p style={{ fontWeight:700, fontSize:'var(--font-sm)', margin:0 }}>Adresse email</p>
            <p style={{ fontSize:11, color:'var(--color-success)', margin:0 }}>✓ Modification immédiate</p>
          </div>
        </div>
        <Field label="Nouvel email">
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </Field>
        <button className="btn btn-primary" disabled={emailMut.isPending || email === profile.email}
          onClick={() => emailMut.mutate({ email })}>
          {emailMut.isPending ? 'Enregistrement…' : 'Mettre à jour l\'email'}
        </button>
      </div>

      {/* Mot de passe */}
      <div style={{ background:'var(--bg-card)', border:'1px solid var(--border-default)', borderRadius:12, padding:24 }}>
        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:18 }}>
          <div style={{ background:'var(--color-danger-10)', color:'var(--color-danger)', borderRadius:8, padding:8, display:'flex' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
          </div>
          <div>
            <p style={{ fontWeight:700, fontSize:'var(--font-sm)', margin:0 }}>Mot de passe</p>
            <p style={{ fontSize:11, color:'var(--color-success)', margin:0 }}>✓ Modification immédiate</p>
          </div>
        </div>
        <Field label="Mot de passe actuel" required>
          <div style={{ position:'relative' }}>
            <Input type={showPwd ? 'text' : 'password'} value={pwd.current}
              onChange={e => setPwd(p=>({...p,current:e.target.value}))} placeholder="Votre mot de passe actuel" />
            <button type="button" onClick={() => setShow(s=>!s)} style={{
              position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
              background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:0 }}>
              {showPwd ? '🙈' : '👁️'}
            </button>
          </div>
        </Field>
        <Field label="Nouveau mot de passe" required>
          <Input type={showPwd ? 'text' : 'password'} value={pwd.next}
            onChange={e => setPwd(p=>({...p,next:e.target.value}))} placeholder="8 caractères minimum" />
        </Field>
        <Field label="Confirmer" required>
          <Input type={showPwd ? 'text' : 'password'} value={pwd.confirm}
            onChange={e => setPwd(p=>({...p,confirm:e.target.value}))} />
        </Field>

        {pwd.next && (
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:14 }}>
            {checks.map(({ ok, label }) => (
              <span key={label} style={{ fontSize:11, color: ok ? 'var(--color-success)' : 'var(--text-muted)' }}>
                {ok ? '✓' : '○'} {label}
              </span>
            ))}
          </div>
        )}

        <button className="btn btn-danger"
          disabled={pwdMut.isPending || !pwd.current || !pwd.next || pwd.next !== pwd.confirm}
          onClick={() => {
            if (pwd.next !== pwd.confirm) return toast.error('Les mots de passe ne correspondent pas');
            if (pwd.next.length < 8) return toast.error('Minimum 8 caractères');
            pwdMut.mutate({ currentPassword: pwd.current, newPassword: pwd.next });
          }}>
          {pwdMut.isPending ? 'Modification…' : '🔒 Changer le mot de passe'}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Onglet Historique
// ══════════════════════════════════════════════════════════════
function RequestsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-profile-requests'],
    queryFn: () => profileAPI.getMyRequests().then(r => r.data.data),
  });

  if (isLoading) return <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}>Chargement…</div>;

  if (!data?.length) return (
    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border-subtle)',
      borderRadius:12, padding:48, textAlign:'center' }}>
      <p style={{ fontSize:36, marginBottom:10 }}>📋</p>
      <p style={{ color:'var(--text-muted)' }}>Aucune demande de modification</p>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {data.map(req => {
        const st = STATUS_STYLE[req.status] || STATUS_STYLE.pending;
        return (
          <div key={req.id} style={{
            background:'var(--bg-card)',
            border:`1px solid ${st.color}33`,
            borderLeft:`4px solid ${st.color}`,
            borderRadius:10, padding:'16px 20px',
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
              <span style={{ background:st.bg, color:st.color, borderRadius:20, padding:'2px 12px', fontSize:11, fontWeight:700 }}>
                {st.icon} {st.label}
              </span>
              <span style={{ fontSize:11, color:'var(--text-muted)' }}>
                {new Date(req.submitted_at).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' })}
              </span>
            </div>
            <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:6 }}>
              {req.changed_fields?.map(f => (
                <span key={f} style={{
                  background:'var(--bg-elevated)', border:'1px solid var(--border-default)',
                  borderRadius:6, padding:'1px 8px', fontSize:11, color:'var(--text-secondary)',
                }}>
                  {FIELD_LABELS[f] || f}
                </span>
              ))}
            </div>
            {req.rejection_reason && (
              <p style={{ fontSize:11, color:'var(--color-danger)', background:'var(--color-danger-10)', borderRadius:6, padding:'5px 10px' }}>
                ❌ {req.rejection_reason}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PAGE PRINCIPALE
// ══════════════════════════════════════════════════════════════
const TABS = [
  { id:'avatar',   label:'📷 Photo' },
  { id:'profile',  label:'👤 Profil' },
  { id:'security', label:'🔒 Sécurité' },
  { id:'requests', label:'📋 Historique' },
];

export default function ProfilePage() {
  const [tab, setTab] = useState('avatar');

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['profile'],
    queryFn: () => profileAPI.getProfile().then(r => r.data.data),
    staleTime: 30000,
  });

  if (isLoading) return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height:60, borderRadius:10 }} />)}
    </div>
  );

  if (error) return (
    <div style={{ textAlign:'center', padding:60 }}>
      <p style={{ fontSize:36, marginBottom:12 }}>⚠️</p>
      <p style={{ color:'var(--color-danger)' }}>Impossible de charger le profil</p>
    </div>
  );

  const avatarUrl = profile.avatar_url
    ? (profile.avatar_url.startsWith('http') ? profile.avatar_url : `${API_BASE}${profile.avatar_url}`)
    : null;

  return (
    <div>
      {/* En-tête hero */}
      <div style={{
        background:'linear-gradient(135deg, var(--color-primary) 0%, #6366F1 100%)',
        borderRadius:16, padding:'28px 32px', marginBottom:'var(--space-6)',
        display:'flex', alignItems:'center', gap:20, position:'relative', overflow:'hidden',
      }}>
        <div style={{ position:'absolute', inset:0,
          backgroundImage:'radial-gradient(ellipse at 80% 50%, rgba(255,255,255,0.08), transparent)' }} />

        <Avatar
          avatarUrl={avatarUrl}
          firstName={profile.first_name}
          lastName={profile.last_name}
          size="xl"
          style={{ border:'3px solid rgba(255,255,255,0.5)', zIndex:1,
            cursor:'pointer', boxShadow:'0 4px 20px rgba(0,0,0,0.3)' }}
          onClick={() => setTab('avatar')}
        />

        <div style={{ zIndex:1, flex:1 }}>
          <h1 style={{ color:'#fff', fontWeight:800, fontSize:'var(--font-2xl)', margin:0 }}>
            {profile.first_name} {profile.last_name}
          </h1>
          <p style={{ color:'rgba(255,255,255,0.8)', margin:'4px 0 0', fontSize:'var(--font-sm)' }}>
            {profile.role_name} · 🏥 {profile.establishment_name}
          </p>
          <p style={{ color:'rgba(255,255,255,0.6)', margin:'2px 0 0', fontSize:'var(--font-xs)' }}>
            {profile.email}
            {profile.matricule ? ` · Matricule : ${profile.matricule}` : ''}
          </p>
        </div>

        {profile.pendingRequest?.status === 'pending' && (
          <div style={{
            background:'rgba(255,255,255,0.2)', borderRadius:8, padding:'8px 16px',
            backdropFilter:'blur(8px)', zIndex:1,
          }}>
            <p style={{ color:'#fff', fontSize:11, fontWeight:700, margin:0 }}>⏳ Demande en attente</p>
          </div>
        )}
      </div>

      {/* Onglets */}
      <div style={{
        display:'flex', gap:4, background:'var(--bg-elevated)',
        borderRadius:10, padding:4, marginBottom:'var(--space-6)', width:'fit-content',
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:'8px 18px', borderRadius:8, border:'none', cursor:'pointer',
            fontWeight:600, fontSize:'var(--font-sm)', fontFamily:'inherit',
            background: tab === t.id ? 'var(--color-primary)' : 'transparent',
            color: tab === t.id ? '#fff' : 'var(--text-secondary)',
            transition:'all 0.2s', whiteSpace:'nowrap',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenu */}
      {tab === 'avatar'   && <AvatarTab profile={profile} />}
      {tab === 'profile'  && <ProfileInfoTab profile={profile} />}
      {tab === 'security' && <SecurityTab profile={profile} />}
      {tab === 'requests' && <RequestsTab />}
    </div>
  );
}

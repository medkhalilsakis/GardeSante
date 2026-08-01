import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profileAPI } from '../../api';
import Avatar from '../../components/common/Avatar';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';

const FIELD_LABELS = {
  first_name:'Prénom', last_name:'Nom', first_name_ar:'Prénom (ar)', last_name_ar:'Nom (ar)',
  phone:'Téléphone', birth_date:'Naissance', gender:'Genre', address:'Adresse', city:'Ville',
  id_card_number:'N° CIN', id_card_expiry:'Exp. CIN', hire_date:'Recrutement',
  speciality:'Spécialité', grade:'Grade', bio:'Bio', matricule:'Matricule',
};

const ST = {
  pending:  { bg:'#D9770618', color:'#D97706', label:'En attente' },
  approved: { bg:'#05966920', color:'#059669', label:'Approuvée' },
  rejected: { bg:'#EF444420', color:'#EF4444', label:'Refusée' },
};

function fmt(v, field) {
  if (!v) return '—';
  if (field?.includes('date') || field?.includes('expiry') || field?.includes('hire')) {
    return typeof v === 'string' ? v.split('T')[0] : v;
  }
  return String(v);
}

function RequestCard({ req, onApprove, onReject, busy }) {
  const [open, setOpen]         = useState(false);
  const [modal, setModal]       = useState(false);
  const [reason, setReason]     = useState('');

  const cur  = typeof req.current_data  === 'string' ? JSON.parse(req.current_data)  : (req.current_data  || {});
  const prop = typeof req.requested_data === 'string' ? JSON.parse(req.requested_data) : (req.requested_data || {});
  const st   = ST[req.status] || ST.pending;
  const avatarUrl = req.avatar_url
    ? (req.avatar_url.startsWith('http') ? req.avatar_url : `${API_BASE}${req.avatar_url}`)
    : null;

  return (
    <div style={{
      background:'var(--bg-card)',
      border:`1px solid ${req.status==='pending' ? 'var(--border-default)' : st.color+'33'}`,
      borderLeft:`4px solid ${st.color}`,
      borderRadius:12, overflow:'hidden',
      boxShadow: req.status==='pending' ? 'var(--shadow-md)' : 'var(--shadow-sm)',
    }}>
      {/* Header */}
      <div style={{ padding:'16px 20px', display:'flex', alignItems:'center', gap:14,
        cursor:'pointer', background:open?'var(--bg-elevated)':'transparent', transition:'background 0.15s' }}
        onClick={() => setOpen(o=>!o)}>
        <Avatar avatarUrl={avatarUrl} firstName={req.first_name} lastName={req.last_name} size="md" />
        <div style={{ flex:1, minWidth:0 }}>
          <p style={{ fontWeight:700, fontSize:'var(--font-sm)', margin:0 }}>{req.first_name} {req.last_name}</p>
          <p style={{ fontSize:11, color:'var(--text-secondary)', margin:'2px 0' }}>
            {req.role_name} · 🏥 {req.establishment_name}
          </p>
          <p style={{ fontSize:11, color:'var(--text-muted)', margin:0 }}>
            {req.changed_fields?.length} champ(s) : {req.changed_fields?.slice(0,3).map(f=>FIELD_LABELS[f]||f).join(', ')}
            {req.changed_fields?.length > 3 ? '…' : ''}
          </p>
        </div>
        <div style={{ textAlign:'right', flexShrink:0 }}>
          <span style={{ background:st.bg, color:st.color, borderRadius:20, padding:'3px 12px', fontSize:11, fontWeight:700, display:'block', marginBottom:3 }}>
            {st.label}
          </span>
          <span style={{ fontSize:10, color:'var(--text-muted)' }}>
            {new Date(req.submitted_at).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' })}
          </span>
        </div>
        <span style={{ color:'var(--text-muted)' }}>{open?'▲':'▼'}</span>
      </div>

      {/* Détails */}
      {open && (
        <div style={{ borderTop:'1px solid var(--border-subtle)', padding:'16px 20px' }}>
          <p style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', marginBottom:10 }}>
            Comparaison des modifications
          </p>
          <div style={{ background:'var(--bg-elevated)', borderRadius:8, overflow:'hidden', marginBottom:16 }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'var(--bg-surface)' }}>
                  {['CHAMP','ACTUEL','NOUVEAU'].map((h, i) => (
                    <th key={h} style={{ padding:'7px 12px', textAlign:'left', fontSize:10,
                      color: i===2 ? 'var(--color-success)' : 'var(--text-muted)', fontWeight:700, width:i===0?'25%':i===1?'37.5%':'37.5%' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {req.changed_fields?.map(f => (
                  <tr key={f} style={{ borderTop:'1px solid var(--border-subtle)' }}>
                    <td style={{ padding:'7px 12px', fontSize:11, fontWeight:700, color:'var(--text-muted)' }}>{FIELD_LABELS[f]||f}</td>
                    <td style={{ padding:'7px 12px', fontSize:'var(--font-sm)', color:'var(--text-secondary)', textDecoration:'line-through', opacity:0.7 }}>{fmt(cur[f], f)}</td>
                    <td style={{ padding:'7px 12px', fontSize:'var(--font-sm)', fontWeight:600, color:'var(--color-success)' }}>→ {fmt(prop[f], f)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {req.rejection_reason && (
            <div style={{ background:'var(--color-danger-10)', border:'1px solid var(--color-danger-20)', borderRadius:8, padding:'8px 12px', marginBottom:12 }}>
              <p style={{ fontSize:11, color:'var(--color-danger)', fontWeight:600 }}>❌ {req.rejection_reason}</p>
            </div>
          )}

          {req.status === 'pending' && (
            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-success" disabled={busy} onClick={() => onApprove(req.id)}>
                ✓ Approuver
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => setModal(true)}>
                ✗ Refuser
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal refus */}
      {modal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex',
          alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }}
          onClick={e => e.target===e.currentTarget && setModal(false)}>
          <div style={{ background:'var(--bg-card)', borderRadius:12, width:'100%', maxWidth:420, padding:28 }}>
            <h3 style={{ margin:'0 0 14px', fontWeight:700 }}>Motif de refus</h3>
            <textarea value={reason} onChange={e=>setReason(e.target.value)}
              placeholder="Expliquez pourquoi cette demande est refusée…"
              style={{ width:'100%', minHeight:90, background:'var(--bg-input)', border:'1px solid var(--border-default)',
                borderRadius:8, padding:'10px 12px', color:'var(--text-primary)', fontFamily:'inherit',
                fontSize:'var(--font-sm)', outline:'none', boxSizing:'border-box', resize:'vertical' }} />
            <div style={{ display:'flex', gap:10, marginTop:14, justifyContent:'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Annuler</button>
              <button className="btn btn-danger" disabled={!reason.trim()||busy}
                onClick={() => { onReject(req.id, reason); setModal(false); }}>
                Confirmer le refus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProfileRequestsAdminPage() {
  const [filter, setFilter] = useState('pending');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-profile-requests', filter],
    queryFn: () => profileAPI.adminGetRequests({ status: filter }).then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: countData } = useQuery({
    queryKey: ['admin-pending-count'],
    queryFn: () => profileAPI.adminPendingCount().then(r => r.data.data),
    refetchInterval: 20000,
  });

  const inv = () => { qc.invalidateQueries(['admin-profile-requests']); qc.invalidateQueries(['admin-pending-count']); };

  const appMut = useMutation({
    mutationFn: (id)            => profileAPI.adminApprove(id),
    onSuccess: () => { toast.success('✅ Modifications appliquées'); inv(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });
  const rejMut = useMutation({
    mutationFn: ({ id, reason }) => profileAPI.adminReject(id, reason),
    onSuccess: () => { toast.success('Demande refusée'); inv(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });

  const busy   = appMut.isPending || rejMut.isPending;
  const reqs   = data?.data || [];
  const pending = countData?.count ?? 0;

  const filters = [
    { id:'pending',  label:`⏳ En attente${pending>0?` (${pending})`:''}` },
    { id:'approved', label:'✅ Approuvées' },
    { id:'rejected', label:'❌ Refusées' },
    { id:'all',      label:'📋 Toutes' },
  ];

  return (
    <div>
      {/* En-tête */}
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:'var(--space-6)' }}>
        <div style={{ background:'linear-gradient(135deg,#1B4FCA,#6366F1)', borderRadius:12, padding:12, display:'flex' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <div>
          <h1 className="page-title" style={{ marginBottom:0 }}>
            Demandes de modification de profil
            {pending>0 && (
              <span style={{ background:'var(--color-danger)', color:'#fff', borderRadius:20,
                padding:'2px 10px', fontSize:13, fontWeight:700, marginLeft:12, verticalAlign:'middle' }}>
                {pending}
              </span>
            )}
          </h1>
          <p className="page-subtitle">Approuvez ou refusez les demandes de modification d'informations</p>
        </div>
      </div>

      {/* Filtres */}
      <div style={{ display:'flex', gap:4, background:'var(--bg-elevated)', borderRadius:10, padding:4,
        marginBottom:'var(--space-6)', width:'fit-content' }}>
        {filters.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding:'8px 16px', borderRadius:8, border:'none', cursor:'pointer',
            fontWeight:600, fontSize:'var(--font-sm)', fontFamily:'inherit', whiteSpace:'nowrap',
            background: filter===f.id ? 'var(--color-primary)' : 'transparent',
            color: filter===f.id ? '#fff' : 'var(--text-secondary)', transition:'all 0.2s',
          }}>{f.label}</button>
        ))}
      </div>

      {/* Liste */}
      {isLoading ? (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height:80, borderRadius:12 }} />)}
        </div>
      ) : reqs.length === 0 ? (
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border-subtle)',
          borderRadius:16, padding:60, textAlign:'center' }}>
          <p style={{ fontSize:48, marginBottom:14 }}>✅</p>
          <p style={{ fontWeight:700, color:'var(--text-primary)' }}>
            {filter==='pending' ? 'Aucune demande en attente' : 'Aucune demande'}
          </p>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {reqs.map(req => (
            <RequestCard key={req.id} req={req} busy={busy}
              onApprove={id => appMut.mutate(id)}
              onReject={(id, reason) => rejMut.mutate({ id, reason })} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Journal de service (Lot 4) — fil chronologique des événements d'un service.
 *
 * Les absences et retards apparaissent ici mais ne s'y saisissent pas : ils sont
 * écrits par le module de signalement d'absence, qui applique la règle « garde
 * courante uniquement ». Le composeur n'offre donc que présence, remarque,
 * incident et demande de renfort.
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { journalAPI } from '../../../api';

const TYPE_META = {
  presence:      { label: 'Présence',   emoji: '✅', color: '#10B981' },
  absence:       { label: 'Absence',    emoji: '🚫', color: '#EF4444' },
  late:          { label: 'Retard',     emoji: '⏰', color: '#F59E0B' },
  incident:      { label: 'Incident',   emoji: '⚠️', color: '#DC2626' },
  remark:        { label: 'Remarque',   emoji: '💬', color: '#6366F1' },
  reinforcement: { label: 'Renfort',    emoji: '🆘', color: '#EC4899' },
};

/** Seuls ces types sont saisissables à la main — miroir de MANUAL_EVENT_TYPES côté serveur. */
const COMPOSABLE = ['remark', 'presence', 'incident', 'reinforcement'];

const SEVERITIES = [
  { value: 'info',     label: 'Information' },
  { value: 'warning',  label: 'Avertissement' },
  { value: 'error',    label: 'Grave' },
  { value: 'critical', label: 'Critique' },
];

const FILTERS = [
  { value: '',              label: 'Tout' },
  { value: 'incident',      label: 'Incidents' },
  { value: 'absence',       label: 'Absences' },
  { value: 'late',          label: 'Retards' },
  { value: 'remark',        label: 'Remarques' },
  { value: 'reinforcement', label: 'Renforts' },
];

export default function ServiceJournalPanel({ departmentId, canWrite = false, title = 'Journal de service' }) {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState('');
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ eventType: 'remark', title: '', description: '', severity: 'info' });

  const params = useMemo(() => {
    const p = { limit: 100 };
    if (typeFilter) p.type = typeFilter;
    if (departmentId) p.departmentId = departmentId;
    return p;
  }, [typeFilter, departmentId]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['journal', params],
    queryFn: () => journalAPI.getEvents(params),
  });

  const addEvent = useMutation({
    mutationFn: (payload) => journalAPI.addEvent(payload),
    onSuccess: () => {
      toast.success('Événement enregistré');
      setForm({ eventType: 'remark', title: '', description: '', severity: 'info' });
      setComposing(false);
      qc.invalidateQueries({ queryKey: ['journal'] });
      qc.invalidateQueries({ queryKey: ['journal-overview'] });
      qc.invalidateQueries({ queryKey: ['journal-alerts'] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Enregistrement impossible'),
  });

  const payload = data?.data?.data;
  const events = payload?.events || [];
  const isForbidden = error?.response?.status === 403;

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error('Le titre est obligatoire'); return; }
    if (!departmentId) { toast.error('Aucun service sélectionné'); return; }
    addEvent.mutate({ ...form, title: form.title.trim(), departmentId });
  };

  // Regroupement par jour : le journal se lit par journée de service.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const ev of events) {
      if (!map.has(ev.date)) map.set(ev.date, []);
      map.get(ev.date).push(ev);
    }
    return Array.from(map.entries());
  }, [events]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
            Traçabilité des événements — les entrées ne sont pas modifiables
          </p>
        </div>
        {canWrite && (
          <button onClick={() => setComposing((v) => !v)} className={composing ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}>
            {composing ? 'Annuler' : '✍️ Nouvelle entrée'}
          </button>
        )}
      </div>

      {composing && canWrite && (
        <form onSubmit={submit} style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--border-radius-lg)', padding: 16,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              value={form.eventType}
              onChange={(e) => setForm((f) => ({ ...f, eventType: e.target.value }))}
              className="input"
              style={{ maxWidth: 200, fontSize: 'var(--font-xs)' }}
            >
              {COMPOSABLE.map((t) => (
                <option key={t} value={t}>{TYPE_META[t].emoji} {TYPE_META[t].label}</option>
              ))}
            </select>
            <select
              value={form.severity}
              onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
              className="input"
              style={{ maxWidth: 180, fontSize: 'var(--font-xs)' }}
            >
              {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <input
            className="input"
            placeholder="Titre de l'événement"
            value={form.title}
            maxLength={255}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <textarea
            className="input"
            placeholder="Description (facultative)"
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
          <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Pour signaler une absence ou un retard, utilisez l'onglet dédié : la règle « garde courante » y est appliquée.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={addEvent.isPending}>
              {addEvent.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setTypeFilter(f.value)}
            className={typeFilter === f.value ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isForbidden ? (
        <div style={{
          padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          Le journal n'est pas accessible avec votre rôle.
        </div>
      ) : isError ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-danger)', fontSize: 'var(--font-sm)' }}>
          Le journal n'a pas pu être chargé.
        </div>
      ) : isLoading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
          Chargement du journal…
        </div>
      ) : events.length === 0 ? (
        <div style={{
          padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          📓 Aucun événement enregistré
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {grouped.map(([date, dayEvents]) => (
            <div key={date}>
              <p style={{
                fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6,
              }}>
                {date} · {dayEvents.length} événement(s)
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dayEvents.map((ev) => {
                  const meta = TYPE_META[ev.type] || { label: ev.type, emoji: '•', color: 'var(--text-muted)' };
                  return (
                    <div key={ev.id} style={{
                      display: 'flex', gap: 10, alignItems: 'flex-start',
                      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                      borderLeft: `3px solid ${meta.color}`,
                      borderRadius: 'var(--border-radius-sm)', padding: '10px 12px',
                    }}>
                      <span style={{ fontSize: 16, lineHeight: 1.2 }}>{meta.emoji}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {ev.title}
                          </span>
                          <span style={{
                            fontSize: 9, fontWeight: 700, color: meta.color,
                            border: `1px solid ${meta.color}`, borderRadius: 6, padding: '1px 6px',
                          }}>
                            {meta.label}
                          </span>
                          {ev.severity && ev.severity !== 'info' && (
                            <span style={{ fontSize: 9, color: 'var(--color-warning)', fontWeight: 700 }}>
                              {ev.severity}
                            </span>
                          )}
                        </div>
                        {ev.description && (
                          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', marginTop: 3 }}>
                            {ev.description}
                          </p>
                        )}
                        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                          {ev.hour}
                          {ev.userName ? ` · concerne ${ev.userName}` : ''}
                          {ev.reporterName ? ` · saisi par ${ev.reporterName}` : ''}
                          {ev.departmentName ? ` · ${ev.departmentName}` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Étape 1 — Équipe, ordre de relais et contraintes.
 *
 * Les congés sont affichés ici, AVANT la génération : le chef voit tout de suite
 * qui est indisponible et sur quelles dates. Le moteur les applique de son côté
 * (assistant-generator), l'affichage n'est qu'un rappel — jamais la source de
 * vérité. Cocher un agent en congé reste possible : il sera simplement écarté
 * des jours concernés, pas du planning entier.
 */
import { useMemo } from 'react';
import { Section, Btn, Field, input } from './ui';

const WEEKDAYS = [
  { value: 1, label: 'Lun' }, { value: 2, label: 'Mar' }, { value: 3, label: 'Mer' },
  { value: 4, label: 'Jeu' }, { value: 5, label: 'Ven' }, { value: 6, label: 'Sam' },
  { value: 0, label: 'Dim' },
];

const fmt = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '');

export default function StepTeam({
  staff, leaves, startDate, endDate,
  selected, setSelected, requirements, setRequirements,
}) {
  // Congés regroupés par agent, pour l'affichage en ligne du tableau.
  const leavesByUser = useMemo(() => {
    const map = new Map();
    (leaves || []).forEach((l) => {
      const key = l.userId || l.user_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(l);
    });
    return map;
  }, [leaves]);

  const isPicked = (id) => selected.some((s) => s.userId === id);
  const pickedOf = (id) => selected.find((s) => s.userId === id);

  const toggle = (member) => {
    if (isPicked(member.id)) {
      setSelected(selected.filter((s) => s.userId !== member.id));
      return;
    }
    setSelected([...selected, {
      userId: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      roleName: member.roleName,
      roleCode: member.roleCode,
      periodStart: startDate,
      periodEnd: endDate,
      maxShifts: null,
      excludedDays: [],
      // Garde à domicile (astreinte) — décochée par défaut : garde à l'hôpital.
      atHome: false,
    }]);
  };

  const patch = (userId, changes) =>
    setSelected(selected.map((s) => (s.userId === userId ? { ...s, ...changes } : s)));

  const move = (userId, delta) => {
    const i = selected.findIndex((s) => s.userId === userId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j], next[i]];
    setSelected(next);
  };

  const toggleDay = (userId, day) => {
    const cur = pickedOf(userId)?.excludedDays || [];
    patch(userId, { excludedDays: cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day] });
  };

  const req = (key, value) => setRequirements({ ...requirements, [key]: value });

  return (
    <>
      <Section
        title={`Équipe de garde — ${selected.length} agent(s) sélectionné(s)`}
        hint="L'ordre du tableau est l'ordre de relais : il pilote les modes « rotation » et « répartition par périodes », et sera enregistré avec le planning."
        right={
          <Btn variant="ghost" onClick={() => setSelected(
            selected.length === staff.length ? [] : staff.map((m, i) => ({
              userId: m.id, firstName: m.firstName, lastName: m.lastName,
              roleName: m.roleName, roleCode: m.roleCode,
              periodStart: startDate, periodEnd: endDate,
              maxShifts: null, excludedDays: [], atHome: false, position: i,
            }))
          )}>
            {selected.length === staff.length ? 'Tout décocher' : 'Tout sélectionner'}
          </Btn>
        }
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--gs-ink-faint)' }}>
                <th style={{ padding: '6px 8px', width: 34 }}></th>
                <th style={{ padding: '6px 8px' }}>Agent</th>
                <th style={{ padding: '6px 8px' }}>Disponibilité</th>
                <th style={{ padding: '6px 8px', width: 150 }}>Période</th>
                <th style={{ padding: '6px 8px', width: 80 }}>Max gardes</th>
                <th style={{ padding: '6px 8px', width: 92 }} title="Cochée : l'agent assure sa garde à domicile (astreinte). Décochée (par défaut) : garde à l'hôpital, en présence.">Domicile</th>
                <th style={{ padding: '6px 8px' }}>Jours exclus</th>
                <th style={{ padding: '6px 8px', width: 70 }}>Ordre</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((m) => {
                const picked = isPicked(m.id);
                const row = pickedOf(m.id);
                const myLeaves = leavesByUser.get(m.id) || [];
                return (
                  <tr key={m.id} style={{ borderTop: '1px solid var(--gs-rule)', opacity: picked ? 1 : 0.65 }}>
                    <td style={{ padding: '8px' }}>
                      <input type="checkbox" checked={picked} onChange={() => toggle(m)} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <div style={{ fontWeight: 700, color: 'var(--gs-ink)' }}>{m.firstName} {m.lastName}</div>
                      <div style={{ fontSize: 11, color: 'var(--gs-ink-faint)' }}>{m.roleName}</div>
                    </td>
                    <td style={{ padding: '8px' }}>
                      {myLeaves.length === 0 ? (
                        <span style={{ fontSize: 11.5, color: 'var(--gs-duty)', fontWeight: 700 }}>Disponible</span>
                      ) : (
                        myLeaves.map((l, i) => (
                          <div key={i} style={{ fontSize: 11, color: 'var(--gs-alert)', fontWeight: 600 }}>
                            {l.typeName || 'Congé'} · {fmt(l.startDate || l.start_date)} → {fmt(l.endDate || l.end_date)}
                          </div>
                        ))
                      )}
                    </td>
                    <td style={{ padding: '8px' }}>
                      {picked && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input type="date" style={{ ...input, padding: '4px 6px', fontSize: 11 }}
                            value={row.periodStart || ''} min={startDate} max={endDate}
                            onChange={(e) => patch(m.id, { periodStart: e.target.value })} />
                          <input type="date" style={{ ...input, padding: '4px 6px', fontSize: 11 }}
                            value={row.periodEnd || ''} min={startDate} max={endDate}
                            onChange={(e) => patch(m.id, { periodEnd: e.target.value })} />
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px' }}>
                      {picked && (
                        <input type="number" min="0" placeholder="—"
                          style={{ ...input, padding: '4px 6px', fontSize: 11 }}
                          value={row.maxShifts ?? ''}
                          onChange={(e) => patch(m.id, { maxShifts: e.target.value === '' ? null : Number(e.target.value) })} />
                      )}
                    </td>
                    <td style={{ padding: '8px' }}>
                      {picked && (
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, fontWeight: 700, color: row.atHome === true ? 'var(--gs-id-7)' : 'var(--gs-ink-faint)' }}
                          title={row.atHome === true
                            ? 'Garde à domicile (astreinte) — décochez pour une garde à l’hôpital'
                            : 'Garde à l’hôpital, en présence — cochez pour une garde à domicile'}>
                          <input type="checkbox" checked={row.atHome === true}
                            onChange={(e) => patch(m.id, { atHome: e.target.checked })}
                            style={{ cursor: 'pointer', accentColor: 'var(--gs-id-7)', margin: 0 }} />
                          {row.atHome === true ? 'Oui' : 'Non'}
                        </label>
                      )}
                    </td>
                    <td style={{ padding: '8px' }}>
                      {picked && (
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                          {WEEKDAYS.map((d) => {
                            const off = (row.excludedDays || []).includes(d.value);
                            return (
                              <span key={d.value} onClick={() => toggleDay(m.id, d.value)}
                                style={{
                                  padding: '2px 6px', borderRadius: 6, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                                  background: off ? 'var(--gs-alert-wash)' : 'var(--gs-rule)',
                                  color: off ? 'var(--gs-alert-strong)' : 'var(--gs-ink-faint)',
                                  textDecoration: off ? 'line-through' : 'none',
                                }}>
                                {d.label}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px' }}>
                      {picked && (
                        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                          <span onClick={() => move(m.id, -1)} style={{ cursor: 'pointer', fontSize: 13 }} title="Monter">▲</span>
                          <span onClick={() => move(m.id, 1)} style={{ cursor: 'pointer', fontSize: 13 }} title="Descendre">▼</span>
                          <span style={{ fontSize: 11, color: 'var(--gs-ink-faint)', fontWeight: 700 }}>
                            {selected.findIndex((s) => s.userId === m.id) + 1}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {staff.length === 0 && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--gs-ink-faint)', fontSize: 13 }}>
            Aucun personnel actif dans ce service.
          </div>
        )}
      </Section>

      <Section title="Contraintes du service" hint="Elles servent à la fois à la génération et au contrôle : une grille qui les enfreint est signalée avant l'envoi.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
          <Field label="Agents par jour (minimum)">
            <input type="number" min="0" style={input}
              value={requirements.minPerDay ?? 1}
              onChange={(e) => req('minPerDay', Number(e.target.value))} />
          </Field>
          <Field label="Gardes max par agent">
            <input type="number" min="0" placeholder="illimité" style={input}
              value={requirements.maxPerPeriod ?? ''}
              onChange={(e) => req('maxPerPeriod', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
          <Field label="Gardes max par semaine">
            <input type="number" min="0" placeholder="illimité" style={input}
              value={requirements.maxPerWeek ?? ''}
              onChange={(e) => req('maxPerWeek', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
          <Field label="Repos minimum (heures)">
            <input type="number" min="0" step="12" placeholder="0" style={input}
              value={requirements.minRestHours ?? ''}
              onChange={(e) => req('minRestHours', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
          <Field label="Seniors requis par jour">
            <input type="number" min="0" style={input}
              value={requirements.seniorCount ?? 0}
              onChange={(e) => req('seniorCount', Number(e.target.value))} />
          </Field>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!requirements.noConsecutiveShifts}
            onChange={(e) => req('noConsecutiveShifts', e.target.checked)} />
          <span style={{ color: 'var(--gs-ink)', fontWeight: 600 }}>Interdire deux gardes consécutives</span>
        </label>
      </Section>
    </>
  );
}

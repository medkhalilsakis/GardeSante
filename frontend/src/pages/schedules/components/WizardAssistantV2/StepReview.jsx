/**
 * Étape 3 — Relecture, édition et validation.
 *
 * La proposition est modifiable AVANT envoi : chaque case se clique pour poser
 * ou retirer une garde (J → N → S → G → vide). Toute édition invalide le résultat
 * de validation affiché : on repasse par le serveur, seul juge, plutôt que de
 * recalculer côté client une vérité approximative.
 *
 * Les anomalies portent leur correction (`fix`) : le bouton la renvoie telle
 * quelle au serveur, qui sait l'exécuter. Rien n'est corrigé dans le navigateur.
 */
import { Section, Btn, Metric, SEVERITY_COLOR } from './ui';

const CODES = ['J', 'N', 'S', 'G'];
const CODE_COLOR = { J: '#0891B2', N: '#6366F1', S: '#D97706', G: '#059669' };

const dayLabel = (d) => {
  const date = new Date(`${d}T12:00:00`);
  return { num: date.getDate(), dow: ['D', 'L', 'M', 'M', 'J', 'V', 'S'][date.getDay()], weekend: [0, 6].includes(date.getDay()) };
};

export default function StepReview({
  rows, days, metrics, notes, validation, dirty,
  onToggleCell, onRevalidate, onApplyFix, onApplyAll, busy,
}) {
  const anomalies = validation?.anomalies || [];
  const counts = validation?.counts || {};
  const fixable = anomalies.filter((a) => a.fix);

  const next = (code) => {
    if (!code) return CODES[0];
    const i = CODES.indexOf(code);
    return i === -1 || i === CODES.length - 1 ? null : CODES[i + 1];
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Metric label="Gardes posées" value={metrics?.totalShifts ?? 0} />
        <Metric label="Couverture" value={metrics?.coveragePct ?? 0} suffix="%"
          tone={(metrics?.coveragePct ?? 0) >= 100 ? '#059669' : '#D97706'} />
        <Metric label="Équité" value={metrics?.equityScore ?? 0} suffix="/100"
          tone={(metrics?.equityScore ?? 0) >= 80 ? '#059669' : '#D97706'} />
        <Metric label="Min / max par agent" value={`${metrics?.minPerAgent ?? 0} / ${metrics?.maxPerAgent ?? 0}`} />
        <Metric label="Anomalies bloquantes" value={counts.errors ?? 0}
          tone={counts.errors ? '#DC2626' : '#059669'} />
      </div>

      {(notes || []).length > 0 && (
        <div style={{
          padding: '10px 14px', borderRadius: 12, marginBottom: 16,
          background: 'rgba(8,145,178,.08)', border: '1px solid rgba(8,145,178,.25)',
          fontSize: 12.5, color: 'var(--text-primary)',
        }}>
          {notes.map((n, i) => <div key={i}>• {n}</div>)}
        </div>
      )}

      {dirty && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px', borderRadius: 12, marginBottom: 16,
          background: 'rgba(217,119,6,.09)', border: '1px solid rgba(217,119,6,.3)',
        }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-primary)', flex: 1 }}>
            La grille a été modifiée : le contrôle affiché n'est plus à jour.
          </span>
          <Btn onClick={onRevalidate} disabled={busy}>Revérifier</Btn>
        </div>
      )}

      <Section
        title="Proposition — cliquez une case pour modifier"
        hint="J = Jour · N = Nuit · S = Soir · G = Garde. Un nouveau clic sur « G » libère la case."
        right={
          fixable.length > 0 ? (
            <Btn variant="ghost" onClick={onApplyAll} disabled={busy}>
              Corriger tout ({fixable.length})
            </Btn>
          ) : null
        }
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={{
                  position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 2,
                  padding: '6px 10px', textAlign: 'left', minWidth: 160,
                  borderBottom: '1px solid var(--border-subtle)',
                }}>
                  Agent
                </th>
                {days.map((d) => {
                  const { num, dow, weekend } = dayLabel(d);
                  return (
                    <th key={d} style={{
                      padding: '4px 0', minWidth: 26, textAlign: 'center',
                      borderBottom: '1px solid var(--border-subtle)',
                      background: weekend ? 'rgba(220,38,38,.06)' : 'transparent',
                      color: weekend ? '#DC2626' : 'var(--text-muted)',
                      fontWeight: 700,
                    }}>
                      <div style={{ fontSize: 9 }}>{dow}</div>
                      <div>{num}</div>
                    </th>
                  );
                })}
                <th style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>Tot.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId}>
                  <td style={{
                    position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 1,
                    padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)',
                  }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{row.firstName} {row.lastName}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{row.roleName}</div>
                  </td>
                  {days.map((d) => {
                    const code = row.shifts?.[d];
                    const outside = d < row.periodStart || d > row.periodEnd;
                    return (
                      <td key={d}
                        onClick={() => onToggleCell(row.userId, d, next(code))}
                        title={outside ? 'Hors période de présence de l\'agent' : ''}
                        style={{
                          textAlign: 'center', cursor: 'pointer', padding: 0, height: 26,
                          borderBottom: '1px solid var(--border-subtle)',
                          background: code ? CODE_COLOR[code] || 'var(--color-primary)' : outside ? 'rgba(120,120,120,.12)' : 'transparent',
                          color: code ? '#fff' : 'var(--text-muted)',
                          fontWeight: 800,
                        }}>
                        {code || ''}
                      </td>
                    );
                  })}
                  <td style={{
                    padding: '4px 8px', textAlign: 'center', fontWeight: 800,
                    color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)',
                  }}>
                    {Object.keys(row.shifts || {}).length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title={`Contrôle serveur — ${counts.total ?? 0} anomalie(s)`}
        hint="Les erreurs empêchent la création du planning ; les avertissements ne font que signaler."
      >
        {anomalies.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: '#059669', fontWeight: 700, fontSize: 13 }}>
            ✓ Aucune anomalie détectée — la proposition respecte les congés et les contraintes.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
            {anomalies.map((a) => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px',
                borderRadius: 10, borderLeft: `3px solid ${SEVERITY_COLOR[a.severity]}`,
                background: 'var(--bg-hover, rgba(120,120,120,.05))',
              }}>
                <span style={{ fontSize: 14 }}>{a.severity === 'error' ? '⛔' : '⚠️'}</span>
                <div style={{ flex: 1, fontSize: 12.5, color: 'var(--text-primary)' }}>{a.message}</div>
                {a.fix && (
                  <Btn variant="ghost" onClick={() => onApplyFix(a)} disabled={busy} style={{ padding: '5px 10px', fontSize: 11.5 }}>
                    {a.fixLabel || 'Corriger'}
                  </Btn>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

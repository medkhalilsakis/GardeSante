/**
 * Étape 3 — Relecture, édition et validation.
 *
 * La proposition est modifiable AVANT envoi : chaque case se clique pour placer
 * l'agent de service ce jour-là, ou l'en retirer. Il n'y a plus de code de garde,
 * donc plus de cycle de lettres : c'est une bascule. Toute édition invalide le
 * résultat de validation affiché : on repasse par le serveur, seul juge, plutôt
 * que de recalculer côté client une vérité approximative.
 *
 * Les anomalies portent leur correction (`fix`) : le bouton la renvoie telle
 * quelle au serveur, qui sait l'exécuter. Rien n'est corrigé dans le navigateur.
 */
import { AlertTriangle, Ban } from 'lucide-react';
import { Section, Btn, Metric, SEVERITY_COLOR } from './ui';

/* Être de service, c'est le service : le cyan d'origine ne disait rien de plus
   et ne s'inversait pas avec le thème. */
const DUTY_COLOR = 'var(--gs-duty)';
const DUTY_MARK = '●';

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

  // Une case est cochée ou vide. « R » n'a jamais désigné un service : c'est
  // l'ancien code Repos, encore présent dans quelques fichiers antérieurs.
  const isOnDuty = (value) => {
    if (value === true) return true;
    const text = String(value ?? '').trim();
    return text ? text.charAt(0).toUpperCase() !== 'R' : false;
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Metric label="Journées de service" value={metrics?.totalShifts ?? 0} />
        <Metric label="Couverture" value={metrics?.coveragePct ?? 0} suffix="%"
          tone={(metrics?.coveragePct ?? 0) >= 100 ? 'var(--gs-duty)' : 'var(--gs-alert)'} />
        <Metric label="Équité" value={metrics?.equityScore ?? 0} suffix="/100"
          tone={(metrics?.equityScore ?? 0) >= 80 ? 'var(--gs-duty)' : 'var(--gs-alert)'} />
        <Metric label="Min / max par agent" value={`${metrics?.minPerAgent ?? 0} / ${metrics?.maxPerAgent ?? 0}`} />
        <Metric label="Anomalies bloquantes" value={counts.errors ?? 0}
          tone={counts.errors ? 'var(--gs-alert-strong)' : 'var(--gs-duty)'} />
      </div>

      {(notes || []).length > 0 && (
        <div style={{
          padding: '10px 14px', borderRadius: 12, marginBottom: 16,
          background: 'var(--gs-seal-wash)', border: '1px solid color-mix(in srgb, var(--gs-seal) 25%, transparent)',
          fontSize: 12.5, color: 'var(--gs-ink)',
        }}>
          {notes.map((n, i) => <div key={i}>• {n}</div>)}
        </div>
      )}

      {dirty && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px', borderRadius: 12, marginBottom: 16,
          background: 'var(--gs-alert-wash)', border: '1px solid color-mix(in srgb, var(--gs-alert) 30%, transparent)',
        }}>
          <span style={{ fontSize: 12.5, color: 'var(--gs-ink)', flex: 1 }}>
            La grille a été modifiée : le contrôle affiché n'est plus à jour.
          </span>
          <Btn onClick={onRevalidate} disabled={busy}>Revérifier</Btn>
        </div>
      )}

      <Section
        title="Proposition — cliquez une case pour modifier"
        hint="Une case pleine = l'agent est de service ce jour-là. Un clic la coche, un autre la libère."
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
                  position: 'sticky', left: 0, background: 'var(--gs-paper)', zIndex: 2,
                  padding: '6px 10px', textAlign: 'left', minWidth: 160,
                  borderBottom: '1px solid var(--gs-rule)',
                }}>
                  Agent
                </th>
                {days.map((d) => {
                  const { num, dow, weekend } = dayLabel(d);
                  return (
                    <th key={d} style={{
                      padding: '4px 0', minWidth: 26, textAlign: 'center',
                      borderBottom: '1px solid var(--gs-rule)',
                      background: weekend ? 'var(--gs-paper-alt)' : 'transparent',
                      color: weekend ? 'var(--gs-ink)' : 'var(--gs-ink-faint)',
                      fontWeight: 700,
                    }}>
                      <div style={{ fontSize: 9 }}>{dow}</div>
                      <div>{num}</div>
                    </th>
                  );
                })}
                <th style={{ padding: '4px 8px', borderBottom: '1px solid var(--gs-rule)', color: 'var(--gs-ink-faint)' }}>Tot.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId}>
                  <td style={{
                    position: 'sticky', left: 0, background: 'var(--gs-paper)', zIndex: 1,
                    padding: '6px 10px', borderBottom: '1px solid var(--gs-rule)',
                  }}>
                    <div style={{ fontWeight: 700, color: 'var(--gs-ink)' }}>{row.firstName} {row.lastName}</div>
                    <div style={{ fontSize: 10, color: 'var(--gs-ink-faint)' }}>{row.roleName}</div>
                  </td>
                  {days.map((d) => {
                    const onDuty = isOnDuty(row.shifts?.[d]);
                    const outside = d < row.periodStart || d > row.periodEnd;
                    return (
                      <td key={d}
                        onClick={() => onToggleCell(row.userId, d, !onDuty)}
                        title={outside
                          ? 'Hors période de présence de l\'agent'
                          : onDuty ? 'De service — cliquer pour retirer' : 'Pas de service — cliquer pour placer de service'}
                        style={{
                          textAlign: 'center', cursor: 'pointer', padding: 0, height: 26,
                          borderBottom: '1px solid var(--gs-rule)',
                          background: onDuty ? DUTY_COLOR : outside ? 'color-mix(in srgb, var(--gs-ink) 12%, transparent)' : 'transparent',
                          color: onDuty ? 'var(--gs-on-tone)' : 'var(--gs-ink-faint)',
                          fontWeight: 800,
                        }}>
                        {onDuty ? DUTY_MARK : ''}
                      </td>
                    );
                  })}
                  <td style={{
                    padding: '4px 8px', textAlign: 'center', fontWeight: 800,
                    color: 'var(--gs-ink)', borderBottom: '1px solid var(--gs-rule)',
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
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--gs-duty)', fontWeight: 700, fontSize: 13 }}>
            Aucune anomalie détectée — la proposition respecte les congés et les contraintes.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
            {anomalies.map((a) => (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px',
                borderRadius: 10, borderLeft: `3px solid ${SEVERITY_COLOR[a.severity]}`,
                background: 'var(--gs-paper-alt)',
              }}>
                {a.severity === 'error'
                  ? <Ban size={15} style={{ flexShrink: 0, color: SEVERITY_COLOR.error }} />
                  : <AlertTriangle size={15} style={{ flexShrink: 0, color: SEVERITY_COLOR.warning }} />}
                <div style={{ flex: 1, fontSize: 12.5, color: 'var(--gs-ink)' }}>{a.message}</div>
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

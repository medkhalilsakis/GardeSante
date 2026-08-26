/**
 * Étape 2 — Choix du mode de génération et brief réutilisable.
 *
 * Les cinq modes viennent du serveur (`context.modes`, dérivé de `MODES` dans
 * assistant-generator.js) : la liste ne peut pas se désynchroniser du moteur.
 * Les descriptions ci-dessous sont locales, purement explicatives.
 */
import { useState } from 'react';
import { CalendarRange, PenLine, RefreshCw, Scale, Users, X } from 'lucide-react';
import { Section, Btn, Field, input, card } from './ui';

/* Les icônes viennent de la même bibliothèque que le reste de la plateforme :
   les émoji d'origine ne s'affichaient pas deux fois pareil d'un poste à
   l'autre, et « 🅰️🅱️ » se rendait en deux carrés vides sur la moitié des
   machines du service. */
const DESC = {
  manual: {
    Icon: PenLine,
    text: 'Grille vierge, prête à remplir : périodes de présence et congés déjà connus, aucune garde posée.',
    good: 'Vous savez exactement qui va où.',
  },
  rotation: {
    Icon: RefreshCw,
    text: 'Chacun son tour, dans l\'ordre de relais défini à l\'étape précédente, en repartant du moins chargé.',
    good: 'Équipe homogène, gardes interchangeables.',
  },
  ab_rotation: {
    Icon: Users,
    text: 'Deux équipes qui alternent par semaine. La première moitié de la liste forme l\'équipe A, la seconde l\'équipe B.',
    good: 'Organisation en binômes ou demi-services.',
  },
  periods: {
    Icon: CalendarRange,
    text: 'Chaque agent couvre sa fenêtre de présence, dans l\'ordre de relais : « X les deux premières semaines, puis Y ».',
    good: 'Résidents qui tournent par quinzaine.',
  },
  balanced: {
    Icon: Scale,
    text: 'À chaque jour, le moins chargé est désigné — senior en premier si le service en exige un. Minimise l\'écart de charge.',
    good: 'Objectif d\'équité avant tout.',
  },
};

export default function StepMode({
  modes, mode, setMode, briefs, onSaveBrief, onUseBrief, onDeleteBrief, saving,
}) {
  const [briefName, setBriefName] = useState('');

  const save = () => {
    if (!briefName.trim()) return;
    onSaveBrief(briefName.trim());
    setBriefName('');
  };

  return (
    <>
      <Section title="Mode de génération" hint="Le mode décide comment les gardes sont réparties. Les congés et les contraintes sont respectés dans tous les cas.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 14 }}>
          {(modes || []).map((m) => {
            const meta = DESC[m.id] || {};
            const active = mode === m.id;
            return (
              <div key={m.id} onClick={() => setMode(m.id)}
                style={{
                  ...card,
                  cursor: 'pointer',
                  borderColor: active ? 'var(--gs-seal)' : 'var(--gs-rule)',
                  borderWidth: active ? 2 : 1,
                  background: active ? 'var(--gs-seal-wash)' : 'var(--gs-paper)',
                }}>
                <div style={{ marginBottom: 8, color: active ? 'var(--gs-seal)' : 'var(--gs-ink-faint)' }}>
                  {meta.Icon ? <meta.Icon size={22} strokeWidth={1.75} /> : null}
                </div>
                <div style={{ fontFamily: 'var(--gs-display)', fontWeight: 700, letterSpacing: '-.015em', fontSize: 14, color: 'var(--gs-ink)', marginBottom: 6 }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--gs-ink-faint)', lineHeight: 1.45 }}>{meta.text}</div>
                {meta.good && (
                  <div style={{ fontSize: 11, color: 'var(--gs-seal)', marginTop: 8, fontWeight: 700 }}>
                    → {meta.good}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        title="Briefs réutilisables"
        hint="Un brief enregistre l'équipe, l'ordre, les contraintes et le mode — jamais les gardes. Le rejouer le mois suivant relit toujours les congés du moment."
      >
        {(briefs || []).length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {briefs.map((b) => (
              <div key={b.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                borderRadius: 10, border: '1px solid var(--gs-rule)',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--gs-ink)' }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--gs-ink-faint)' }}>
                    {b.mode} · utilisé {b.timesUsed || 0} fois
                    {b.lastUsedAt ? ` · dernier usage ${b.lastUsedAt}` : ''}
                  </div>
                </div>
                <Btn variant="ghost" onClick={() => onUseBrief(b)} style={{ padding: '6px 12px' }}>Charger</Btn>
                <Btn variant="ghost" onClick={() => onDeleteBrief(b)} title="Supprimer ce brief" style={{ padding: '6px 10px', color: 'var(--gs-alert-strong)' }}>
                  <X size={14} strokeWidth={2.5} />
                </Btn>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--gs-ink-faint)', marginBottom: 14 }}>
            Aucun brief enregistré pour ce service.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <Field label="Enregistrer la configuration actuelle" width="100%">
            <input style={input} placeholder="ex. Rotation résidents — mois type"
              value={briefName} onChange={(e) => setBriefName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()} />
          </Field>
          <Btn onClick={save} disabled={!briefName.trim() || saving}>Enregistrer</Btn>
        </div>
      </Section>
    </>
  );
}

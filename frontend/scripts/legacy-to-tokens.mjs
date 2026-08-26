/**
 * Traduction de la couche héritée vers les jetons `--gs-*`.
 *
 * La refonte s'est faite écran par écran, et chaque écran refondu a cessé de
 * lire `--text-*` / `--bg-*` / `--color-*` pour lire les jetons. Restaient les
 * fichiers jamais rouverts : ils n'avaient aucun hexadécimal — donc l'audit des
 * couleurs codées en dur ne les voyait pas — mais toutes leurs couleurs
 * venaient de la couche héritée, qui ne s'inverse pas de la même façon.
 *
 * Ce script ne fait que renommer. Il ne touche ni la structure, ni la
 * géométrie (`--space-*`, `--border-radius-*`, `--font-*` restent), ni les
 * valeurs déjà correctes en thème sombre (`--bg-overlay`, `--scrollbar-*`).
 *
 * Usage :  node scripts/legacy-to-tokens.mjs <fichier…>
 *          node scripts/legacy-to-tokens.mjs --dry <fichier…>
 */
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Du plus long au plus court : `--color-primary-20` doit être traduit avant
 * `--color-primary`, sinon il resterait un `--gs-seal-20` qui n'existe pas.
 */
const MAP = [
  // Encre
  ['--color-text-primary', 'var(--gs-ink)'],
  ['--text-primary', 'var(--gs-ink)'],
  ['--text-secondary', 'var(--gs-ink-soft)'],
  ['--text-muted', 'var(--gs-ink-faint)'],
  ['--text-disabled', 'var(--gs-ink-faint)'],
  ['--text-h', 'var(--gs-ink)'],

  // Le sceau et ses dilutions
  ['--color-primary-20', 'color-mix(in srgb, var(--gs-seal) 20%, transparent)'],
  ['--color-primary-10', 'var(--gs-seal-wash)'],
  ['--color-primary-light', 'color-mix(in srgb, var(--gs-seal) 55%, var(--gs-paper))'],
  ['--color-primary-soft', 'var(--gs-seal-wash)'],
  ['--color-primary', 'var(--gs-seal)'],
  ['--border-primary', 'var(--gs-seal)'],
  ['--color-info', 'var(--gs-seal)'],
  // Le cyan « secondaire » ne disait aucun état : il devient le sceau.
  ['--color-secondary', 'var(--gs-seal)'],

  // Le service
  ['--color-success-20', 'color-mix(in srgb, var(--gs-duty) 22%, transparent)'],
  ['--color-success-10', 'var(--gs-duty-wash)'],
  ['--color-success', 'var(--gs-duty)'],

  // L'alerte, à deux degrés : l'avertissement et ce qui est déjà fautif.
  ['--color-warning-10', 'var(--gs-alert-wash)'],
  ['--color-warning', 'var(--gs-alert)'],
  ['--color-danger-10', 'var(--gs-alert-wash)'],
  ['--color-danger', 'var(--gs-alert-strong)'],
  ['--color-error', 'var(--gs-alert-strong)'],

  // Papier
  ['--bg-card-hover', 'var(--gs-paper-alt)'],
  ['--bg-card', 'var(--gs-paper)'],
  ['--bg-elevated', 'var(--gs-paper-alt)'],
  ['--bg-input', 'var(--gs-paper-alt)'],
  ['--bg-surface', 'var(--gs-paper-alt)'],
  ['--bg-subtle', 'var(--gs-paper-alt)'],
  ['--bg-hover', 'var(--gs-paper-alt)'],
  ['--bg-header', 'var(--gs-paper)'],
  ['--bg-sidebar', 'var(--gs-paper)'],
  ['--bg-base', 'var(--gs-paper-alt)'],
  ['--color-surface', 'var(--gs-paper)'],

  // Filets
  ['--border-subtle', 'var(--gs-rule)'],
  ['--border-default', 'var(--gs-rule)'],
  ['--border-strong', 'var(--gs-rule-strong)'],
  ['--color-border', 'var(--gs-rule)'],

  // Ombres — deux niveaux suffisent : posé et soulevé.
  ['--shadow-sm', 'var(--gs-shadow-card)'],
  ['--shadow-md', 'var(--gs-shadow-lift)'],
  ['--shadow-lg', 'var(--gs-shadow-lift)'],
  ['--shadow-xl', 'var(--gs-shadow-lift)'],
];

const dry = process.argv.includes('--dry');
const files = process.argv.slice(2).filter((a) => a !== '--dry');

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let after = before;

  for (const [legacy, token] of MAP) {
    // `var(--x)` devient la valeur cible ; `var(--x, repli)` perd son repli,
    // qui n'a plus de raison d'être puisque la cible est toujours définie.
    after = after.split(`var(${legacy})`).join(token);
    after = after.replace(
      new RegExp(`var\\(${legacy.replace(/-/g, '\\-')},\\s*[^()]*(?:\\([^()]*\\))?[^()]*\\)`, 'g'),
      token,
    );
  }

  const remaining = [...after.matchAll(/var\(--(?:text|bg|color|shadow)-[a-z0-9-]+|var\(--border-(?:default|subtle|strong|primary)/g)];
  const rings = [...after.matchAll(/outline\s*:\s*(?:none|0)\b/g)];
  const grads = [...after.matchAll(/linear-gradient|radial-gradient/g)];

  /* La traduction crée elle-même un défaut de lecture : un aplat qui valait
     `--color-primary`, figé et sombre, devient `--gs-seal`, qui se remonte en
     clarté en thème sombre. Le blanc posé dessus était juste avant, il ne l'est
     plus après. Le compte est signalé ici, et `white-to-on-tone.mjs` le corrige. */
  const whites = [...after.matchAll(/(?:^|;)\s*color\s*:\s*#(?:fff|ffffff)\b/gi)];

  const changed = after !== before;
  if (changed && !dry) writeFileSync(file, after);

  const notes = [];
  if (remaining.length) notes.push(`RESTE ${remaining.length}: ${[...new Set(remaining.map((m) => m[0].slice(4)))].join(' ')}`);
  if (whites.length) notes.push(`BLANC ${whites.length}`);
  if (rings.length) notes.push(`ANNEAU ${rings.length}`);
  if (grads.length) notes.push(`DÉGRADÉ ${grads.length}`);

  const label = changed ? (dry ? 'à traduire' : 'traduit  ') : 'inchangé ';
  console.log(`${label} ${file}${notes.length ? '  — ' + notes.join(' · ') : ''}`);
}

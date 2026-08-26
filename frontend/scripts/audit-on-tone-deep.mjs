/**
 * Relevé du texte blanc posé sur un fond qui change avec le thème.
 *
 * Le premier relevé comparait le fond au motif littéral `var(--gs-seal)` et
 * consorts. Il a donc rangé du côté « fond figé » tout écran qui se donne un
 * vocabulaire local — `--appel-green: var(--gs-duty)`, `--catchup-tone`, … —
 * alors que ces noms ne font que renvoyer à un jeton de thème et s'inversent
 * exactement comme lui. Ici on résout la chaîne de définitions jusqu'au bout
 * avant de conclure : un fond est dépendant du thème dès que sa résolution
 * mentionne un `--gs-*`, puisque tous ces jetons sont redéclarés en thème
 * sombre ou dérivés d'un jeton qui l'est.
 *
 * Usage :  node scripts/audit-on-tone-deep.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.css') ? [p] : [];
  });

const files = walk('src');

/* ── 1. Toutes les définitions de propriétés personnalisées du dépôt ────── */
const defs = new Map();
for (const file of files) {
  const css = readFileSync(file, 'utf8');
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+)/gi)) {
    const [, name, value] = m;
    if (!defs.has(name)) defs.set(name, value.trim());
  }
}

/* ── 2. Résolution transitive d'une expression de fond ─────────────────── */
const resolve = (expr, seen = new Set()) => {
  let out = expr;
  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false;
    out = out.replace(/var\((--[a-z0-9-]+)(?:\s*,[^()]*)?\)/gi, (whole, name) => {
      if (name.startsWith('--gs-') || seen.has(name) || !defs.has(name)) return whole;
      seen.add(name);
      changed = true;
      return defs.get(name);
    });
    if (!changed) break;
  }
  return out;
};

/* ── 3. Les blocs à texte blanc ────────────────────────────────────────── */
const WHITE = /(?:^|;)\s*color\s*:\s*#(?:fff|ffffff)\b/i;
const buckets = { theme: [], fixed: [], inherited: [] };

for (const file of files) {
  const css = readFileSync(file, 'utf8');
  const lines = css.split('\n');
  const lineOf = (i) => css.slice(0, i).split('\n').length;

  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [whole, sel, body] = m;
    if (!WHITE.test(body)) continue;
    const bg = body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i);
    const at = `${file}:${lineOf(m.index + whole.indexOf('#'))}`;
    const label = `${at}  ${sel.trim().split('\n').pop().trim().slice(0, 58)}`;
    if (!bg) {
      buckets.inherited.push(label);
      continue;
    }
    const solved = resolve(bg[1].trim());
    (solved.includes('--gs-') ? buckets.theme : buckets.fixed).push(
      `${label}\n      fond ${bg[1].trim()}${solved === bg[1].trim() ? '' : `  →  ${solved}`}`,
    );
  }
  void lines;
}

const show = (title, list) => {
  console.log(`\n── ${title} (${list.length})`);
  list.forEach((l) => console.log(`  ${l}`));
};
show('FOND DE THÈME → le blanc échoue en thème sombre', buckets.theme);
show('FOND FIGÉ → le blanc est correct', buckets.fixed);
show('FOND HÉRITÉ → à trancher à la main', buckets.inherited);

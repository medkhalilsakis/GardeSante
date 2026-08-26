/**
 * Substitution du texte blanc posé sur un aplat de teinte.
 *
 * Ne touche qu'un bloc dont le `background` déclaré dans le même bloc dépend du
 * thème. La première version comparait ce fond au motif littéral
 * `var(--gs-seal)` et consorts, et laissait donc passer tout écran qui se donne
 * un vocabulaire local — `--appel-green: var(--gs-duty)`, `--ss-blue`,
 * `--staff-color` pris dans les couleurs d'identité. Ces noms ne font que
 * renvoyer à un jeton de thème et s'inversent exactement comme lui. On résout
 * donc la chaîne de définitions jusqu'au bout, avec le même résolveur que
 * `audit-on-tone-deep.mjs`, pour que le relevé et l'écriture ne puissent pas
 * diverger.
 *
 * Les fonds réellement figés — un hexadécimal en dur, un jeton de l'ancienne
 * couche qui n'a pas de contrepartie sombre — sont laissés tels quels : le blanc
 * y est correct, et la substitution serait fausse.
 *
 * Usage :  node scripts/white-to-on-tone.mjs [--dry]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.css') ? [p] : [];
  });

const files = walk('src');

/* Toutes les définitions de propriétés personnalisées du dépôt. */
const defs = new Map();
for (const file of files) {
  for (const m of readFileSync(file, 'utf8').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+)/gi)) {
    if (!defs.has(m[1])) defs.set(m[1], m[2].trim());
  }
}

/* Un fond dépend du thème dès que sa résolution mentionne un `--gs-*` : tous
   ces jetons sont redéclarés en thème sombre, ou dérivés d'un qui l'est. */
const dependsOnTheme = (expr) => {
  let out = expr;
  const seen = new Set();
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
  return out.includes('--gs-');
};

const WHITE = /(^|;)(\s*)color(\s*):(\s*)#(?:fff|ffffff)\b/i;

const dry = process.argv.includes('--dry');
let touched = 0;
const log = [];

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let n = 0;

  const after = before.replace(/([^{}]+)\{([^{}]*)\}/g, (whole, sel, body) => {
    const bg = body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i);
    if (!bg || !dependsOnTheme(bg[1])) return whole;
    if (!WHITE.test(body)) return whole;
    n += 1;
    const fixed = body.replace(WHITE, (_, a, b, c, d) => `${a}${b}color${c}:${d}var(--gs-on-tone)`);
    return `${sel}{${fixed}}`;
  });

  if (n) {
    touched += n;
    log.push(`${dry ? 'à changer' : 'changé   '} ${String(n).padStart(2)}  ${file}`);
    if (!dry) writeFileSync(file, after);
  }
}

log.forEach((l) => console.log(l));
console.log(`\n${touched} blocs`);

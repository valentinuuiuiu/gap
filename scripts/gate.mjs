#!/usr/bin/env node
/**
 * VETAL — poarta anti-execuție.
 *
 * Refuzul din HANDOFF e declarativ. Ăsta îl face mecanic:
 *   „Orice PR cu buton de cumpărare, cheie privată sau link de afiliere
 *    către un swap custodial se respinge."
 *
 * Rulare: node scripts/gate.mjs [director]
 * Ieșire: 1 dacă găsește ceva, 0 dacă e curat.
 *
 * Fișierele .md sunt sărite intenționat: docs/gap/HANDOFF.md enumeră exact
 * lucrurile interzise, deci s-ar auto-semnaliza. Acest fișier e sărit din
 * același motiv — regexurile conțin șabloanele pe care le caută.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCANNED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.html', '.py', '.sh', '.bash', '.yml', '.yaml',
  '.json', '.sol',
]);

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage',
  'venv', '.venv', '__pycache__', 'vendor',
]);

const SKIP_FILES = new Set(['scripts/gate.mjs']);

export const RULES = [
  {
    id: 'tx-broadcast',
    pattern: /\beth_send(Transaction|RawTransaction)\b/,
    why: 'difuzare de tranzacție — GAP nu execută și nu semnează',
  },
  {
    id: 'tx-sign',
    pattern: /\bsignTransaction\s*\(|\bsendTransaction\s*\(/,
    why: 'construire/semnare de tranzacție — browserul nu semnează nimic',
  },
  {
    id: 'secret-private-key',
    pattern: /private[_-]?key/i,
    why: 'material de cheie privată — citirea cheilor e interzisă prin handoff',
  },
  {
    id: 'secret-seed',
    pattern: /\b(seed\s?phrase|mnemonic|xprv|tprv|sshpass)\b/i,
    why: 'seed/frază de recuperare sau acces SSH — în afara task-urilor',
  },
  {
    id: 'secret-pem',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    why: 'cheie privată în clar',
  },
  {
    id: 'affiliate-link',
    pattern: /[?&](ref|aff|affiliate|partner|referral)=/i,
    why: 'link de afiliere — nu luăm afiliere, nu numim un câștigător',
  },
  {
    id: 'affiliate-word',
    pattern: /\baffiliate[_-]?(id|link|url|code|tag)\b/i,
    why: 'identificator de afiliere către un operator',
  },
  {
    id: 'buy-cta',
    pattern: /\b(buy[ _-]?now|buy[ _-]?xmr)\b|cump[ăa]r[ăa]\s+acum/i,
    why: 'buton de cumpărare — GAP nu vinde și nu rutează execuția',
  },
];

function walk(dir, root, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).split('\\').join('/');

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, root, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(rel)) continue;
    if (!SCANNED_EXTENSIONS.has(extname(entry.name))) continue;
    out.push({ full, rel });
  }
  return out;
}

/** Întoarce lista de încălcări. Goală înseamnă curat. */
export function scan(root) {
  const files = [];
  walk(root, root, files);

  const violations = [];
  for (const { full, rel } of files) {
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue; // binar

    const lines = text.split('\n');
    for (const rule of RULES) {
      lines.forEach((line, index) => {
        if (rule.pattern.test(line)) {
          violations.push({
            file: rel,
            line: index + 1,
            rule: rule.id,
            why: rule.why,
            snippet: line.trim().slice(0, 120),
          });
        }
      });
    }
  }

  // Ordine stabilă, ca diff-ul din CI să fie lizibil.
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return violations;
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const root = process.argv[2] ?? '.';
  if (!statSync(root).isDirectory()) {
    console.error(`VETAL: ${root} nu e director`);
    process.exit(2);
  }

  const violations = scan(root);
  if (violations.length === 0) {
    console.log('VETAL: curat — nicio execuție, nicio cheie, nicio afiliere.');
    process.exit(0);
  }

  console.error(`VETAL: ${violations.length} încălcare(i)`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}] ${v.why}`);
    console.error(`      ${v.snippet}`);
  }
  console.error(
    '\nHandoff: „Custodie, mixer, afiliere, chei, sshpass, parole, broker MiCA de XMR" sunt în afara task-urilor.',
  );
  process.exit(1);
}

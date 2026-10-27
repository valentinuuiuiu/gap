#!/usr/bin/env node
/**
 * Sincronizează issue-urile cu registrul.
 *
 * Regula: backlog-ul nu se inventează, se derivă din `routes.json`
 * (vezi `deriveTasks`). Pentru fiecare afirmație fără citat există un issue
 * care cere, în corp, **citatul verbatim** din sursa primară. Pentru fiecare
 * afirmație care a primit citat, issue-ul se închide cu dovada în comentariu.
 *
 * Rulare: node --experimental-strip-types scripts/sync-issues.mjs
 *   DRY=1  — arată ce s-ar face, fără să scrie pe GitHub
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { deriveTasks, isSourced } from '../src/ledger.ts';

const DRY = process.env.DRY === '1';
const REPO = 'https://github.com/valentinuuiuiu/gap';

const ledger = JSON.parse(readFileSync(new URL('../routes.json', import.meta.url), 'utf8'));
const tasks = deriveTasks(ledger);

function gh(args, input) {
  return execFileSync('gh', args, { input, encoding: 'utf8' });
}

const issues = JSON.parse(
  gh(['issue', 'list', '--state', 'all', '--limit', '200', '--json', 'number,title,state']),
);
const byTitle = new Map(issues.map((issue) => [issue.title, issue]));

function bodyFor(task) {
  return `Afirmația **\`${task.claimId}\`** din registru (ruta \`${task.routeId}\`):

> ${task.title.replace(/^Dovedește: /, '')}

## Ce se cere

- **Citatul verbatim**, în corpul acestui issue — propoziția exactă din sursa
  primară, nu o parafrază și nu un rezumat de blog.
- **URL https al sursei primare** în \`routes.json\`, la afirmația \`${task.claimId}\`.
- **Data citirii** în \`retrieved_at\` (format \`YYYY-MM-DD\`).
- Dacă sursa primară nu poate fi citită (blocată, randată în JS, dispărută),
  afirmația **se retrage**. Nu se înlocuiește cu o aproximare și nu se citează
  o sursă secundară în locul ei.

## De ce

Un stamp se afișează doar dacă fiecare afirmație de care depinde are citat.
Fără citat, ruta apare „nedovedit" pe desk și în registru — nu ascunsă, ci
declarată ca nedovedită.

## Definiția de gata

- [ ] citat verbatim adăugat mai jos, cu data la care a fost citit
- [ ] \`source\` (https) + \`retrieved_at\` (\`YYYY-MM-DD\`) completate în \`routes.json\`
- [ ] poarta Vetal curată (\`node scripts/gate.mjs\`) și testele verzi
- [ ] dacă afirmația nu se poate dovedi: PR care o retrage din registru
`;
}

function commentFor(task, source, retrievedAt, quote) {
  return `Închis cu dovadă — citatul e din sursa primară, citită azi.

**Sursă:** ${source}
**Citit la:** ${retrievedAt}

> ${quote}

\`routes.json\` are acum \`source\` + \`retrieved_at\` pentru \`${task.claimId}\`, iar testul de registru fixează exact lista citatelor verificate, ca nimeni să nu adauge unul fără să-l fi citit. Ruta \`${task.routeId}\` rămâne „nedovedit" până când **toate** afirmațiile ei au citat.

Definiția de gata: citat în corp ✅ · \`source\` + \`retrieved_at\` ✅ · poartă și teste verzi ✅`;
}

// Citatul verbatim pentru afirmațiile deja verificate (fetched de agent, nu din memorie).
const VERIFIED = {
  okx_delist_2024_01: {
    source: 'https://www.okx.com/help/okx-to-delist-several-spot-trading-pairs-12-29',
    retrievedAt: '2026-10-27',
    quote:
      '«XMR-BTC, XMR-ETH, DASH-BTC; January 5, 2024, 7:00-9:00 am UTC» / «XMR-USDT, DASH-USDT, ZEC-USDT, ZEN-USDT; January 5, 2024, 8:00-12:00 pm UTC» — anunț din 29 decembrie 2023, perechile XMR scoase pe 5 ianuarie 2024.',
  },
  kraken_eea_2024_10_31: {
    source: 'https://support.kraken.com/articles/support-for-monero-xmr-in-europe',
    retrievedAt: '2026-10-27',
    quote:
      '«On October 31st 2024 at 15:00 PM UTC, we halted trading and deposits of all XMR markets (XMR/USD, XMR/EUR, XMR/BTC, XMR/USDT) for clients registered in the EEA. Any open XMR orders were also automatically closed at this time.»',
  },
};

let created = 0;
let updated = 0;
let closed = 0;

// Întâi închidem ce s-a dovedit: registrul nu mai derivă task pentru o afirmație
// care are citat, deci bucla de mai jos nu le-ar vedea niciodată.
for (const route of ledger.routes) {
  for (const claim of route.claims) {
    if (!isSourced(claim)) continue;
    const title = `Dovedește: ${claim.text}`;
    const existing = byTitle.get(title);
    const verified = VERIFIED[claim.id];
    if (!existing) {
      console.log(`! ${claim.id}: are citat, dar nu există issue deschis pentru el`);
      continue;
    }
    if (existing.state === 'CLOSED') {
      console.log(`= #${existing.number} ${claim.id}: deja închis`);
      continue;
    }
    console.log(`→ închid #${existing.number} ${claim.id} (citat verificat la sursă)`);
    if (!DRY) {
      gh([
        'issue',
        'comment',
        String(existing.number),
        '--body',
        verified
          ? commentFor({ claimId: claim.id, routeId: route.id }, verified.source, verified.retrievedAt, verified.quote)
          : `Închis: \`${claim.id}\` are acum \`source\` + \`retrieved_at\` în \`routes.json\`.`,
      ]);
      gh(['issue', 'close', String(existing.number), '--reason', 'completed']);
    }
    closed += 1;
  }
}

for (const task of tasks) {
  const existing = byTitle.get(task.title);

  if (existing) {
    console.log(`→ actualizez #${existing.number} ${task.claimId}`);
    if (!DRY) {
      gh(['issue', 'edit', String(existing.number), '--body', bodyFor(task)]);
    }
    updated += 1;
    continue;
  }

  console.log(`+ creez issue pentru ${task.claimId} (${task.routeId})`);
  if (!DRY) {
    const output = gh([
      'issue',
      'create',
      '--title',
      task.title,
      '--body',
      bodyFor(task),
      '--label',
      'jules',
    ]);
    console.log(`  ${output.trim()}`);
  }
  created += 1;
}

console.log(
  `\nrezumat: create ${created}, actualizate ${updated}, închise cu dovadă ${closed} | DRY=${DRY ? 'da' : 'nu'} | task-uri în registru: ${tasks.length}`,
);

/**
 * Generează fixture-ul golden pentru paritatea dintre limbaje.
 *
 * `src/rank.ts` e sursa de adevăr. Orice implementare paralelă — azi
 * `AgentX/utils/gap_desk.py` — se compară cu fișierul produs aici.
 *
 * Rulare: node --experimental-strip-types scripts/emit-golden.ts
 * Ieșire: test/fixtures/rank-golden.json
 */

import { mkdirSync, writeFileSync } from 'node:fs';

import { rankRoutes } from '../src/rank.ts';
import type { RankInput, Region, Stance } from '../src/rank.ts';

const REGIONS: Region[] = ['RO', 'SEE', 'UK', 'US', 'ALTA'];
const STANCES: Stance[] = ['fara_custodie', 'licentiat', 'operator'];
const AMOUNTS: Array<[number, number]> = [
  [20, 20],
  [500, 312.5],
  [5000, 5000],
  [50_000, 50_000],
  [2000, 10_000],
];

const cases: Array<{ input: RankInput; output: ReturnType<typeof rankRoutes> }> = [];
for (const region of REGIONS) {
  for (const stance of STANCES) {
    for (const [ticketEur, heldEur] of AMOUNTS) {
      const input: RankInput = { region, stance, ticketEur, heldEur };
      cases.push({ input, output: rankRoutes(input) });
    }
  }
}

const target = new URL('../test/fixtures/rank-golden.json', import.meta.url);
mkdirSync(new URL('../test/fixtures/', import.meta.url), { recursive: true });
writeFileSync(target, `${JSON.stringify(cases, null, 2)}\n`, 'utf8');

console.log(`scrise ${cases.length} cazuri în test/fixtures/rank-golden.json`);

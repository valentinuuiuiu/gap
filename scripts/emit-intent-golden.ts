/**
 * Generează fixture-ul golden pentru mașina de intenție.
 *
 * `src/intent.ts` e sursa de adevăr. Executorul din AgentX
 * (`AgentX/utils/gap_intent.py`) se compară cu fișierul produs aici — altfel
 * același bilet ar primi două trasee diferite în funcție de proces.
 *
 * Rulare: node --experimental-strip-types scripts/emit-intent-golden.ts
 * Ieșire: test/fixtures/intent-golden.json
 */

import { mkdirSync, writeFileSync } from 'node:fs';

import { applyEvent, createIntent, type Intent, type IntentEvent } from '../src/intent.ts';

const AT = '2026-10-27T16:00:00Z';

const ATTEST_SELLER: IntentEvent = {
  type: 'atestare',
  side: 'vanzator_xmr',
  proof: 'adresa semnată',
  at: AT,
};
const ATTEST_BUYER: IntentEvent = {
  type: 'atestare',
  side: 'cumparator_eur',
  proof: 'cont fiat semnat',
  at: AT,
};
const MATCH: IntentEvent = {
  type: 'potrivire',
  protocol: 'haveno-multisig',
  contraparte: 'peer-7f3',
  at: AT,
};
const HANDOFF: IntentEvent = { type: 'predare', protocol: 'haveno-multisig', at: AT };
const OBSERVED: IntentEvent = {
  type: 'observare',
  observed: true,
  evidence: 'lock-uri confirmate',
  at: AT,
};
const NOT_OBSERVED: IntentEvent = {
  type: 'observare',
  observed: false,
  evidence: 'niciun transfer pe lanț în fereastră',
  at: AT,
};

interface Scenario {
  name: string;
  ticketEur: number;
  events: IntentEvent[];
}

const SCENARIOS: Scenario[] = [
  { name: 'doar-intentie', ticketEur: 500, events: [] },
  { name: 'atestare-vanzator', ticketEur: 500, events: [ATTEST_SELLER] },
  { name: 'atestat-complet', ticketEur: 500, events: [ATTEST_SELLER, ATTEST_BUYER] },
  { name: 'potrivit', ticketEur: 500, events: [ATTEST_SELLER, ATTEST_BUYER, MATCH] },
  {
    name: 'predat',
    ticketEur: 500,
    events: [ATTEST_SELLER, ATTEST_BUYER, MATCH, HANDOFF],
  },
  {
    name: 'observat',
    ticketEur: 500,
    events: [ATTEST_SELLER, ATTEST_BUYER, MATCH, HANDOFF, OBSERVED],
  },
  {
    name: 'facturat',
    ticketEur: 500,
    events: [ATTEST_SELLER, ATTEST_BUYER, MATCH, HANDOFF, OBSERVED, { type: 'facturare', at: AT }],
  },
  {
    name: 'predare-cazuta',
    ticketEur: 500,
    events: [ATTEST_SELLER, ATTEST_BUYER, MATCH, HANDOFF, NOT_OBSERVED],
  },
  {
    name: 'renuntat',
    ticketEur: 500,
    events: [ATTEST_SELLER, ATTEST_BUYER, { type: 'renuntare', motiv: 'contrapartea a tăcut', at: AT }],
  },
  { name: 'bilet-mic', ticketEur: 20, events: [ATTEST_SELLER, ATTEST_BUYER, MATCH, HANDOFF, OBSERVED] },
  {
    name: 'bilet-mare',
    ticketEur: 50_000,
    events: [ATTEST_SELLER, ATTEST_BUYER, MATCH, HANDOFF, OBSERVED],
  },
];

const cases = SCENARIOS.map((scenario) => {
  const initial = createIntent(`intent-${scenario.name}`, scenario.ticketEur);
  const output: Intent = scenario.events.reduce(
    (current, event) => applyEvent(current, event),
    initial,
  );
  return {
    scenario: scenario.name,
    ticketEur: scenario.ticketEur,
    events: scenario.events,
    output,
  };
});

const target = new URL('../test/fixtures/intent-golden.json', import.meta.url);
mkdirSync(new URL('../test/fixtures/', import.meta.url), { recursive: true });
writeFileSync(target, `${JSON.stringify(cases, null, 2)}\n`, 'utf8');

console.log(`scrise ${cases.length} scenarii în test/fixtures/intent-golden.json`);

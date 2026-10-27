/**
 * Registrul: nimic nu se afișează fără citat, iar backlog-ul se derivă.
 * Rulare: node --experimental-strip-types --test test/ledger.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  daysToDeadline,
  deriveTasks,
  isRenderable,
  isSourced,
  unsourcedClaims,
  validateLedger,
} from '../src/ledger.ts';
import type { Ledger } from '../src/ledger.ts';

const ledger: Ledger = JSON.parse(
  readFileSync(new URL('../routes.json', import.meta.url), 'utf8'),
) as Ledger;

describe('registrul — starea de pornire', () => {
  it('e structural valid', () => {
    assert.deepEqual(validateLedger(ledger), []);
  });

  it('citatele puse au URL https și dată, iar restul rămân task-uri', () => {
    const claims = ledger.routes.flatMap((route) => route.claims);
    const sourced = claims.filter(isSourced);

    // Registrul verifică sursele primare. Fiecare citat adăugat trebuie să fie
    // verificabil la sursă, nu o aproximare — de aceea lista e explicită.
    assert.deepEqual(
      sourced.map((claim) => claim.id).sort(),
      [
        'amlr_art79_scope',
        'atomic_swap_feasible',
        'binance_delist_2024_02',
        'haveno_tor_multisig',
        'kraken_eea_2024_10_31',
        'localmonero_announced_2024_05',
        'localmonero_gone_2024_11',
        'no_trusted_bridge',
        'okx_delist_2024_01',
      ],
    );
    assert.equal(unsourcedClaims(ledger).length, claims.length - sourced.length);
    assert.ok(unsourcedClaims(ledger).length > 0, 'registrul nu e complet citat încă');
  });

  it('afișează ca dovedite rutele ale căror afirmații sunt toate citate', () => {
    for (const route of ledger.routes) {
      if (route.id === 'licensed_exchange' || route.id === 'wrapped_bridge') {
        assert.equal(isRenderable(route), true, `${route.id} ar trebui să fie afișabil ca fapt`);
      } else {
        assert.equal(isRenderable(route), false, `${route.id} nu ar trebui să fie afișabil încă fără toate citatele`);
      }
    }
  });

  it('convertește fiecare afirmație fără citat într-un task pentru Jules', () => {
    const tasks = deriveTasks(ledger);
    assert.equal(tasks.length, unsourcedClaims(ledger).length);
    assert.ok(tasks.every((t) => t.owner === 'jules'));
    assert.ok(tasks.every((t) => t.acceptance.includes('Fără citat')));
  });
});

describe('registrul — poarta de dovezi', () => {
  it('acceptă doar URL http(s) cu dată', () => {
    const claim = { id: 'x', text: 'y', source: 'https://example.org/a', retrieved_at: '2026-10-27' };
    assert.equal(isSourced(claim), true);
    assert.equal(isSourced({ ...claim, source: null }), false);
    assert.equal(isSourced({ ...claim, source: 'example.org/a' }), false);
    assert.equal(isSourced({ ...claim, retrieved_at: null }), false);
    assert.equal(isSourced({ ...claim, retrieved_at: '27.10.2026' }), false);
  });

  it('deschide o rută doar când toate afirmațiile ei sunt citate', () => {
    const route = {
      id: 'r',
      label: 'R',
      stamp: 'drumul',
      regions: ['RO'],
      claims: [
        { id: 'a', text: 'A', source: 'https://e.org/a', retrieved_at: '2026-10-27' },
        { id: 'b', text: 'B', source: null, retrieved_at: null },
      ],
    };
    assert.equal(isRenderable(route), false);

    route.claims[1] = { id: 'b', text: 'B', source: 'https://e.org/b', retrieved_at: '2026-10-27' };
    assert.equal(isRenderable(route), true);
  });

  it('respinge o rută fără afirmații', () => {
    assert.equal(isRenderable({ id: 'r', label: 'R', stamp: 'nu', regions: ['RO'], claims: [] }), false);
    const errors = validateLedger({
      ...ledger,
      routes: [{ id: 'r', label: 'R', stamp: 'nu', regions: ['RO'], claims: [] }],
    });
    assert.ok(errors.some((e) => e.includes('nu are afirmații')));
  });
});

describe('registrul — ceasul', () => {
  it('numără zilele până la 10 iulie 2027', () => {
    const days = daysToDeadline(ledger, new Date('2026-10-27T00:00:00Z'));
    assert.equal(days, 256);
  });
});

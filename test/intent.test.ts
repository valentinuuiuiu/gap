/**
 * Mașina de intenție: lanțul fix, taxa plată și refuzul capitalului.
 *
 * Rulare: node --experimental-strip-types --test test/intent.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  FEE_EUR,
  applyEvent,
  createIntent,
  exposureEur,
  feeFor,
  type Intent,
  type IntentEvent,
} from '../src/intent.ts';

const AT = '2026-10-27T16:00:00Z';

function attested(ticketEur = 500): Intent {
  const start = createIntent('intent-1', ticketEur);
  const withSeller = applyEvent(start, {
    type: 'atestare',
    side: 'vanzator_xmr',
    proof: 'adresa semnată',
    at: AT,
  });
  return applyEvent(withSeller, {
    type: 'atestare',
    side: 'cumparator_eur',
    proof: 'cont fiat semnat',
    at: AT,
  });
}

function chain(intent: Intent, events: IntentEvent[]): Intent {
  return events.reduce((current, event) => applyEvent(current, event), intent);
}

const HANDOFF: IntentEvent[] = [
  { type: 'potrivire', protocol: 'haveno-multisig', contraparte: 'peer-7f3', at: AT },
  { type: 'predare', protocol: 'haveno-multisig', at: AT },
];

describe('intent — lanțul de stări', () => {
  it('nu ajunge la potrivire cu o singură atestare', () => {
    const partial = applyEvent(createIntent('intent-2', 500), {
      type: 'atestare',
      side: 'vanzator_xmr',
      proof: 'adresa semnată',
      at: AT,
    });
    assert.equal(partial.state, 'intentie');
    assert.throws(
      () =>
        applyEvent(partial, {
          type: 'potrivire',
          protocol: 'haveno-multisig',
          contraparte: 'peer-7f3',
          at: AT,
        }),
      /cere ambele atestări/,
    );
  });

  it('acceptă fiecare pas o singură dată', () => {
    const matched = chain(attested(), HANDOFF);
    assert.equal(matched.state, 'predata');
    assert.throws(() => applyEvent(matched, HANDOFF[0]), /atestata|nu se aplică/);
  });

  it('refuză predarea către alt protocol decât cel agreat', () => {
    const matched = chain(attested(), HANDOFF.slice(0, 1));
    assert.throws(
      () => applyEvent(matched, { type: 'predare', protocol: 'alt-protocol', at: AT }),
      /alt protocol/,
    );
  });

  it('nu facturează o intenție neobservată', () => {
    const handed = chain(attested(), HANDOFF);
    assert.throws(() => applyEvent(handed, { type: 'facturare', at: AT }), /observată/);
    const failed = applyEvent(handed, {
      type: 'observare',
      observed: false,
      evidence: 'niciun transfer pe lanț în fereastră',
      at: AT,
    });
    assert.equal(failed.state, 'predata');
    assert.equal(failed.settlement?.observed, false);
    assert.throws(() => applyEvent(failed, { type: 'facturare', at: AT }), /observată/);
  });

  it('închide biletul doar după o predare observată', () => {
    const done = chain(attested(), [
      ...HANDOFF,
      { type: 'observare', observed: true, evidence: 'lock-uri confirmate', at: AT },
      { type: 'facturare', at: AT },
    ]);
    assert.equal(done.state, 'facturata');
    assert.equal(done.invoice?.amountEur, FEE_EUR);
    assert.equal(done.invoice?.paid, false);
    assert.throws(() => applyEvent(done, { type: 'renuntare', motiv: 'prea târziu', at: AT }), /finală/);
  });

  it('poate renunța înainte de predare', () => {
    const dropped = applyEvent(attested(), { type: 'renuntare', motiv: 'contrapartea a tăcut', at: AT });
    assert.equal(dropped.state, 'renuntata');
    assert.equal(dropped.renuntare?.motiv, 'contrapartea a tăcut');
  });
});

describe('intent — zero capital', () => {
  it('taxa e plată, nu procent din bilet', () => {
    assert.equal(feeFor(20), feeFor(50_000));
    assert.equal(feeFor(20), FEE_EUR);
    assert.notEqual(feeFor(20), 0.02 * 50_000);
  });

  it('nu are câmp prin care desk-ul să țină sau să avanseze bani', () => {
    const intent = createIntent('intent-3', 500);
    const forbidden = ['held', 'balance', 'float', 'inventory', 'custody', 'escrow'];
    for (const key of Object.keys(intent)) {
      assert.ok(!forbidden.some((bad) => key.toLowerCase().includes(bad)), `cheie interzisă: ${key}`);
    }
  });

  it('pierderea maximă e taxa, nu biletul', () => {
    const handed = chain(attested(50_000), HANDOFF);
    assert.equal(exposureEur(handed), FEE_EUR);
    assert.ok(exposureEur(handed) < handed.ticketEur);
  });

  it('modulul nu semnează, nu difuzează și nu atinge chei', () => {
    const text = readFileSync(new URL('../src/intent.ts', import.meta.url), 'utf8');
    const forbidden = [
      'send' + 'Transaction',
      'eth_' + 'sendTransaction',
      'sign' + 'Transaction',
      'private' + 'Key',
      'seed' + 'Phrase',
      'http' + 's://',
    ];
    for (const needle of forbidden) {
      assert.ok(!text.includes(needle), `intent.ts nu are voie să conțină ${needle}`);
    }
  });
});

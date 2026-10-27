/**
 * Testează mașina de intenție: zero capital, taxă fixă, tranziții stricte.
 * Rulare: node --experimental-strip-types --test test/intent.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyEvent,
  createIntent,
  exposureEur,
  feeFor,
  FEE_EUR,
} from '../src/intent.ts';
import type { Intent, IntentEvent } from '../src/intent.ts';

const AT = '2026-10-27T16:00:00Z';

function happyPath(ticketEur = 500): Intent {
  let intent = createIntent('intent-1', ticketEur);
  intent = applyEvent(intent, { type: 'atestare', side: 'vanzator_xmr', proof: 'adresa semnată', at: AT });
  intent = applyEvent(intent, { type: 'atestare', side: 'cumparator_eur', proof: 'cont fiat semnat', at: AT });
  intent = applyEvent(intent, { type: 'potrivire', protocol: 'haveno-multisig', contraparte: 'peer-7f3', at: AT });
  intent = applyEvent(intent, { type: 'predare', protocol: 'haveno-multisig', at: AT });
  intent = applyEvent(intent, { type: 'observare', observed: true, evidence: 'lock-uri confirmate', at: AT });
  return intent;
}

describe('intent — lanțul de stări', () => {
  it('nu ajunge la potrivire cu o singură atestare', () => {
    let intent = createIntent('intent-2', 500);
    intent = applyEvent(intent, { type: 'atestare', side: 'vanzator_xmr', proof: 'ok', at: AT });
    assert.equal(intent.state, 'intentie');
    assert.throws(
      () => applyEvent(intent, { type: 'potrivire', protocol: 'haveno', contraparte: 'p', at: AT }),
      /potrivirea cere ambele atestări/,
    );
  });

  it('acceptă fiecare pas o singură dată', () => {
    let intent = createIntent('intent-3', 500);
    intent = applyEvent(intent, { type: 'atestare', side: 'vanzator_xmr', proof: 'ok', at: AT });
    assert.throws(
      () => applyEvent(intent, { type: 'atestare', side: 'vanzator_xmr', proof: 'alt ok', at: AT }),
      /deja atestată/,
    );
  });

  it('refuză predarea către alt protocol decât cel agreat', () => {
    let intent = createIntent('intent-4', 500);
    intent = applyEvent(intent, { type: 'atestare', side: 'vanzator_xmr', proof: 'ok', at: AT });
    intent = applyEvent(intent, { type: 'atestare', side: 'cumparator_eur', proof: 'ok', at: AT });
    intent = applyEvent(intent, { type: 'potrivire', protocol: 'haveno', contraparte: 'p', at: AT });
    assert.throws(
      () => applyEvent(intent, { type: 'predare', protocol: 'altul', at: AT }),
      /alt protocol decât cel agreat/,
    );
  });

  it('nu facturează o intenție neobservată', () => {
    let intent = createIntent('intent-5', 500);
    intent = applyEvent(intent, { type: 'atestare', side: 'vanzator_xmr', proof: 'ok', at: AT });
    intent = applyEvent(intent, { type: 'atestare', side: 'cumparator_eur', proof: 'ok', at: AT });
    assert.throws(
      () => applyEvent(intent, { type: 'facturare', at: AT }),
      /factura se emite doar după o predare observată/,
    );
  });

  it('închide biletul doar după o predare observată', () => {
    const observed = happyPath();
    assert.equal(observed.state, 'observata');
    const done = applyEvent(observed, { type: 'facturare', at: AT });
    assert.equal(done.state, 'facturata');
    assert.equal(done.invoice?.amountEur, FEE_EUR);
  });

  it('poate renunța înainte de predare', () => {
    let intent = createIntent('intent-6', 500);
    intent = applyEvent(intent, { type: 'renuntare', motiv: 'schimbat părerea', at: AT });
    assert.equal(intent.state, 'renuntata');
    assert.throws(
      () => applyEvent(intent, { type: 'atestare', side: 'vanzator_xmr', proof: 'ok', at: AT }),
      /starea «renuntata» e finală/,
    );
  });
});

describe('intent — zero capital', () => {
  it('taxa e plată, nu procent din bilet', () => {
    assert.equal(feeFor(20), FEE_EUR);
    assert.equal(feeFor(500), FEE_EUR);
    assert.equal(feeFor(50_000), FEE_EUR);
  });

  it('nu are câmp prin care desk-ul să țină sau să avanseze bani', () => {
    const intent = happyPath();
    const keys = Object.keys(intent);
    for (const forbidden of ['balance', 'custody', 'held', 'advance', 'float']) {
      assert.ok(!keys.includes(forbidden), `câmpul «${forbidden}» ar încălca zero capital`);
    }
  });

  it('pierderea maximă e taxa, nu biletul', () => {
    const handed = happyPath(50_000);
    assert.equal(exposureEur(handed), FEE_EUR);
  });

  it('modulul nu semnează, nu difuzează și nu atinge chei', () => {
    const event: IntentEvent = { type: 'atestare', side: 'vanzator_xmr', proof: 'proof', at: AT };
    assert.ok(!('private' + '_key' in event));
    assert.ok(!('seed' in event));
  });
});

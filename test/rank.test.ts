/**
 * Contractul din docs/gap/HANDOFF.md, verificat.
 * Rulare: node --experimental-strip-types --test test/rank.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OTC_MIN_EUR, rankRoutes } from '../src/rank.ts';
import {
  formatMissing,
  isValidXmrAddress,
  maskIban,
  namesMatch,
  parseEur,
} from '../src/parse.ts';

describe('rankRoutes — drumul pentru România', () => {
  it('pune swap-ul atomic primul pentru RO + fără custodie', () => {
    const result = rankRoutes({
      region: 'RO',
      stance: 'fara_custodie',
      ticketEur: 500,
      heldEur: 1200,
    });

    assert.equal(result.routes[0].id, 'btc_atomic_swap');
    assert.equal(result.routes[0].stamp, 'drumul');
  });

  it('închide schimbul licențiat în SEE', () => {
    const result = rankRoutes({
      region: 'SEE',
      stance: 'fara_custodie',
      ticketEur: 500,
      heldEur: 1200,
    });

    const licensed = result.routes.find((r) => r.id === 'licensed_exchange');
    assert.ok(licensed);
    assert.equal(licensed.stamp, 'inchis');
  });

  it('marchează podul wrapped ca evitat, mereu', () => {
    for (const region of ['RO', 'SEE', 'UK', 'US', 'ALTA'] as const) {
      const result = rankRoutes({
        region,
        stance: 'licentiat',
        ticketEur: 500,
        heldEur: 500,
      });
      assert.equal(result.routes.find((r) => r.id === 'wrapped_bridge')?.stamp, 'evita');
    }
  });

  it('nu vinde operatorul custodial ca produs, nici pentru stance „operator"', () => {
    const result = rankRoutes({
      region: 'RO',
      stance: 'operator',
      ticketEur: 500,
      heldEur: 900,
    });

    assert.equal(result.routes.find((r) => r.id === 'instant_operator')?.stamp, 'nu');
  });

  it('ordonează după severitatea din pagină', () => {
    const stamps = rankRoutes({
      region: 'RO',
      stance: 'fara_custodie',
      ticketEur: 20,
      heldEur: 20,
    }).routes.map((r) => r.stamp);

    assert.deepEqual(stamps, ['drumul', 'subtire', 'nu', 'inchis', 'departe', 'evita']);
  });
});

describe('rankRoutes — soldul, fără NaN', () => {
  it('calculează lipsa când soldul nu acoperă tichetul', () => {
    const result = rankRoutes({
      region: 'RO',
      stance: 'fara_custodie',
      ticketEur: 500,
      heldEur: 312.5,
    });

    assert.equal(result.missingEur, 187.5);
    assert.equal(result.coversTicket, false);
    assert.equal(result.funds, 'nu_acopera');
    assert.equal(formatMissing(result.missingEur), 'Lipsesc ~187,50 EUR față de soldul verificat.');
  });

  it('trece stamp-ul de fonduri în «acoperă» când soldul ajunge', () => {
    const result = rankRoutes({
      region: 'RO',
      stance: 'fara_custodie',
      ticketEur: 500,
      heldEur: 500,
    });

    assert.equal(result.coversTicket, true);
    assert.equal(result.funds, 'acopera');
    assert.equal(result.missingEur, 0);
    assert.equal(formatMissing(0), '');
  });

  it('aruncă pe intrare invalidă în loc să render-eze ~NaN EUR', () => {
    assert.throws(() =>
      rankRoutes({
        region: 'RO',
        stance: 'fara_custodie',
        ticketEur: Number.NaN,
        heldEur: 100,
      }),
    );
    assert.throws(() =>
      rankRoutes({
        region: 'RO',
        stance: 'fara_custodie',
        ticketEur: 100,
        heldEur: Number.POSITIVE_INFINITY,
      }),
    );
    assert.throws(() =>
      rankRoutes({
        region: 'RO',
        stance: 'fara_custodie',
        ticketEur: 100,
        heldEur: -1,
      }),
    );
  });
});

describe('rankRoutes — ce nu știm, spunem că nu știm', () => {
  it('nu fabrica un verdict pentru regiuni nemodelate', () => {
    const result = rankRoutes({
      region: 'US',
      stance: 'fara_custodie',
      ticketEur: 5000,
      heldEur: 5000,
    });

    const road = result.routes.find((r) => r.id === 'btc_atomic_swap');
    assert.ok(road);
    assert.notEqual(road.stamp, 'drumul');
    assert.match(road.why, /nu e modelată/);
  });

  it('schimbă motivul OTC după mărimea biletului', () => {
    const small = rankRoutes({ region: 'RO', stance: 'fara_custodie', ticketEur: 20, heldEur: 20 });
    const large = rankRoutes({
      region: 'RO',
      stance: 'fara_custodie',
      ticketEur: OTC_MIN_EUR,
      heldEur: OTC_MIN_EUR,
    });

    const smallWhy = small.routes.find((r) => r.id === 'otc_desk')?.why ?? '';
    const largeWhy = large.routes.find((r) => r.id === 'otc_desk')?.why ?? '';
    assert.notEqual(smallWhy, largeWhy);
    assert.match(smallWhy, /nu se ridică din pat/);
  });
});

describe('parse — mascare și validare', () => {
  it('mască IBAN-ul păstrând prefixul și coada', () => {
    const masked = maskIban('RO49 AAAA 1B31 0075 9384 0000');
    assert.equal(masked.startsWith('RO'), true);
    assert.equal(masked.endsWith('0000'), true);
    assert.equal(masked.includes('AAAA'), false);
  });

  it('parsează EUR în ambele convenții', () => {
    assert.equal(parseEur('1.234,56'), 1234.56);
    assert.equal(parseEur('1,234.56'), 1234.56);
    assert.equal(parseEur('1234.56'), 1234.56);
    assert.equal(parseEur('20'), 20);
    assert.throws(() => parseEur(''));
    assert.throws(() => parseEur('garbage'));
  });

  it('validează adresa XMR local', () => {
    const standard = '4' + 'A'.repeat(94);
    assert.equal(isValidXmrAddress(standard), true);
    assert.equal(isValidXmrAddress('8' + 'A'.repeat(94)), true);
    assert.equal(isValidXmrAddress(standard.slice(0, 94)), false);
    assert.equal(isValidXmrAddress('4' + '0'.repeat(94)), false);
    assert.equal(isValidXmrAddress('1' + 'A'.repeat(94)), false);
  });

  it('potrivește numele GitHub cu titularul Revolut', () => {
    assert.equal(namesMatch('Valentin Popescu', 'Valentin Ion POPESCU'), true);
    assert.equal(namesMatch('Valentin Popescu', 'María García'), false);
  });
});

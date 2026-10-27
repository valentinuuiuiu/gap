/**
 * Desk-ul viu: rutele HTTP răspuns corect, iar starea dovezilor nu se cosmetizează.
 *
 * Se pornește procesul real (nu se importă handler-ul), ca testul să prindă
 * exact ce vede un om cu curl: coduri, JSON, HTML.
 *
 * Rulare: node --experimental-strip-types --test test/desk.test.ts
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER = fileURLToPath(new URL('../scripts/desk-server.mjs', import.meta.url));

let child: ReturnType<typeof spawn>;

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) return;
    } catch {
      // încă nu ascultă
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('desk-ul nu a pornit în 15s');
}

before(async () => {
  child = spawn(process.execPath, ['--experimental-strip-types', SERVER], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  await waitForHealth();
});

after(() => {
  child?.kill('SIGTERM');
});

describe('desk — suprafețele publice', () => {
  it('healthz spune câte rute are și câte afirmații nu au citat', async () => {
    const body = await (await fetch(`${BASE}/healthz`)).json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'gap-desk');
    assert.equal(body.routes, 6);
    assert.ok(body.unsourced > 0, 'registrul de pornire nu are citate — trebuie raportat');
  });

  it('verdictul de ranking se calculează din parametri', async () => {
    const response = await fetch(`${BASE}/api/rank?region=RO&ticketEur=800&heldEur=200`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.coversTicket, false);
    assert.equal(body.missingEur, 600);
    assert.equal(body.routes.length, 6);
    assert.equal(body.routes[0].id, 'btc_atomic_swap');
    for (const route of body.routes) {
      assert.equal(typeof route.proof.renderable, 'boolean');
      assert.equal(route.proof.sourced, 0, 'niciun citat încă — nu se fabrică dovezi');
    }
  });

  it('rutele fără citate se afișează ca nedovedit, nu cu stamp ca fapt', async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    assert.ok(html.includes('nedovedit'), 'pagina trebuie să marcheze nedovedit');
    assert.ok(html.includes('propus:'), 'verdictul motorului se afișează ca propunere');
    // Șabloanele interzise se asamblează din bucăți: scrise literal, fișierul
    // s-ar auto-semnaliza la rularea porții pe repo (vezi și test/gate.test.ts).
    const calls = [[['buy', 'now'].join(' ')], [['cumpără', 'acum'].join(' ')]];
    for (const [call] of calls) {
      assert.ok(!html.toLowerCase().includes(call.toLowerCase()), `desk-ul nu vinde: ${call}`);
    }
  });

  it('intrările imposibile ies ca 400, iar serverul rămâne viu', async () => {
    assert.equal((await fetch(`${BASE}/api/rank?ticketEur=abc`)).status, 400);
    assert.equal((await fetch(`${BASE}/api/rank?region=MARS`)).status, 400);
    assert.equal((await fetch(`${BASE}/healthz`)).status, 200);
  });

  it('restul căilor nu sunt inventate', async () => {
    assert.equal((await fetch(`${BASE}/ceva`)).status, 404);
  });
});

describe('desk — registrul servit', () => {
  it('trimite registrul întreg, plus starea derivată', async () => {
    const body = await (await fetch(`${BASE}/api/registry`)).json();
    assert.equal(body.schema, 1);
    assert.equal(body.routes.length, 6);
    assert.equal(body.state.renderable, 0);
    assert.equal(body.state.tasks.length, body.state.unsourced);
    assert.ok(body.state.daysToDeadline > 0);
  });
});

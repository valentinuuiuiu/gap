/**
 * Live desk tests for English UI and full verified parity.
 * Run: node --experimental-strip-types --test test/desk.test.ts
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { isSourced } from '../src/ledger.ts';

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
      // not yet listening
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('desk failed to start within 15s');
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

describe('desk — public surfaces', () => {
  it('healthz returns route count and unsourced status', async () => {
    const body = await (await fetch(`${BASE}/healthz`)).json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'gap-desk');
    assert.equal(body.routes, 5);
    assert.equal(body.unsourced, 0);
  });

  it('ranking verdict is computed from query parameters', async () => {
    const response = await fetch(`${BASE}/api/rank?region=RO&ticketEur=800&heldEur=200`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.coversTicket, false);
    assert.equal(body.missingEur, 600);
    assert.equal(body.routes.length, 6);
    assert.equal(body.routes[0].id, 'btc_atomic_swap');

    const ledger = JSON.parse(readFileSync(new URL('../routes.json', import.meta.url), 'utf8'));
    const sourced = ledger.routes.flatMap((route) => route.claims).filter(isSourced);
    const reported = body.routes.reduce((sum, route) => sum + route.proof.sourced, 0);
    assert.equal(reported, sourced.length);

    for (const route of body.routes) {
      assert.equal(typeof route.proof.renderable, 'boolean');
      assert.ok(route.proof.sourced <= route.proof.claims);
    }
  });

  it('UI renders English labels and flat fee correctly', async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    assert.ok(html.includes('Flat €4 Fee'));
    assert.ok(html.includes('Initiate Escrow Desk Coordination'));
    assert.ok(html.includes('Evaluate Route'));

    const calls = [[['buy', 'now'].join(' ')], [['cumpără', 'acum'].join(' ')]];
    for (const [call] of calls) {
      assert.ok(!html.toLowerCase().includes(call.toLowerCase()), `desk does not sell execution: ${call}`);
    }

    assert.ok(html.includes('id="gap-chat-btn"'));
    assert.ok(html.includes('id="gap-chat-box"'));
    assert.ok(html.includes('id="gap-ticket-form"'));
  });

  it('ticket registration creates validated intent handoff', async () => {
    const invalidRes = await fetch(`${BASE}/api/intent/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side: 'cumparator_eur', amountEur: 50, contact: '', xmrAddress: 'invalid' }),
    });
    assert.equal(invalidRes.status, 400);

    const validRes = await fetch(`${BASE}/api/intent/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        side: 'cumparator_eur',
        amountEur: 200,
        contact: '@e2e_tester',
        xmrAddress: '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9NaN62qBp2T9YVMK8GMTCEtvc83a6Ek5xJn8BGuFxxg4',
      }),
    });
    assert.equal(validRes.status, 200);
    const body = await validRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.ticket.state, 'predata');
    assert.equal(body.ticket.feeEur, 4);
    assert.ok(body.instructions.escrowKey);
  });

  it('chat API handles empty and valid queries', async () => {
    const emptyRes = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });
    assert.equal(emptyRes.status, 400);

    const validRes = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What is the desk fee?' }),
    });
    assert.equal(validRes.status, 200);
    const data = await validRes.json();
    assert.ok(data.reply && data.reply.length > 0);
  });

  it('invalid inputs yield 400 and server remains healthy', async () => {
    assert.equal((await fetch(`${BASE}/api/rank?ticketEur=abc`)).status, 400);
    assert.equal((await fetch(`${BASE}/api/rank?region=MARS`)).status, 400);
    assert.equal((await fetch(`${BASE}/healthz`)).status, 200);
  });

  it('unmapped routes return 404', async () => {
    assert.equal((await fetch(`${BASE}/unknown-path`)).status, 404);
  });
});

describe('desk — served registry', () => {
  it('returns entire registry plus derived state', async () => {
    const body = await (await fetch(`${BASE}/api/registry`)).json();
    assert.equal(body.schema, 1);
    assert.equal(body.routes.length, 5);
    assert.equal(body.state.renderable, 5);
    assert.equal(body.state.unsourced, 0);
    assert.ok(body.state.daysToDeadline > 0);
  });
});

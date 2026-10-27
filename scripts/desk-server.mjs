#!/usr/bin/env node
/**
 * GAP — Read-Only Live Desk (English UI).
 *
 * Serves route ranking verdicts AND ledger evidence state transparently:
 * A route without verified citations is displayed as "proposed / unsourced".
 * A route with full primary sources is displayed as a verified fact.
 *
 * Non-custodial, zero keys, zero fund execution:
 * Direct coordination desk with a flat €4 fee.
 *
 * Run: node --experimental-strip-types scripts/desk-server.mjs
 *   PORT (default 5011), HOST (default 127.0.0.1)
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

import { rankRoutes } from '../src/rank.ts';
import {
  daysToDeadline,
  deriveTasks,
  isRenderable,
  isSourced,
  unsourcedClaims,
  validateLedger,
} from '../src/ledger.ts';
import { FEE_EUR } from '../src/intent.ts';

const PORT = Number(process.env.PORT ?? 5011);
const HOST = process.env.HOST ?? '127.0.0.1';
const REPO = 'https://github.com/valentinuuiuiu/gap';

const ledger = JSON.parse(readFileSync(new URL('../routes.json', import.meta.url), 'utf8'));
const ledgerErrors = validateLedger(ledger);
if (ledgerErrors.length > 0) {
  console.error('Ledger is not valid — desk refuses to start:');
  for (const error of ledgerErrors) console.error(`  - ${error}`);
  process.exit(1);
}

const byId = new Map(ledger.routes.map((route) => [route.id, route]));

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function registryState() {
  const tasks = deriveTasks(ledger);
  const unsourced = unsourcedClaims(ledger);
  const total = ledger.routes.reduce((sum, route) => sum + route.claims.length, 0);
  return {
    sourced: total - unsourced.length,
    unsourced: unsourced.length,
    total,
    renderable: ledger.routes.filter(isRenderable).length,
    routes: ledger.routes.length,
    tasks,
    daysToDeadline: daysToDeadline(ledger, new Date()),
    deadline: ledger.deadline,
  };
}

function rankFor(query) {
  const region = query.get('region') ?? 'RO';
  const stance = query.get('stance') ?? 'fara_custodie';
  const ticketEur = Number(query.get('ticketEur') ?? 500);
  const heldEur = Number(query.get('heldEur') ?? 0);

  const rank = rankRoutes({ region, stance, ticketEur, heldEur });
  const routes = rank.routes.map((route) => {
    const registered = byId.get(route.id);
    const claims = registered?.claims ?? [];
    const renderable = registered ? isRenderable(registered) : false;
    return {
      ...route,
      proof: {
        renderable,
        claims: claims.length,
        sourced: claims.filter(isSourced).length,
        missing: claims
          .filter((claim) => !isSourced(claim))
          .map((claim) => ({
            id: claim.id,
            text: claim.text,
            issueSearch: `${REPO}/issues?q=${encodeURIComponent(claim.id)}`,
          })),
      },
    };
  });

  return { input: { region, stance, ticketEur, heldEur }, ...rank, routes };
}

function page(query) {
  const rank = rankFor(query);
  const registry = registryState();

  const routeCards = rank.routes
    .map((route) => {
      const verdict = route.proof.renderable
        ? `<span class="stamp verified">${esc(route.stamp)}</span>`
        : `<span class="stamp muted">proposed: ${esc(route.stamp)}</span><span class="stamp nedovedit">unsourced</span>`;
      
      const missingList = route.proof.missing
        .map(
          (claim) =>
            `<li><code>${esc(claim.id)}</code> — ${esc(claim.text)} <a href="${esc(
              claim.issueSearch,
            )}">issue</a></li>`,
        )
        .join('\n');

      const gate = route.proof.claims
        ? `<details class="gate">
        <summary>${route.proof.sourced}/${route.proof.claims} verified primary citations${
          route.proof.missing.length ? ` — view missing (${route.proof.missing.length})` : ' — all verified'
        }</summary>
        ${
          route.proof.missing.length
            ? `<ul>${missingList}</ul>
        <p class="req">Requirement: verbatim quote from primary HTTPS source, retrieval timestamp in <code>routes.json</code>. If primary source is inaccessible, claim must be retracted per ledger rules.</p>`
            : '<p class="req">All claims are backed by primary sources. Stamp is rendered as verified fact.</p>'
        }
      </details>`
        : '<div class="claims">Route not present in active ledger</div>';

      return `<div class="card ${route.proof.renderable ? 'active' : 'dimmed'}">
        <div class="row">
          <h3>${esc(route.label)}</h3>
          <div>${verdict}</div>
        </div>
        <p class="why">${esc(route.why)}</p>
        ${gate}
      </div>`;
    })
    .join('\n');

  const backlog = registry.tasks
    .map(
      (task) =>
        `<li><b>${esc(task.routeId)}</b> / <code>${esc(task.claimId)}</code>: ${esc(task.title)}</li>`,
    )
    .join('\n');

  const deadlineNote = registry.deadline.unsourced
    ? 'application date unsourced'
    : `verified primary citation from <a href="${esc(registry.deadline.source)}">Official Journal of the EU</a> (retrieved ${esc(registry.deadline.retrieved_at)})`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GAP — Read-Only Monero Bridge Desk</title>
<style>
  :root {
    --bg:#0b0f19; --fg:#e6edf3; --dim:#8b949e; --line:#30363d;
    --card:#161b22; --accent:#58a6ff; --green:#3fb950; --red:#f85149; --amber:#d29922;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; padding:24px 16px; background:var(--bg); color:var(--fg);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; line-height:1.5;
  }
  main { max-width:880px; margin:0 auto; }
  h1 { font-size:26px; margin:0 0 6px; letter-spacing:-0.5px; }
  .sub { color:var(--dim); font-size:14px; margin:0 0 24px; }
  form {
    display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px;
    background:var(--card); padding:16px; border-radius:12px; border:1px solid var(--line);
    margin-bottom:28px;
  }
  label { font-size:12px; color:var(--dim); display:flex; flex-direction:column; gap:6px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; }
  input, select, button {
    background:#0d1117; color:var(--fg); border:1px solid var(--line); border-radius:8px;
    padding:9px 12px; font-size:14px;
  }
  button {
    background:#238636; border-color:#2ea043; color:#fff; font-weight:600; cursor:pointer;
    align-self:end; height:40px;
  }
  button:hover { background:#2ea043; }
  .action-box {
    background: linear-gradient(135deg, rgba(88,166,255,0.08) 0%, rgba(63,185,80,0.08) 100%);
    border: 1px solid rgba(88,166,255,0.3); border-radius: 12px; padding: 20px; margin-bottom: 28px;
  }
  .action-box h2 { margin:0 0 8px; font-size:18px; color:#fff; }
  .action-box p { margin:0 0 16px; font-size:13px; color:var(--dim); }
  .fee-badge {
    display:inline-block; background:rgba(63,185,80,0.2); color:var(--green); border:1px solid var(--green);
    padding:3px 8px; border-radius:6px; font-weight:bold; font-size:12px; margin-left:8px;
  }
  .card {
    background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 20px;
    margin-bottom:14px; transition:border-color 0.15s;
  }
  .card.active { border-color:rgba(63,185,80,0.35); }
  .row { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
  h3 { font-size:17px; margin:0 0 6px; }
  .why { color:var(--dim); font-size:14px; margin:0 0 10px; }
  .stamp {
    font-size:11px; text-transform:uppercase; font-weight:700; letter-spacing:0.8px;
    padding:4px 9px; border-radius:6px; border:1px solid currentColor; display:inline-block;
  }
  .stamp.verified { color:var(--green); background:rgba(63,185,80,0.12); }
  .stamp.muted { color:var(--amber); background:rgba(210,153,34,0.12); border-color:var(--amber); }
  .stamp.nedovedit { color:var(--red); background:rgba(248,81,73,0.12); border-color:var(--red); margin-left:6px; }
  .gate { margin-top:8px; padding-top:10px; border-top:1px dashed var(--line); font-size:12px; }
  .gate summary { cursor:pointer; color:var(--accent); font-weight:600; }
  .gate p.req { color:var(--dim); margin:8px 0 2px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:24px; }
  .stat { border:1px solid var(--line); border-radius:10px; padding:12px 14px; background:var(--card); }
  .stat b { display:block; font-size:22px; font-weight:700; }
  .stat span { color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:0.5px; }
  ul { padding-left:18px; } li { color:var(--dim); margin-bottom:4px; font-size:13px; }
  a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
  footer { margin-top:40px; padding-top:16px; border-top:1px solid var(--line); color:var(--dim); font-size:12px; }
</style>
</head>
<body>
<main>
  <h1>GAP — Read-Only Bridge Desk</h1>
  <p class="sub">Non-custodial, zero keys, zero fund execution. Settlement happens on P2P atomic swap & multisig protocols.</p>

  <form method="get" action="/">
    <label>Region
      <select name="region">
        ${['RO', 'SEE', 'UK', 'US', 'ALTA']
          .map((r) => `<option value="${r}"${r === rank.input.region ? ' selected' : ''}>${r}</option>`)
          .join('')}
      </select>
    </label>
    <label>Stance
      <select name="stance">
        ${['fara_custodie', 'licentiat', 'operator']
          .map((s) => `<option value="${s}"${s === rank.input.stance ? ' selected' : ''}>${s}</option>`)
          .join('')}
      </select>
    </label>
    <label>Ticket Amount (EUR) <input name="ticketEur" value="${esc(rank.input.ticketEur)}" /></label>
    <label>Verified Balance (EUR) <input name="heldEur" value="${esc(rank.input.heldEur)}" /></label>
    <button type="submit">Evaluate Route</button>
  </form>

  <div class="action-box">
    <h2>Initiate Escrow Desk Coordination <span class="fee-badge">Flat €${FEE_EUR} Fee</span></h2>
    <p>Zero custody. Desk coordinates matching and verifies participant addresses. Peer-to-peer settlement via non-custodial 2-of-3 escrow protocol.</p>
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <a href="mailto:operator@piata-ai.ro?subject=New%20GAP%20Ticket%20${encodeURIComponent(rank.input.ticketEur)}%20EUR" style="display:inline-block; background:var(--accent); color:#0b0f19; padding:8px 16px; border-radius:8px; font-weight:700; font-size:13px;">Open Ticket via Coordinator (€${FEE_EUR} flat)</a>
      <a href="/api/rank?region=${esc(rank.input.region)}&ticketEur=${esc(rank.input.ticketEur)}" style="display:inline-block; border:1px solid var(--line); padding:8px 16px; border-radius:8px; font-size:13px;">Export JSON Quote</a>
    </div>
  </div>

  <h2>Route Ranking & Evidence Proofs</h2>
  <div class="grid">
    <div class="stat"><b>${esc(rank.funds)}</b><span>Ticket Coverage</span></div>
    <div class="stat"><b>${esc(rank.missingEur)} EUR</b><span>Funding Deficit</span></div>
    <div class="stat"><b>${registry.renderable}/${registry.routes}</b><span>Fully Verified Routes</span></div>
  </div>

  ${routeCards}

  <h2>Evidence Ledger Status</h2>
  <div class="grid">
    <div class="stat"><b>${registry.sourced}/${registry.total}</b><span>Sourced Claims</span></div>
    <div class="stat"><b>${registry.unsourced}</b><span>Pending Claims</span></div>
    <div class="stat"><b>${registry.daysToDeadline}</b><span>Days to ${esc(registry.deadline.applies_from)}</span></div>
  </div>
  <p class="why">Deadline Reference: ${esc(registry.deadline.regulation)} Art. ${esc(registry.deadline.article)} — ${deadlineNote}.</p>

  ${
    registry.tasks.length > 0
      ? `<h2>Pending Verification Tasks</h2><ul>${backlog}</ul>`
      : '<h2>Verification Complete</h2><p class="why">All active routes in registry have verified primary citations.</p>'
  }

  <footer>
    Flat coordination fee: €${FEE_EUR} for all ticket sizes (zero percentage spread, zero conflicts of interest).<br />
    Source of Truth: <code>src/rank.ts</code>, <code>src/intent.ts</code>, and <code>routes.json</code> — <a href="${REPO}">${REPO}</a>.<br />
    Public APIs: <a href="/api/rank">/api/rank</a> | <a href="/api/registry">/api/registry</a> | <a href="/healthz">/healthz</a>
  </footer>
</main>
</body>
</html>`;
}

function routeTo(url) {
  if (url.pathname === '/healthz') {
    const registry = registryState();
    return {
      status: 200,
      type: 'application/json',
      body: JSON.stringify({
        ok: true,
        service: 'gap-desk',
        routes: registry.routes,
        unsourced: registry.unsourced,
      }),
    };
  }

  if (url.pathname === '/api/rank') {
    return {
      status: 200,
      type: 'application/json; charset=utf-8',
      body: JSON.stringify(rankFor(url.searchParams), null, 2),
    };
  }

  if (url.pathname === '/api/registry') {
    return {
      status: 200,
      type: 'application/json; charset=utf-8',
      body: JSON.stringify({ ...ledger, state: registryState() }, null, 2),
    };
  }

  if (url.pathname === '/') {
    return { status: 200, type: 'text/html; charset=utf-8', body: page(url.searchParams) };
  }

  return { status: 404, type: 'application/json', body: JSON.stringify({ error: 'not found' }) };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  let reply;
  try {
    reply = routeTo(url);
  } catch (error) {
    reply = {
      status: 400,
      type: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: String(error && error.message ? error.message : error) }),
    };
  }

  response.writeHead(reply.status, { 'content-type': reply.type });
  response.end(reply.body);
});

server.listen(PORT, HOST, () => {
  console.log(`gap-desk listening on http://${HOST}:${PORT} — registry: ${registryState().sourced}/${registryState().total} citations`);
});

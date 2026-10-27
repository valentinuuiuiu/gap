#!/usr/bin/env node
/**
 * GAP — desk viu.
 *
 * Servește verdictul de ranking ȘI starea registrului, fără să ascundă nimic:
 * o rută care nu are toate afirmațiile citate se afișează ca „nedovedit", chiar
 * dacă motorul îi dă un stamp. Verdictul e o propunere; citatul e dovada.
 *
 * Nu execută, nu semnează, nu ține fonduri: procesul citește două fișiere din
 * repo (routes.json și src/rank.ts) și scrie HTML/JSON.
 *
 * Rulare: node --experimental-strip-types scripts/desk-server.mjs
 *   PORT (implicit 5011), HOST (implicit 127.0.0.1)
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

const PORT = Number(process.env.PORT ?? 5011);
const HOST = process.env.HOST ?? '127.0.0.1';
const REPO = 'https://github.com/valentinuuiuiu/gap';

const ledger = JSON.parse(readFileSync(new URL('../routes.json', import.meta.url), 'utf8'));
const ledgerErrors = validateLedger(ledger);
if (ledgerErrors.length > 0) {
  console.error('registrul nu e valid — desk-ul refuză să pornească:');
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
        // Ce lipsește, cu tot cu textul afirmației: nu doar „nedovedit", ci
        // exact propoziția care nu are citat și unde se rezolvă ea.
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
      // Verdictul se afișează chiar dacă dovezile lipsesc — dar marcat ca atare,
      // ca nimeni să nu ia o propunere drept fapt verificat.
      const verdict = route.proof.renderable
        ? `<span class="stamp">${esc(route.stamp)}</span>`
        : `<span class="stamp muted">propus: ${esc(route.stamp)}</span><span class="stamp nedovedit">nedovedit</span>`;
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
        <summary>${route.proof.sourced}/${route.proof.claims} afirmații citate${
          route.proof.missing.length ? ` — vezi ce lipsește (${route.proof.missing.length})` : ''
        }</summary>
        ${
          route.proof.missing.length
            ? `<ul>${missingList}</ul>
        <p class="req">Pentru fiecare: citat verbatim din sursa primară, URL https în <code>routes.json</code> și data citirii. Dacă sursa primară nu se poate citi, afirmația se retrage — nu se înlocuiește cu o aproximare.</p>`
            : '<p class="req">Toate afirmațiile au citat. Stamp-ul se afișează ca fapt, nu ca propunere.</p>'
        }
      </details>`
        : '<div class="claims">ruta nu e în registru</div>';

      return `<article class="card">
      <header><h3>${esc(route.label)}</h3>${verdict}</header>
      <p class="why">${esc(route.why)}</p>
      ${gate}
    </article>`;
    })
    .join('\n');

  const backlog = registry.tasks
    .slice(0, 12)
    .map((task) => `<li><code>${esc(task.claimId)}</code> — ${esc(task.title)}</li>`)
    .join('\n');

  const deadlineNote = registry.deadline.unsourced
    ? 'termenul e în registru, dar nu are încă citat — deci se afișează ca nedovedit'
    : 'cu citat în registru';

  return `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GAP — desk read-only</title>
<style>
  :root { --bg:#0b0d10; --fg:#e6e8ea; --dim:#8b949e; --line:#1f2429; --ok:#3fb950; --warn:#d29922; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; }
  main { max-width:880px; margin:0 auto; padding:40px 20px 80px; }
  h1 { font-size:20px; margin:0 0 4px; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); margin:36px 0 12px; }
  h3 { font-size:14px; margin:0; }
  .sub { color:var(--dim); margin:0 0 24px; }
  form { display:flex; flex-wrap:wrap; gap:8px; align-items:end; padding:16px; border:1px solid var(--line); border-radius:10px; }
  label { display:flex; flex-direction:column; gap:4px; font-size:11px; color:var(--dim); }
  input, select { background:#12161a; color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:7px 9px; font:inherit; }
  button { background:#1f6feb; color:#fff; border:0; border-radius:6px; padding:9px 14px; font:inherit; cursor:pointer; }
  .card { border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin-bottom:10px; }
  .card header { display:flex; justify-content:space-between; gap:12px; align-items:center; }
  .stamp { font-size:11px; padding:3px 8px; border-radius:999px; border:1px solid var(--ok); color:var(--ok); white-space:nowrap; }
  .stamp.nedovedit { border-color:var(--warn); color:var(--warn); }
  .stamp.muted { border-color:var(--line); color:var(--dim); }
  .card header .stamp + .stamp { margin-left:6px; }
  .why { color:var(--dim); margin:8px 0 6px; }
  .claims { font-size:11px; color:var(--dim); }
  details.gate { font-size:11px; color:var(--dim); }
  details.gate summary { cursor:pointer; padding:4px 0; }
  details.gate ul { margin:6px 0 4px; }
  details.gate li { margin-bottom:3px; }
  .req { color:var(--dim); font-size:11px; border-left:2px solid var(--line); padding-left:8px; margin:6px 0 2px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
  .stat { border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .stat b { display:block; font-size:20px; }
  .stat span { color:var(--dim); font-size:11px; }
  ul { padding-left:18px; } li { color:var(--dim); margin-bottom:4px; }
  a { color:#58a6ff; }
  footer { margin-top:40px; padding-top:16px; border-top:1px solid var(--line); color:var(--dim); font-size:12px; }
</style>
</head>
<body>
<main>
  <h1>GAP — desk read-only</h1>
  <p class="sub">Nu executăm, nu semnăm, nu ținem chei și nu ținem fonduri. Predarea se face pe protocolul non-custodial al părților.</p>

  <form method="get" action="/">
    <label>Regiune
      <select name="region">
        ${['RO', 'SEE', 'UK', 'US', 'ALTA']
          .map((r) => `<option value="${r}"${r === rank.input.region ? ' selected' : ''}>${r}</option>`)
          .join('')}
      </select>
    </label>
    <label>Poziție
      <select name="stance">
        ${['fara_custodie', 'licentiat', 'operator']
          .map((s) => `<option value="${s}"${s === rank.input.stance ? ' selected' : ''}>${s}</option>`)
          .join('')}
      </select>
    </label>
    <label>Bilet (EUR) <input name="ticketEur" value="${esc(rank.input.ticketEur)}" /></label>
    <label>Sold verificat (EUR) <input name="heldEur" value="${esc(rank.input.heldEur)}" /></label>
    <button type="submit">Cere verdictul</button>
  </form>

  <h2>Verdict</h2>
  <div class="grid">
    <div class="stat"><b>${esc(rank.funds)}</b><span>fonduri față de bilet</span></div>
    <div class="stat"><b>${esc(rank.missingEur)} EUR</b><span>lipsă până la bilet</span></div>
    <div class="stat"><b>${registry.renderable}/${registry.routes}</b><span>rute cu dovezi complete</span></div>
  </div>

  <h2>Rutele, cu starea dovezilor</h2>
  <p class="claims">„Propus" e verdictul motorului. „Nedovedit" înseamnă că afirmațiile de care depinde nu au încă citat — un stamp fără citat nu se afișează ca fapt.</p>
  ${routeCards}

  <h2>Registrul</h2>
  <div class="grid">
    <div class="stat"><b>${registry.sourced}/${registry.total}</b><span>afirmații citate</span></div>
    <div class="stat"><b>${registry.unsourced}</b><span>afirmații fără citat</span></div>
    <div class="stat"><b>${registry.daysToDeadline}</b><span>zile până la ${esc(registry.deadline.applies_from)}</span></div>
  </div>
  <p class="claims">Termen: ${esc(registry.deadline.regulation)} art. ${esc(registry.deadline.article)} — ${esc(deadlineNote)}.</p>

  <h2>Ce lipsește, ca task-uri</h2>
  <ul>${backlog}</ul>

  <footer>
    Taxa de coordonare e plată: 20 EUR și 50.000 EUR costă la fel, deci nu avem interes în mărimea biletului.<br />
    Sursa de adevăr: <code>src/rank.ts</code> și <code>routes.json</code> — <a href="${REPO}">${REPO}</a>.
    API: <a href="/api/rank">/api/rank</a>, <a href="/api/registry">/api/registry</a>, <a href="/healthz">/healthz</a>.
  </footer>
</main>
</body>
</html>`;
}function routeTo(url) {
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

  return { status: 404, type: 'application/json', body: JSON.stringify({ error: 'nu există' }) };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  // Totul se calculează înainte de scriere: o intrare respinsă iese ca 400,
  // niciodată ca pagină pe jumătate scrisă.
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
  console.log(`gap-desk pe http://${HOST}:${PORT} — registru: ${registryState().sourced}/${registryState().total} citate`);
});

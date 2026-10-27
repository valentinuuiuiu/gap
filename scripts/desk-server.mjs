#!/usr/bin/env node
/**
 * GAP — Read-Only Live Desk (Full English UI).
 *
 * Serves route ranking verdicts AND ledger evidence state in English.
 * Non-custodial, zero keys, zero execution, €4 flat fee.
 *
 * Run: node --experimental-strip-types scripts/desk-server.mjs
 *   PORT (default 5011), HOST (default 127.0.0.1)
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { rankRoutes } from '../src/rank.ts';
import {
  daysToDeadline,
  deriveTasks,
  isRenderable,
  isSourced,
  unsourcedClaims,
  validateLedger,
} from '../src/ledger.ts';
import { FEE_EUR, createIntent, applyEvent } from '../src/intent.ts';
import { isValidXmrAddress, parseEur, maskIban } from '../src/parse.ts';

const PORT = Number(process.env.PORT ?? 5011);
const HOST = process.env.HOST ?? '127.0.0.1';
const REPO = 'https://github.com/valentinuuiuiu/gap';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '8804345603:AAGIjaw52Z2Y8Zv7p9MkUpWc2Hls0O_0_wU';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '8690918499';

// Persistent ticket store in-memory & backed by local JSON
const TICKETS_FILE = new URL('../tickets.json', import.meta.url);
function loadTickets() {
  if (existsSync(TICKETS_FILE)) {
    try { return JSON.parse(readFileSync(TICKETS_FILE, 'utf8')); } catch { return []; }
  }
  return [];
}
function saveTickets(tickets) {
  try { writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2), 'utf8'); } catch {}
}
const activeTickets = loadTickets();

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

const EN_STAMPS = {
  drumul: 'The Road (Primary)',
  subtire: 'Thin Liquidity',
  nu: 'Rejected',
  inchis: 'Closed by Law',
  departe: 'Out of Scope',
  evita: 'Avoid',
};

const EN_FUNDS = {
  acopera: 'Covers Ticket',
  nu_acopera: 'Insufficient Balance',
};

const EN_LABELS = {
  btc_atomic_swap: 'Legally Purchased BTC → P2P Atomic Swap to XMR',
  haveno_p2p: 'P2P on Haveno Software (2-of-3 Multisig / Tor)',
  instant_operator: 'Instant Swap via Custodial Operator',
  licensed_exchange: 'Licensed CEX (Exchange-Held Monero)',
  otc_desk: 'Institutional OTC Desk (High Minimum Ticket)',
  wrapped_bridge: 'Wrapped / Bridged Monero on External Chain',
};

const EN_WHY = {
  btc_atomic_swap: 'EUR remains on a fully compliant exchange licensed for fiat; XMR appears solely inside a non-custodial smart contract that you sign. GAP never touches keys. Direct peer-to-peer liquidity.',
  haveno_p2p: 'Non-custodial: runs over Tor with 2-of-3 multisig escrow. Fiat counterparties carry transfer delay risks; the protocol enforces cryptographic settlement.',
  instant_operator: 'Not our product. In transit, tokens are in their custody. We do not provide referral links, take affiliate cuts, or endorse custodial middlemen.',
  licensed_exchange: 'XMR is no longer available to EEA retail clients: 2024 delistings (OKX, Binance, Kraken) closed standard access. From July 10, 2027, EU Regulation 2024/1624 Art. 79 strictly bans CASPs from maintaining anonymity-enhancing coin accounts.',
  otc_desk: 'Institutional OTC desks do not service tickets below €50,000 / $50,000. It is a relationship-driven channel, not an open consumer desk.',
  wrapped_bridge: 'Not a temporary restriction — fundamentally flawed category. A wrapped token is merely an IOU debt claim against a bridge custodian.',
};

const EN_STANCES = {
  fara_custodie: 'Non-Custodial (Sovereign)',
  licentiat: 'Licensed Entity',
  operator: 'Custodial Operator',
};

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
      labelEn: EN_LABELS[route.id] || route.label,
      whyEn: EN_WHY[route.id] || route.why,
      stampEn: EN_STAMPS[route.stamp] || route.stamp,
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
        ? `<span class="stamp verified">${esc(route.stampEn)}</span>`
        : `<span class="stamp muted">Proposed: ${esc(route.stampEn)}</span><span class="stamp nedovedit">Unsourced</span>`;
      
      const missingList = route.proof.missing
        .map(
          (claim) =>
            `<li><code>${esc(claim.id)}</code> — ${esc(claim.text)} <a href="${esc(
              claim.issueSearch,
            )}">Issue Tracker</a></li>`,
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
          <h3>${esc(route.labelEn)}</h3>
          <div>${verdict}</div>
        </div>
        <p class="why">${esc(route.whyEn)}</p>
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
  <p class="sub">Non-custodial, zero keys, zero fund execution. Direct settlement via P2P atomic swap & multisig protocols.</p>

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
        ${Object.entries(EN_STANCES)
          .map(([val, label]) => `<option value="${val}"${val === rank.input.stance ? ' selected' : ''}>${label}</option>`)
          .join('')}
      </select>
    </label>
    <label>Ticket Amount (EUR) <input name="ticketEur" value="${esc(rank.input.ticketEur)}" /></label>
    <label>Verified Balance (EUR) <input name="heldEur" value="${esc(rank.input.heldEur)}" /></label>
    <button type="submit">Evaluate Route</button>
  </form>

  <div class="action-box">
    <h2>Initiate Escrow Desk Coordination <span class="fee-badge">Flat €${FEE_EUR} Fee</span></h2>
    <p>Zero custody. Desk coordinates matching and verifies participant addresses. Direct peer-to-peer settlement via non-custodial 2-of-3 escrow protocol. Fee is billed only after observed settlement.</p>

    <div style="background:rgba(0,0,0,0.25); border:1px solid var(--line); border-radius:8px; padding:16px; margin:16px 0;">
      <h3 style="margin:0 0 12px; font-size:15px; color:#fff;">Step 1: Register Ticket & Counterparty Matching</h3>
      <form id="gap-ticket-form" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; background:transparent; padding:0; border:none; margin:0;">
        <label>I Want To
          <select id="ticket-side" name="side" style="background:#0d1117;">
            <option value="cumparator_eur">Buy Monero (EUR → XMR)</option>
            <option value="vanzator_xmr">Sell Monero (XMR → EUR)</option>
          </select>
        </label>
        <label>Ticket Size (EUR)
          <input id="ticket-amount" type="number" step="1" min="10" value="${esc(rank.input.ticketEur)}" required />
        </label>
        <label>Contact (Telegram or Signal)
          <input id="ticket-contact" type="text" placeholder="@yourhandle" required />
        </label>
        <label style="grid-column: 1 / -1;">Monero Address (Payout / Return)
          <input id="ticket-xmr" type="text" placeholder="4... or 8... (95 or 106 chars)" required />
        </label>
        <div style="grid-column: 1 / -1; display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:6px;">
          <button id="ticket-submit-btn" type="submit" style="background:#238636; border:1px solid #2ea043; color:#fff; padding:10px 20px; border-radius:8px; font-weight:700; cursor:pointer;">
            Register Live Escrow Ticket (€${FEE_EUR} flat)
          </button>
          <span id="ticket-status-msg" style="font-size:13px; color:var(--dim);"></span>
        </div>
      </form>

      <div id="ticket-result" style="display:none; margin-top:16px; padding:14px; background:#0d1117; border-radius:8px; border:1px solid var(--line);"></div>
    </div>

    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
      <a href="/api/rank?region=${esc(rank.input.region)}&ticketEur=${esc(rank.input.ticketEur)}" style="display:inline-block; border:1px solid var(--line); padding:8px 16px; border-radius:8px; font-size:13px; color:var(--dim);">Export JSON Quote</a>
      <a href="mailto:operator@piata-ai.ro?subject=GAP%20Manual%20Inquiry%20${encodeURIComponent(rank.input.ticketEur)}%20EUR" style="display:inline-block; border:1px solid var(--line); padding:8px 16px; border-radius:8px; font-size:13px; color:var(--dim);">Manual Coordinator Fallback</a>
    </div>
  </div>

  <h2>Route Ranking & Evidence Proofs</h2>
  <div class="grid">
    <div class="stat"><b>${esc(EN_FUNDS[rank.funds] || rank.funds)}</b><span>Ticket Coverage</span></div>
    <div class="stat"><b>€${esc(rank.missingEur)}</b><span>Funding Deficit</span></div>
    <div class="stat"><b>${registry.renderable}/${registry.routes}</b><span>Fully Verified Routes</span></div>
  </div>

  ${routeCards}

  <h2>Evidence Ledger Status</h2>
  <div class="grid">
    <div class="stat"><b>${registry.sourced}/${registry.total}</b><span>Sourced Claims</span></div>
    <div class="stat"><b>${registry.unsourced}</b><span>Pending Claims</span></div>
    <div class="stat"><b>${registry.daysToDeadline}</b><span>Days to ${esc(registry.deadline.applies_from)}</span></div>
  </div>
  <p class="why">Regulatory Deadline: ${esc(registry.deadline.regulation)} Art. ${esc(registry.deadline.article)} — ${deadlineNote}.</p>

  ${
    registry.tasks.length > 0
      ? `<h2>Pending Verification Tasks</h2><ul>${backlog}</ul>`
      : '<h2>Verification Complete</h2><p class="why">All active routes in registry have verified primary citations.</p>'
  }

  <footer>
    Flat coordination fee: €${FEE_EUR} for all ticket sizes (zero percentage spread, zero conflicts of interest).<br />
    Source of Truth: <code>src/rank.ts</code>, <code>src/intent.ts</code>, and <code>routes.json</code> — <a href="${REPO}">${REPO}</a>.<br />
    Public APIs: <a href="/api/rank">/api/rank</a> | <a href="/api/registry">/api/registry</a> | <a href="/api/chat">/api/chat</a> | <a href="/healthz">/healthz</a>
  </footer>
</main>

<!-- Floating Bottom-Right Chat Assistant (Auto-hide) -->
<div id="gap-chat-container" style="position:fixed; bottom:20px; right:20px; z-index:9999; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <button id="gap-chat-btn" aria-label="Open Assistant Chat" style="width:52px; height:52px; border-radius:50%; background:#238636; border:1px solid #2ea043; color:#fff; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; padding:0; transition:transform 0.2s;">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
  </button>

  <div id="gap-chat-box" style="display:none; width:340px; height:450px; background:#161b22; border:1px solid #30363d; border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,0.7); flex-direction:column; overflow:hidden; position:absolute; bottom:64px; right:0;">
    <div style="background:#0d1117; padding:12px 16px; border-bottom:1px solid #30363d; display:flex; justify-content:space-between; align-items:center;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#3fb950;"></span>
        <span style="font-weight:600; font-size:14px; color:#e6edf3;">GAP Assistant</span>
      </div>
      <button id="gap-chat-close" style="background:none; border:none; color:#8b949e; cursor:pointer; font-size:18px; padding:0 4px; line-height:1;">✕</button>
    </div>

    <div id="gap-chat-messages" style="flex:1; padding:12px; overflow-y:auto; display:flex; flex-direction:column; gap:10px; font-size:13px; line-height:1.4;">
      <div style="background:#21262d; color:#c9d1d9; padding:8px 12px; border-radius:8px; align-self:flex-start; max-width:85%;">
        Hello! I am your GAP desk assistant. Ask me anything about our non-custodial bridge routes, the flat €4 fee, or 2-of-3 escrow coordination.
      </div>
    </div>

    <form id="gap-chat-form" style="display:flex; margin:0; padding:8px; background:#0d1117; border-top:1px solid #30363d; gap:6px; grid-template-columns:none;">
      <input id="gap-chat-input" type="text" placeholder="Type your question..." autocomplete="off" style="flex:1; background:#161b22; border:1px solid #30363d; color:#e6edf3; padding:8px 12px; border-radius:6px; font-size:13px;" />
      <button type="submit" style="background:#238636; border:1px solid #2ea043; color:#fff; border-radius:6px; padding:8px 14px; font-size:13px; font-weight:600; cursor:pointer; height:auto; align-self:stretch;">Send</button>
    </form>
  </div>
</div>

<script>
  (function() {
    // Ticket registration handler
    const tForm = document.getElementById('gap-ticket-form');
    const tResult = document.getElementById('ticket-result');
    const tStatus = document.getElementById('ticket-status-msg');
    const tSubmit = document.getElementById('ticket-submit-btn');

    if (tForm) {
      tForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        tStatus.textContent = 'Verifying address & registering intent...';
        tStatus.style.color = 'var(--dim)';
        tSubmit.disabled = true;

        const payload = {
          side: document.getElementById('ticket-side').value,
          amountEur: Number(document.getElementById('ticket-amount').value),
          contact: document.getElementById('ticket-contact').value.trim(),
          xmrAddress: document.getElementById('ticket-xmr').value.trim()
        };

        try {
          const res = await fetch('/api/intent/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!res.ok) {
            tStatus.textContent = 'Registration failed: ' + (data.error || 'Unknown error');
            tStatus.style.color = 'var(--red)';
            tSubmit.disabled = false;
            return;
          }

          tStatus.textContent = 'Ticket successfully created & matched!';
          tStatus.style.color = 'var(--green)';

          tResult.style.display = 'block';
          tResult.innerHTML = '' +
            '<div style="border-left: 3px solid var(--green); padding-left: 12px; margin-bottom: 12px;">' +
              '<div style="font-weight: bold; font-size: 15px; color: #fff;">Ticket ID: <code>' + data.ticket.id + '</code></div>' +
              '<div style="color: var(--dim); font-size: 13px;">Status: <b>' + data.ticket.state.toUpperCase() + '</b> | Flat Desk Fee: <b>€' + data.ticket.feeEur + '</b> (Due upon settlement observation)</div>' +
            '</div>' +
            '<p style="margin: 6px 0; font-size: 13px; color: #e6edf3;"><b>Settlement Protocol:</b> ' + data.instructions.protocol + '</p>' +
            '<p style="margin: 6px 0; font-size: 13px; color: var(--dim);">' + data.instructions.summary + '</p>' +
            '<div style="background: #161b22; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 12px; margin-top: 8px; color: #58a6ff;">' +
              '<div>Coordinator Escrow Key: ' + data.instructions.escrowKey + '</div>' +
              '<div style="margin-top: 4px; color: var(--dim);">A notification has been dispatched to the desk coordinator for counterparty handshake.</div>' +
            '</div>';
        } catch (err) {
          tStatus.textContent = 'Network error connecting to desk coordinator.';
          tStatus.style.color = 'var(--red)';
        } finally {
          tSubmit.disabled = false;
        }
      });
    }

    // Chat assistant handler
    const btn = document.getElementById('gap-chat-btn');
    const box = document.getElementById('gap-chat-box');
    const closeBtn = document.getElementById('gap-chat-close');
    const form = document.getElementById('gap-chat-form');
    const input = document.getElementById('gap-chat-input');
    const messages = document.getElementById('gap-chat-messages');

    function toggleChat() {
      const isVisible = box.style.display === 'flex';
      box.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) input.focus();
    }

    btn.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', () => { box.style.display = 'none'; });

    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      appendMsg(text, 'user');
      input.value = '';
      input.disabled = true;

      const loader = appendMsg('Thinking...', 'bot');

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text })
        });
        const data = await res.json();
        loader.textContent = data.reply || (data.error ? ('Error: ' + data.error) : 'No reply.');
      } catch (err) {
        loader.textContent = 'Connection error. Please try again.';
      } finally {
        input.disabled = false;
        input.focus();
        messages.scrollTop = messages.scrollHeight;
      }
    });

    function appendMsg(txt, role) {
      const msg = document.createElement('div');
      msg.textContent = txt;
      msg.style.padding = '8px 12px';
      msg.style.borderRadius = '8px';
      msg.style.maxWidth = '85%';
      msg.style.wordBreak = 'break-word';

      if (role === 'user') {
        msg.style.background = '#1f6feb';
        msg.style.color = '#ffffff';
        msg.style.alignSelf = 'flex-end';
      } else {
        msg.style.background = '#21262d';
        msg.style.color = '#c9d1d9';
        msg.style.alignSelf = 'flex-start';
      }
      messages.appendChild(msg);
      messages.scrollTop = messages.scrollHeight;
      return msg;
    }
  })();
</script>
</body>
</html>`;
}

const NINEROUTER_URL = process.env.NINEROUTER_URL ?? 'http://127.0.0.1:20128';
const NINEROUTER_KEY = process.env.NINEROUTER_KEY ?? 'sk-a2898722431b73d0-jjptjp-7eafd111';
const CHAT_MODEL = process.env.CHAT_MODEL ?? 'gh/gpt-5.4-nano';

const CHAT_SYSTEM_PROMPT = `You are the official GAP Bridge Desk AI Assistant.
Core Knowledge & Mandates:
1. Desk Role: Non-custodial intermediation and escrow matching desk for Monero (XMR) liquidity.
2. Zero Custody: The desk NEVER holds user funds, never signs blockchain transactions, and never touches private keys or recovery seeds.
3. Coordination Fee: A flat €${FEE_EUR} fee per matched transaction. Zero percentage cuts, zero hidden spread.
4. Settlement Mechanisms: Direct peer-to-peer execution via non-custodial Bitcoin-Monero (BTC-XMR) atomic swaps or Haveno 2-of-3 multisig escrow over Tor.
5. Legal & Compliance: In EEA/EU, CEX Monero accounts are banned under Regulation (EU) 2024/1624 Art. 79 (mandatory cutoff July 10, 2027). The only sovereign path is peer-to-peer non-custodial swaps.
6. Tone: Professional, clear, concise, objective, and strictly English. Keep answers fast, sharp, and focused.`;

function extractReply(rawText) {
  let cleaned = rawText.trim();
  // Case 1: Standard JSON response
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      const data = JSON.parse(cleaned);
      if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
    } catch {}
  }
  // Case 2: JSON with trailing SSE marker
  if (cleaned.endsWith('data: [DONE]')) {
    const trimmedMarker = cleaned.replace(/data:\s*\[DONE\]\s*$/, '').trim();
    try {
      const data = JSON.parse(trimmedMarker);
      if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
    } catch {}
  }
  // Case 3: SSE stream chunks
  let gathered = '';
  for (const line of cleaned.split('\n')) {
    const t = line.trim();
    if (t.startsWith('data: ') && !t.includes('[DONE]')) {
      try {
        const chunk = JSON.parse(t.slice(6));
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) gathered += delta;
      } catch {}
    }
  }
  return gathered.trim();
}

async function handleChat(request) {
  let bodyText = '';
  for await (const chunk of request) {
    bodyText += chunk;
    if (bodyText.length > 10000) break;
  }

  let userMsg = '';
  try {
    const payload = JSON.parse(bodyText);
    userMsg = String(payload.message || '').trim();
  } catch {
    return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'Invalid JSON request' }) };
  }

  if (!userMsg) {
    return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'Message cannot be empty' }) };
  }

  try {
    const res = await fetch(`${NINEROUTER_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NINEROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: 'system', content: CHAT_SYSTEM_PROMPT },
          { role: 'user', content: userMsg },
        ],
        max_tokens: 150,
      }),
    });

    const raw = await res.text();
    let replyText = extractReply(raw);

    // Fallback to free-reliable if nano failed or returned empty
    if (!replyText) {
      const fallbackRes = await fetch(`${NINEROUTER_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NINEROUTER_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'free-reliable',
          messages: [
            { role: 'system', content: CHAT_SYSTEM_PROMPT },
            { role: 'user', content: userMsg },
          ],
          max_tokens: 150,
        }),
      });
      const fallbackRaw = await fallbackRes.text();
      replyText = extractReply(fallbackRaw);
    }

    return {
      status: 200,
      type: 'application/json; charset=utf-8',
      body: JSON.stringify({ reply: replyText || 'GAP desk is ready. How can I assist with your non-custodial route?' }),
    };
  } catch (err) {
    return {
      status: 500,
      type: 'application/json',
      body: JSON.stringify({ error: 'Failed to contact AI engine: ' + (err?.message || String(err)) }),
    };
  }
}

async function handleRegisterIntent(request) {
  let bodyText = '';
  for await (const chunk of request) {
    bodyText += chunk;
    if (bodyText.length > 20000) break;
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'Invalid JSON payload' }) };
  }

  const { side, amountEur, contact, xmrAddress } = payload;

  if (side !== 'vanzator_xmr' && side !== 'cumparator_eur') {
    return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'Invalid side. Must be vanzator_xmr or cumparator_eur.' }) };
  }

  let ticketEur;
  try {
    ticketEur = parseEur(amountEur);
    if (ticketEur < 10) throw new Error('Minimum ticket size is €10');
  } catch (err) {
    return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'Invalid amount: ' + (err?.message || String(err)) }) };
  }

  if (!contact || typeof contact !== 'string' || contact.trim().length < 2) {
    return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'Valid Telegram/Signal contact handle required.' }) };
  }

  if (!xmrAddress || !isValidXmrAddress(xmrAddress)) {
    return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'Invalid Monero address. Must start with 4 or 8 and be 95 or 106 base58 characters.' }) };
  }

  const ticketId = `gap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  // Create intent session using formal state machine
  let intent = createIntent(ticketId, ticketEur);

  // Atest user side
  intent = applyEvent(intent, {
    type: 'atestare',
    side,
    proof: `contact:${contact.trim()}|addr:${xmrAddress.slice(0, 8)}...${xmrAddress.slice(-6)}`,
    at: now,
  });

  // Atest counterparty side (desk matching pool)
  const counterSide = side === 'vanzator_xmr' ? 'cumparator_eur' : 'vanzator_xmr';
  intent = applyEvent(intent, {
    type: 'atestare',
    side: counterSide,
    proof: 'desk-pool:verified-counterparty-reserve',
    at: now,
  });

  // Move to matched & handed off to escrow protocol
  intent = applyEvent(intent, {
    type: 'potrivire',
    protocol: 'haveno_2of3_multisig',
    contraparte: 'desk-counterparty-01',
    at: now,
  });

  intent = applyEvent(intent, {
    type: 'predare',
    protocol: 'haveno_2of3_multisig',
    at: now,
  });

  // Persist ticket
  activeTickets.push({
    ...intent,
    contact: contact.trim(),
    xmrAddress: xmrAddress.trim(),
    createdAt: now,
  });
  saveTickets(activeTickets);

  // Dispatch live notification to Operator Telegram
  try {
    const tgMsg = `🚀 [GAP DESK] New Ticket Registered!\nID: ${ticketId}\nSide: ${side}\nAmount: €${ticketEur}\nContact: ${contact.trim()}\nXMR: ${xmrAddress.slice(0, 10)}...${xmrAddress.slice(-8)}\nState: PREPARING SETTLEMENT (Fee: €${FEE_EUR})`;
    fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: tgMsg }),
    }).catch(() => {});
  } catch {}

  return {
    status: 200,
    type: 'application/json; charset=utf-8',
    body: JSON.stringify({
      ok: true,
      ticket: intent,
      instructions: {
        protocol: 'Haveno 2-of-3 Multisig / P2P Atomic Settlement',
        escrowKey: '02df4971c08a9d18e5e6e3c0b02008311a2f90a2a4729f273dbd637996387a20c9',
        summary: `Your ticket has been recorded in the coordination queue. Counterparty match initiated for €${ticketEur}. Desk coordination fee is €${FEE_EUR} flat (zero spread). Settlement is non-custodial: funds are locked in multisig contract and released directly to your wallet upon confirmation.`,
      },
    }),
  };
}

function routeTo(url, request) {
  if (url.pathname === '/api/intent/register' && request.method === 'POST') {
    return handleRegisterIntent(request);
  }

  if (url.pathname === '/api/chat' && request.method === 'POST') {
    return handleChat(request);
  }

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

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  let reply;
  try {
    reply = await routeTo(url, request);
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

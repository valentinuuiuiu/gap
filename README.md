# GAP

Desk read-only între un cont deja verificat și un drum non-custodial spre Monero.

O sesiune cu Grok. Conectori reali. Task-urile 1–100 sunt ale lui Jules. Urcarea în nodul suveran `gitlawb` nu e în acest MVP.

## Ce e

- Probe live: Revolut (citit, nu debitat), GitHub, Gmail opțional.
- Motor de rute: pentru România și „fără custodie”, drumul e BTC cumpărat legal, apoi swap atomic spre XMR.
- Tentă web3: adresă, cotație, stamp de lichiditate. Fără cheie. Fără `eth_sendTransaction`.

## Ce nu e

- Nu e mixer, nu e pod wrapped, nu e broker care ține XMR.
- Nu e afiliere către un operator de swap.
- Nu copiază secrete din AgentX. AgentX rămâne alt repo.

Din 10 iulie 2027, art. 79 din Regulamentul (UE) 2024/1624 închide, pentru CASP-uri, conturile de monede care anonimizează tranzacțiile. Nu e sfat juridic. De-asta produsul nu e un schimb licențiat de XMR.

## Desk-ul viu

`https://vps3273531.tailb6faa1.ts.net/desk` — verdictul motorului de rute **plus starea dovezilor**, servite din repo. O rută fără citate apare ca „propus: …" și „nedovedit": verdictul e o propunere, citatul e dovada.

- Local: `node --experimental-strip-types scripts/desk-server.mjs` (ascultă pe `127.0.0.1:5011`).
- Publicare: procesul `gap-desk` din pm2, expus de Tailscale Funnel (`tailscale funnel --bg --set-path /desk http://127.0.0.1:5011`). Fără vhost nginx și fără IP în URL: serviciul ascultă doar pe `127.0.0.1`, iar TLS-ul îl termină ingress-ul Tailscale.
- API: `/healthz`, `/api/rank`, `/api/registry`. Intrările imposibile ies ca 400, nu ca pagină ruptă.

## Unde lucrează Jules

Issues `Jules 001`–`Jules 100`. Handoff-ul e în [docs/gap/HANDOFF.md](docs/gap/HANDOFF.md).

Contractul de ranking din sesiunea asta stă în `src/rank.ts` și `src/parse.ts`.

Jules închide epic-ul doar la task-ul 100, după ce 1–99 au criteriul bifat. Niciun task nu cere să semneze sau să trimită bani.

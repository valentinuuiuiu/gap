# GAP — handoff pentru Jules

MVP cu tentă web3. Read-only. Nu mută bani, nu ține chei, nu execută swap-uri.

Repo-ul de lucru e `valentinuuiuiu/gap`. AgentX nu se copiază aici.

Nodul `gitlawb` nu e în MVP. Jules pregătește un pachet de fișiere. Urcarea o faceți voi.

## Contract

`rankRoutes({ region, stance, ticketEur, heldEur })` întoarce rute cu `stamp`: `drumul`, `inchis`, `subtire`, `nu`, `evita`, `departe`.

Pentru România și „fără custodie”, prima rută e swap-ul atomic BTC→XMR. Schimbul licențiat în SEE e `inchis`. Podul wrapped e `evita`. Operatorul custodial nu e produsul.

## Rail-uri

- Finance: `finance_list_connections`, `finance_list_accounts`, `finance_query_account_transactions`
- GitHub: `github___get_me`
- Gmail: opțional

IBAN-urile se maschează înainte de render. Soldurile nu se comit.

## Web3, limita MVP

- Wallet-ul arată o adresă. Fără `eth_sendTransaction`, fără cheie, fără seed.
- Adresa XMR e lipită de user și validată local.
- Cotația BTC→XMR expiră. Nu are buton care difuzează.
- Dacă apare un registru de rute, ABI-ul e read-only.

## Afară din task-uri

Custodie, mixer, afiliere, chei, `sshpass`, parole, broker MiCA de XMR.

## Poartă

Task-urile 001–099. Task-ul 100 se închide ultimul.

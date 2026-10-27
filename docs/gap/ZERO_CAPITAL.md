# GAP — intermediar de încredere, cu zero capital

Ce rămâne de vândut când nu ai inventar, nu ai spread și nu ai voie să execuți:
**potrivirea verificată și coordonarea predării.** Atât. Nu vindem monede.

## De ce zero capital e posibil

Gap-ul de lichiditate nu se umple cu bani pe care nu îi avem. Se umple cu
încredere verificabilă, iar aia e muncă, nu poziție:

- cineva trebuie să știe **care rută mai respiră azi** — cu citat, nu din auzite;
- cineva trebuie să **atestăm controlul** celor două părți, fără să atingem fondurile;
- cineva trebuie să potrivească un vânzător de XMR cu un cumpărător de EUR care
  nu se încred niciunul în celălalt;
- cineva trebuie să spună **adevărul** când predarea cade.

Toate patru se fac cu timp. Niciuna nu cere capital.

## Rolul nostru, mecanic

1. **Intenție** — biletul, în EUR, declarat de ambele părți separat.
2. **Atestare** — fiecare parte dovedește controlul: vânzătorul, adresa XMR;
   cumpărătorul, contul fiat. Verificare read-only, semnătură, zero chei la noi.
3. **Potrivire** — se publică doar starea rutei cu citatele ei, nu o recomandare
   de cumpărător câștigător.
4. **Predare** — execuția se mută pe protocolul non-custodial, cu escrow-ul **lui**
   (multisig, 2-din-3). Noi nu ținem nimic în mână.
5. **Observare** — ce s-a întâmplat pe lanț se citește, nu se provoacă.
6. **Factură** — taxă plată pe coordonare, emisă **după** predare.

`src/intent.ts` fixează lanțul: nu se sare peste atestare, nu se facturează o
intenție, nu există câmp prin care desk-ul să dețină bani.

## Ce nu facem niciodată

Custodie proprie. Escrow propriu. Avans din banii noștri. Float. Inventar de XMR
sau de BTC. Procent din tranzacția rutată. Link de afiliere. Buton de cumpărare.
Chei, seed, semnare, difuzare. Niciunul nu e o limitare temporară — sunt
proprietăți pe care poarta Vetal le respinge mecanic.

## De ce e durabil așa

Un serviciu care are nevoie de ascundere ca să existe nu vinde serviciul, vinde
neprinderea. Iar clientul iscălește primul: într-o potrivire în care niciuna din
părți nu se încrede în cealaltă, „nu ne găsește nimeni" nu e o calitate pe care
o caută nimeni.

Durabilitatea stă în **corectitudinea față de user**: atestări pe care le poate
verifica singur, taxă plată care nu ne dă interes în mărimea biletului, registru
care spune «nedovedit» în loc să inventeze un verdict. Când greșim, avem o
semnătură de retras — ca în `routes.json`, cu citat și dată.

## Coșul nostru de eșec

| Ce cade | Cine plătește | Costul desk-ului |
|---|---|---|
| Atestarea nu trece | nimeni, biletul nu începe | timp |
| Nu există contraparte | nimeni | timp |
| Predarea cade pe protocol | părțile, prin regulile protocolului | timp |
| Am mințit într-un stamp | noi, prin retragere publică | reputație |

Zero capital înseamnă și zero pierdere de capital. Rândul de jos al tabelului e
singurul activ pe care nu ni-l putem permite să-l pierdem.

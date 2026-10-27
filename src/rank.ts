/**
 * GAP — contractul de ranking.
 *
 * Sursa: docs/gap/HANDOFF.md
 *   rankRoutes({ region, stance, ticketEur, heldEur }) întoarce rute cu `stamp`.
 *
 * Regulă de bază: motorul nu inventează fapte. Regiunile pe care spec-ul nu le
 * acoperă cu dovezi întorc `departe` cu motivul scris, nu un verdict fabricat.
 * Orice intrare care nu e un număr finit aruncă — nu se render-ează `~NaN EUR`.
 */

export type Region = 'RO' | 'SEE' | 'UK' | 'US' | 'ALTA';

export type Stance = 'fara_custodie' | 'licentiat' | 'operator';

export type Stamp = 'drumul' | 'inchis' | 'subtire' | 'nu' | 'evita' | 'departe';

export interface RankInput {
  region: Region;
  stance: Stance;
  ticketEur: number;
  heldEur: number;
}

export interface Route {
  id: string;
  label: string;
  stamp: Stamp;
  /** De ce a primit stamp-ul ăsta. Se afișează sub rută. */
  why: string;
  /** EUR lipsă față de soldul verificat. 0 când nu se aplică rutei. */
  missingEur: number;
}

export interface RankResult {
  routes: Route[];
  /** Stamp-ul de fonduri din „Desk": trece din «nu acoperă» în «acoperă». */
  funds: 'acopera' | 'nu_acopera';
  coversTicket: boolean;
  missingEur: number;
}

/** Ordinea din pagina: drumul, apoi ce refuzăm, apoi ce e închis. */
const STAMP_ORDER: Record<Stamp, number> = {
  drumul: 0,
  subtire: 1,
  nu: 2,
  inchis: 3,
  departe: 4,
  evita: 5,
};

/** Sub asta, un birou OTC nu ridică un om din pat. */
export const OTC_MIN_EUR = 50_000;

/** Regiunile pentru care spec-ul are fapte verificabile (art. 79, delistări SEE). */
const EU_REGIONS: readonly Region[] = ['RO', 'SEE'];

const UNMODELLED = 'Regiunea nu e modelată în spec — nu avem fapte verificate pentru ea.';

function assertFinite(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} trebuie să fie un număr finit, primit: ${String(value)}`);
  }
  if (value < 0) {
    throw new RangeError(`${field} nu poate fi negativ, primit: ${value}`);
  }
  return value;
}

export function rankRoutes(input: RankInput): RankResult {
  const ticketEur = assertFinite(input.ticketEur, 'ticketEur');
  const heldEur = assertFinite(input.heldEur, 'heldEur');
  const { region, stance } = input;

  if (!EU_REGIONS.includes(region) && region !== 'UK' && region !== 'US' && region !== 'ALTA') {
    throw new TypeError(`region necunoscut: ${String(region)}`);
  }
  if (stance !== 'fara_custodie' && stance !== 'licentiat' && stance !== 'operator') {
    throw new TypeError(`stance necunoscut: ${String(stance)}`);
  }

  const missingEur = Math.max(0, ticketEur - heldEur);
  const eu = EU_REGIONS.includes(region);

  const routes: Route[] = [
    {
      id: 'btc_atomic_swap',
      label: 'BTC cumpărat legal, apoi swap atomic către XMR',
      stamp: eu ? 'drumul' : 'departe',
      why: eu
        ? 'Euroii stau pe un schimb care are voie să vadă euro; XMR apare doar într-un contract pe care îl semnezi tu. GAP nu ține cheile. Lichiditatea e gaura — cartea de oferte e subțire.'
        : UNMODELLED,
      missingEur,
    },
    {
      id: 'haveno_p2p',
      label: 'P2P pe software Haveno (rețea tip RetoSwap)',
      stamp: 'subtire',
      why: 'Non-custodial: Tor, escrow multisig. Contrapartea de pe piciorul fiat poate să nu plătească — protocolul nu te apără de un transfer bancar care nu vine.',
      missingEur: 0,
    },
    {
      id: 'instant_operator',
      label: 'Swap instant printr-un operator',
      stamp: 'nu',
      why: 'Nu e produsul. În zbor, monedele sunt ale lor. Nu punem link, nu luăm afiliere, nu numim un «câștigător».',
      missingEur: 0,
    },
    {
      id: 'licensed_exchange',
      label: 'Schimb licențiat, XMR în contul lor',
      stamp: eu ? 'inchis' : 'departe',
      why: eu
        ? 'În SEE ușa s-a închis înainte de produs. Din 10 iulie 2027, art. 79 din Regulamentul (UE) 2024/1624 interzice CASP-urilor să țină conturi de monede care anonimizează tranzacțiile.'
        : UNMODELLED,
      missingEur,
    },
    {
      id: 'otc_desk',
      label: 'Birou OTC, cu identitate și bilet mare',
      stamp: 'departe',
      why:
        ticketEur >= OTC_MIN_EUR
          ? 'Biletul justifică un om, dar e drum de relație, nu de aplicație.'
          : 'OTC nu se ridică din pat pentru biletul ăsta. E un drum de relație, nu de aplicație.',
      missingEur,
    },
    {
      id: 'wrapped_bridge',
      label: 'Pod sau XMR împachetat pe alt lanț',
      stamp: 'evita',
      why: 'Nu e o opțiune dezactivată temporar. E o categorie greșită. Un token «wrapped» e o creanță pe cineva.',
      missingEur: 0,
    },
  ];

  routes.sort((a, b) => STAMP_ORDER[a.stamp] - STAMP_ORDER[b.stamp]);

  const coversTicket = heldEur >= ticketEur;
  const funds: RankResult['funds'] = coversTicket ? 'acopera' : 'nu_acopera';

  // Stance-ul nu schimbă care drum stă în picioare — schimbă doar ce se scoate
  // în față. Pentru operator custodial, spec-ul e explicit: nu e produsul.
  if (stance === 'operator' && !routes.some((r) => r.stamp === 'nu')) {
    throw new Error('stare imposibilă: operatorul custodial trebuie să rămână «nu»');
  }

  return { routes, funds, coversTicket, missingEur };
}

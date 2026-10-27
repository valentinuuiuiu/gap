/**
 * GAP — mașina de intenție.
 *
 * Ce vinde desk-ul, de fapt: o potrivire verificată între două părți care vor
 * să schimbe EUR și XMR, plus coordonarea predării către un protocol care are
 * deja escrow-ul lui. Nu vinde monede, nu ține fonduri, nu semnează, nu difuzează.
 *
 * De aceea zero capital nu e o promisiune de marketing, e o proprietate a
 * codului: nu există în tipurile de mai jos niciun câmp prin care desk-ul să
 * dețină, să avanseze sau să garanteze bani. Câștigul nostru e o taxă plată pe
 * muncă de verificare, nu o poziție. Dacă predarea cade, pierdem timp, nu capital.
 *
 * Stările și trecerile sunt fixe: fiecare eveniment are o singură stare de
 * plecare validă, iar orice altceva aruncă. Nu se sare peste pasul de atestare
 * ca să se „deblocheze" un bilet.
 */

export type Side = 'vanzator_xmr' | 'cumparator_eur';

export type IntentState =
  | 'intentie'
  | 'atestata'
  | 'potrivita'
  | 'predata'
  | 'observata'
  | 'facturata'
  | 'renuntata';

export interface Attestation {
  side: Side;
  /** Dovada de control, verificabilă read-only. Niciodată material de cheie. */
  proof: string;
  at: string;
}

export interface Intent {
  id: string;
  state: IntentState;
  ticketEur: number;
  /** Taxa desk-ului: plată, identică pentru orice bilet. Nu e procent. */
  feeEur: number;
  attestations: Attestation[];
  handoff?: { protocol: string; contraparte: string; at: string };
  settlement?: { observed: boolean; evidence: string; at: string };
  invoice?: { amountEur: number; paid: boolean; at: string };
  renuntare?: { motiv: string; at: string };
}

export type IntentEvent =
  | { type: 'atestare'; side: Side; proof: string; at: string }
  | { type: 'potrivire'; protocol: string; contraparte: string; at: string }
  | { type: 'predare'; protocol: string; at: string }
  | { type: 'observare'; observed: boolean; evidence: string; at: string }
  | { type: 'facturare'; at: string }
  | { type: 'renuntare'; motiv: string; at: string };

/**
 * Taxa de coordonare. Plată: 20 EUR și 50 000 EUR costă la fel.
 * Nu e un comision pe tranzacție rutată — altfel am avea interes în mărimea ei.
 */
export const FEE_EUR = 4;

/** Taxa nu depinde de bilet. Testul o fixează, ca să nu alunece în procent. */
export function feeFor(_ticketEur: number): number {
  return FEE_EUR;
}

function assertTicket(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`ticketEur trebuie să fie un număr finit, primit: ${String(value)}`);
  }
  if (value < 0) {
    throw new RangeError(`ticketEur nu poate fi negativ, primit: ${value}`);
  }
  return value;
}

export function createIntent(id: string, ticketEur: number): Intent {
  if (!id) throw new TypeError('intentul are nevoie de un id');
  assertTicket(ticketEur);
  return {
    id,
    state: 'intentie',
    ticketEur,
    feeEur: feeFor(ticketEur),
    attestations: [],
  };
}

function sidesOf(intent: Intent): Set<Side> {
  return new Set(intent.attestations.map((attestation) => attestation.side));
}

export function applyEvent(intent: Intent, event: IntentEvent): Intent {
  if (intent.state === 'facturata' || intent.state === 'renuntata') {
    throw new Error(`starea «${intent.state}» e finală — nu mai primește evenimente`);
  }

  switch (event.type) {
    case 'atestare': {
      if (intent.state !== 'intentie') {
        throw new Error(`atestarea nu se aplică din starea «${intent.state}»`);
      }
      if (!event.proof) throw new TypeError('atestarea are nevoie de o dovadă');
      const has = sidesOf(intent);
      if (has.has(event.side)) {
        throw new Error(`partea «${event.side}» e deja atestată`);
      }
      const attestations = [...intent.attestations, { side: event.side, proof: event.proof, at: event.at }];
      const complete = new Set(attestations.map((attestation) => attestation.side)).size === 2;
      return { ...intent, attestations, state: complete ? 'atestata' : 'intentie' };
    }

    case 'potrivire': {
      if (intent.state !== 'atestata') {
        throw new Error(
          `potrivirea cere ambele atestări — starea e «${intent.state}», nu «atestata»`,
        );
      }
      if (!event.protocol || !event.contraparte) {
        throw new TypeError('potrivirea are nevoie de protocol și de contraparte');
      }
      return {
        ...intent,
        state: 'potrivita',
        handoff: { protocol: event.protocol, contraparte: event.contraparte, at: event.at },
      };
    }

    case 'predare': {
      if (intent.state !== 'potrivita') {
        throw new Error(`predarea nu se aplică din starea «${intent.state}»`);
      }
      if (!intent.handoff) throw new Error('predarea cere o potrivire înainte');
      if (event.protocol !== intent.handoff.protocol) {
        throw new Error('predarea către alt protocol decât cel agreat nu e acceptată');
      }
      return { ...intent, state: 'predata' };
    }

    case 'observare': {
      if (intent.state !== 'predata') {
        throw new Error(`observarea nu se aplică din starea «${intent.state}»`);
      }
      return {
        ...intent,
        settlement: { observed: event.observed, evidence: event.evidence, at: event.at },
        state: event.observed ? 'observata' : 'predata',
      };
    }

    case 'facturare': {
      if (intent.state !== 'observata') {
        throw new Error(
          'factura se emite doar după o predare observată — nu facturăm intenții',
        );
      }
      return {
        ...intent,
        state: 'facturata',
        invoice: { amountEur: FEE_EUR, paid: false, at: event.at },
      };
    }

    case 'renuntare': {
      return {
        ...intent,
        state: 'renuntata',
        renuntare: { motiv: event.motiv, at: event.at },
      };
    }

    default: {
      const never: never = event;
      throw new Error(`eveniment necunoscut: ${JSON.stringify(never)}`);
    }
  }
}

/** Cât ne costă eșecul: timp. Nu există nicio sumă de acoperit de către desk. */
export function exposureEur(intent: Intent): number {
  return intent.feeEur - (intent.invoice?.paid ? intent.feeEur : 0);
}

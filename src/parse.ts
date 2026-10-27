/**
 * GAP — parse și mascare.
 *
 * Sursa: docs/gap/HANDOFF.md
 *   „IBAN-urile se maschează înainte de render. Soldurile nu se comit."
 *   „Adresa XMR e lipită de user și validată local."
 */

/** Alfabetul base58 folosit de Monero (fără 0, O, I, l). */
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Mască un IBAN pentru render: păstrează prefixul de țară și ultimele 4 cifre.
 * Nu întoarce niciodată IBAN-ul întreg, nici în eroare.
 */
export function maskIban(iban: string): string {
  const clean = (iban ?? '').replace(/\s+/g, '').toUpperCase();
  if (clean.length < 8) {
    throw new TypeError('IBAN prea scurt pentru mascare');
  }
  const country = clean.slice(0, 2);
  const tail = clean.slice(-4);
  return `${country}${'*'.repeat(clean.length - 6)}${tail}`;
}

/**
 * Parsează o sumă EUR din ce trimite connectorul.
 * Acceptă „1.234,56", „1,234.56", „1234.56", „1234".
 * Aruncă pe gunoi — nu întoarce NaN, ca să nu ajungă „~NaN EUR" pe ecran.
 */
export function parseEur(raw: string | number): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new TypeError(`sumă invalidă: ${raw}`);
    return raw;
  }
  const text = (raw ?? '').trim();
  if (text === '') throw new TypeError('sumă goală');

  // Doar cifre, separatori și semn. „12abc34" nu e o sumă, e gunoi.
  const compact = text.replace(/\s|\u00a0|€|EUR/gi, '');
  if (!/^[+-]?\d[\d.,]*$/.test(compact)) {
    throw new TypeError(`sumă invalidă: ${raw}`);
  }

  const hasComma = compact.includes(',');
  const hasDot = compact.includes('.');
  let normalised = compact;

  if (hasComma && hasDot) {
    // Separatorul zecimal e ultimul care apare.
    normalised =
      compact.lastIndexOf(',') > compact.lastIndexOf('.')
        ? compact.replace(/\./g, '').replace(',', '.')
        : compact.replace(/,/g, '');
  } else if (hasComma) {
    // „1,234" sau „1,50" — după poziție, nu după ghicit.
    const decimals = compact.length - compact.lastIndexOf(',') - 1;
    normalised = decimals === 3 ? compact.replace(',', '') : compact.replace(',', '.');
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) throw new TypeError(`sumă invalidă: ${raw}`);
  return value;
}

/**
 * Validare locală de adresă Monero.
 * 95 caractere = adresă standard (4…) sau subadresă (8…).
 * 106 caractere = adresă integrată (4…).
 * Nu validează checksum-ul — asta cere base58 decode + keccak, în afara MVP-ului.
 */
export function isValidXmrAddress(address: string): boolean {
  const value = (address ?? '').trim();
  if (value.length !== 95 && value.length !== 106) return false;
  if (value[0] !== '4' && value[0] !== '8') return false;
  for (const char of value) {
    if (!BASE58.includes(char)) return false;
  }
  return true;
}

/**
 * Textul de lipsă, fără NaN. Întoarce string gol când soldul acoperă.
 * `1.234,56` — punct ca separator de mii, virgulă ca zecimal, ca în pagină.
 */
export function formatMissing(missingEur: number): string {
  if (!Number.isFinite(missingEur)) {
    throw new TypeError(`lipsă invalidă: ${missingEur}`);
  }
  if (missingEur <= 0) return '';

  const rounded = Math.round(missingEur * 100) / 100;
  const [whole, cents] = rounded.toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `Lipsesc ~${grouped},${cents} EUR față de soldul verificat.`;
}

/** Verifică că numele din GitHub se potrivește cu titularul Revolut. */
export function namesMatch(githubName: string, accountHolder: string): boolean {
  const normalise = (value: string) =>
    (value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

  const github = normalise(githubName);
  const holder = normalise(accountHolder);
  if (github.length === 0 || holder.length === 0) return false;

  return github.every((part) => holder.includes(part));
}

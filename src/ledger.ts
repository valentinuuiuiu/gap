/**
 * GAP — registrul rutelor.
 *
 * Regula care ține produsul cinstit:
 *   Un stamp se poate afișa doar dacă fiecare afirmație de care depinde are
 *   citat verbatim + URL + dată. Fără citat, ruta nu se ascunde — se declară
 *   nedovedită. Nu inventăm un verdict, nu punem un mock.
 *
 * Backlog-ul se derivă din registru: fiecare afirmație fără citat e un task.
 */

export type Owner = 'jules' | 'codex' | 'vetal' | 'desk' | 'lichiditate';

export interface Claim {
  id: string;
  text: string;
  /** URL-ul sursei primare. null = nedovedit. */
  source: string | null;
  /** ISO 8601, ziua în care s-a citit sursa. */
  retrieved_at: string | null;
}

export interface LedgerRoute {
  id: string;
  label: string;
  stamp: string;
  regions: string[];
  claims: Claim[];
}

export interface Ledger {
  schema: number;
  deadline: {
    regulation: string;
    article: string;
    applies_from: string;
    unsourced?: boolean;
  };
  routes: LedgerRoute[];
}

export interface Task {
  id: string;
  title: string;
  owner: Owner;
  routeId: string;
  claimId: string;
  acceptance: string;
}

export function isSourced(claim: Claim): boolean {
  return (
    typeof claim.source === 'string' &&
    claim.source.length > 0 &&
    /^https?:\/\//.test(claim.source) &&
    typeof claim.retrieved_at === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(claim.retrieved_at)
  );
}

/** O rută se poate afișa doar dacă toate afirmațiile ei sunt citate. */
export function isRenderable(route: LedgerRoute): boolean {
  return route.claims.length > 0 && route.claims.every(isSourced);
}

export function unsourcedClaims(ledger: Ledger): Array<{ route: LedgerRoute; claim: Claim }> {
  const out: Array<{ route: LedgerRoute; claim: Claim }> = [];
  for (const route of ledger.routes) {
    for (const claim of route.claims) {
      if (!isSourced(claim)) out.push({ route, claim });
    }
  }
  return out;
}

/**
 * Derivează backlog-ul din registru. Nu inventăm task-uri: fiecare afirmație
 * fără citat devine un task pentru Jules, cu criteriul de acceptare scris.
 */
export function deriveTasks(ledger: Ledger): Task[] {
  return unsourcedClaims(ledger).map(({ route, claim }) => ({
    id: `source-${claim.id}`,
    title: `Dovedește: ${claim.text}`,
    owner: 'jules' as Owner,
    routeId: route.id,
    claimId: claim.id,
    acceptance: `routes.json marcat cu source (URL https) + retrieved_at (YYYY-MM-DD) pentru „${claim.id}". Citatul verbatim stă în corpul issue-ului. Fără citat, afirmația se retrage — nu se înlocuiește cu o aproximare.`,
  }));
}

/** Zile rămase până la 10 iulie 2027. Ceasul care dă produsului termen. */
export function daysToDeadline(ledger: Ledger, now: Date): number {
  const deadline = new Date(`${ledger.deadline.applies_from}T00:00:00Z`);
  const ms = deadline.getTime() - now.getTime();
  return Math.ceil(ms / 86_400_000);
}

/** Verifică structura registrului. Întoarce lista de erori, goală când e valid. */
export function validateLedger(ledger: Ledger): string[] {
  const errors: string[] = [];

  if (ledger.schema !== 1) errors.push(`schema necunoscut: ${ledger.schema}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ledger.deadline?.applies_from ?? '')) {
    errors.push('deadline.applies_from trebuie să fie YYYY-MM-DD');
  }
  if (!Array.isArray(ledger.routes) || ledger.routes.length === 0) {
    errors.push('registrul nu are rute');
    return errors;
  }

  const seen = new Set<string>();
  for (const route of ledger.routes) {
    if (seen.has(route.id)) errors.push(`rută duplicată: ${route.id}`);
    seen.add(route.id);

    if (!Array.isArray(route.claims) || route.claims.length === 0) {
      errors.push(`ruta ${route.id} nu are afirmații — nu se poate dovedi`);
    }
    for (const claim of route.claims ?? []) {
      if (claim.source !== null && !/^https?:\/\//.test(claim.source)) {
        errors.push(`${route.id}/${claim.id}: sursa nu e URL http(s)`);
      }
      if (claim.source !== null && !claim.retrieved_at) {
        errors.push(`${route.id}/${claim.id}: sursă fără retrieved_at`);
      }
    }
  }

  return errors;
}

/**
 * Poarta Vetal: fiecare regulă trebuie să prindă ce trebuie și nimic altceva.
 *
 * Șabloanele interzise sunt asamblate din bucăți intenționat: dacă le-am scrie
 * literal, fișierul ăsta s-ar auto-semnaliza la rularea porții pe repo.
 *
 * Rulare: node --experimental-strip-types --test test/gate.test.ts
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { scan } from '../scripts/gate.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gap-gate-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function put(name: string, content: string): void {
  const full = join(dir, name);
  mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

describe('poarta — repo-ul real', () => {
  it('nu găsește nicio încălcare în codul actual', () => {
    assert.deepEqual(scan(REPO_ROOT), []);
  });
});

describe('poarta — regulile', () => {
  it('prinde difuzarea de tranzacție', () => {
    put('src/exec.ts', `await window.ethereum.request({ method: '${'eth_send' + 'Transaction'}' });`);
    const found = scan(dir);
    assert.equal(found.length, 1);
    assert.equal(found[0].rule, 'tx-broadcast');
    assert.equal(found[0].line, 1);
  });

  it('prinde citirea unei chei private', () => {
    put('src/config.py', `KEY = os.environ["${'private' + '_key'}"]`);
    const found = scan(dir);
    assert.ok(found.some((v) => v.rule === 'secret-private' + '-key'));
  });

  it('prinde fraza de recuperare', () => {
    put('src/wallet.ts', `const words = "${'seed' + ' phrase'}";`);
    const found = scan(dir);
    assert.ok(found.some((v) => v.rule === 'secret-seed'));
  });

  it('prinde cheia privată în clar', () => {
    put('src/id_rsa.txt.sh', `echo '${'-----BEGIN ' + 'PRIVATE KEY-----'}'`);
    const found = scan(dir);
    assert.ok(found.some((v) => v.rule === 'secret-pem'));
  });

  it('prinde linkul de afiliere', () => {
    put('src/links.json', `{"url": "https://swap.example/${'?' + 'ref=' + 'abc'}"}`);
    const found = scan(dir);
    assert.ok(found.some((v) => v.rule === 'affiliate' + '-link'));
  });

  it('prinde butonul de cumpărare', () => {
    put('public/index.html', `<button onclick="go()">${'Buy' + ' now'}</button>`);
    const found = scan(dir);
    assert.ok(found.some((v) => v.rule === 'buy-cta'));
  });

  it('raportează fișierul și linia corectă', () => {
    put('src/deep/thing.ts', `const a = 1;\nconst b = 2;\nconst c = '${'eth_send' + 'Transaction'}';`);
    const [violation] = scan(dir);
    assert.equal(violation.file, 'src/deep/thing.ts');
    assert.equal(violation.line, 3);
  });
});

describe('poarta — fără fals-pozitive', () => {
  it('sare peste documentație, unde refuzul e enumerat', () => {
    put(
      'docs/gap/HANDOFF.md',
      'Interzis: custodie, mixer, afiliere, chei, ' + 'ssh' + 'pass' + ', parole.',
    );
    assert.deepEqual(scan(dir), []);
  });

  it('lasă în pace textul obișnuit despre swap', () => {
    put('src/copy.ts', 'const text = "Euroii stau pe un schimb care are voie să vadă euro.";');
    assert.deepEqual(scan(dir), []);
  });

  it('ignoră directoarele de dependențe', () => {
    put('node_modules/x/evil.ts', `'${'eth_send' + 'Transaction'}'`);
    assert.deepEqual(scan(dir), []);
  });

  it('ignoră extensiile pe care nu le scanează', () => {
    put('src/notes.txt', `'${'eth_send' + 'Transaction'}'`);
    assert.deepEqual(scan(dir), []);
  });
});

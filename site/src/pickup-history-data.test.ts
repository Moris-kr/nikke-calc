import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validatePickupHistory } from './pickup-history';

const publicDir = new URL('../public/', import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, publicDir), 'utf8'));
describe('published pickup archive', () => {
  it('uses real catalog names, available portraits and valid referenced sources', () => {
    const data = validatePickupHistory(read('pickup-history.json'));
    const catalog = read('catalog.json') as { name: string; image: string }[];
    const byName = new Map(catalog.map(c => [c.name, c]));
    for (const name of new Set(data.events.flatMap(e => e.names))) {
      expect(byName.has(name), name).toBe(true);
      expect(existsSync(new URL(byName.get(name)!.image, publicDir)), name).toBe(true);
    }
    const seen = new Set<string>();
    for (const e of data.events) for (const name of e.names) {
      const key = `${e.start}:${name}:${e.kind}`;
      expect(seen.has(key), `Duplicate pickup: ${key}`).toBe(false);
      seen.add(key);
    }
  });
  it('matches the checked-in research sources after regeneration', () => {
    expect(() => execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-pickup-history.mjs', import.meta.url)), '--check'])).not.toThrow();
  });
});

/**
 * Repository files and the TypeScript engine (../../site/src/engine). No calculation happens here.
 *
 * The engine reads the same JSON files as the site runtime; they are loaded once from the repository
 * (or the Docker image, which copies the same paths) before any tool runs.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_DATA_FILES, hasEngineData, setEngineData } from '../../site/src/engine/data.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const cache = new Map<string, any>();

/** Parsed JSON file relative to the repository root (cached, like Python's `lru_cache`). */
export function data(path: string): any {
  let value = cache.get(path);
  if (value === undefined) {
    value = JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
    cache.set(path, value);
  }
  return value;
}

/** Load the engine's data tables (idempotent). */
export function ensureEngineData(): void {
  if (hasEngineData()) return;
  setEngineData(Object.fromEntries(Object.keys(ENGINE_DATA_FILES).map((path) => [path, data(path)])));
}

let names: string[] | null = null;

/** Registered, non-test characters that also have skills (Python `character_names`). */
export function character_names(): string[] {
  if (!names) {
    const skills = data('data/parsed_skills.json');
    names = Object.keys(data('data/parsed_nikke.json'))
      .filter((name) => Object.hasOwn(skills, name) && !name.startsWith('test_'))
      .sort(pyStringCompare);
  }
  return names;
}

/** Python `sorted()` order for strings (code points, not UTF-16 units). */
export function pyStringCompare(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}

function walk(dir: string, match: (path: string) => boolean, recursive = true): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (recursive) out.push(...walk(path, match));
    } else if (match(path)) out.push(path);
  }
  return out;
}

let version: string | null = null;

/**
 * Content hash of everything that can change a result: the TypeScript engine, its data, the catalog
 * files and this server. Line endings are normalized so CRLF and LF checkouts agree.
 */
export function engine_version(): string {
  if (version) return version;
  const isSource = (path: string) => path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.d.ts');
  const files = [
    ...walk(join(ROOT, 'site/src/engine'), (p) => isSource(p) && !p.endsWith(`${sep}engine.worker.ts`), false),
    ...walk(join(ROOT, 'data'), (p) => p.endsWith('.json')),
    join(ROOT, 'scraper/preview_skills.json'), join(ROOT, 'scraper/nikke_scraped.json'),
    ...walk(join(ROOT, 'nikke_mcp/src'), (p) => isSource(p) || p.endsWith(`${sep}python-floats.json`), false),
  ].map((path) => relative(ROOT, path).split(sep).join('/'));
  files.sort(pyStringCompare);
  const digest = createHash('sha256');
  for (const path of files) {
    digest.update(path);
    digest.update(readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n'));
  }
  version = digest.digest('hex').slice(0, 20);
  return version;
}

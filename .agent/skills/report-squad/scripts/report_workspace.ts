/** 사람이 보는 보고서 출력(`reports/`)과 보고서별 작업 묶음(`.report-work/<슬러그>/`). */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { ROOT, posixRel } from './engine_env';
import { dumps, esc, fmt, isoFromMs, isoSeconds, loadJson, writeText } from './pycompat';

export const REPORTS_DIR = join(ROOT, 'reports');
export const WORK_DIR = join(ROOT, '.report-work');

/** 경로 같음 — 윈도우 경로는 대소문자를 가리지 않는다(파이썬 `Path.__eq__`와 같게). */
export function samePath(a: string, b: string): boolean {
  const ra = resolve(a); const rb = resolve(b);
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

export function bundle_dir(slug: string): string {
  if (!slug || basename(slug) !== slug || slug === '.' || slug === '..' || /[\\/]/.test(slug)) {
    throw new Error(`ValueError: 잘못된 보고서 슬러그: '${slug}'`);
  }
  return join(WORK_DIR, slug);
}

export function output_path(slug: string): string {
  return join(REPORTS_DIR, `${slug}.html`);
}

/** 확장자 하나를 뗀 파일 이름(파이썬 `Path.stem`). */
export function stem(p: string): string {
  const b = basename(p);
  const e = extname(b);
  return e && e !== b ? b.slice(0, -e.length) : b;
}

export function slug_from_spec(source: string): string {
  const path = resolve(source);
  if (basename(path) === 'spec.json' && samePath(dirname(dirname(path)), WORK_DIR)) {
    return basename(dirname(path));
  }
  return stem(path);
}

export function spec_path(slug: string): string {
  return join(bundle_dir(slug), 'spec.json');
}

export function data_path(slug: string): string {
  return join(bundle_dir(slug), 'result.data.json');
}

export function ref_path(slug: string): string {
  return join(bundle_dir(slug), 'ref.json');
}

export function prepare(slug: string): string {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const work = bundle_dir(slug);
  mkdirSync(work, { recursive: true });
  return work;
}

/** `shutil.copy2` — 내용과 수정 시각을 옮긴다. */
function copy2(src: string, dst: string): void {
  copyFileSync(src, dst);
  const st = statSync(src);
  utimesSync(dst, st.atime, st.mtime);
}

/** 편집 가능한 입력 스펙을 작업 묶음에 복사한다. */
export function preserve_spec(source: string, slug: string): string {
  const target = resolve(spec_path(slug));
  prepare(slug);
  if (!samePath(source, target)) copy2(resolve(source), target);
  return target;
}

export function preserve_ref(source: string, slug: string): string {
  const target = resolve(ref_path(slug));
  prepare(slug);
  if (!samePath(source, target)) copy2(resolve(source), target);
  return target;
}

export function write_manifest(slug: string, kind: string, title: string,
  dependencies: string[] | null = null): string {
  const work = prepare(slug);
  const path = join(work, 'manifest.json');
  let old: Record<string, any> = {};
  if (existsSync(path)) {
    try { old = loadJson(path); } catch { old = {}; }
  }
  const manifest: Record<string, any> = { ...old };
  // 파이썬 `{**old, "slug": ...}` — 이미 있는 키는 자리를 지키고 값만 바뀐다.
  manifest['slug'] = slug;
  manifest['kind'] = kind;
  manifest['title'] = title || slug;
  manifest['generated_at'] = isoSeconds();
  manifest['output'] = `reports/${slug}.html`;
  for (const [key, artifact] of [['spec', spec_path(slug)], ['data', data_path(slug)],
    ['ref', ref_path(slug)]] as const) {
    if (existsSync(artifact)) manifest[key] = posixRel(artifact);
    else delete manifest[key];
  }
  if (dependencies !== null) {
    manifest['dependencies'] = [...new Set(dependencies)].sort();
  }
  writeText(path, dumps(manifest, { indent: 2 }));
  return path;
}

function _entry(path: string): Record<string, any> {
  const slug = stem(path);
  const manifest_path = join(bundle_dir(slug), 'manifest.json');
  let manifest: Record<string, any> = {};
  if (existsSync(manifest_path)) {
    try { manifest = loadJson(manifest_path); } catch { /* 손상된 manifest는 무시 */ }
  }
  const st = statSync(path);
  const stamp = manifest['generated_at'] || isoFromMs(st.mtimeMs);
  return {
    slug,
    title: manifest['title'] || slug,
    kind: manifest['kind'] || 'report-squad',
    generated_at: stamp,
    size: st.size,
  };
}

export function write_index(): string {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const entries = readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith('.html') && f !== 'index.html')
    .map((f) => _entry(join(REPORTS_DIR, f)));
  // 파이썬 `sort(reverse=True)`는 안정 정렬 — 같은 시각이면 원래 순서를 지킨다.
  const keyed = entries.map((e, i) => ({ e, i }));
  keyed.sort((a, b) => (a.e['generated_at'] < b.e['generated_at'] ? 1
    : a.e['generated_at'] > b.e['generated_at'] ? -1 : a.i - b.i));
  const sortedEntries = keyed.map((x) => x.e);
  const labels: Record<string, string> = {
    'report-squad': '스쿼드 비교',
    'report-growth': '육성 효율',
    enikk: 'enikk 대조',
    optimize: 'N덱 최적화',
  };
  const cards: string[] = [];
  for (const item of sortedEntries) {
    const size = item['size'] / 1024;
    const size_text = size >= 1024 ? `${fmt(size / 1024, '.1f')} MB` : `${fmt(size, '.0f')} KB`;
    const date = String(item['generated_at']).replace('T', ' ').slice(0, 16);
    cards.push(
      `<li><a href="${esc(`${item['slug']}.html`)}"><strong>${esc(item['title'])}</strong>`
      + `<span>${esc(labels[item['kind']] ?? item['kind'])} · ${esc(date)} · ${esc(size_text)}</span>`
      + `<code>${esc(item['slug'])}</code></a></li>`,
    );
  }
  const empty = !cards.length ? '<p class=empty>아직 생성된 보고서가 없습니다.</p>' : '';
  const page = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NIKKE 보고서</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;background:#f3f4f6;color:#171717}
main{max-width:920px;margin:auto;padding:48px 24px}h1{margin:0 0 8px}p{color:#666}ul{list-style:none;padding:0;display:grid;gap:12px}
li a{display:grid;grid-template-columns:1fr auto;gap:5px 20px;padding:18px 20px;border:1px solid #ddd;border-radius:12px;background:#fff;color:inherit;text-decoration:none}
li a:hover{border-color:#777}strong{font-size:17px}span,code{font-size:13px;color:#666}code{grid-column:1/-1}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}p,span,code{color:#aaa}li a{background:#191919;border-color:#333}}
</style></head><body><main><h1>NIKKE 보고서</h1><p>최신순 · ${sortedEntries.length}개</p>${empty}<ul>${cards.join('')}</ul></main></body></html>`;
  const path = join(REPORTS_DIR, 'index.html');
  writeText(path, page);
  return path;
}

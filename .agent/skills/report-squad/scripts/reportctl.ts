/**
 * 로컬 보고서 목록·색인·정리.
 *
 *   cd site && npx tsx ../.agent/skills/report-squad/scripts/reportctl.ts list
 *   cd site && npx tsx ../.agent/skills/report-squad/scripts/reportctl.ts reindex
 *   cd site && npx tsx ../.agent/skills/report-squad/scripts/reportctl.ts remove <슬러그> [--yes] [--force]
 *   cd site && npx tsx ../.agent/skills/report-squad/scripts/reportctl.ts prune [--yes]
 */

import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { REPORTS_DIR, WORK_DIR, bundle_dir, output_path, stem, write_index, write_manifest } from './report_workspace';
import { SystemExit, fmt, loadJson, print, runMain } from './pycompat';

/** 파이썬 `Path` 정렬 — 윈도우에서는 대소문자를 가리지 않는다. */
function pathKey(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function sortPaths(ps: string[]): string[] {
  return ps.sort((a, b) => (pathKey(a) < pathKey(b) ? -1 : pathKey(a) > pathKey(b) ? 1 : 0));
}

function workDirs(): string[] {
  if (!existsSync(WORK_DIR)) return [];
  return readdirSync(WORK_DIR).map((n) => join(WORK_DIR, n)).filter((p) => statSync(p).isDirectory());
}

/** 옛 묶음이나 손으로 살린 묶음에 최소 manifest를 다시 만든다. */
function _adopt_missing(): void {
  for (const work of workDirs()) {
    if (existsSync(join(work, 'manifest.json'))) continue;
    const data_file = join(work, 'result.data.json');
    if (!existsSync(data_file)) continue;
    let payload: Record<string, any>;
    try { payload = loadJson(data_file); } catch { continue; }
    let kind: string;
    if (existsSync(join(work, 'ref.json'))) kind = 'enikk';
    else if ('meta' in payload) kind = 'report-growth';
    else if ('solutions' in payload && 'candidate_counts' in payload) kind = 'optimize';
    else kind = 'report-squad';
    const title = (payload['spec'] || {})['title'] || payload['title'] || basename(work);
    write_manifest(basename(work), kind, title);
  }
}

function _manifests(): Array<Record<string, any>> {
  _adopt_missing();
  const rows: Array<Record<string, any>> = [];
  if (!existsSync(WORK_DIR)) return rows;
  const paths = sortPaths(workDirs().map((w) => join(w, 'manifest.json')).filter((p) => existsSync(p)));
  for (const path of paths) {
    try { rows.push(loadJson(path)); } catch {
      rows.push({ slug: basename(join(path, '..')), kind: '?', title: '손상된 manifest' });
    }
  }
  const known = new Set(rows.map((r) => r['slug']));
  for (const work of sortPaths(workDirs())) {
    const name = basename(work);
    if (!known.has(name)) rows.push({ slug: name, kind: 'draft', title: name, draft: true });
  }
  return rows;
}

function _remove(slug: string): void {
  const out = output_path(slug);
  const work = bundle_dir(slug);
  if (existsSync(out)) unlinkSync(out);
  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
}

const USAGE = 'usage: reportctl.ts [-h] {list,reindex,remove,prune} ...';

function main(): void {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === '-h' || command === '--help') {
    print(USAGE);
    print('\n로컬 보고서 목록·색인·정리\n\n  list     보고서와 작업 묶음 상태를 표시\n  reindex  reports/index.html을 다시 생성\n'
      + '  remove   보고서와 같은 슬러그의 작업 묶음을 함께 삭제 (--yes 실제 삭제, --force 참조돼도 삭제)\n'
      + '  prune    HTML이 없는 고아 작업 묶음을 정리 (--yes 실제 삭제)');
    if (!command) process.exitCode = 2;
    return;
  }
  const rest = argv.slice(1);
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const positional = rest.filter((a) => !a.startsWith('--'));

  if (command === 'reindex') {
    _adopt_missing();
    print(write_index());
    return;
  }

  if (command === 'list') {
    const seen = new Set<string>();
    for (const row of _manifests()) {
      const slug = row['slug'] ?? '?';
      seen.add(slug);
      const state = row['draft'] ? '초안' : (existsSync(output_path(slug)) ? 'HTML 있음' : '작업 묶음만 있음');
      print(`${fmt(slug, '<36')} ${fmt(row['kind'] ?? '?', '<14')} ${state}  ${row['title'] ?? slug}`);
    }
    if (existsSync(REPORTS_DIR)) {
      const htmls = sortPaths(readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.html'))
        .map((f) => join(REPORTS_DIR, f)));
      for (const path of htmls) {
        if (basename(path) !== 'index.html' && !seen.has(stem(path))) {
          print(`${fmt(stem(path), '<36')} ${fmt('?', '<14')} HTML만 있음`);
        }
      }
    }
    return;
  }

  if (command === 'remove') {
    const slug = positional[0];
    if (!slug) throw SystemExit(`${USAGE}\nreportctl.ts remove: error: the following arguments are required: slug`);
    const targets = [output_path(slug), bundle_dir(slug)].filter((p) => existsSync(p));
    if (!targets.length) throw SystemExit(`없는 보고서: ${slug}`);
    const dependents = _manifests().filter((r) => (r['dependencies'] || []).includes(slug)).map((r) => r['slug']);
    print('삭제 대상:');
    for (const path of targets) print(`  ${path}`);
    if (dependents.length) print('참조 중인 보고서: ' + dependents.join(', '));
    if (!flags.has('--yes')) {
      print('미리보기만 했다. 실제 삭제는 --yes를 붙인다.');
      return;
    }
    if (dependents.length && !flags.has('--force')) {
      throw SystemExit('참조 중이라 삭제하지 않았다. 관계를 확인한 뒤 --force를 붙인다.');
    }
    _remove(slug);
    write_index();
    return;
  }

  if (command !== 'prune') {
    throw SystemExit(`${USAGE}\nreportctl.ts: error: argument command: invalid choice: '${command}' `
      + "(choose from 'list', 'reindex', 'remove', 'prune')");
  }
  const manifests = _manifests();
  const referenced = new Set<string>(manifests.flatMap((r) => (r['dependencies'] || []) as string[]));
  const protectedSlugs = manifests.filter((r) => referenced.has(r['slug']) && !existsSync(output_path(r['slug'])))
    .map((r) => r['slug'] ?? '');
  let orphans = manifests.filter((r) => r['slug'] && !r['draft'] && !existsSync(output_path(r['slug'])))
    .map((r) => r['slug'] ?? '');
  orphans = orphans.filter((s) => !referenced.has(s));
  if (protectedSlugs.length) {
    print('다른 보고서가 참조해 보존한 작업 묶음:');
    for (const slug of protectedSlugs) print(`  ${bundle_dir(slug)}`);
  }
  if (!orphans.length) {
    print('고아 작업 묶음 없음');
    return;
  }
  print('고아 작업 묶음:');
  for (const slug of orphans) print(`  ${bundle_dir(slug)}`);
  if (!flags.has('--yes')) {
    print('미리보기만 했다. 실제 삭제는 --yes를 붙인다.');
    return;
  }
  for (const slug of orphans) _remove(slug);
  write_index();
}

if (require.main === module) runMain(main);

/**
 * enikk 덤프 → 보고서 스펙 + 기준값 JSON (파이썬 `enikk_spec.py`의 이식).
 *
 * 브라우저에서 긁은 덱 목록(`references/enikk.md §2`)을 받아 두 파일을 만든다.
 *
 *   .report-work/<슬러그>/spec.json — report-squad 러너 입력
 *   .report-work/<슬러그>/ref.json  — `report_ref.ts` 입력
 *
 * 캐릭터는 **이름이 아니라 id로 조인한다.** enikk 썸네일 URL의 `si_c{id}_`가
 * `scraper/nikke_scraped.json`의 `id`와 같은 체계다. 한국 서버 명칭은 영문명을 그대로
 * 음차하지 않아(Liter=리타, Moran=목단) 이름 매칭은 반드시 틀린다.
 *
 *   cd site && npx tsx ../.agent/skills/report-squad/scripts/enikk_spec.ts <덤프.txt> \
 *       --slug sr35-enikk-teams --min-uses 3 --title "..." --note "..." --code 풍압 --runs 5
 *
 * 덤프 형식 — 한 줄에 한 덱, 공백/줄바꿈 구분:
 *
 *   192,583,234,101,074=867|8.31|5.84
 */

import { join } from 'node:path';
import { _py_repr } from '../../../../site/src/engine/customization';
import { ROOT } from './engine_env';
import { SystemExit, dumps, floats, loadJson, print, readText, runMain, writeText } from './pycompat';
import { parseArgs } from './report';
import { prepare, ref_path, spec_path } from './report_workspace';

type Deck = [number[], number, number, number];

export function load_decks(text: string): Deck[] {
  const out: Deck[] = [];
  for (const tok of text.split(/\s+/).filter((t) => t)) {
    const parts = tok.split('=');
    if (parts.length !== 2) throw new Error(`ValueError: 덤프 형식이 아니다: ${tok}`);
    const [ids, rest] = parts as [string, string];
    const r = rest.split('|');
    if (r.length !== 3) throw new Error(`ValueError: 덤프 형식이 아니다: ${tok}`);
    const [n, mx, av] = r as [string, string, string];
    out.push([ids.split(',').map((x) => parseInt(x, 10)), parseInt(n, 10), Number(mx), Number(av)]);
  }
  return out;
}

function main(): void {
  const a = parseArgs({
    prog: 'enikk_spec.ts', description: 'enikk 덱 덤프 → 스펙 + 기준값', positional: ['dump'],
    options: {
      slug: 'str', min_uses: 'int', title: 'str', note: 'str', runs: 'int', code: 'str',
      core_px: 'int', has_parts: 'bool', ref_label: 'str',
    },
    help: 'options:\n  --slug SLUG          출력 파일명 (영문 슬러그, 필수)\n'
      + '  --min-uses N         이 횟수 이상 사용된 덱만 (기본 3)\n  --title TITLE\n  --note NOTE\n  --runs RUNS\n'
      + '  --code CODE          랩쳐 코드. 보스 속성을 그대로 적는다 (약점이 아니다)\n'
      + '  --core-px N\n  --has-parts\n  --ref-label LABEL',
  });
  if (!a.slug) {
    process.stderr.write('usage: enikk_spec.ts [-h] dump\nenikk_spec.ts: error: the following arguments are required: --slug\n');
    process.exit(2);
  }
  const min_uses: number = a.min_uses ?? 3;
  const title: string = a.title ?? 'enikk 실사용 조합 딜량';
  const note: string = a.note ?? '';
  const runs: number = a.runs ?? 5;
  const core_px: number = a.core_px ?? 0;
  const ref_label: string = a.ref_label ?? 'enikk 평균';

  const sc = loadJson(join(ROOT, 'scraper', 'nikke_scraped.json')) as Record<string, any>;
  const sk = loadJson(join(ROOT, 'data', 'parsed_skills.json')) as Record<string, any>;
  const byid = new Map<unknown, string>();
  for (const [k, v] of Object.entries(sc)) byid.set(v?.['id'] ?? null, k);

  const decks = load_decks(readText(a.dump)).filter((d) => d[1] >= min_uses);

  const cases: Array<Record<string, any>> = [];
  const ref: Record<string, any> = {};
  const skipped: Array<[Array<string | undefined>, number, Array<string | undefined>]> = [];
  const unknown = new Set<number>();
  for (const [ids, n, , av] of decks) {
    const names = ids.map((i) => byid.get(i));
    ids.forEach((i, j) => { if (names[j] === undefined) unknown.add(i); });
    const bad = names.filter((nm) => nm === undefined || !Object.prototype.hasOwnProperty.call(sk, nm));
    if (bad.length) {
      skipped.push([names, n, bad]);
      continue;
    }
    const key = (names as string[]).join(' · ');
    cases.push({ name: `${n}회 · ${key}`, squad: names });
    ref[key] = av;
    floats(ref, key);
  }

  if (!cases.length) throw SystemExit('계산 가능한 덱이 없다 — 덤프나 --min-uses를 확인하라');

  const enemy: Record<string, any> = { core_px, has_parts: !!a.has_parts };
  if (a.code) enemy['code'] = a.code;
  const spec = { title, note, runs, enemy, cases };

  prepare(a.slug);
  const sp = spec_path(a.slug);
  const rp = ref_path(a.slug);
  writeText(sp, dumps(spec, { indent: 2 }));
  writeText(rp, dumps(floats({ label: ref_label, unit: 'B', scale: 1e9, by_squad: ref }, 'scale'), { indent: 2 }));

  print(`${min_uses}회 이상 ${decks.length}개 → 계산가능 ${cases.length}개 / 제외 ${skipped.length}개`);
  for (const [names, n, bad] of skipped) {
    const shown = names.map((nm) => nm || '?');
    print(`  제외 (${n}회): ${shown.join(' · ')}   ← ${bad.filter((b) => b).map((b) => String(b)).join(', ')}`);
  }
  if (unknown.size) {
    print(`  ⚠ 스크랩 데이터에 없는 id: ${_py_repr([...unknown].sort((x, y) => x - y))} — cdn_fetch 갱신이 필요할 수 있다`);
  }
  print(`\n${sp}\n${rp}`);
}

if (require.main === module) runMain(main);

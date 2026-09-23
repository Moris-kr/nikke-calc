/**
 * 외부 기준값 대조 렌더러 (add-on, 파이썬 `report_ref.py`의 이식).
 *
 * 이미 돌린 보고서 캐시(`.report-work/<이름>/result.data.json`)에 외부 출처의 딜량을 얹어
 * 케이스마다 `기준값`과 `비율(우리/기준)`을 덧붙인 최종 HTML을 낸다.
 * enikk.app 실사용 파스처럼 육성 수준이 다른 기록과 우리 시뮬을 견줄 때 쓴다.
 *
 * `report_html.ts`의 형식은 건드리지 않는다 — 여기서 `hooks.case_card`만 감싸 갈아끼운다.
 *
 *   cd site && npx tsx ../.agent/skills/report-squad/scripts/report_ref.ts <data.json> <ref.json>
 *
 * 기준값 파일 형식:
 *
 *   {
 *     "label": "enikk 평균",        // 화면에 찍히는 이름
 *     "unit": "B",                  // 값 뒤에 붙는 단위 표기 (없으면 생략)
 *     "scale": 1e9,                 // 기준값 → 원 단위 환산 계수. 비율 계산에만 쓴다
 *     "by_squad": {                 // 키 = 스쿼드 정식 명칭을 " · "로 이은 것
 *       "토브 · 아르카나 : 포츈 메이트 · 도로시 : 세렌디피티 · 드레이크 · 솔린 : 프로스트 티켓": 5.84
 *     }
 *   }
 *
 * `by_squad`에 없는 케이스는 대조 줄 없이 원래대로 나온다.
 */

import { basename, dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { _py_fmt_g } from '../../../../site/src/engine/customization';
import { get } from '../../../../site/src/engine/py';
import * as R from './report_html';
import { output_path, preserve_ref, write_index, write_manifest } from './report_workspace';
import { esc, fmt, loadJson, print, runMain, writeText } from './pycompat';
import { parseArgs } from './report';

const _ORIG_CASE_CARD = R.hooks.case_card;
let _REF: Record<string, any> = {};

/** 케이스 카드에 덧붙일 대조 줄. 기준값이 없으면 빈 문자열. */
function _ref_line(c: Record<string, any>): string {
  const by = get(_REF, 'by_squad', {}) as Record<string, any>;
  const key = (c['squad'] as string[]).join(' · ');
  const val = Object.prototype.hasOwnProperty.call(by, key) ? by[key] : null;
  if (val == null) return '';
  const label = get(_REF, 'label', '기준');
  const unit = get(_REF, 'unit', '');
  const scale = Number(get(_REF, 'scale', 1.0));
  const ratio = val ? c['total']['mean'] / (val * scale) : null;
  // 비율이 1에서 멀수록 눈에 띄게 — 0.9~1.1은 중립색으로 둔다.
  let cls = 'ref';
  if (ratio !== null) cls += ratio < 0.9 ? ' ref-lo' : (ratio > 1.1 ? ' ref-hi' : '');
  const r_txt = ratio !== null ? ` · 비율 <b>${fmt(ratio, '.2f')}</b>` : '';
  return `<span class="${cls}">${esc(label)} ${_py_fmt_g(val)}${esc(unit)}${r_txt}</span>`;
}

function _case_card(c: Record<string, any>, show_name: boolean, ops = ''): string {
  const html = _ORIG_CASE_CARD(c, show_name, ops);
  const line = _ref_line(c);
  if (!line) return html;
  // `.kv` 블록 끝에 한 칸 더 붙인다 (범위·풀버스트 옆).
  const marker = '  </div>\n  </div>\n</div>';
  if (!html.includes(marker)) {
    throw new Error('RuntimeError: report_html._case_card 구조가 바뀌었다 — report_ref.ts의 앵커를 고쳐라');
  }
  return html.replace(marker, () => `    ${line}\n${marker}`);
}

const _CSS = `
.kv .ref { border:1px solid var(--border); border-radius:999px;
           padding:1px 8px; opacity:.85; font-size:11px; }
.kv .ref b { font-weight:700; }
.kv .ref-lo { color:#e0823d; border-color:#e0823d66; }
.kv .ref-hi { color:#4aa3df; border-color:#4aa3df66; }
`;

function main(): void {
  const a = parseArgs({
    prog: 'report_ref.ts', description: '보고서 캐시에 외부 기준값을 얹어 다시 렌더한다',
    positional: ['data', 'ref'], options: { out: 'str' },
    help: 'positional arguments:\n  data        .report-work/<이름>/result.data.json\n  ref         기준값 JSON\n\n'
      + 'options:\n  -o, --out OUT  출력 HTML (기본: reports/<이름>.html)',
  }, process.argv.slice(2).map((x) => (x === '-o' ? '--out' : x)));

  const data_file = resolve(a.data);
  const ref_file = resolve(a.ref);
  const d = loadJson(data_file);
  _REF = loadJson(ref_file);
  const name = basename(data_file);
  const slug = name === 'result.data.json' ? basename(dirname(data_file))
    : (name.endsWith('.data.json') ? name.slice(0, -'.data.json'.length) : name);
  preserve_ref(ref_file, slug);

  R.hooks.case_card = _case_card;
  let html = R.render_html(d['spec'], d['cases'], d['seeds'], get(d, 'random', false),
    get(d, 'expected', (get(d, 'seeds') || []).length <= 1));
  html = html.replace('</style>', () => _CSS + '</style>');

  const out = a.out ? resolve(a.out) : output_path(slug);
  mkdirSync(dirname(out), { recursive: true });
  writeText(out, html);
  write_manifest(slug, 'enikk', get(d['spec'], 'title', slug));
  write_index();

  const by = get(_REF, 'by_squad', {}) as Record<string, any>;
  const hit = (d['cases'] as any[]).filter((c) => Object.prototype.hasOwnProperty.call(by, c['squad'].join(' · '))).length;
  print(`${out}  (케이스 ${d['cases'].length}개 중 기준값 매칭 ${hit}개)`);
}

if (require.main === module) runMain(main);

/**
 * 솔로레이드 N스쿼드 보고서(최적화·지정 편성)의 HTML 렌더러 (파이썬 `optimize_html.py`의 이식).
 *
 * 한 해(solution)는 초상화 N×5 블록 하나로 읽는다. 각 줄은 초상화 5개와 총딜만
 * 두고, 운용·CV·FB 같은 부가 문구는 블록 아래 각주로 내린다 — 스쿼드 사이 간격이
 * 벌어지면 25명을 한눈에 비교할 수 없기 때문이다.
 */

import { get, truthy } from '../../../../site/src/engine/py';
import { _py_eq } from '../../../../site/src/engine/customization';
import { loadEngine } from './engine_env';
import { first_image, portraits } from './images';
import type { Portrait } from './images';
import { esc, fmt } from './pycompat';
import { _burst_pattern_text, _seq_text } from './report_html';

export function _kor(value: number): string {
  return `${fmt(value / 1e8, ',.2f')}억`;
}

const _esc = esc;

// 이름 → 초상화(64px 썸네일). 파이썬·Pillow가 없어 원본을 넣는 경우엔 CSS 클래스로 한 번만 싣는다.
const _images = new Map<string, Portrait | null>();
const _fallbackClass = new Map<string, string>();

function _prefetch(names: string[]): void {
  const todo = [...new Set(names)].filter((n) => !_images.has(n));
  const paths = todo.map((n) => first_image(n));
  const reqs = paths.filter((p): p is string => p !== null).map((p) => ({ path: p, size: 64, quality: 78, always: true }));
  const got = portraits(reqs);
  let j = 0;
  todo.forEach((n, i) => { _images.set(n, paths[i] ? got[j++] ?? null : null); });
}

function _operation_text(squad: Record<string, any>): string {
  const cfg: Record<string, any> = get(squad, 'config', {}) || {};
  const ops: string[] = [];
  if (truthy(get(cfg, 'no_burst_char'))) ops.push(`${cfg['no_burst_char']} 버스트 미사용`);
  for (const [name, pattern] of Object.entries((get(cfg, 'burst_pattern') || {}) as Record<string, any>)) {
    let pattern_text: string;
    if (pattern === 'every:1') pattern_text = '매 사이클';
    else if (_py_eq(pattern, [1])) pattern_text = '첫 사이클만';
    else pattern_text = _burst_pattern_text(pattern);
    ops.push(`${name} ${pattern_text}`);
  }
  const sequence_text = _seq_text(squad['squad'], get(cfg, 'burst_sequence') || []);
  if (sequence_text) ops.push(sequence_text);
  return ops.length ? ops.join(' · ') : '버스트순서 왼쪽부터';
}

function _squad_row(squad: Record<string, any>): string {
  const pics: string[] = [];
  for (const name of squad['squad'] as string[]) {
    const image = _images.get(name) ?? null;
    if (image && image.posY === null) {
      pics.push(`<img src="${image.src}" alt="${_esc(name)}" title="${_esc(name)}">`);
    } else if (image) {
      pics.push(`<span class="pic ${_fallbackClass.get(name)}" role="img" aria-label="${_esc(name)}" title="${_esc(name)}"></span>`);
    } else {
      pics.push(`<span class="missing" title="${_esc(name)}">?</span>`);
    }
  }
  const stats: Record<string, any> = get(squad, 'total', {});
  // 범위는 관측 최소·최대가 아니라 평균 ± 표준편차다 — 시드 수가 적어 극단값이 튄다.
  const mean = Number(stats['mean']); const std = Number(get(stats, 'std', 0));
  const span = `${fmt((mean - std) / 1e8, ',.2f')}~${fmt((mean + std) / 1e8, ',.2f')}억`;
  return `<div class="row"><div class="chars">${pics.join('')}</div>`
    + `<div class="damage">${_kor(mean)}<span>${span}</span></div></div>`;
}

function _squad_note(index: number, squad: Record<string, any>): string {
  let tail = `FB ${fmt(Number(get(squad, 'burst_count', 0)), '.0f')}`;
  if (truthy(get(squad, 'simulated'))) tail += ' · 신규 시뮬';
  const names = (squad['squad'] as string[]).join(' / ');
  const operation = _operation_text(squad);
  return `<li title="${_esc(`${names} — ${operation} · ${tail}`)}"><i>${index}</i>${_esc(names)}`
    + `<em>${_esc(operation)} · ${tail}</em></li>`;
}

function _solution_block(solution: Record<string, any>, best: number, pinned: boolean): string {
  const objective = Number(solution['total']['objective']);
  const rows = (solution['squads'] as any[]).map((s) => _squad_row(s)).join('');
  const notes = (solution['squads'] as any[]).map((s, i) => _squad_note(i + 1, s)).join('');
  let head: string; let delta_text: string;
  if (pinned) {
    head = '<span class="rank">지정</span>';
    delta_text = best <= 0 ? '' : `최적해 대비 ${_kor(objective - best)}`;
  } else {
    head = `<span class="rank">#${solution['rank']}</span>`;
    delta_text = solution['rank'] === 1 ? '최고' : _kor(objective - best);
  }
  return `<section class="solution">
      <header><div>${head}<b>${_kor(objective)}</b></div>
      <div class="delta">${_esc(delta_text)}</div></header>
      <div class="rows">${rows}</div><ol class="notes">${notes}</ol>
    </section>`;
}

function _variant_panel(variant: Record<string, any>, index: number, reference: number): string {
  const pinned = truthy(get(variant, 'pinned'));
  const best = Number(variant['solutions'][0]['total']['objective']);
  const blocks = (variant['solutions'] as any[])
    .map((s) => _solution_block(s, pinned ? reference : best, pinned)).join('');

  const target = get(variant, 'target', {}) || {};
  const enemy = get(target, 'enemy', {}) || {};
  const chips = [
    `적 코드 ${_esc(get(enemy, 'code', '미지정'))}`,
    truthy(get(enemy, 'core_px')) ? '코어' : '비코어',
    truthy(get(enemy, 'has_parts')) ? '파츠' : '노파츠',
    `${fmt(Number(get(get(target, 'config', {}) || {}, 'duration', 0)), '.0f')}초`,
  ];
  if (pinned) {
    const meta = get(variant, 'pinned_meta', {}) || {};
    chips.push(`지정 편성 ${variant['solutions'][0]['squads'].length}스쿼드`);
    chips.push(`캐시 재사용 ${get(meta, 'reused', 0)}개 · 신규 시뮬 ${get(meta, 'simulated', 0)}개`);
  } else {
    const excluded = (get(variant, 'exclude_members', []) || []) as string[];
    if (excluded.length) chips.push(`제외 ${excluded.join(' · ')}`);
    else chips.push('캐릭터 제외 없음');
    chips.push(`후보 ${variant['candidate_counts']['unique']}개`);
    chips.push(`탐색 상태 ${fmt(variant['search']['explored_nodes'], ',')}개`);
  }
  const chip_html = chips.map((t) => `<span class="chip">${_esc(t)}</span>`).join('');

  const source_rows = ((get(variant, 'sources', []) || []) as any[]).map((src) =>
    `<tr><td>${_esc(src['title'])}</td><td>${src['loaded']}</td><td>${src['accepted']}</td></tr>`).join('');
  const table = source_rows
    ? `<table><thead><tr><th>후보 보고서</th><th>전체</th><th>채택</th></tr></thead><tbody>${source_rows}</tbody></table>`
    : '';
  const active = index === 0 ? ' active' : '';
  return `<section class="variant-panel${active}" data-panel="${index}">`
    + `<section class="meta"><div class="chips">${chip_html}</div>${table}</section>`
    + `${blocks}</section>`;
}

export function render_html(output: Record<string, any>): string {
  loadEngine();
  const variants: Array<Record<string, any>> = truthy(get(output, 'variants')) ? output['variants'] : [output];
  _prefetch(variants.flatMap((v) => (v['solutions'] as any[]).flatMap((s) => (s['squads'] as any[]).flatMap((q) => q['squad']))));
  // 원본 초상화를 그대로 넣는 경우(파이썬·Pillow 없음) — 이름마다 한 번만 CSS로 싣는다.
  const fbRules: string[] = [];
  for (const [name, img] of _images) {
    if (img && img.posY !== null && !_fallbackClass.has(name)) {
      const cls = `fb${_fallbackClass.size}`;
      _fallbackClass.set(name, cls);
      fbRules.push(`.${cls}{background-image:url(${img.src});background-position:50% ${fmt(img.posY, '.2f')}%}`);
    }
  }
  const fbCss = fbRules.length
    ? `\n.chars .pic{display:block;width:56px;height:56px;background-size:cover;border-radius:3px;background-color:var(--soft)}\n`
      + '@media(max-width:680px){.chars .pic{width:100%;height:auto;aspect-ratio:1}}\n' + fbRules.join('\n')
    : '';
  // 지정 편성 패널의 기준선은 같은 보고서 안의 최적화 해다. 최적화가 없으면 비교하지 않는다.
  const opt = variants.find((v) => !truthy(get(v, 'pinned')));
  const reference = opt ? Number(opt['solutions'][0]['total']['objective']) : 0.0;
  const tabs = variants.map((variant, index) =>
    `<button class="tab${index === 0 ? ' active' : ''}" data-tab="${index}" `
    + `type="button">${_esc(variant['name'])}</button>`).join('');
  const panels = variants.map((v, i) => _variant_panel(v, i, reference)).join('');
  const optimized = '기존 계산 결과 안에서 캐릭터 중복 없는 스쿼드 조합의 평균 총딜 합을 정확 최적화했다.';
  let lead: string;
  if (variants.every((v) => truthy(get(v, 'pinned')))) {
    lead = '지정한 편성의 총딜을 계산했다. 후보 캐시에 없는 스쿼드만 새로 시뮬했다.';
  } else if (variants.some((v) => truthy(get(v, 'pinned')))) {
    lead = `${optimized} 지정 편성 탭은 같은 조건에서 최적해와 나란히 비교한다.`;
  } else {
    lead = optimized;
  }
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${_esc(output['title'])}</title>
<style>
:root{--bg:#f6f6f3;--card:#fff;--ink:#151515;--muted:#6d6b65;--line:#deddd6;--blue:#2a78d6;--soft:#eaf2fc}
@media(prefers-color-scheme:dark){:root{--bg:#111;--card:#1c1c1b;--ink:#f5f5f3;--muted:#aaa79f;--line:#343431;--blue:#61a3ef;--soft:#152943}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,"Malgun Gothic",sans-serif}
.wrap{max-width:1180px;margin:auto;padding:34px 22px 80px}h1{font-size:25px;margin:0 0 6px}.lead{color:var(--muted);margin:0 0 18px}
.tabs{display:flex;gap:8px;margin:0 0 16px;border-bottom:1px solid var(--line)}.tab{appearance:none;border:0;border-bottom:3px solid transparent;background:transparent;color:var(--muted);font:inherit;font-weight:700;padding:10px 14px;cursor:pointer}.tab.active{color:var(--blue);border-bottom-color:var(--blue)}.variant-panel{display:none}.variant-panel.active{display:block}
.meta{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:20px}.chips{display:flex;gap:7px;flex-wrap:wrap}
.chip{background:var(--soft);border-radius:999px;padding:4px 10px}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}td,th{padding:6px;border-top:1px solid var(--line);text-align:left}th{color:var(--muted)}
.solution{margin:0 0 26px}.solution>header{display:flex;justify-content:space-between;align-items:end;margin-bottom:6px}.solution>header b{font-size:21px}.rank{color:var(--blue);font-weight:800;margin-right:9px}.delta{color:var(--muted)}
.rows{display:grid;gap:2px;width:max-content;max-width:100%}.row{display:flex;align-items:center;gap:12px}
.chars{display:grid;grid-template-columns:repeat(5,56px);gap:2px}.chars img,.missing{display:block;width:56px;height:56px;object-fit:cover;object-position:center 18%;border-radius:3px;background:var(--soft)}.missing{display:grid;place-items:center}
.damage{font-size:16px;font-weight:800;white-space:nowrap}.damage span{margin-left:8px;font-size:11.5px;font-weight:400;color:var(--muted)}
.notes{list-style:none;margin:7px 0 0;padding:0;display:grid;gap:1px;color:var(--muted);font-size:11.5px;line-height:1.45}
.notes li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.notes i{display:inline-block;min-width:14px;font-style:normal;font-weight:700;color:var(--ink)}.notes em{font-style:normal;margin-left:7px}
@media(max-width:680px){.rows{width:auto}.chars{grid-template-columns:repeat(5,minmax(0,1fr));flex:1}.chars img,.missing{width:100%;height:auto;aspect-ratio:1}}${fbCss}
</style></head><body><main class="wrap"><h1>${_esc(output['title'])}</h1><p class="lead">${lead}</p>
<nav class="tabs" aria-label="조건">${tabs}</nav>${panels}</main>
<script>document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.tab,.variant-panel').forEach(el=>el.classList.remove('active'));btn.classList.add('active');document.querySelector(\`.variant-panel[data-panel="\${btn.dataset.tab}"]\`).classList.add('active')}));</script></body></html>`;
}

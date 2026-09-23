/**
 * 육성 효율 보고서 HTML 렌더러 (파이썬 `growth_html.py`의 이식).
 *
 * 딜량 보고서(`report_html`)의 CSS 토큰·이미지 인라인·운용 조건 블록을 그대로 쓰고,
 * Δ를 보여주는 부분만 여기서 만든다. **계산은 하지 않는다** — `growth.analyze()`가
 * 낸 값을 그리기만 한다.
 *
 * 시각화 규칙
 *   · Δ는 부호가 뜻을 가지므로 **발산형**이다 — 0을 가운데 두고 양·음이 서로 다른 색,
 *     유의하지 않은 값(|Δ| ≤ 2·표준오차)은 중립 회색 + `판정 불가` 라벨.
 *     기대값 모드(기본)에는 표본오차가 없어 Δ=0일 때만 중립색 + `차이 없음`이 된다.
 *   · 덱 총딜 Δ와 자기 딜 Δ는 **한 축에 겹치지 않는다.** 두 열로 나란히 놓는다.
 *   · 오차 막대는 ±2·표준오차. 막대 끝에 얹는다.
 */

import { _py_float_repr } from '../../../../site/src/engine/customization';
import { get, truthy } from '../../../../site/src/engine/py';
import { loadEngine } from '../../report-squad/scripts/engine_env';
import { dumps, esc, fmt, nowMinute } from '../../report-squad/scripts/pycompat';
import {
  _CSS, _enemy_desc, _img_css, _kor, _ops, _squad_strip,
} from '../../report-squad/scripts/report_html';

const _esc = esc;

// 발산형 막대에 얹는 CSS. report의 토큰(--good/--bad/--muted/--grid)을 그대로 쓴다.
const _EXTRA_CSS = `
.dgrid { display: grid; grid-template-columns: minmax(150px,1.3fr) 1fr 1fr; gap: 0 14px;
         align-items: center; font-variant-numeric: tabular-nums; }
.dgrid > .hd { font-size: 11.5px; color: var(--muted); padding: 0 0 6px;
               border-bottom: 1px solid var(--border); margin-bottom: 6px; }
.dgrid > .lb { font-size: 13px; padding: 5px 0; min-width: 0; }
.dgrid > .lb .sub2 { color: var(--muted); font-size: 11.5px; }
.dgrid > .cell { padding: 5px 0; }
/* 0을 가운데 둔 발산 트랙. 양수는 오른쪽, 음수는 왼쪽으로 자란다. */
.track { position: relative; height: 20px; background: var(--grid);
         border-radius: 4px; overflow: hidden; }
.track .zero { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px;
               background: var(--axis); }
.track .fill { position: absolute; top: 3px; bottom: 3px; border-radius: 4px; }
.track .fill.pos { background: var(--good); left: 50%; }
.track .fill.neg { background: var(--bad); }
.track .fill.nil { background: var(--muted); opacity: .5; }
/* ±2·표준오차. 막대 위에 얹히므로 표면색 테두리로 띄운다. */
.track .err { position: absolute; top: 5px; bottom: 5px;
              border-left: 1px solid var(--surface); border-right: 1px solid var(--surface);
              background: color-mix(in srgb, var(--ink) 22%, transparent); }
.dnum { font-size: 12.5px; margin-top: 3px; color: var(--ink2); }
.dnum b { color: var(--ink); font-size: 13px; }
.dnum .nil { color: var(--muted); }
.tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px;
       font-size: 10.5px; background: var(--grid); color: var(--muted);
       border: 1px solid var(--border); }
.axisbox { border-top: 1px solid var(--border); padding: 14px 0 4px; }
.axisbox:first-child { border-top: none; padding-top: 2px; }
.axisname { font-weight: 640; font-size: 14px; margin-bottom: 8px; }
.axisname .who { color: var(--muted); font-weight: 400; font-size: 12px; margin-left: 8px; }
table.g { border-collapse: collapse; width: 100%; font-size: 12.5px;
          font-variant-numeric: tabular-nums; }
table.g th, table.g td { padding: 6px 10px; text-align: right;
                         border-bottom: 1px solid var(--border); }
table.g th:first-child, table.g td:first-child { text-align: left; }
table.g th { color: var(--muted); font-weight: 500; font-size: 11.5px; }
table.g td.pos { color: var(--good); }
table.g td.neg { color: var(--bad); }
table.g td.nil, table.g td span.nil { color: var(--muted); }
/* 재화 효율 표 — 축(=메뉴얼 종류)마다 머리줄을 두고 그 아래를 한 칸 들여 쓴다. */
table.g tr.grp td { text-align: left; border-bottom: none; padding: 16px 10px 2px;
                    font-weight: 640; font-size: 13px; }
table.g tr.grp:first-child td { padding-top: 2px; }
table.g tr.grp .sub2 { color: var(--muted); font-weight: 400; font-size: 11.5px;
                       margin-left: 8px; }
table.g td.ind { padding-left: 22px; }
table.g td.effcell { white-space: nowrap; }
/* 값 옆의 미니 막대. 길이는 **같은 메뉴얼끼리만** 비교된다 (표 머리글 참고). */
.mini { display: inline-block; width: 76px; height: 7px; margin-left: 9px;
        background: var(--grid); border-radius: 3px; vertical-align: 1px; }
.mini i { display: block; height: 100%; border-radius: 3px; background: var(--good); }
.mini i.neg { background: var(--bad); }
.mini i.nil { background: var(--muted); opacity: .5; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--ink2);
          margin-bottom: 10px; }
.legend i { display: inline-block; width: 11px; height: 11px; border-radius: 3px;
            margin-right: 5px; vertical-align: -1px; }
.basecard { display: flex; flex-wrap: wrap; gap: 22px; align-items: center; }
.basecard .num { font-variant-numeric: tabular-nums; }
.basecard .num b { font-size: 20px; letter-spacing: -0.01em; }
.basecard .num span { display: block; color: var(--muted); font-size: 11.5px; }
`;

function _pct2(x: number): string {
  return `${fmt(x, '+.2f')}%`;
}

function _cls(d: Record<string, any>): string {
  if (!d['sig']) return 'nil';
  return d['mean'] > 0 ? 'pos' : 'neg';
}

/** 발산형 막대 하나. `scale`은 이 카드에서 100%에 해당하는 Δ% 절대값. */
function _bar(d: Record<string, any>, scale: number): string {
  const pct: number = d['pct']; const se: number = d['se_pct'];
  // 파이썬 `min(x, 50)` — x가 50을 넘으면 정수 50이 돌아온다(아래 `{50 - w}` 표기가 갈린다).
  let w: number; let wIsInt = false;
  if (scale) {
    const x = Math.abs(pct) / scale * 50;
    if (x > 50) { w = 50; wIsInt = true; } else w = x;
  } else w = 0.0;
  const kind = _cls(d);
  let fill: string;
  if (kind === 'nil') {
    const left = pct < 0 ? (wIsInt ? String(50 - w) : _py_float_repr(50 - w)) : '50';
    fill = `<div class="fill nil" style="left:${left}%;width:${fmt(w, '.3f')}%"></div>`;
  } else if (pct >= 0) {
    fill = `<div class="fill pos" style="width:${fmt(w, '.3f')}%"></div>`;
  } else {
    fill = `<div class="fill neg" style="left:${fmt(50 - w, '.3f')}%;width:${fmt(w, '.3f')}%"></div>`;
  }

  let err = '';
  if (se && scale) {
    let lo = (pct - 2 * se) / scale * 50 + 50;
    let hi = (pct + 2 * se) / scale * 50 + 50;
    lo = Math.max(0.0, Math.min(100.0, lo)); hi = Math.max(0.0, Math.min(100.0, hi));
    err = `<div class="err" style="left:${fmt(lo, '.3f')}%;width:${fmt(Math.max(hi - lo, 0.4), '.3f')}%"></div>`;
  }

  const tag = d['sig'] ? '' : `<span class="tag">${get(d, 'exact') ? '차이 없음' : '판정 불가'}</span>`;
  // 기대값 모드는 표본오차가 없다 — ±를 적으면 없는 불확실성을 있는 것처럼 보여준다
  const err_txt = get(d, 'exact') ? ''
    : `<span class="${kind === 'nil' ? 'nil' : ''}">± ${fmt(2 * se, '.2f')}%p</span>`;
  const num = `<div class="dnum"><b class="${kind}">${_esc(_pct2(pct))}</b> ${err_txt}${tag}</div>`;
  return `<div class="cell"><div class="track"><div class="zero"></div>${fill}${err}</div>${num}</div>`;
}

function _legend(scale: [number, number], expected = false): string {
  const noise = expected
    ? '<span><i style="background:var(--muted);opacity:.5"></i>차이 없음 (Δ = 0)</span>'
    : '<span><i style="background:var(--muted);opacity:.5"></i>판정 불가 '
      + '(차이가 ±2·표준오차 안)</span>'
      + '<span>가는 세로 띠 = ±2·표준오차</span>';
  return '<div class="legend">'
    + '<span><i style="background:var(--good)"></i>기준보다 증가</span>'
    + '<span><i style="background:var(--bad)"></i>기준보다 감소</span>'
    + noise
    + `<span>막대 길이는 <b>열 안에서만</b> 비교된다 — 왼쪽 열 끝 `
    + `${fmt(scale[0], '.1f')}%, 오른쪽 열 끝 ${fmt(scale[1], '.1f')}%</span></div>`;
}

function _axis_block(ax: Record<string, any>, scale: [number, number], subject: string): string {
  const who = ax['target'] === subject ? '' : `<span class="who">대상 ${_esc(ax['target'])}</span>`;
  const note = truthy(ax['note'])
    ? `<div class="sub2" style="color:var(--muted);font-size:12px">${_esc(ax['note'])}</div>` : '';
  const rows = ['<div class="hd">단계</div><div class="hd">덱 전체 딜 Δ</div>'
    + '<div class="hd">해당 캐릭 딜 Δ</div>'];
  for (const st of ax['steps']) {
    if (st['base']) {
      rows.push(`<div class="lb">${_esc(st['label'])}`
        + '<span class="tag">기준</span>'
        + `<div class="sub2">${_esc(_kor(st['total']))} · `
        + `본인 ${_esc(_kor(st['self']))}</div></div>`
        + '<div class="cell"><div class="track"><div class="zero"></div></div>'
        + '<div class="dnum"><b>0.00%</b></div></div>'
        + '<div class="cell"><div class="track"><div class="zero"></div></div>'
        + '<div class="dnum"><b>0.00%</b></div></div>');
      continue;
    }
    let inc = '';
    if (st['step_deck_pct'] !== null) {
      inc = `<div class="sub2">직전 단계 대비 덱 ${fmt(st['step_deck_pct'], '+.2f')}%</div>`;
    }
    rows.push(`<div class="lb">${_esc(st['label'])}${inc}</div>`
      + `${_bar(st['delta']['deck'], scale[0])}`
      + `${_bar(st['delta']['self'], scale[1])}`);
  }
  return `<div class="axisbox"><div class="axisname">${_esc(ax['name'])}${who}</div>${note}`
    + `<div class="dgrid">${rows.join('')}</div></div>`;
}

function _eff_cls(x: number, sig: boolean): string {
  if (!sig) return 'nil';
  return x > 0 ? 'pos' : (x < 0 ? 'neg' : 'nil');
}

/** 재화 효율 — 한 칸이 메뉴얼 몇 장이고, 그 장수가 얼마짜리인가. */
function _cost_block(d: Record<string, any>): string {
  const rows = (get(d, 'cost_rows') || []) as any[];
  if (!rows.length) return '';

  const top = (rows.length ? rows.map((r) => Math.abs(r['per100'])).reduce((a, b) => (b > a ? b : a)) : 0.0) || 1.0;

  const body: string[] = [];
  let seen: string | null = null;
  for (const r of rows) {
    if (r['axis'] !== seen) {
      seen = r['axis'];
      body.push(`<tr class="grp"><td colspan="4">${_esc(r['axis'])}`
        + `<span class="sub2">${_esc(r['kind'])}</span></td></tr>`);
    }
    const tag = r['sig'] ? '' : `<span class="tag">${get(r, 'exact') ? '차이 없음' : '판정 불가'}</span>`;
    const w = Math.min(Math.abs(r['per100']) / top * 100, 100);
    const cls = _eff_cls(r['per100'], r['sig']);
    body.push(
      `<tr><td class="ind">${_esc(r['from'] === null ? 'None' : String(r['from']))} → ${_esc(String(r['to']))}${tag}</td>`
      + `<td>${fmt(r['cost'], '.0f')}<span class="nil">장</span></td>`
      + `<td class="${_eff_cls(r['deck_pct'], r['sig'])}">${fmt(r['deck_pct'], '+.2f')}%</td>`
      + `<td class="effcell"><b class="${cls}">${fmt(r['per100'], '+.3f')}</b>`
      + `<span class="mini"><i class="${cls}" style="width:${fmt(w, '.2f')}%"></i></span></td></tr>`);
  }

  const total = ((get(d, 'cost_total') || []) as any[])
    .map((t) => `${_esc(t['kind'])} <b>${fmt(t['cost'], '.0f')}장</b>`).join(' · ');
  return `
  <h2>재화 효율 — 한 칸이 얼마짜리인가</h2>
  <div class="card">
    <p class="sub" style="margin:0 0 12px">한 칸(직전 레벨 → 이 레벨)에 드는 메뉴얼 장수와,
    그 <b>100장이 덱 딜을 몇 %p 올리는가</b>. 두 메뉴얼은 서로 대체되지 않아 장수를 한
    단위로 합치지 않았다.</p>
    <table class="g"><thead><tr><th>단계</th><th>메뉴얼</th><th>덱 딜 Δ</th>
      <th>100장당 덱 딜</th></tr></thead><tbody>${body.join('')}</tbody></table>
    <p class="sub" style="margin:12px 0 0">전부 만렙까지 올리는 데 ${total}.</p>
  </div>`;
}

function _combo_table(combos: any[]): string {
  if (!combos.length) return '';
  const rows: string[] = [];
  for (const cb of combos) {
    const parts = (cb['parts'] as any[])
      .map((p) => `${_esc(p['axis'])} ${_esc(p['label'])} (${fmt(p['deck_pct'], '+.2f')}%)`).join(' + ');
    const gap = cb['gap_deck'];
    const cls = gap > 0.05 ? 'pos' : (gap < -0.05 ? 'neg' : 'nil');
    rows.push(
      `<tr><td>${_esc(cb['label'])}<div class="sub2" style="color:var(--muted);`
      + `font-size:11.5px">${parts}</div></td>`
      + `<td class="${_cls(cb['delta']['deck'])}">${_pct2(cb['delta']['deck']['pct'])}</td>`
      + `<td class="nil">${fmt(cb['sum_deck'], '+.2f')}%</td>`
      + `<td class="${cls}">${fmt(gap, '+.2f')}%p</td>`
      + `<td class="${_cls(cb['delta']['self'])}">${_pct2(cb['delta']['self']['pct'])}</td>`
      + `<td class="nil">${fmt(cb['sum_self'], '+.2f')}%</td>`
      + `<td>${fmt(cb['gap_self'], '+.2f')}%p</td></tr>`);
  }
  return '<h2>조합 검증 — 같이 올리면 합보다 큰가</h2><div class="card">'
    + '<p class="sub" style="margin:0 0 10px">실제로 둘 다 올려 돌린 값과, 각각 따로 올린 '
    + 'Δ를 그냥 더한 값의 차이다. 차이가 +면 상승 효과가 서로 곱해진 것이고, '
    + '−면 한쪽이 다른 쪽에 먹혔다는 뜻이다 (버프 상한·오버킬).</p>'
    + '<table class="g"><thead><tr><th>조합</th><th>덱 실측 Δ</th><th>덱 단순 합</th>'
    + '<th>차이</th><th>본인 실측 Δ</th><th>본인 단순 합</th><th>차이</th></tr></thead>'
    + `<tbody>${rows.join('')}</tbody></table></div>`;
}

/** 덱 간 대조 — 같은 투자가 덱에 따라 얼마나 다른가. */
function _cross_deck(result: Record<string, any>): string {
  const decks = result['decks'] as any[];
  if (decks.length < 2) return '';
  const keys: Array<[string, string]> = [];
  for (const d of decks) {
    for (const r of d['rank']) {
      if (!keys.some(([a, l]) => a === r['axis'] && l === r['label'])) keys.push([r['axis'], r['label']]);
    }
  }
  const idx = decks.map((d) => new Map<string, any>((d['rank'] as any[]).map((r) => [`${r['axis']}|${r['label']}`, r])));

  const head = decks.map((d) => `<th>${_esc(d['name'])}</th>`).join('');
  const rows: string[] = [];
  for (const [ax, lb] of keys) {
    const cells: string[] = [];
    for (const m of idx) {
      const r = m.get(`${ax}|${lb}`);
      if (!r) { cells.push('<td class="nil">—</td>'); continue; }
      const dk = r['delta']['deck'];
      cells.push(`<td class="${_cls(dk)}">${_pct2(dk['pct'])}</td>`);
    }
    rows.push(`<tr><td>${_esc(ax)} → ${_esc(lb)}</td>${cells.join('')}</tr>`);
  }
  return '<h2>덱 간 대조 — 덱 전체 딜 Δ</h2><div class="card">'
    + '<p class="sub" style="margin:0 0 10px">같은 투자가 덱에 따라 얼마나 다르게 '
    + '돌아오는지. 여기서 크게 갈리면 "이 캐릭터를 어디에 쓰느냐"가 육성 순서보다 '
    + '먼저 정해져야 한다는 뜻이다.</p>'
    + `<table class="g"><thead><tr><th>투자</th>${head}</tr></thead>`
    + `<tbody>${rows.join('')}</tbody></table></div>`;
}

function _raw_table(cases: Array<Record<string, any>>, seeds: Array<number | null>): string {
  if (seeds.length <= 1) return '';
  const head = seeds.map((_, i) => `<th>#${i + 1}</th>`).join('');
  const rows = cases.map((c) => `<tr><td>${_esc(c['name'])}</td>`
    + (c['runs'] as any[]).map((r) => `<td>${_esc(_kor(r['squad_total']))}</td>`).join('')
    + '</tr>').join('');
  return `<details><summary>회차별 총딜 (케이스 ${cases.length}개)</summary>`
    + `<div class="detail-body"><table class="g"><thead><tr><th>케이스</th>${head}</tr>`
    + `</thead><tbody>${rows}</tbody></table></div></details>`;
}

export function render_html(spec: Record<string, any>, cases: Array<Record<string, any>>, result: Record<string, any>,
  seeds: Array<number | null>, expected = false): string {
  loadEngine();
  const now = nowMinute();
  const subject = result['subject'];
  const decks = result['decks'] as any[];

  const mode_label = ({ skill: '스킬 조사', option: '옵션 조사' } as Record<string, string>)[get(result, 'mode', '')] ?? '';
  const chips = [`대상 ${subject}`, mode_label, `덱 ${decks.length}개`, `케이스 ${cases.length}개`,
    expected ? '기대값 모드 · 크리/코어 난수 없음' : `케이스당 ${seeds.length}회`,
    cases.length ? `전투 ${fmt(cases[0]!['duration'], '.0f')}초` : '',
    `생성 ${now}`];
  const chip_html = chips.filter((t) => t).map((t) => `<span class="chip">${_esc(t)}</span>`).join('');
  const foot_txt = expected
    ? 'Δ는 기준 케이스와의 차다. 크리·코어히트를 기대값으로 계산해 난수가 없으므로, '
      + '여기 적힌 차이는 전부 실제 차이다 — 회차를 늘려도 값이 달라지지 않는다.'
    : 'Δ는 <b>페어드 델타</b>다 — 시드별로 먼저 기준과의 차를 구하고 그 평균을 냈다. '
      + '케이스별 평균끼리 빼는 것보다 난수 노이즈가 훨씬 작아, 총딜 CV(약 1%)보다 작은 '
      + '차이도 잡힌다. ±는 그 차이의 2·표준오차이며, Δ가 이 안에 들면 <b>판정 불가</b>로 '
      + '적었다. 회차를 늘리면 ±가 √n에 반비례해 줄어든다.';

  const img_css = _img_css(cases.flatMap((c) => c['squad'] as string[]));

  const by_deck = new Map<string, Array<Record<string, any>>>();
  for (const c of cases) {
    const k = get(c, 'group', '');
    if (!by_deck.has(k)) by_deck.set(k, []);
    by_deck.get(k)!.push(c);
  }

  // 막대 길이는 **전 덱 통틀어** 최대 |Δ%| 기준. 덱 딜과 자기 딜은 **열마다 따로** 잰다.
  const _scale = (metric: string): number => {
    const xs = decks.flatMap((d) => (d['rank'] as any[]).map((r) => Math.abs(r['delta'][metric]['pct'])));
    return (xs.length ? xs.reduce((a, b) => (b > a ? b : a)) : 1.0) || 1.0;
  };
  const scale: [number, number] = [_scale('deck'), _scale('self')];

  const tabs: string[] = []; const panels: string[] = [];
  decks.forEach((d, i) => {
    const gcases = by_deck.get(d['name']) ?? [];
    tabs.push(`<button class="tab${i === 0 ? ' on' : ''}" `
      + `data-panel="p${i}">${_esc(d['name'])}</button>`);
    // 운용 조건은 **기준 케이스만** 넣어 만든다.
    const base_case = gcases.find((c) => c['name'] === d['base_case']) ?? null;
    const [ops_top] = _ops(spec, base_case ? [base_case] : gcases);
    const base_note = truthy(d['note']) ? `<p class="sub">${_esc(d['note'])}</p>` : '';

    const share = d['base_total'] ? d['base_self'] / d['base_total'] * 100 : 0;
    const base_card = '<div class="card basecard">'
      + `<div style="flex:0 0 290px">${_squad_strip(d['squad'])}</div>`
      + `<div class="num"><b>${_esc(_kor(d['base_total']))}</b>`
      + `<span>기준 덱 총딜 (CV ${fmt(d['base_cv'], '.2f')}%)</span></div>`
      + `<div class="num"><b>${_esc(_kor(d['base_self']))}</b>`
      + `<span>${_esc(subject)} 본인 딜 · 덱의 `
      + `${fmt(share, '.1f')}%</span></div>`
      + `<div class="num"><b>${fmt(d['burst_count'], '.1f')}</b><span>풀버스트 횟수</span></div>`
      + '</div>';

    panels.push(`
<div class="panel" id="p${i}"${i === 0 ? '' : ' hidden'}>
  <div class="boss"><b>랩쳐</b> ${_esc(_enemy_desc(d['enemy']))}</div>
  ${ops_top}
  ${base_note}

  <h2>기준</h2>
  ${base_card}

  ${_cost_block(d)}

  <h2>축별 상세</h2>
  <div class="card">
    ${_legend(scale, expected)}
    ${(d['axes'] as any[]).map((ax) => _axis_block(ax, scale, subject)).join('')}
  </div>

  ${_combo_table(d['combos'])}
</div>`);
  });

  const tab_html = decks.length > 1 ? `<div class="tabs">${tabs.join('')}</div>` : '';
  const note = truthy(get(spec, 'note')) ? `<p class="sub">${_esc(spec['note'])}</p>` : '';
  const base_json = _esc(dumps(result['baseline'], { indent: 2 }));
  // 무엇을 고정하고 무엇을 움직였는지. 이 줄이 없으면 Δ가 무엇 대비인지 알 수 없다.
  const mnotes = ((get(result, 'mode_notes') || []) as string[]).map((n) => `<li>${_esc(n)}</li>`).join('');
  const mblock = mnotes ? `<div class="ops"><b>조사 범위</b><ul>${mnotes}</ul></div>` : '';

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${_esc(spec['title'])} — 육성 효율 보고서</title>
<style>${_CSS}
${_EXTRA_CSS}
${img_css}</style></head>
<body><div class="wrap">
  <h1>${_esc(spec['title'])}</h1>
  ${note}
  <div class="chips">${chip_html}</div>
  ${mblock}
  ${tab_html}
  ${panels.join('')}

  ${_cross_deck(result)}

  <h2>원자료 · 설정</h2>
  <div class="card" style="padding-top:0">
    ${_raw_table(cases, seeds)}
    <details><summary>기준 육성 오버라이드 (${_esc(subject)})</summary>
      <div class="detail-body"><pre>${base_json}</pre></div></details>
  </div>

  <p class="foot">
    ${foot_txt}
  </p>
</div>
<script>
document.querySelectorAll('.tab').forEach(function (t) {
  t.addEventListener('click', function () {
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('on'); });
    document.querySelectorAll('.panel').forEach(function (p) { p.hidden = true; });
    t.classList.add('on');
    document.getElementById(t.dataset.panel).hidden = false;
  });
});
</script>
</body></html>`;
}

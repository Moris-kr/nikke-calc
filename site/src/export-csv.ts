/**
 * 계산 결과를 표 계산 프로그램으로 내보낸다.
 *
 * 화면은 숫자를 「1.24억」처럼 줄여 적는다 — 한눈에 견주기에는 그게 낫지만, 1의 자리까지
 * 놓고 따져 보려면 다른 통로가 필요하다. **엔진은 처음부터 정수로 정확히 세고 있다**
 * (히트마다 방어력 계산이 끝난 정수). 계산이 뭉뚱그려져 있어서가 아니라 «보여 줄 자리»가
 * 없었을 뿐이라, 여기서는 그 정수를 그대로 내보낸다.
 *
 * 엑셀이 UTF-8 CSV를 한글 깨짐 없이 읽으려면 BOM이 필요하다 — `csvBlob`이 붙인다.
 */

import type { BattleTimeline, SimulationResult } from './types';

/** 한 칸. 쉼표·따옴표·줄바꿈이 들어가면 감싸고, 안쪽 따옴표는 겹쳐 쓴다. */
export function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 줄 목록 → CSV 한 덩이. 줄 끝은 CRLF다(엑셀·구글 시트가 둘 다 안전하게 읽는다). */
export const csvText = (rows: Array<Array<string | number>>): string =>
  rows.map((row) => row.map(csvCell).join(',')).join('\r\n');

/**
 * 「초당 대미지」 표. 첫 줄은 머리글, 그다음은 구간마다 한 줄이다.
 *
 * 칸의 크기는 결과에 실려 온 값을 그대로 따른다(`timeline.bucket`) — 1초짜리 결과든
 * 더 잘게 쪼갠 결과든 같은 함수가 그린다. 마지막 두 열은 그 구간의 합계와 누적이라,
 * 시트에서 따로 수식을 쓰지 않아도 «언제까지 얼마나 넣었는지»가 바로 보인다.
 */
export function perSecondRows(timeline: BattleTimeline, names: string[]):
Array<Array<string | number>> {
  const bucket = timeline.bucket || 1;
  const digits = bucket < 1 ? 1 : 0;
  const rows: Array<Array<string | number>> = [
    ['시작(초)', '끝(초)', ...names, '합계', '누적'],
  ];
  let running = 0;
  for (let index = 0; index < timeline.buckets; index += 1) {
    const each = names.map((name) => timeline.damage[name]?.[index] ?? 0);
    const sum = each.reduce((a, b) => a + b, 0);
    running += sum;
    rows.push([
      (index * bucket).toFixed(digits), ((index + 1) * bucket).toFixed(digits),
      ...each, sum, running,
    ]);
  }
  return rows;
}

/** 「최종 대미지」 표 — 캐릭터별 총합과 평타·스킬 나눔. 마지막 줄이 스쿼드 합계다. */
export function totalRows(result: SimulationResult, names: string[]):
Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [
    ['캐릭터', '총 대미지', '평타', '평타 히트', '스킬', '스킬 히트', '지분(%)'],
  ];
  const squad = result.squadTotal || 0;
  for (const name of names) {
    const total = Math.round(result.charTotals[name] ?? 0);
    const cut = result.charBreakdown?.[name];
    rows.push([
      name, total,
      cut ? Math.round(cut.normal) : '', cut ? cut.normalHits : '',
      cut ? Math.round(cut.skill) : '', cut ? cut.skillHits : '',
      squad > 0 ? (total / squad * 100).toFixed(2) : '',
    ]);
  }
  rows.push(['스쿼드 합계', Math.round(squad), '', '', '', '', squad > 0 ? '100.00' : '']);
  return rows;
}

/**
 * 내보낼 CSV 한 장. 위쪽에 최종 대미지, 한 줄 띄고 초당 대미지를 잇는다 —
 * 파일 하나로 받는 편이 두 장을 오가는 것보다 낫고, 시트에서 잘라 쓰기도 쉽다.
 */
export function damageCsv(result: SimulationResult, names: string[], note = ''): string {
  const head: Array<Array<string | number>> = [
    ['NIKKE 스쿼드 계산기 · 정밀 수치'],
    ['전투 시간(초)', result.duration, '총 히트', result.hitCount],
  ];
  if (note) head.push(['조건', note]);
  const rows = [...head, [], ...totalRows(result, names)];
  if (result.timeline) {
    const bucket = result.timeline.bucket || 1;
    rows.push([], [`구간별 대미지 (${bucket}초 단위)`], ...perSecondRows(result.timeline, names));
  }
  return csvText(rows);
}

/** 엑셀이 한글을 깨뜨리지 않게 BOM을 붙인 CSV 덩이. */
export const csvBlob = (text: string): Blob =>
  new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' });

/** 파일 이름에 쓸 수 없는 글자를 털어 낸다. 덱 이름이 그대로 들어오기 때문이다. */
export const csvFileName = (label: string, at = new Date()): string => {
  const stamp = [at.getFullYear(), at.getMonth() + 1, at.getDate()]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0'))).join('');
  const safe = label.replace(/[\\/:*?"<>|]/g, '').trim() || '계산';
  return `니케계산기_${safe}_${stamp}.csv`;
};

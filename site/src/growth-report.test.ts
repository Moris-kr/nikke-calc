// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {growthReportHtml,mergeSkillPlans,rankModuleResults,skillMaterialLines,skillTotalLines} from './growth-report';
import { BURST_III_IN_SKILL_III, skillManualIIIUnits } from './growth-report';
import {calculatePlan,MATERIAL_NAMES} from './skill-planner';
describe('growth result exports',()=>{
 it('exports all collapsed results as offline readable HTML without action buttons',()=>{
  const output=document.createElement('div');const detail=document.createElement('details');detail.innerHTML='<summary>상세</summary><p>필요 모듈 123개</p><button>계산</button>';output.append(detail);
  const text=document.createElement('p');text.textContent='<script>alert(1)</script>';output.append(text);
  const html=growthReportHtml(output,'p{color:red}');const doc=new DOMParser().parseFromString(html,'text/html');
  expect(doc.querySelector('details')?.open).toBe(true);expect(doc.querySelector('button')).toBeNull();expect(doc.querySelector('script')).toBeNull();expect(doc.body.textContent).toContain('필요 모듈 123개');expect(doc.querySelector('style')?.textContent).toContain('p{color:red}');expect(detail.open).toBe(false);
 });
 it('deduplicates characters across decks and sums only actual skill increases',()=>{
  const rows=[{name:'아인',current:[1,1,1],target:[2,1,1]},{name:'아인',current:[1,1,1],target:[3,1,1]}];
  expect(mergeSkillPlans(rows)).toEqual([{name:'아인',current:[1,1,1],target:[3,1,1]}]);
  const cost=calculatePlan([{name:'아인',current:[1,1,1],target:[3,1,1]}],{}).required;
  for(const [key,n] of Object.entries(cost))expect(skillTotalLines(rows)).toContain(`${MATERIAL_NAMES[key]} ${n.toLocaleString('ko-KR')}개`);
  expect(skillMaterialLines([{name:'미확인',current:[1,1,1],target:[2,1,1]}])[0]).toContain('미확인');
  expect(skillTotalLines([{name:'아인',current:[10,10,10],target:[10,10,10]}])).toEqual(['추가 스킬 재료 없음']);
 });
 it('ranks all decks by damage per module, keeping no-cost and failed analyses out of efficiency ranks',()=>{
  const rows=[{deckId:1,name:'A',total:10,damagePerModule:2},{deckId:2,name:'B',total:30,damagePerModule:9},{deckId:1,name:'C',total:0,damagePerModule:0},{deckId:3,name:'D',error:'missing'}];
  expect(rankModuleResults(rows).map(row=>row.name)).toEqual(['B','A','C','D']);expect(rows[0]?.name).toBe('A');
 });
});

describe('스킬칩 가성비 비용 — 매뉴얼 III만', () => {
  it('스킬 매뉴얼 III + 버스트 매뉴얼 III × 2(30 DAY 상자 교환비 8 : 4)로 환산한다', () => {
    expect(BURST_III_IN_SKILL_III).toBe(2);
    const row = { name: '신 : 스위프트 바니', current: [1, 1, 1], target: [10, 10, 10] };
    const units = skillManualIIIUnits(row);
    expect(units.skill3).toBe(630);
    expect(units.units).toBe(units.skill3 + units.burst3 * 2);
    // 매뉴얼 I·II만 드는 구간은 비용이 0이다.
    expect(skillManualIIIUnits({ ...row, current: [1, 1, 1], target: [2, 1, 1] }).units).toBe(0);
  });
});

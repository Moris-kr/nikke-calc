// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {inlineCodeIcon,bossElementHint,elementText,refreshElementSelect} from './element-inline';
describe('inline element icons',()=>{
 it('shows the correct weakness without dropping readable text',()=>{
  const hint=bossElementHint('작열');expect(hint.textContent).toBe('작열 보스 · 수냉 우월');
  expect([...hint.querySelectorAll('img')].map(img=>img.title)).toEqual(['작열','수냉']);
 });
 it('does not guess unknown elements',()=>{
  expect(bossElementHint('').textContent).toBe('');expect(inlineCodeIcon('unknown').children.length).toBe(0);
  expect(inlineCodeIcon().children.length).toBe(5);
 });
});
it('keeps summaries as safe text with inline icons',()=>{
 const host=document.createElement('span');host.append(elementText('적 수냉 · <script>풍압</script>'));
 expect(host.textContent).toBe('적 수냉 · <script>풍압</script>');expect(host.querySelector('script')).toBeNull();expect(host.querySelectorAll('img')).toHaveLength(2);
});
it('refreshes restored values without duplicate controls',()=>{
 const host=document.createElement('div');host.innerHTML='<select><option value="작열">작열 (수냉이 우월)</option><option value="수냉">수냉 (전격이 우월)</option></select>';
 const select=host.querySelector('select')!;refreshElementSelect(select,'보스 코드');
 expect(select.hidden).toBe(true);expect(host.querySelectorAll('button img')).toHaveLength(2);
 select.value='수냉';refreshElementSelect(select,'보스 코드');
 expect(host.querySelector('button')!.textContent).toBe('수냉 (전격이 우월)');expect(host.querySelectorAll('button')).toHaveLength(1);
});

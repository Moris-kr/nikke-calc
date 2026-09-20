// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {inlineCodeIcon,bossElementHint} from './element-inline';
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

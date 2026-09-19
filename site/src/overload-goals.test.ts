import {describe,it,expect} from 'vitest';
import {allocateOverloadGoals} from './overload-goals';
import {overloadLinesOf} from './character-settings';
const parts=['머리','몸통','팔','다리'] as const;
describe('whole-character overload goals',()=>{
 it('allocates 4/4/4 with no duplicate effect in any part',()=>{
  const plan=allocateOverloadGoals([{option:'element',count:4,alternatives:[]},{option:'atk',count:4,alternatives:[]},{option:'crit',count:4,alternatives:[]}],{});
  for(const part of parts)expect(new Set(plan.lines[part]!.map(row=>row.option))).toEqual(new Set(['element','atk','crit']));
  expect(plan.substitutions).toEqual([]);
 });
 it('retains current slots where possible without changing input',()=>{
  const current=overloadLinesOf({머리:[{option:'crit',level:7},{option:'atk',level:3},{option:'element',level:2}]});
  const plan=allocateOverloadGoals([{option:'element',count:4,alternatives:[]},{option:'atk',count:4,alternatives:[]},{option:'crit',count:4,alternatives:[]}],current);
  expect(plan.lines.머리!.map(row=>row.option)).toEqual(['crit','atk','element']);expect(current.머리[0]!.level).toBe(7);
 });
 it('can explicitly choose a second or third priority instead of silently calling it the primary goal',()=>{
  const goals=[{option:'element',count:4,alternatives:[]},{option:'atk',count:4,alternatives:[]},{option:'crit',count:4,alternatives:['ammo','rate']}];
  expect(allocateOverloadGoals(goals,{},1).substitutions).toEqual([]);
  const plan=allocateOverloadGoals(goals,{},2);
  for(const part of parts)expect(plan.lines[part]!.map(row=>row.option)).toContain('ammo');
  expect(plan.substitutions).toEqual([{from:'crit',to:'ammo',count:4,rank:2}]);
  expect(allocateOverloadGoals(goals,{},3).substitutions[0]!.to).toBe('rate');
 });
 it('rejects impossible duplicate-per-part goals and invalid counts',()=>{
  expect(()=>allocateOverloadGoals([{option:'a',count:5,alternatives:[]}],{})).toThrow();
  expect(()=>allocateOverloadGoals([{option:'a',count:4,alternatives:['b']},{option:'b',count:4,alternatives:[]}],{},2)).toThrow();
  expect(()=>allocateOverloadGoals(['a','b','c','d'].map(option=>({option,count:4,alternatives:[]})),{})).toThrow();
 });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { frameAt, pelletPoints, summarizeFrames, openShotgunHeatmap } from './shotgun-heatmap';
import { normalizeRequest } from './model';
import type { ShotgunHeatmapFrame, ShotgunHeatmapScene, DeckResultEntry, ShotgunHeatmapData } from './types';

const frames: ShotgunHeatmapFrame[] = [
  {t:1,scene:0,pellets:10,hit:.5,core:.2,accuracy:0,fullBurst:false},
  {t:3,scene:1,pellets:20,hit:1,core:.5,accuracy:20,fullBurst:true},
];
describe('shotgun interactive diagnostics', () => {
  it('opens an interactive dialog, uses result inputs and reuses loaded diagnostics', async () => {
    const ctx=new Proxy({}, {get:(_t,key)=>key==='measureText'?()=>({width:10}):()=>{}});
    const spy=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx as CanvasRenderingContext2D);
    const data: ShotgunHeatmapData={size:1,bounds:[-120,-120,240,240],density:[30],body:[14],core:[11],miss:[5],frames,
      scenes:[{shapes:[],aim:[0,0],radius:120,core:null,spatial:true,exponent:2.55},{shapes:[],aim:[0,0],radius:90,core:null,spatial:true,exponent:2.55}],sceneCount:2,spatial:true,fired:30,hit:25,coreHits:11};
    const entry:DeckResultEntry={deckId:2,request:{squad:['드레이크'],duration:4,enemyDef:123,enemyCode:'',corePx:0,hasParts:false,seed:7},result:{squadTotal:100,duration:4,hitCount:1,charTotals:{드레이크:100},previewNote:'',deviations:''}};
    const simulate=vi.fn().mockResolvedValue({...entry.result,shotgunReport:{드레이크:data}});
    let close=openShotgunHeatmap(entry,'덱 2',simulate);
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(simulate).toHaveBeenCalledWith({...entry.request,shotgunReport:true});
    expect(document.querySelector('[data-hm-name]')?.textContent).toBe('드레이크');
    (document.querySelector('[data-hm-next]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-hm-time]')?.textContent).toContain('1.00');
    close();expect(document.querySelector('.shotgun-modal')).toBeNull();
    close=openShotgunHeatmap(entry,'덱 2',simulate);await new Promise(resolve=>setTimeout(resolve,0));
    expect(simulate).toHaveBeenCalledTimes(1);close();spy.mockRestore();
  });
  it('weights by fired pellets, not average of per-shot percentages', () => {
    expect(summarizeFrames(frames)).toEqual({fired:30,hit:25,core:11,shots:2});
  });
  it('does not invent a shot before first fire and chooses the actual previous shot', () => {
    expect(frameAt(frames,0)).toBeUndefined();
    expect(frameAt(frames,2)).toBe(frames[0]);
    expect(frameAt(frames,3)).toBe(frames[1]);
  });
  it('uses engine quadrature locations and overlapping bodies only count once', () => {
    const scene: ShotgunHeatmapScene = {shapes:[['rect',0,0,120,120,0],['rect',0,0,120,120,0]],aim:[0,0],radius:120,core:[0,0,26],spatial:true,exponent:2.55};
    const points = pelletPoints(scene);
    expect(points).toHaveLength(1024);
    expect(points.filter(p=>p.kind==='core').length/1024).toBeCloseTo((26/120)**2.55,2);
    expect(points.some(p=>p.kind==='miss')).toBe(true);
  });
  it('never assigns spatial hit colours to legacy probability mode', () => {
    expect(pelletPoints({shapes:[],aim:[0,0],radius:120,core:null,spatial:false,exponent:2.55}).every(p=>p.kind==='density')).toBe(true);
  });
  it('keeps report requests separate from ordinary result cache keys', () => {
    const request = {squad:['드레이크'],duration:3,enemyDef:0,enemyCode:'' as const,corePx:0,hasParts:false,seed:42};
    expect(normalizeRequest({...request,shotgunReport:true}).shotgunReport).toBe(true);
    expect(normalizeRequest(request)).not.toHaveProperty('shotgunReport');
  });
});

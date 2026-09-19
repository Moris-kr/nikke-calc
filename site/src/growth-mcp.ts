interface GrowthIntegration {inspect:()=>Record<string,unknown>;calculate:()=>Promise<Record<string,unknown>>}
let integration:GrowthIntegration|undefined;
export function registerGrowthMcp(value:GrowthIntegration):()=>void{integration=value;return()=>{if(integration===value)integration=undefined;};}
export function inspectGrowthPlan(){if(!integration)throw new Error('계산기에서 육성효율 창을 열고 목표를 먼저 설정해 주세요.');return integration.inspect();}
export async function calculateGrowthPlan(){if(!integration)throw new Error('계산기에서 육성효율 창을 열고 목표를 먼저 설정해 주세요.');return integration.calculate();}

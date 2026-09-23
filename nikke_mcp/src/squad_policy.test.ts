// py: nikke_mcp/test_squad_policy.py — the policy itself is the TS engine's squad_policy.ts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { data as engineData } from '../../site/src/engine/data.ts';
import { inspect_squad_policy, query_squad_roles } from '../../site/src/engine/squad_policy.ts';
import { ensureEngineData } from './engine.ts';

ensureEngineData();
const squad = (first = '리타') => [first, '크라운', '신데렐라', '홍련 : 흑영', '나가'];
const policy = (members: string[], characters: Record<string, unknown> | null = null, purpose = 'recommendation', allow = false) =>
  inspect_squad_policy(members, characters, purpose, allow) as Record<string, any>;

/** Python patched `char_effects` to return `effects` for every member; none of these has favorite slots. */
function withEffects<R>(members: string[], effects: unknown[], body: () => R): R {
  const skills = engineData().parsed_skills;
  const saved = members.map((name) => [name, skills[name]] as const);
  for (const name of members) skills[name] = structuredClone(effects);
  try {
    return body();
  } finally {
    for (const [name, value] of saved) skills[name] = value;
  }
}

describe('squad policy', () => {
  it('positive team CDR is required', () => {
    const result = policy(squad());
    assert.equal(result['recommendedEligible'], true);
    assert.deepEqual(result['providers'], ['리타']);
    assert.equal(policy(squad('미란다'))['allowed'], false);
  });

  it('self reduction and negative reduction are not providers', () => {
    for (const name of ['레드 후드', '프리카']) {
      const result = policy(squad(name));
      assert.deepEqual(result['providers'], []);
      assert.equal(result['recommendedEligible'], false);
    }
  });

  it('explicit consent only allows a user-fixed simulation', () => {
    const members = squad('미란다');
    assert.equal(policy(members, null, 'user_fixed')['requiresConfirmation'], true);
    const accepted = policy(members, null, 'user_fixed', true);
    assert.equal(accepted['allowed'], true);
    assert.equal(accepted['recommendedEligible'], false);
    assert.equal(policy(members, null, 'recommendation', true)['allowed'], false);
  });

  it('Anis and Rapi with another B1 do not provide team CDR', () => {
    for (const name of ['아니스 : 스타', '라피 : 레드 후드']) {
      const members = squad(name);
      assert.ok(policy(members)['providers'].includes(name));
      members[4] = '미란다';
      assert.deepEqual(policy(members)['providers'], []);
    }
  });

  it('Anis with Rapi keeps Anis CDR and Rapi stage three', () => {
    const result = policy(['아니스 : 스타', '크라운', '라피 : 레드 후드', '스노우 화이트 : 헤비암즈', '마스트 : 로망틱 메이드']);
    assert.deepEqual(result['providers'], ['아니스 : 스타']);
    assert.equal(result['recommendedEligible'], true);
    assert.ok(result['burstStageCoverage']['3'].includes('라피 : 레드 후드'));
    assert.deepEqual(result['conditional'], []);
  });

  it('a re-entry-only stage cannot complete the burst chain', () => {
    const members = ['티아', '헬름 : 아쿠아마린', '신데렐라', '홍련 : 흑영', '나가'];
    const result = policy(members);
    assert.ok(result['constraints'].includes('missing_burst_stage_exit_1'));
    assert.equal(result['recommendedEligible'], false);
    members[4] = '리타';
    assert.equal(policy(members)['recommendedEligible'], true);
  });

  it('favorite stage selects the actual effects', () => {
    const members = squad('목단');
    assert.ok(policy(members)['providers'].includes('목단'));
    const result = policy(members, { '목단': { collection: { stage: 'SR15', favorite: 0 } } });
    assert.deepEqual(result['providers'], []);
    assert.equal(result['recommendedEligible'], false);
  });

  it('manual tap fire does not guarantee full-charge CDR', () => {
    const members = squad('D : 킬러 와이프');
    assert.equal(policy(members)['recommendedEligible'], true);
    const result = policy(members, { 'D : 킬러 와이프': { control: { tap_fire: { rate: 3.6 } } } });
    assert.equal(result['recommendedEligible'], false);
    assert.ok(result['conditional'].length);
  });

  it('the selected skill level is used', () => {
    const result = policy(squad('D : 킬러 와이프'), { 'D : 킬러 와이프': { skillLevels: { 2: 1 } } });
    assert.equal(result['cdrEffects'][0]['seconds'], 4.13);
  });

  it('restricted positive and negative team effects do not pass', () => {
    for (const [target, value] of [['allies_burst3', 7], ['all_allies', -21], ['self', 40]] as const) {
      const effect = { stat: 'burst_cooldown_reduce', target, fixed_value: value, trigger: { timing: ['full_burst_start'], condition: [] } };
      withEffects(squad(), [effect], () => assert.equal(policy(squad())['recommendedEligible'], false));
    }
  });

  it('an arbitrary unknown state is not effective', () => {
    const effect = { stat: 'burst_cooldown_reduce', target: 'all_allies', fixed_value: 7,
      trigger: { timing: ['full_burst_start'], condition: ['self_state:unknown'] } };
    const result = withEffects(squad(), [effect], () => policy(squad()));
    assert.deepEqual(result['providers'], []);
    assert.ok(result['conditional'].length);
  });

  it('the Soda exception requires the shotgun archetype', () => {
    const members = ['토브', '나유타', '소다 : 트윙클링 바니', '도로시 : 세렌디피티', '드레이크'];
    const result = policy(members);
    assert.equal(result['recommendedEligible'], true);
    assert.equal(result['exception'], 'soda_shotgun_fullburst_extension');
    const arbitrary = squad('미란다');
    arbitrary[2] = '소다 : 트윙클링 바니';
    assert.equal(policy(arbitrary)['recommendedEligible'], false);
    assert.equal(policy(members, { '소다 : 트윙클링 바니': { burst: { mode: 'skip' } } })['recommendedEligible'], false);
  });

  it('five unique members and stage coverage', () => {
    for (const members of [squad().slice(0, 4), Array(5).fill('리타'), ['리타', '신데렐라', '홍련 : 흑영', '앨리스', '모더니아']]) {
      assert.equal(policy(members, null, 'user_fixed', true)['allowed'], false);
    }
    assert.equal(policy(squad(), { '크라운': { burst: { mode: 'skip' } }, '나가': { burst: { mode: 'skip' } } })['allowed'], false);
  });

  it('one B3 is not automatically rejected', () => {
    assert.equal(policy(['리타', '크라운', '이사벨', '나가', '토브'])['recommendedEligible'], true);
  });

  it('roles are candidates, not composition guarantees', () => {
    const roles = (query_squad_roles(['리타', '레드 후드', '프리카', '아니스 : 스타']) as Record<string, any>)['characters'];
    assert.deepEqual(roles.map((r: any) => r['teamCdrCandidate']), [true, false, false, true]);
    assert.equal(roles.at(-1)['requiresSquadValidation'], true);
  });
});

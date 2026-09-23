// py: nikke_mcp/test_recommendation.py
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BrowserRelay } from './browser_relay.ts';
import { data, ensureEngineData } from './engine.ts';
import { ToolError } from './errors.ts';
import { RecommendationScenario } from './models.ts';
import { ValidationError } from './pydantic.ts';
import { evidence } from './recommendation_evidence.ts';
import { connect } from './testing.ts';

ensureEngineData();

describe('evidence', () => {
  it('relay rejects inconsistent selected and scores', () => {
    const squad = ['리타', '크라운', '헬름', '앨리스', '모더니아'];
    const payload = { kind: 'recommend', options: { candidates: [{ squad }], squadCount: 1 } };
    const row = { id: 0, squad, status: 'evaluated', policy: { recommendedEligible: true }, scenarios: [{ total: 10 }] };
    const valid = { engineVersion: 'test', candidates: [row], selected: [row],
      solutions: [{ candidateIds: [0], scenarioTotals: [10], baseTotal: 10, maxRegret: 0 }] };
    const relay = new BrowserRelay();
    relay.validateResult(payload, valid);
    for (const [key, value] of [['selected', [{ squad: ['other'] }]], ['solutions', ['bad']]] as const) {
      assert.throws(() => relay.validateResult(payload, { ...structuredClone(valid), [key]: value }), ToolError);
    }
    const wrong = structuredClone(valid);
    wrong.solutions[0]!.scenarioTotals = [20];
    assert.throws(() => relay.validateResult(payload, wrong), ToolError);
  });

  it('all observed squads join canonical resource ids', () => {
    const observed = evidence() as Record<string, any>;
    const raw = data('scraper/nikke_scraped.json');
    const teams = [...observed['campaign']['teams'], ...observed['soloraid']['seasons'].flatMap((s: any) => s['teams'])];
    assert.equal(teams.length, 34);
    for (const team of teams) {
      assert.equal(new Set(team['characters']).size, 5);
      assert.deepEqual(team['characters'].map((n: string) => Number(raw[n]['id'])), team['resourceIds']);
    }
    assert.equal(observed['live'], false);
  });

  it('scenarios cannot change the account or accept an invalid battle', () => {
    for (const battle of [{ synchroLevel: 999 }, { characters: {} }, { corePx: -1 }, { hasParts: 'yes' }]) {
      assert.throws(() => RecommendationScenario.validate({ label: 'test', battle }), ValidationError);
    }
  });

  it('recommendation heartbeat retains a long job but has a bound', () => {
    let clock = 0;
    const relay = new BrowserRelay(() => clock);
    const session = relay.connect() as Record<string, string>;
    const job = relay.submit(session['connectionCode'], { kind: 'recommend', options: {} });
    relay.poll(session['browserToken']);
    for (let moment = 30; moment <= 1260; moment += 30) {
      clock = moment;
      relay.poll(session['browserToken'], false);
      const state = relay.result(session['connectionCode'], job['jobId'] as string);
      assert.equal(state['status'], moment < 1260 ? 'running' : 'failed');
    }
  });
});

describe('recommendation protocol', () => {
  it('new read-only tools respond', async () => {
    const client = await connect({ browserMode: true });
    const result = await client.call('get_recommendation_evidence', { mode: 'campaign' });
    assert.equal(result.isError, false);
    assert.ok('mechanismAnalysis' in result.structured);
    const policy = await client.call('validate_squad_policy', { squad: ['리타', '크라운', '헬름', '앨리스', '모더니아'] });
    assert.equal(policy.isError, false);
    assert.equal(policy.structured['recommendedEligible'], true);
    const recommend = await client.call('recommend_browser_squads', { connection_code: '',
      candidates: [{ label: '검증', squad: ['리타', '크라운', '헬름', '앨리스', '모더니아'] }] });
    assert.equal(recommend.isError, true);
    assert.match(recommend.text, /CONNECTION_REQUIRED/);
    await client.close();
  });
});

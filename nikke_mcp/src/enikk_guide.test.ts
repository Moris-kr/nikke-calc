// py: nikke_mcp/test_enikk_guide.py
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { connect } from './testing.ts';

describe('recommendation guide', () => {
  it('is available without browser or network', async () => {
    const client = await connect({ browserMode: true });
    assert.ok((await client.listTools()).some((t) => t.name === 'get_recommendation_guide'));
    const response = await client.call('get_recommendation_guide', { mode: 'soloraid' });
    assert.equal(response.isError, false);
    const guide = response.structured;
    assert.equal(guide['dataAccess'], 'guidance_only');
    assert.deepEqual(Object.keys(guide['modes']), ['soloraid']);
    assert.equal(guide['weaknessToEnemyCode']['Water'], '작열');
    assert.match(JSON.stringify(guide['workflow']), /compare_setups/);
    const catalog = await client.call('list_characters', { query: '리타' });
    assert.ok((catalog.structured['characters'] as Array<{ resourceId: unknown }>).every((row) => Number.isInteger(row.resourceId)));
    await client.close();
  });

  it('overview covers modes and rejects unknown mode', async () => {
    const client = await connect();
    const response = await client.call('get_recommendation_guide', {});
    assert.deepEqual(new Set(Object.keys(response.structured['modes'])), new Set(['meta', 'campaign', 'soloraid', 'unionraid', 'arena']));
    assert.equal((await client.call('get_recommendation_guide', { mode: 'unknown' })).isError, true);
    await client.close();
  });

  it('arena routing is separate from PvE in both transports', async () => {
    for (const browserMode of [false, true]) {
      const client = await connect({ browserMode });
      for (const mode of ['arena', 'pvp']) {
        const response = await client.call('get_recommendation_guide', { mode });
        assert.equal(response.isError, false);
        const guide = response.structured;
        assert.equal(guide['dataAccess'], 'guidance_only');
        assert.deepEqual(Object.keys(guide['modes']), ['arena']);
        assert.ok(!('mandatorySquadPolicy' in guide));
        const arena = guide['modes']['arena'];
        assert.equal(arena['url'], 'https://nikkeari.cc/ko');
        assert.equal(arena['enginePolicy']['pveSimulationApplicable'], false);
        assert.equal(arena['enginePolicy']['requireTeamCooldownReduction'], false);
        assert.match(JSON.stringify(arena['navigation']), /Team Search/);
        assert.match(JSON.stringify(arena['navigation']), /제외/);
        assert.match(JSON.stringify(arena['answerChecklist']), /경기 수/);
        assert.match(JSON.stringify(arena['access']), /개인 기록/);
      }
      await client.close();
    }
  });
});

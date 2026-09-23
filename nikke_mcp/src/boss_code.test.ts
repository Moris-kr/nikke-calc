// py: nikke_mcp/test_boss_code.py
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BossCodeRequest, create_boss_code } from './boss_code.ts';
import { ROOT } from './engine.ts';
import { ValidationError } from './pydantic.ts';
import { parseJson } from './pyjson.ts';
import { connect, unpack } from './testing.ts';

describe('boss code', () => {
  it('frontend compatibility fixture stays current', () => {
    const fixture = JSON.parse(readFileSync(join(ROOT, 'site/src/fixtures/mcp-boss-code.json'), 'utf8'));
    assert.equal(create_boss_code(BossCodeRequest.validate(fixture.request))['code'], fixture.code);
  });

  it('geometry and embedded battle', () => {
    const request = BossCodeRequest.validate({
      name: '시험 보스', settingsSource: 'battle',
      shapes: [{ kind: 'rect', x: -0.5, y: 310, w: 200, h: 100, windows: [{ from: 0, to: 15.5 }], range: ['SR', 'AR'] }],
      parts: [{ name: '왼팔', kind: 'circle', x: 100, y: 200, w: 40, h: 40, hp: 1234, score: 50 }],
      core: { x: 480, y: 310, d: 52 }, center: { x: 480, y: 320 },
      aimKeys: [{ t: 0, x: 480, y: 310 }, { t: 10.5, x: 100, y: 200 }],
      battle: { enemyDef: 100, enemyCode: '수냉', coreEnabled: true, burstReaction: 0.15, coreWindows: [{ from: 0, to: 10.5 }] },
    });
    const raw = unpack(create_boss_code(request)['code'] as string);
    assert.deepEqual(raw.s, [{ k: 1, x: 0, y: 310, w: 200, h: 100, v: [[0, 155]], g: ['AR', 'SR'] }]);
    assert.equal(raw.p[0].hp, 1234);
    assert.deepEqual(raw.a[1], [105, 100, 200]);
    assert.equal(raw.bs, 'battle');
    assert.deepEqual(unpack(raw.b), { ed: 100, ec: 2, ce: 1, rt: 15, cw: [[0, 105]] });
  });

  it('default is geometry only and deterministic', () => {
    const request = BossCodeRequest.create({ name: '빈 보스' });
    assert.deepEqual(unpack(create_boss_code(request)['code'] as string), { n: '빈 보스' });
    assert.deepEqual(create_boss_code(request), create_boss_code(request));
  });

  it('RL normal hit coefficient is shared', () => {
    const request = BossCodeRequest.validate({ name: 'RL 계수', battle: { normalHitCoeff: { RL: 0.75 } } });
    assert.deepEqual(unpack(unpack(create_boss_code(request)['code'] as string).b), { hc: { RL: 0.75 } });
  });

  it('explicit SG 1 is not lost to site defaults (and stays a Python float)', () => {
    const request = BossCodeRequest.validate({ name: 'SG 계수', battle: { normalHitCoeff: { SG: 1 } } });
    const inner = unpack(create_boss_code(request)['code'] as string).b as string;
    assert.deepEqual(unpack(inner), { hc: { SG: 1 } });
    assert.match(Buffer.from(inner.slice(4), 'base64url').toString(), /"SG":1\.0/);
  });

  it('rejects unsupported or lossy inputs', () => {
    const invalid: unknown[] = [
      { settingsSource: 'battle' }, { name: ' ' }, { image: 'url' },
      { battle: { synchroLevel: 400 } }, { battle: { duration: 5 } },
      { battle: { enemyDef: 1000000 } }, { core: { x: 0, y: 0, d: 3 } },
      { aimKeys: [{ t: 2, x: 0, y: 0 }, { t: 1, x: 0, y: 0 }] },
      { shapes: [{ kind: 'rect', x: 0, y: 0, w: 4, h: 4, windows: [{ from: 1, to: 1.01 }] }] },
      parseJson('{"shapes":[{"kind":"rect","x":1e400,"y":0,"w":4,"h":4}]}'),
    ];
    for (const value of invalid) {
      assert.throws(() => BossCodeRequest.validate({ name: '보스', ...(value as object) }), ValidationError, JSON.stringify(value));
    }
  });
});

describe('boss code protocol', () => {
  it('available without browser and invalid input fails', async () => {
    const client = await connect({ browserMode: true });
    const tool = (await client.listTools()).find((t) => t.name === 'create_boss_code')!;
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.idempotentHint, true);
    const result = await client.call('create_boss_code', { request: { name: '시험' } });
    assert.equal(result.isError, false);
    assert.deepEqual(unpack(result.structured['code']), { n: '시험' });
    const invalid = await client.call('create_boss_code', { request: { name: '시험', settingsSource: 'battle' } });
    assert.equal(invalid.isError, true);
    await client.close();
  });
});

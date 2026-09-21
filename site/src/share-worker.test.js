import { describe, expect, it } from 'vitest';

import worker from '../../worker-share/src/index.js';

/** 메모리 KV. put/get만 쓰므로 이걸로 충분하다. */
function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

const ORIGIN = 'https://moris-kr.github.io';
const ADMIN = 'let-me-in';
const envWith = (kv) => ({
  SHARE: kv, ALLOWED_ORIGINS: ORIGIN, VOTE_SALT: 'test', ADMIN_PASSWORD: ADMIN,
});

const call = (kv, path, { method = 'GET', body, ip } = {}) => worker.fetch(
  new Request(`https://share.example${path}`, {
    method,
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip ?? '1.1.1.1',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }),
  envWith(kv),
);

const upload = (kv, { ip, ...over } = {}) => call(kv, '/upload', {
  method: 'POST',
  ip,
  body: { kind: 'boss', name: '솔레 3페', by: '', auto: '90초 · 적 수냉', code: 'NK3-abc', ...over },
});

describe('설정 공유 서버', () => {
  it('허용하지 않은 오리진에는 아무것도 주지 않는다', async () => {
    const response = await worker.fetch(
      new Request('https://share.example/list?kind=boss', { headers: { Origin: 'https://evil.example' } }),
      envWith(fakeKv()),
    );
    expect(response.status).toBe(403);
  });

  it('올린 설정이 목록에 뜨고, 업로더를 비우면 빈 문자열로 남는다', async () => {
    const kv = fakeKv();
    const created = await (await upload(kv)).json();
    expect(created.existed).toBe(false);
    expect(created.item.by).toBe('');
    // 코드는 목록과 함께 온다 — 받는 쪽이 바로 적용할 수 있어야 한다.
    expect(created.item.code).toBe('NK3-abc');

    const list = await (await call(kv, '/list?kind=boss')).json();
    expect(list.items.map((item) => item.name)).toEqual(['솔레 3페']);
    expect(list.mine).toEqual({});
    // 누가 올렸는지(IP 해시)는 목록에 나가지 않는다.
    expect(list.items[0].owner).toBeUndefined();
  });

  it('이름이 없으면 거절하고, 종류가 다른 코드도 거절한다', async () => {
    const kv = fakeKv();
    expect((await upload(kv, { name: '   ' })).status).toBe(400);
    // 조합 코드(NK2-)를 보스 칸에 올릴 수는 없다.
    expect((await upload(kv, { code: 'NK2-abc' })).status).toBe(400);
  });

  it('같은 코드를 다시 올리면 새로 만들지 않고 있던 항목을 돌려준다', async () => {
    const kv = fakeKv();
    const first = await (await upload(kv)).json();
    const again = await (await upload(kv, { name: '다른 이름' })).json();
    expect(again.existed).toBe(true);
    expect(again.item.id).toBe(first.item.id);

    const list = await (await call(kv, '/list?kind=boss')).json();
    expect(list.items).toHaveLength(1);
  });

  it('한 IP는 한 표만 갖고, 다시 누르면 취소·반대쪽이면 갈아탄다', async () => {
    const kv = fakeKv();
    const { item } = await (await upload(kv)).json();
    const vote = (value, ip) => call(kv, '/vote', { method: 'POST', body: { kind: 'boss', id: item.id, value }, ip });

    expect(await (await vote(1, '1.1.1.1')).json()).toMatchObject({ up: 1, down: 0, mine: 1 });
    // 같은 IP가 또 눌러도 두 표가 되지 않는다.
    expect(await (await vote(1, '1.1.1.1')).json()).toMatchObject({ up: 0, down: 0, mine: 0 });
    // 반대쪽으로 갈아타면 위가 줄고 아래가 는다.
    await vote(1, '1.1.1.1');
    expect(await (await vote(-1, '1.1.1.1')).json()).toMatchObject({ up: 0, down: 1, mine: -1 });
    // 다른 IP는 따로 한 표를 갖는다.
    expect(await (await vote(1, '2.2.2.2')).json()).toMatchObject({ up: 1, down: 1 });

    // 내가 누른 표는 목록에 함께 온다 — 새로 열어도 눌린 채로 보인다.
    const list = await (await call(kv, '/list?kind=boss', { ip: '2.2.2.2' })).json();
    expect(list.mine[item.id]).toBe(1);
  });

  it('적용 횟수는 IP당 한 번만 오르고, 목록이 이미 쓴 항목을 알려 준다', async () => {
    const kv = fakeKv();
    const { item } = await (await upload(kv)).json();
    const apply = (ip) => call(kv, '/apply', { method: 'POST', body: { kind: 'boss', id: item.id }, ip });

    expect(await (await apply('1.1.1.1')).json()).toMatchObject({ uses: 1, counted: true });
    // 같은 IP가 또 적용해도 오르지 않는다.
    expect(await (await apply('1.1.1.1')).json()).toMatchObject({ uses: 1, counted: false });
    // 다른 IP는 따로 센다.
    expect(await (await apply('2.2.2.2')).json()).toMatchObject({ uses: 2, counted: true });

    const list = await (await call(kv, '/list?kind=boss', { ip: '1.1.1.1' })).json();
    expect(list.items[0].uses).toBe(2);
    expect(list.applied[item.id]).toBe(1);
    // 적용한 적 없는 사람에게는 표시가 없다.
    const other = await (await call(kv, '/list?kind=boss', { ip: '3.3.3.3' })).json();
    expect(other.applied).toEqual({});
  });

  it('사라진 항목을 적용했다고 알리면 404로 답한다', async () => {
    const kv = fakeKv();
    const response = await call(kv, '/apply', { method: 'POST', body: { kind: 'boss', id: 'nope' } });
    expect(response.status).toBe(404);
  });

  it('사라진 항목에 투표하면 404로 알린다', async () => {
    const kv = fakeKv();
    const response = await call(kv, '/vote', { method: 'POST', body: { kind: 'boss', id: 'nope', value: 1 } });
    expect(response.status).toBe(404);
  });

  it('IP당 하루 업로드 수를 넘기면 막는다', async () => {
    const kv = fakeKv();
    for (let i = 0; i < 20; i += 1) {
      expect((await upload(kv, { code: `NK3-code${i}` })).status).toBe(200);
    }
    const blocked = await upload(kv, { code: 'NK3-onemore' });
    expect(blocked.status).toBe(429);
    // 다른 IP는 그대로 올릴 수 있다.
    expect((await upload(kv, { code: 'NK3-other', ip: '9.9.9.9' })).status).toBe(200);
  });

  it('KV가 연결되지 않았으면 500으로 분명히 알린다', async () => {
    const response = await worker.fetch(
      new Request('https://share.example/list?kind=boss', { headers: { Origin: ORIGIN } }),
      { ALLOWED_ORIGINS: ORIGIN },
    );
    expect(response.status).toBe(500);
  });
});

describe('피드백 코멘트', () => {
  const post = (kv, text) => call(kv, '/feedback', {
    method: 'POST', body: { kind: 'bug', text, by: '' },
  });
  const reply = (kv, id, body, password = ADMIN) => call(kv, '/feedback/reply', {
    method: 'POST', body: { id, reply: body, password },
  });

  it('운영자가 단 코멘트가 목록에 함께 나온다', async () => {
    const kv = fakeKv();
    const { item } = await (await post(kv, '풍라플 코어가 안 먹혀요')).json();
    // 달기 전에는 비어 있다 — 옛 글도 이 자리가 빈 문자열로 온다.
    expect(item.reply).toBe('');

    const saved = await (await reply(kv, item.id, '고쳤습니다.\n모드 탄착군이 원인이었습니다.')).json();
    expect(saved.item.reply).toBe('고쳤습니다.\n모드 탄착군이 원인이었습니다.');
    expect(saved.item.replyAt).not.toBe('');

    const list = await (await call(kv, '/feedback')).json();
    expect(list.items[0].reply).toContain('고쳤습니다.');
  });

  it('빈 글을 주면 코멘트를 뗀다 — 시각도 함께 지운다', async () => {
    const kv = fakeKv();
    const { item } = await (await post(kv, '건의합니다')).json();
    await reply(kv, item.id, '검토하겠습니다.');
    const cleared = await (await reply(kv, item.id, '   ')).json();
    expect(cleared.item.reply).toBe('');
    expect(cleared.item.replyAt).toBe('');
  });

  it('비밀번호가 틀리면 달지 못한다', async () => {
    const kv = fakeKv();
    const { item } = await (await post(kv, '버그요')).json();
    const denied = await reply(kv, item.id, '아무나 답하면 안 된다', 'nope');
    expect(denied.status).toBe(403);
    const list = await (await call(kv, '/feedback')).json();
    expect(list.items[0].reply).toBe('');
  });

  it('사라진 항목에는 404로 답한다', async () => {
    const kv = fakeKv();
    expect((await reply(kv, 'gone', '있나요')).status).toBe(404);
  });
});

describe('계산기 레이드', () => {
  const open = (kv, title = '9월 4주차 · 전격 보스') => call(kv, '/raid/open', {
    method: 'POST', body: { title, code: 'NK3-abc', auto: '180초 · 전격 · 코어 52px', password: ADMIN },
  });
  const deck = (names, dmg) => ({ names, code: 'NK2-x', order: '1버 리타 → 2버 크라운 → 3버 이브', dmg });
  const entry = (kv, id, over = {}) => call(kv, '/raid/entry', {
    method: 'POST', ip: over.ip,
    body: {
      id, openid: '123456789', name: 'MORIS', area: 83,
      decks: [deck(['리타', '크라운', '이브'], 300_000_000), deck(['토브', '민트'], 200_000_000)],
      total: 500_000_000, engine: 'c5c4d9a4', spec: { decks: [{ squad: ['리타'] }] },
      ...over,
    },
  });

  it('어드민이 전투 조건 코드로 레이드를 열고, 목록에 뜬다', async () => {
    const kv = fakeKv();
    const opened = await (await open(kv)).json();
    expect(opened.raid.status).toBe('open');
    const list = await (await call(kv, '/raid')).json();
    expect(list.raids.map((r) => r.title)).toEqual(['9월 4주차 · 전격 보스']);
    // NK3가 아니면 레이드가 될 수 없다.
    const bad = await call(kv, '/raid/open', { method: 'POST', body: { title: 'x', code: 'NK2-abc', password: ADMIN } });
    expect(bad.status).toBe(400);
    // 비밀번호 없이는 못 연다.
    expect((await call(kv, '/raid/open', { method: 'POST', body: { title: 'x', code: 'NK3-abc' } })).status).toBe(403);
  });

  it('니케별 큐브가 덱에 실려 남에게도 보이고, 익명 꼬리표로 참가자를 구분한다', async () => {
    const kv = fakeKv();
    const { raid } = await (await open(kv)).json();
    await entry(kv, raid.id, {
      decks: [{ ...deck(['리타', '크라운'], 300_000_000), cubes: { 리타: { name: '렐릭 베어 큐브', level: 15 }, 크라운: { name: '없음', level: 0 }, 이브: { name: '엉뚱', level: 15 }, 토브: { name: 'x', level: 99 } } }],
      total: 300_000_000,
    });
    await entry(kv, raid.id, { openid: '555555555', total: 100_000_000 });
    const board = await (await call(kv, `/raid/board?id=${raid.id}`)).json();
    // 편성에 없는 이름·잘못된 레벨은 버린다.
    expect(board.entries[0].decks[0].cubes).toEqual({ 리타: { name: '렐릭 베어 큐브', level: 15 }, 크라운: { name: '없음', level: 0 } });
    expect(board.entries[1].decks[0].cubes).toBeUndefined();
    // 꼬리표는 네 글자 해시 — 두 계정이 다르고, 계정 번호는 어디에도 없다.
    const tags = board.entries.map((row) => row.tag);
    expect(tags.every((tag) => /^[0-9a-f]{4}$/.test(tag))).toBe(true);
    expect(tags[0]).not.toBe(tags[1]);
    expect(JSON.stringify(board)).not.toContain('123456789');
    expect(JSON.stringify(board)).not.toContain('555555555');
  });

  it('어드민이 다른 레이드의 기록을 옮긴다 — 동일인이 이미 있으면 건너뛰고, 스펙과 출처를 남긴다', async () => {
    const kv = fakeKv();
    const { raid: old } = await (await open(kv, '지난 시즌')).json();
    await entry(kv, old.id);
    await entry(kv, old.id, { openid: '555555555', name: 'B', total: 100_000_000 });
    const oldBoard = await (await call(kv, '/raid/board', { method: 'POST', body: { id: old.id, password: ADMIN } })).json();
    expect(oldBoard.entries.every((row) => /^[0-9a-f]+$/.test(row.owner))).toBe(true);
    const { raid: fresh } = await (await open(kv, '새 시즌')).json();
    // 새 시즌에 첫 계정(MORIS)이 이미 직접 올렸다.
    await entry(kv, fresh.id, { total: 700_000_000 });
    const items = oldBoard.entries.map((row) => ({
      owner: row.owner, name: row.name, area: row.area, tail: row.tail,
      decks: [deck(['리타'], 420_000_000)], total: 420_000_000, engine: 'new', spec: { requests: [{ squad: ['리타'] }] },
    }));
    // 비밀번호 없이는 안 된다.
    expect((await call(kv, '/raid/migrate', { method: 'POST', body: { to: fresh.id, from: old.id, entries: items } })).status).toBe(403);
    const moved = await (await call(kv, '/raid/migrate', { method: 'POST', body: { to: fresh.id, from: old.id, entries: items, password: ADMIN } })).json();
    expect(moved).toEqual({ moved: 1, skipped: 1 });
    const board = await (await call(kv, '/raid/board', { method: 'POST', body: { id: fresh.id, password: ADMIN } })).json();
    expect(board.entries).toHaveLength(2);
    // MORIS의 직접 올린 7억은 그대로(재계산본 4.2억으로 안 덮인다). B는 옮겨졌고 출처가 남는다.
    const moris = board.entries.find((row) => row.name === 'MORIS');
    expect(moris.total).toBe(700_000_000);
    expect(moris.from).toBeUndefined();
    const b = board.entries.find((row) => row.name === 'B');
    expect(b.total).toBe(420_000_000);
    expect(b.from).toBe(old.id);
    const spec = await (await call(kv, '/raid/spec', { method: 'POST', body: { id: fresh.id, eid: b.eid, password: ADMIN } })).json();
    expect(spec.spec.requests[0].squad).toEqual(['리타']);
    // 남에게도 «옮겨진 기록»은 보이되 계정 해시는 안 보인다.
    const anon = await (await call(kv, `/raid/board?id=${fresh.id}`)).json();
    expect(anon.entries.find((row) => row.from)).toBeTruthy();
    expect(anon.entries.every((row) => row.owner === undefined)).toBe(true);
  });

  it('닫은 레이드는 다시 열거나 통째로 지울 수 있다 — 진행 중인 것은 못 지운다', async () => {
    const kv = fakeKv();
    const { raid } = await (await open(kv)).json();
    await entry(kv, raid.id);
    // 진행 중에는 못 지운다.
    expect((await call(kv, '/raid/delete', { method: 'POST', body: { id: raid.id, password: ADMIN } })).status).toBe(400);
    await call(kv, '/raid/close', { method: 'POST', body: { id: raid.id, password: ADMIN } });
    expect((await entry(kv, raid.id, { openid: '555555555' })).status).toBe(409);
    // 다시 열면 제출이 다시 된다 — 기록은 그대로다.
    const reopened = await (await call(kv, '/raid/reopen', { method: 'POST', body: { id: raid.id, password: ADMIN } })).json();
    expect(reopened.raid.status).toBe('open');
    expect((await entry(kv, raid.id, { openid: '555555555' })).status).toBe(200);
    expect((await (await call(kv, `/raid/board?id=${raid.id}`)).json()).entries).toHaveLength(2);
    // 닫고 지우면 목록·랭킹·스펙이 전부 사라진다.
    await call(kv, '/raid/close', { method: 'POST', body: { id: raid.id, password: ADMIN } });
    const eid = (await (await call(kv, `/raid/board?id=${raid.id}`)).json()).entries[0].eid;
    expect((await call(kv, '/raid/delete', { method: 'POST', body: { id: raid.id } })).status).toBe(403);
    const deleted = await call(kv, '/raid/delete', { method: 'POST', body: { id: raid.id, password: ADMIN } });
    expect(deleted.status).toBe(200);
    expect((await (await call(kv, '/raid')).json()).raids).toEqual([]);
    expect((await call(kv, `/raid/board?id=${raid.id}`)).status).toBe(404);
    expect((await call(kv, '/raid/spec', { method: 'POST', body: { id: raid.id, eid, password: ADMIN } })).status).toBe(404);
  });

  it('설명이 길어도 튕기지 않는다 — 사이트가 만든 요약이라 넘치면 자른다', async () => {
    const kv = fakeKv();
    const long = '180초 · 전격 · '.repeat(60);
    const response = await call(kv, '/raid/open', {
      method: 'POST', body: { title: '긴 요약', code: 'NK3-abc', auto: long, password: ADMIN },
    });
    expect(response.status).toBe(200);
    const { raid } = await response.json();
    expect(raid.auto.length).toBeLessThanOrEqual(400);
    expect(raid.auto.startsWith('180초 · 전격')).toBe(true);
    // 어드민이 고친 설명은 그대로 남는다.
    const edited = await (await call(kv, '/raid/open', {
      method: 'POST', body: { title: '고친 설명', code: 'NK3-abc', auto: '전격 보스 · 코어 있음', password: ADMIN },
    })).json();
    expect(edited.raid.auto).toBe('전격 보스 · 코어 있음');
  });

  it('기록을 올리면 남에게는 순위·덱·딜만 보이고, 어드민에게는 누구인지가 보인다', async () => {
    const kv = fakeKv();
    const { raid } = await (await open(kv)).json();
    const posted = await (await entry(kv, raid.id)).json();
    expect(posted.kept).toBe(false);
    expect(posted.entry.name).toBeUndefined();

    const board = await (await call(kv, `/raid/board?id=${raid.id}`)).json();
    expect(board.entries).toHaveLength(1);
    const row = board.entries[0];
    expect(row.total).toBe(500_000_000);
    expect(row.decks[0].names).toEqual(['리타', '크라운', '이브']);
    // 누구인지 알 수 있는 값은 하나도 없다.
    expect(row.name).toBeUndefined();
    expect(row.area).toBeUndefined();
    expect(row.tail).toBeUndefined();
    expect(row.owner).toBeUndefined();
    expect(JSON.stringify(board)).not.toContain('123456789');

    const admin = await (await call(kv, '/raid/board', { method: 'POST', body: { id: raid.id, password: ADMIN } })).json();
    expect(admin.entries[0]).toMatchObject({ name: 'MORIS', area: 83, tail: '6789' });
    expect(JSON.stringify(admin)).not.toContain('123456789');
  });

  it('한 계정에는 최고 기록 하나만 남는다', async () => {
    const kv = fakeKv();
    const { raid } = await (await open(kv)).json();
    await entry(kv, raid.id, { total: 500_000_000 });
    const lower = await (await entry(kv, raid.id, { total: 400_000_000 })).json();
    expect(lower.kept).toBe(true);
    const higher = await (await entry(kv, raid.id, { total: 600_000_000 })).json();
    expect(higher.replaced).toBe(true);
    const board = await (await call(kv, `/raid/board?id=${raid.id}`)).json();
    expect(board.entries).toHaveLength(1);
    expect(board.entries[0].total).toBe(600_000_000);
    // 계정이 다르면 따로 선다.
    await entry(kv, raid.id, { openid: '987654321', total: 550_000_000, ip: '2.2.2.2' });
    const two = await (await call(kv, `/raid/board?id=${raid.id}`)).json();
    expect(two.entries.map((r) => r.total)).toEqual([600_000_000, 550_000_000]);
  });

  it('같은 니케가 두 덱에 서면 막는다', async () => {
    const kv = fakeKv();
    const { raid } = await (await open(kv)).json();
    const dup = await entry(kv, raid.id, { decks: [deck(['리타', '크라운'], 1), deck(['리타'], 1)] });
    expect(dup.status).toBe(400);
    expect((await dup.json()).error).toContain('리타');
  });

  it('닫힌 레이드는 기록을 더 받지 않고, 랭킹은 남는다', async () => {
    const kv = fakeKv();
    const { raid } = await (await open(kv)).json();
    await entry(kv, raid.id);
    const closed = await (await call(kv, '/raid/close', { method: 'POST', body: { id: raid.id, password: ADMIN } })).json();
    expect(closed.raid.status).toBe('closed');
    expect((await entry(kv, raid.id, { total: 900_000_000 })).status).toBe(409);
    const board = await (await call(kv, `/raid/board?id=${raid.id}`)).json();
    expect(board.entries).toHaveLength(1);
  });

  it('어드민은 기록을 지우고 스펙을 다시 읽을 수 있다', async () => {
    const kv = fakeKv();
    const { raid } = await (await open(kv)).json();
    const { entry: mine } = await (await entry(kv, raid.id)).json();
    const spec = await (await call(kv, '/raid/spec', { method: 'POST', body: { id: raid.id, eid: mine.eid, password: ADMIN } })).json();
    expect(spec.spec).toEqual({ decks: [{ squad: ['리타'] }] });
    // 스펙은 비밀번호 없이는 못 본다 — 남의 육성은 남에게 안 나간다.
    expect((await call(kv, '/raid/spec', { method: 'POST', body: { id: raid.id, eid: mine.eid } })).status).toBe(403);
    await call(kv, '/raid/remove', { method: 'POST', body: { id: raid.id, eid: mine.eid, password: ADMIN } });
    const board = await (await call(kv, `/raid/board?id=${raid.id}`)).json();
    expect(board.entries).toEqual([]);
    expect((await call(kv, '/raid/spec', { method: 'POST', body: { id: raid.id, eid: mine.eid, password: ADMIN } })).status).toBe(404);
  });

  it('레이드는 여럿이 동시에 열리고 기록은 레이드마다 따로다', async () => {
    const kv = fakeKv();
    const a = (await (await open(kv, 'A')).json()).raid;
    const b = (await (await open(kv, 'B')).json()).raid;
    await entry(kv, a.id);
    const list = await (await call(kv, '/raid')).json();
    expect(list.raids.map((r) => [r.title, r.count])).toEqual([['B', 0], ['A', 1]]);
    expect((await (await call(kv, `/raid/board?id=${b.id}`)).json()).entries).toEqual([]);
  });
});

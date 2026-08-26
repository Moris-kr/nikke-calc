import { describe, expect, it } from 'vitest';

import worker from '../../worker-share/src/index.js';

/** 메모리 KV. put/get만 쓰므로 이걸로 충분하다. */
function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
  };
}

const ORIGIN = 'https://moris-kr.github.io';
const envWith = (kv) => ({ SHARE: kv, ALLOWED_ORIGINS: ORIGIN, VOTE_SALT: 'test' });

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

// 설정 공유 서버. 전투 조건(보스)과 조합을 이름 붙여 올리고, 목록으로 받고, 엄지로 평가한다.
//
// 여기서 게임 데이터를 해석하지 않는다 — 저장되는 것은 **사이트가 만든 공유 코드 문자열**과
// 사람이 붙인 이름뿐이다. 코드의 뜻(몇 초짜리 전투인지, 누가 편성됐는지)은 브라우저만 안다.
// 그래야 게임이 바뀌어도 이 Worker를 다시 배포할 일이 없다. `worker/`(블라블라링크 프록시)와
// 나눠 둔 것도 같은 이유다 — 저쪽은 로그인 세션 비밀이 필요하고 이쪽은 필요 없다.

/** 종류별로 받아 줄 코드 접두사. 사이트의 `share-code.ts`와 같은 값이다. */
const KINDS = { boss: 'NK3-', squad: 'NK2-' };

const LIMITS = {
  name: 40,          // 이름 — 목록에서 한 줄로 읽히는 길이
  by: 16,            // 업로더
  auto: 160,         // 자동 설명(사이트가 만든다)
  code: 2000,        // 5덱 조합 코드도 이 안에 들어온다
  items: 400,        // 종류당 보관 수 — 넘으면 새 업로드를 막는다
  uploadsPerDay: 20, // IP당
};

class Fail extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const corsHeaders = (origin, env) => {
  const allowed = String(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim());
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};

/**
 * 투표자 식별자. 원문 IP는 저장하지 않는다 — 소금과 함께 해시해 앞 16자만 쓴다.
 * 같은 공유기를 쓰면 한 사람으로 묶이고 IP가 바뀌면 남남이 된다. 그 한계를 안고 쓰는
 * 값이라, 정확한 신원이 아니라 «같은 사람이 두 번 누르는 것»만 막는 용도다.
 */
async function voterId(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
  const salt = String(env.VOTE_SALT ?? 'nikke-calc');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const catalogKey = (kind) => `catalog:${kind}`;
const votesKey = (kind, voter) => `votes:${kind}:${voter}`;
// 적용 횟수도 한 사람이 여러 번 올릴 수 없다 — 누가 이미 적용했는지 따로 적어 둔다.
const usesKey = (kind, voter) => `uses:${kind}:${voter}`;
const rateKey = (voter) => `rate:${voter}`;

const readJson = async (env, key, fallback) => {
  const raw = await env.SHARE.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

/** 목록에 나가는 모양. 코드까지 함께 준다 — 적용은 브라우저가 코드로 한다. */
const publicItem = (item) => ({
  id: item.id,
  name: item.name,
  auto: item.auto,
  by: item.by,
  at: item.at,
  up: item.up,
  down: item.down,
  // 몇 명이 실제로 가져다 썼나. 엄지와 달리 취소가 없다.
  uses: item.uses ?? 0,
  code: item.code,
});

const text = (value, limit, field, required) => {
  const trimmed = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (required && trimmed === '') throw new Fail(400, `${field}을(를) 입력해 주세요.`);
  if (trimmed.length > limit) throw new Fail(400, `${field}이(가) 너무 깁니다(${limit}자까지).`);
  return trimmed;
};

const kindOf = (value) => {
  const kind = String(value ?? '');
  if (!(kind in KINDS)) throw new Fail(400, '알 수 없는 공유 종류입니다.');
  return kind;
};

async function handleList(request, env, url) {
  const kind = kindOf(url.searchParams.get('kind'));
  const voter = await voterId(request, env);
  const [catalog, mine, applied] = await Promise.all([
    readJson(env, catalogKey(kind), { items: [] }),
    readJson(env, votesKey(kind, voter), {}),
    readJson(env, usesKey(kind, voter), {}),
  ]);
  return { items: catalog.items.map(publicItem), mine, applied };
}

async function handleUpload(request, env, body) {
  const kind = kindOf(body.kind);
  const name = text(body.name, LIMITS.name, '이름', true);
  const by = text(body.by, LIMITS.by, '업로더', false);
  const auto = text(body.auto, LIMITS.auto, '설명', false);
  const code = text(body.code, LIMITS.code, '코드', true);
  if (!code.startsWith(KINDS[kind])) {
    throw new Fail(400, '이 종류의 코드가 아닙니다.');
  }

  const voter = await voterId(request, env);
  const today = new Date().toISOString().slice(0, 10);
  const rate = await readJson(env, rateKey(voter), { day: today, count: 0 });
  const count = rate.day === today ? rate.count : 0;
  if (count >= LIMITS.uploadsPerDay) {
    throw new Fail(429, '오늘 올릴 수 있는 개수를 넘었습니다. 내일 다시 시도해 주세요.');
  }

  const catalog = await readJson(env, catalogKey(kind), { items: [] });
  // 같은 코드가 이미 있으면 새로 만들지 않는다 — 레이팅이 둘로 쪼개지면
  // 어느 쪽이 «좋은 설정»인지 아무도 알 수 없게 된다.
  const existing = catalog.items.find((item) => item.code === code);
  if (existing) return { item: publicItem(existing), existed: true };
  if (catalog.items.length >= LIMITS.items) {
    throw new Fail(507, '보관함이 가득 찼습니다.');
  }

  const item = {
    id: crypto.randomUUID().slice(0, 8),
    name,
    auto,
    by,
    code,
    at: new Date().toISOString(),
    up: 0,
    down: 0,
    uses: 0,
    owner: voter,
  };
  catalog.items.push(item);
  await env.SHARE.put(catalogKey(kind), JSON.stringify(catalog));
  await env.SHARE.put(rateKey(voter), JSON.stringify({ day: today, count: count + 1 }));
  return { item: publicItem(item), existed: false };
}

async function handleVote(request, env, body) {
  const kind = kindOf(body.kind);
  const id = text(body.id, 40, '항목', true);
  const want = Number(body.value);
  if (![1, -1, 0].includes(want)) throw new Fail(400, '잘못된 투표 값입니다.');

  const voter = await voterId(request, env);
  const [catalog, mine] = await Promise.all([
    readJson(env, catalogKey(kind), { items: [] }),
    readJson(env, votesKey(kind, voter), {}),
  ]);
  const item = catalog.items.find((entry) => entry.id === id);
  if (!item) throw new Fail(404, '이미 사라진 항목입니다.');

  // 한 항목에 한 표. 같은 것을 다시 누르면 취소, 반대쪽을 누르면 갈아탄다.
  const before = mine[id] ?? 0;
  const after = before === want ? 0 : want;
  if (before === 1) item.up = Math.max(0, item.up - 1);
  if (before === -1) item.down = Math.max(0, item.down - 1);
  if (after === 1) item.up += 1;
  if (after === -1) item.down += 1;

  if (after === 0) delete mine[id];
  else mine[id] = after;

  await env.SHARE.put(catalogKey(kind), JSON.stringify(catalog));
  await env.SHARE.put(votesKey(kind, voter), JSON.stringify(mine));
  return { id, up: item.up, down: item.down, mine: after };
}

/**
 * 적용 횟수. 한 사람이 같은 항목을 몇 번 적용하든 1로 센다 — 무엇이 실제로 쓰이는지
 * 보려는 숫자라, 같은 사람이 여러 번 눌러 부풀릴 수 있으면 뜻이 없어진다.
 * 엄지와 달리 취소는 없다: 이미 가져다 쓴 일이 되돌려지지는 않는다.
 */
async function handleApply(request, env, body) {
  const kind = kindOf(body.kind);
  const id = text(body.id, 40, '항목', true);

  const voter = await voterId(request, env);
  const [catalog, applied] = await Promise.all([
    readJson(env, catalogKey(kind), { items: [] }),
    readJson(env, usesKey(kind, voter), {}),
  ]);
  const item = catalog.items.find((entry) => entry.id === id);
  if (!item) throw new Fail(404, '이미 사라진 항목입니다.');

  if (applied[id]) return { id, uses: item.uses ?? 0, counted: false };
  item.uses = (item.uses ?? 0) + 1;
  applied[id] = 1;
  await env.SHARE.put(catalogKey(kind), JSON.stringify(catalog));
  await env.SHARE.put(usesKey(kind, voter), JSON.stringify(applied));
  return { id, uses: item.uses, counted: true };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
    }
    if (!cors) return new Response('forbidden origin', { status: 403 });

    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });

    if (!env.SHARE) return json({ error: 'KV 네임스페이스가 연결되지 않았습니다.' }, 500);

    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/list') {
        return json(await handleList(request, env, url));
      }
      if (request.method === 'POST' && url.pathname === '/upload') {
        return json(await handleUpload(request, env, await request.json()));
      }
      if (request.method === 'POST' && url.pathname === '/vote') {
        return json(await handleVote(request, env, await request.json()));
      }
      if (request.method === 'POST' && url.pathname === '/apply') {
        return json(await handleApply(request, env, await request.json()));
      }
      return json({ error: '없는 경로입니다.' }, 404);
    } catch (error) {
      if (error instanceof Fail) return json({ error: error.message }, error.status);
      return json({ error: '서버에서 처리하지 못했습니다.' }, 500);
    }
  },
};

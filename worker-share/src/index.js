// 설정 공유 서버. 전투 조건(보스)과 조합을 이름 붙여 올리고, 목록으로 받고, 엄지로 평가한다.
//
// 여기서 게임 데이터를 해석하지 않는다 — 저장되는 것은 **사이트가 만든 공유 코드 문자열**과
// 사람이 붙인 이름뿐이다. 코드의 뜻(몇 초짜리 전투인지, 누가 편성됐는지)은 브라우저만 안다.
// 그래야 게임이 바뀌어도 이 Worker를 다시 배포할 일이 없다. `worker/`(블라블라링크 프록시)와
// 나눠 둔 것도 같은 이유다 — 저쪽은 로그인 세션 비밀이 필요하고 이쪽은 필요 없다.

/** 종류별로 받아 줄 코드 접두사. 사이트의 `share-code.ts`와 같은 값이다. */
const KINDS = { boss: 'NK3-', squad: 'NK2-', union: 'NK4-', maker: 'NK5-' };

const LIMITS = {
  name: 40,          // 이름 — 목록에서 한 줄로 읽히는 길이
  by: 16,            // 업로더
  auto: 160,         // 자동 설명(사이트가 만든다)
  code: 2000,        // 5덱 조합 코드도 이 안에 들어온다
  items: 400,        // 종류당 보관 수 — 넘으면 새 업로드를 막는다
  uploadsPerDay: 20, // IP당
  abbrevKey: 12,     // 약어 한 덩어리 — 「리센홍모라」가 다섯 자다
  abbrevName: 40,    // 니케 정식 명칭
  abbrevNames: 5,    // 한 약어가 뜻하는 니케 수(한 편성)
  abbrevKeys: 4000,  // 사전에 담는 약어 수
  abbrevPerDay: 60,  // IP당 등록 횟수
  feedbackText: 1000, // 피드백 본문
  feedbackItems: 1000,
  feedbackPerDay: 10,
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

/**
 * 줄바꿈을 지키는 자리 — 피드백 본문뿐이다.
 *
 * 이름·닉네임은 한 줄이어야 하므로 `text`가 공백을 통째로 접는다. 그런데 본문까지 그
 * 규칙을 받아 「내가 쓴 것도 읽기 힘들다」는 말이 올라왔다. 줄 **안**의 공백만 접고
 * 줄바꿈은 남긴다(빈 줄은 하나까지 — 스무 줄 띄우기로 게시판을 밀지 못하게).
 */
const multiline = (value, limit, field, required) => {
  const trimmed = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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


// ── 약어 사전 ────────────────────────────────────────────────────────────
// 「리센홍모라」처럼 앞글자를 이어 친 약어를 편성으로 풀 때 쓰는 뜻풀이다. 약어는
// 비문학이라(「클」이 루드밀라 : 윈터 오너다) 규칙으로 풀 수 없고, **쓰는 사람들이
// 모아 주는 수밖에 없다.** 그래서 사이트에서 「예외 등록」을 누르면 여기로 온다.
//
// 저장되는 것은 **친 글자와 니케 이름뿐**이다 — 누가 보냈는지, 무슨 편성을 짰는지는
// 남기지 않는다(하루 등록 수를 세는 데 쓰는 IP 해시만 다른 기능과 함께 쓴다).
// 같은 약어에 서로 다른 답이 오면 **표가 많은 쪽**을 사전으로 내보낸다.

const ABBREV_KEY = 'abbrev:v1';
const abbrevRateKey = (voter) => `arate:${voter}`;

/** 사전에 넣을 수 있는 모양인가. 글자는 한글·영숫자만 받는다. */
const abbrevEntry = (body) => {
  const key = String(body.key ?? '').replace(/\s+/g, '');
  if (!/^[0-9A-Za-z가-힣]{1,12}$/.test(key)) throw new Fail(400, '등록할 수 있는 약어가 아닙니다.');
  const names = (Array.isArray(body.names) ? body.names : [])
    .map((name) => text(name, LIMITS.abbrevName, '니케 이름', false))
    .filter(Boolean);
  if (names.length === 0) throw new Fail(400, '니케를 골라 주세요.');
  if (names.length > LIMITS.abbrevNames) throw new Fail(400, '한 약어에 너무 많은 니케를 담았습니다.');
  return { key, names };
};

/** 표가 가장 많은 답을 약어마다 하나씩. 사이트는 이것을 그대로 사전으로 쓴다. */
async function handleAbbrevList(env) {
  const book = await readJson(env, ABBREV_KEY, { keys: {} });
  const rules = [];
  for (const [key, variants] of Object.entries(book.keys ?? {})) {
    let best = null;
    for (const [joined, count] of Object.entries(variants)) {
      // 표가 같으면 글자 순서로 갈라 매번 같은 답이 나오게 한다.
      if (!best || count > best.count || (count === best.count && joined < best.joined)) {
        best = { joined, count };
      }
    }
    if (best) rules.push({ key, names: best.joined.split('\u001f'), count: best.count });
  }
  return { rules };
}

async function handleAbbrevAdd(request, env, body) {
  const { key, names } = abbrevEntry(body);
  const voter = await voterId(request, env);
  const today = new Date().toISOString().slice(0, 10);
  const rate = await readJson(env, abbrevRateKey(voter), { day: today, count: 0 });
  const count = rate.day === today ? rate.count : 0;
  if (count >= LIMITS.abbrevPerDay) {
    throw new Fail(429, '오늘 등록할 수 있는 개수를 넘었습니다.');
  }

  const book = await readJson(env, ABBREV_KEY, { keys: {} });
  book.keys = book.keys ?? {};
  if (!book.keys[key] && Object.keys(book.keys).length >= LIMITS.abbrevKeys) {
    throw new Fail(507, '사전이 가득 찼습니다.');
  }
  const variants = book.keys[key] ?? {};
  const joined = names.join('\u001f');
  variants[joined] = (variants[joined] ?? 0) + 1;
  // 한 약어에 답이 스무 가지를 넘으면 표가 적은 것부터 버린다 — 오타와 장난이 쌓이는 자리다.
  const trimmed = Object.entries(variants).sort((a, b) => b[1] - a[1]).slice(0, 20);
  book.keys[key] = Object.fromEntries(trimmed);
  await env.SHARE.put(ABBREV_KEY, JSON.stringify(book));
  await env.SHARE.put(abbrevRateKey(voter), JSON.stringify({ day: today, count: count + 1 }));
  return { key, names, count: variants[joined] };
}

// ── 피드백 ───────────────────────────────────────────────────────────────
// 올린 글은 **모두에게 보인다**. 관리자만 상태를 옮길 수 있고, 그 확인은 비밀번호로
// 한다 — 비밀번호는 코드에 적지 않고 `wrangler secret put ADMIN_PASSWORD`로 넣는다.
// (소스가 공개 저장소에 있으므로 여기 적으면 아무나 관리자가 된다.)

const FEEDBACK_KEY = 'feedback:v1';
const feedbackRateKey = (voter) => `frate:${voter}`;
/** 접수 → 진행중 → 완료 / 불가능. 늘어놓는 차례이기도 하다. */
const FEEDBACK_STATUS = ['new', 'doing', 'done', 'wont'];
const FEEDBACK_KINDS = ['bug', 'idea', 'etc'];

/**
 * 관리자인가. 길이가 달라도 같은 시간이 걸리게 비교한다 — 다른 곳에서 새는 정보가
 * 없더라도, 비밀번호 비교에서 «몇 글자까지 맞았나»가 새면 그것만으로 뚫린다.
 */
const isAdmin = (env, value) => {
  const want = String(env.ADMIN_PASSWORD ?? '');
  const got = String(value ?? '');
  if (want === '' || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i += 1) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
};

const requireAdmin = (env, value) => {
  if (!isAdmin(env, value)) throw new Fail(403, '관리자 비밀번호가 맞지 않습니다.');
};

const publicFeedback = (item) => ({
  id: item.id,
  kind: item.kind,
  text: item.text,
  by: item.by,
  at: item.at,
  status: item.status,
  /** 관리자가 옮긴 시각. 목록에서 «언제 진행중이 됐나»를 읽는다. */
  movedAt: item.movedAt ?? '',
});

async function handleFeedbackList(env) {
  const board = await readJson(env, FEEDBACK_KEY, { items: [] });
  return { items: (board.items ?? []).map(publicFeedback) };
}

async function handleFeedbackAdd(request, env, body) {
  const kind = FEEDBACK_KINDS.includes(String(body.kind)) ? String(body.kind) : 'etc';
  const content = multiline(body.text, LIMITS.feedbackText, '내용', true);
  const by = text(body.by, LIMITS.by, '닉네임', false);

  const voter = await voterId(request, env);
  const today = new Date().toISOString().slice(0, 10);
  const rate = await readJson(env, feedbackRateKey(voter), { day: today, count: 0 });
  const count = rate.day === today ? rate.count : 0;
  if (count >= LIMITS.feedbackPerDay) {
    throw new Fail(429, '오늘 올릴 수 있는 개수를 넘었습니다. 내일 다시 시도해 주세요.');
  }

  const board = await readJson(env, FEEDBACK_KEY, { items: [] });
  board.items = board.items ?? [];
  if (board.items.length >= LIMITS.feedbackItems) throw new Fail(507, '피드백함이 가득 찼습니다.');
  // 같은 글을 두 번 올리는 것은 대개 «눌렸나?» 싶어 다시 누른 것이다.
  const twin = board.items.find((item) => item.text === content && item.owner === voter);
  if (twin) return { item: publicFeedback(twin), existed: true };

  const item = {
    id: crypto.randomUUID().slice(0, 8),
    kind,
    text: content,
    by,
    at: new Date().toISOString(),
    status: 'new',
    movedAt: '',
    owner: voter,
  };
  board.items.unshift(item);
  await env.SHARE.put(FEEDBACK_KEY, JSON.stringify(board));
  await env.SHARE.put(feedbackRateKey(voter), JSON.stringify({ day: today, count: count + 1 }));
  return { item: publicFeedback(item), existed: false };
}

async function handleFeedbackMove(env, body) {
  requireAdmin(env, body.password);
  const id = text(body.id, 40, '항목', true);
  const status = String(body.status ?? '');
  if (!FEEDBACK_STATUS.includes(status)) throw new Fail(400, '알 수 없는 상태입니다.');

  const board = await readJson(env, FEEDBACK_KEY, { items: [] });
  const item = (board.items ?? []).find((entry) => entry.id === id);
  if (!item) throw new Fail(404, '이미 사라진 항목입니다.');
  item.status = status;
  item.movedAt = new Date().toISOString();
  await env.SHARE.put(FEEDBACK_KEY, JSON.stringify(board));
  return { item: publicFeedback(item) };
}

async function handleFeedbackRemove(env, body) {
  requireAdmin(env, body.password);
  const id = text(body.id, 40, '항목', true);
  const board = await readJson(env, FEEDBACK_KEY, { items: [] });
  const before = (board.items ?? []).length;
  board.items = (board.items ?? []).filter((entry) => entry.id !== id);
  if (board.items.length === before) throw new Fail(404, '이미 사라진 항목입니다.');
  await env.SHARE.put(FEEDBACK_KEY, JSON.stringify(board));
  return { id };
}

/** 관리자 확인만. 사이트가 «관리자 화면을 열어도 되는지» 물을 때 쓴다. */
const handleAdminCheck = (env, body) => {
  requireAdmin(env, body.password);
  return { ok: true };
};


/**
 * 지금 보고 있는 사람 수.
 *
 * KV로 세지 않는다 — 인사 한 번이 쓰기 한 번이라 무료 한도(하루 1,000회)를 몇십 명이
 * 몇 분 머무는 것만으로 넘긴다. Durable Object는 **한 자리에 모여** 메모리에서 세므로
 * 저장 쓰기가 아예 없다.
 *
 * 방은 하나뿐이다(`global`) — 모두가 같은 수를 봐야 하니 한곳에 모아야 한다.
 * 오래 조용하면 객체가 잠들어 숫자가 0에서 다시 쌓인다. 사람들이 다음 인사를 보내는
 * 45초 안에 제자리로 돌아오므로, 정확도보다 «지금 대충 몇 명»을 보여 주는 쪽으로 둔다.
 */
export class Presence {
  constructor() {
    /** @type {Map<string, number>} 방문자 표식 → 마지막 인사 시각 */
    this.seen = new Map();
  }

  async fetch(request) {
    const now = Date.now();
    let id = '';
    try {
      ({ id } = await request.json());
    } catch { /* 본문이 없으면 조회만 한다 */ }
    if (typeof id === 'string' && id.length >= 8 && id.length <= 64) {
      this.seen.set(id, now);
    }
    // 창을 닫으면 인사가 끊긴다 — 그 뒤로 이 시간이 지나면 나간 것으로 친다.
    for (const [key, at] of this.seen) {
      if (now - at > PRESENCE_WINDOW_MS) this.seen.delete(key);
    }
    return new Response(JSON.stringify({ online: this.seen.size }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

/** 마지막 인사로부터 이만큼 지나면 나간 것으로 친다(인사 주기의 두 배 남짓). */
const PRESENCE_WINDOW_MS = 100_000;

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
      if (request.method === 'GET' && url.pathname === '/abbrev') {
        return json(await handleAbbrevList(env));
      }
      if (request.method === 'POST' && url.pathname === '/abbrev') {
        return json(await handleAbbrevAdd(request, env, await request.json()));
      }
      if (request.method === 'GET' && url.pathname === '/feedback') {
        return json(await handleFeedbackList(env));
      }
      if (request.method === 'POST' && url.pathname === '/feedback') {
        return json(await handleFeedbackAdd(request, env, await request.json()));
      }
      if (request.method === 'POST' && url.pathname === '/feedback/move') {
        return json(await handleFeedbackMove(env, await request.json()));
      }
      if (request.method === 'POST' && url.pathname === '/feedback/remove') {
        return json(await handleFeedbackRemove(env, await request.json()));
      }
      if (request.method === 'POST' && url.pathname === '/admin/check') {
        return json(handleAdminCheck(env, await request.json()));
      }
      if (request.method === 'POST' && url.pathname === '/presence') {
        if (!env.PRESENCE) return json({ online: 0 });
        const room = env.PRESENCE.get(env.PRESENCE.idFromName('global'));
        const answer = await room.fetch('https://presence/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(await request.json().catch(() => ({}))),
        });
        return json(await answer.json());
      }
      return json({ error: '없는 경로입니다.' }, 404);
    } catch (error) {
      if (error instanceof Fail) return json({ error: error.message }, error.status);
      return json({ error: '서버에서 처리하지 못했습니다.' }, 500);
    }
  },
};

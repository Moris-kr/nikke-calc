// 블라블라링크 조회 프록시. 사이트가 프로필 URL을 주면 원시 응답을 돌려준다.
//
// 여기서 게임 데이터를 해석하지 않는다 — 캐릭명 매칭도, 오버로드 환산도 브라우저 몫이다.
// Worker가 아는 것은 "어떤 엔드포인트를 어떤 헤더로 부르는가"뿐이고, 그래야 게임 업데이트가
// 와도 배포를 다시 할 일이 없다.

const API = 'https://api.blablalink.com/api/game/proxy/';
const COMMON = {
  game_id: '29080', area_id: 'global', source: 'pc_web',
  intl_game_id: '29080', language: 'ko', env: 'prod',
};

// `X-Channel-Type`과 `X-Language`가 없으면 게이트웨이가 **응답 자체를 하지 않는다**
// (에러도 아니고 무한 대기다, 실측 2026-08-23). 빠뜨리기 쉬우니 한 곳에 모아 둔다.
const upstreamHeaders = (cookie) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0 Safari/537.36',
  Origin: 'https://www.blablalink.com',
  Referer: 'https://www.blablalink.com/',
  'X-Channel-Type': '2',
  'X-Language': 'ko',
  'X-Common-Params': JSON.stringify(COMMON),
  Cookie: cookie,
});

// BlablaLink GetRegionList가 돌려주는 공식 서버. 수동 선택이면 하나만, 자동이면 전부
// 조회한다. 한 계정에 지역이 둘 이상 걸리기도 해서 자동은 하나를 찾았다고 멈추지 않는다.
const AREAS = [83, 81, 84, 82, 85];

const DETAIL_BATCH = 60;      // 상세는 60종씩 — 그 이상은 상류가 잘라 낸다

class SyncError extends Error {
  constructor(reason, message, status) {
    super(message);
    this.reason = reason;
    this.status = status;
  }
}

/** 프로필 URL(또는 붙여넣은 openid) → 숫자 openid. */
export function openidFrom(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;

  // URL이면 openid·uid 파라미터를, 아니면 입력 전체를 후보로 본다.
  const candidates = [];
  try {
    const url = new URL(text);
    if (!/(^|\.)blablalink\.com$/i.test(url.hostname)) return null;
    for (const key of ['openid', 'uid', 'intl_open_id', 'open_id']) {
      const value = url.searchParams.get(key);
      if (value) candidates.push(value);
    }
  } catch {
    candidates.push(text);
  }

  for (const raw of candidates) {
    // 주소창의 값은 base64로 감싸여 있다("MjkwODAt…" → "29080-1536…").
    let decoded = raw;
    try {
      const unpadded = raw.replace(/-/g, '+').replace(/_/g, '/');
      const guess = atob(unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '='));
      if (/^[\x20-\x7e]+$/.test(guess)) decoded = guess;
    } catch { /* base64가 아니면 원문 그대로 */ }
    // "29080-15361668407129878426" → 뒤 숫자만이 intl_open_id다.
    const match = decoded.match(/(\d{6,})\s*$/);
    if (match) return match[1];
  }
  return null;
}

async function post(route, body, cookie) {
  let response;
  try {
    response = await fetch(API + route, {
      method: 'POST',
      headers: upstreamHeaders(cookie),
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new SyncError('upstream', `블라블라링크에 연결하지 못했습니다 (${route}).`, 502);
  }
  if (!response.ok) {
    throw new SyncError('upstream', `블라블라링크가 ${response.status}를 돌려줬습니다 (${route}).`, 502);
  }
  const payload = await response.json();
  if (payload.code === 300001) {
    throw new SyncError('session', '프록시 세션이 만료됐습니다. 관리자가 쿠키를 갱신해야 합니다.', 503);
  }
  return payload;
}

/**
 * 니케 목록을 못 받는 이유는 둘이다 — **비공개**이거나, 상류가 잠깐 흔들린 것이다.
 * 둘을 뭉뚱그리면 부르는 쪽이 «이 사람은 비공개»라고 잘못 단정한다(유니온 레이드처럼
 * 여럿을 훑을 때 실제로 그런 오판이 났다). 그래서 코드를 그대로 실어 보낸다.
 */
const PRIVACY_CODES = new Set([
  1301002,   // user not allow show nikkeinfo in Shiftypad
  1303002,   // proxy.GetUserShiftyspadPrivacy error
]);

async function collectArea(openid, area, cookie) {
  const roster = await post('Game/GetUserCharacters',
    { intl_open_id: openid, nikke_area_id: area }, cookie);
  const characters = roster.code === 0 ? (roster.data?.characters ?? null) : null;
  if (!characters || characters.length === 0) {
    return { failedCode: roster.code ?? 0, failedMsg: roster.msg ?? '' };
  }

  const codes = characters.map((entry) => entry.name_code);
  const details = [];
  const stateEffects = [];
  for (let i = 0; i < codes.length; i += DETAIL_BATCH) {
    const chunk = await post('Game/GetUserCharacterDetails',
      { intl_open_id: openid, nikke_area_id: area, name_codes: codes.slice(i, i + DETAIL_BATCH) },
      cookie);
    if (chunk.code !== 0) {
      throw new SyncError('upstream',
        `육성 상세를 받지 못했습니다 (${chunk.code} ${chunk.msg ?? ''}).`, 502);
    }
    details.push(...(chunk.data?.character_details ?? []));
    stateEffects.push(...(chunk.data?.state_effects ?? []));
  }

  // 전초기지는 따로 공개해야 오는 값이라, 안 와도 실패로 치지 않는다 (콘솔만 기본값이 된다).
  let outpost = null;
  try {
    const info = await post('Game/GetUserProfileOutpostInfo',
      { intl_open_id: openid, nikke_area_id: area }, cookie);
    if (info.code === 0) outpost = info.data?.outpost_info ?? null;
  } catch (error) {
    if (error.reason === 'session') throw error;
  }

  return { area, characters, details, stateEffects, outpost };
}

/**
 * 세션 점검. 쿠키가 왜 거부되는지 알려면 값이 아니라 **모양**을 봐야 한다 —
 * 값은 절대 돌려주지 않고 길이와 키 유무만 센다.
 */
async function health(cookie) {
  const pairs = cookie.split(';').map((part) => part.trim()).filter(Boolean);
  const names = pairs.map((part) => part.split('=')[0]);
  // 값은 절대 내보내지 않는다. 길이만 보면 잘려 들어왔는지는 알 수 있다.
  const valueLengths = Object.fromEntries(pairs.map((part) => {
    const eq = part.indexOf('=');
    return [part.slice(0, eq), part.length - eq - 1];
  }));
  const shape = {
    length: cookie.length,
    cookies: names.length,
    names,
    valueLengths,
    hasGameToken: names.includes('game_token'),
    hasGameOpenid: names.includes('game_openid'),
    // 붙여넣다 흔히 섞여 들어오는 것들
    looksLikeHeader: /^\s*cookie\s*:/i.test(cookie),
    hasNewline: cookie.split(String.fromCharCode(10)).length > 1 || cookie.split(String.fromCharCode(13)).length > 1,
  };

  // 세션이 살아 있는지 한 번만 확인한다. 쿠키 조합 실험은 셋업 때 끝났다 —
  // 무엇이 모자라도 결론은 "쿠키를 다시 넣어라"라서 갈래를 늘릴 이유가 없다.
  let upstream;
  try {
    const response = await fetch(
      API.replace('game/proxy/', 'ugc/proxy/standalonesite/') + 'User/GetUserInfoNew',
      { method: 'POST', headers: upstreamHeaders(cookie), body: '{}' },
    );
    const payload = await response.json();
    upstream = { code: payload.code, msg: payload.msg ?? '' };
    // 로그인이 살아 있으면 내 식별자가 온다. 뒤 4자리만 남겨 본인 확인만 되게 한다.
    const openid = payload.data?.info?.intl_openid;
    if (openid) upstream.openidTail = String(openid).slice(-4);
  } catch (error) {
    upstream = { error: String(error).slice(0, 100) };
  }
  return { shape, upstream };
}

async function sync(profileUrl, cookie, requestedArea) {
  const openid = openidFrom(profileUrl);
  if (!openid) {
    throw new SyncError('badurl',
      '블라블라링크 프로필 URL을 알아보지 못했습니다. blablalink.com/user 주소를 그대로 붙여넣어 주세요.',
      400);
  }

  const selectedArea = requestedArea === undefined || requestedArea === null || requestedArea === ''
    ? null : Number(requestedArea);
  if (selectedArea !== null && !AREAS.includes(selectedArea)) {
    throw new SyncError('badarea', '지원하지 않는 서버입니다.', 400);
  }

  const areas = [];
  const failures = [];
  for (const area of selectedArea === null ? AREAS : [selectedArea]) {
    const collected = await collectArea(openid, area, cookie);
    if (collected.failedCode === undefined) areas.push(collected);
    else failures.push(collected);
  }
  if (areas.length === 0) {
    // 비공개라고 단정할 수 있는 건 상류가 그렇게 말했을 때뿐이다. 나머지는 «다시 해 보라»가 맞다.
    const privacy = failures.some((fail) => PRIVACY_CODES.has(fail.failedCode));
    if (privacy) {
      throw new SyncError('private',
        '니케 목록을 받지 못했습니다. 블라블라링크에서 프로필과 니케 목록을 공개로 바꾼 뒤 다시 시도해 주세요.',
        404);
    }
    const first = failures[0] ?? {};
    throw new SyncError('upstream',
      `니케 목록을 받지 못했습니다 (${first.failedCode ?? '?'} ${first.failedMsg ?? ''}). 잠시 뒤 다시 시도해 주세요.`,
      502);
  }
  return { openid, areas };
}

const corsHeaders = (origin, env) => {
  const allowed = String(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim());
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
    }
    if (!cors) {
      return new Response('forbidden origin', { status: 403 });
    }
    const json = (body, status) => new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });

    const url = new URL(request.url);
    if (request.method !== 'POST' || !['/sync', '/health'].includes(url.pathname)) {
      return json({ error: 'POST /sync 만 받습니다.', reason: 'badurl' }, 404);
    }
    if (!env.BLABLA_COOKIE) {
      return json({ error: '프록시에 세션이 설정돼 있지 않습니다.', reason: 'session' }, 503);
    }
    if (url.pathname === '/health') {
      return json(await health(env.BLABLA_COOKIE), 200);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: '요청 본문이 JSON이 아닙니다.', reason: 'badurl' }, 400);
    }

    try {
      return json(await sync(body?.profileUrl, env.BLABLA_COOKIE, body?.area), 200);
    } catch (error) {
      if (error instanceof SyncError) {
        return json({ error: error.message, reason: error.reason }, error.status);
      }
      return json({ error: '알 수 없는 오류로 실패했습니다.', reason: 'upstream' }, 500);
    }
  },
};

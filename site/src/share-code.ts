import type { BattleSettings, DeckState, ElementWindow, PhaseWindow } from './types';

// 조합 공유 코드 — **누가 편성됐는지(캐릭터 이름)만** 한 줄 텍스트로 주고받는다.
// 오버로드·공격력·돌파·스킬·큐브·소장품·컨트롤 같은 개인 스펙과 전투 조건은
// 일부러 담지 않는다: 남의 계정 수치가 딸려 나가면 안 되고, 받는 쪽도 자기 스펙
// 그대로 조합만 얹어 보는 게 목적이기 때문이다.
//
// 형식(NK2): 이름을 그대로 실으면 한글 한 글자가 3바이트라 5덱이면 코드가 700자를
// 넘어 붙여넣는 곳에서 잘린다. 그래서 이름 대신 **24비트 해시**를 바이너리로 싣는다.
//   [0] 플래그(bit0 = 5덱 모드)
//   [1] 덱 수
//   덱마다: [채워진 슬롯 비트마스크] + 슬롯당 해시 3바이트
// 해시는 이름에서만 나오므로 캐릭터가 새로 추가돼도 옛 코드가 깨지지 않는다
// (목록 순서에 의존하는 인덱스 방식과 다른 점). 받는 쪽이 자기 캐릭터 목록을
// 같은 해시로 훑어 이름을 되찾는다.

const PREFIX = 'NK2-';
const LEGACY_PREFIX = 'NIKKE1-';
const SLOTS = 5;

export interface SharePayload {
  decks: Array<{ squad: string[] }>;
  fiveDeckMode: boolean;
}

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string): Uint8Array => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** 이름 → 24비트 FNV-1a 해시. 이름이 같으면 언제나 같은 값이 나온다. */
export function nameHash(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash & 0xffffff;
}

const trimEmptyDecks = (decks: Array<{ squad: string[] }>): Array<{ squad: string[] }> => {
  const out = decks.map((deck) => ({ squad: deck.squad.map((name) => (name ?? '').trim()) }));
  while (out.length > 1 && !out[out.length - 1]!.squad.some((name) => name !== '')) out.pop();
  return out;
};

/** 편성을 공유 코드 문자열로. 이름만 담고, 뒤쪽 빈 덱은 잘라 짧게 만든다. */
export function encodeShareCode(decks: DeckState[], fiveDeckMode: boolean): string {
  // 이름만 싣는다 — deck.characters(개인 스펙)는 의도적으로 제외한다.
  const trimmed = trimEmptyDecks(decks.map((deck) => ({ squad: deck.squad })));
  const bytes: number[] = [fiveDeckMode ? 1 : 0, trimmed.length];
  for (const deck of trimmed) {
    let mask = 0;
    const filled: string[] = [];
    for (let slot = 0; slot < SLOTS; slot += 1) {
      const name = deck.squad[slot] ?? '';
      if (name !== '') { mask |= 1 << slot; filled.push(name); }
    }
    bytes.push(mask);
    for (const name of filled) {
      const hash = nameHash(name);
      bytes.push((hash >> 16) & 0xff, (hash >> 8) & 0xff, hash & 0xff);
    }
  }
  return PREFIX + toBase64Url(Uint8Array.from(bytes));
}

/**
 * 공유 코드를 해석한다.
 *
 * `catalogNames`는 해시에서 이름을 되찾는 데 쓴다(NK2 형식). 목록에 없는 캐릭터는
 * 빈 슬롯으로 남고, 적용 단계에서 몇 명이 빠졌는지 알린다.
 * 옛 형식(NIKKE1-, 이름을 JSON으로 담던 코드)도 계속 읽되 이름만 취한다.
 */
export function decodeShareCode(code: string, catalogNames: string[] = []): SharePayload {
  const trimmed = code.trim();
  if (!trimmed) throw new Error('공유 코드를 입력해 주세요.');

  if (trimmed.startsWith(LEGACY_PREFIX)) return decodeLegacy(trimmed.slice(LEGACY_PREFIX.length));

  const body = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(body);
  } catch {
    throw new Error('공유 코드를 해석하지 못했습니다. 코드 전체를 그대로 붙여넣었는지 확인해 주세요.');
  }
  // 옛 형식을 접두사 없이 붙여넣는 경우가 있어, base64가 JSON이면 그쪽으로 넘긴다.
  if (bytes[0] === 0x7b) return decodeLegacy(body);
  if (bytes.length < 3) {
    throw new Error('공유 코드가 너무 짧습니다. 코드 전체를 그대로 붙여넣었는지 확인해 주세요.');
  }

  const byHash = new Map<number, string>();
  for (const name of catalogNames) {
    const hash = nameHash(name);
    if (!byHash.has(hash)) byHash.set(hash, name);
  }

  const fiveDeckMode = (bytes[0]! & 1) === 1;
  const deckCount = bytes[1]!;
  if (deckCount < 1 || deckCount > 5) throw new Error('공유 코드의 덱 수가 올바르지 않습니다.');

  const decks: Array<{ squad: string[] }> = [];
  let cursor = 2;
  for (let d = 0; d < deckCount; d += 1) {
    if (cursor >= bytes.length) throw new Error('공유 코드가 중간에 잘렸습니다. 전체를 다시 복사해 주세요.');
    const mask = bytes[cursor]!;
    cursor += 1;
    const squad: string[] = [];
    for (let slot = 0; slot < SLOTS; slot += 1) {
      if ((mask & (1 << slot)) === 0) { squad.push(''); continue; }
      if (cursor + 2 >= bytes.length) {
        throw new Error('공유 코드가 중간에 잘렸습니다. 전체를 다시 복사해 주세요.');
      }
      const hash = (bytes[cursor]! << 16) | (bytes[cursor + 1]! << 8) | bytes[cursor + 2]!;
      cursor += 3;
      squad.push(byHash.get(hash) ?? `\u0000${hash}`); // 모르는 캐릭터는 표시로만 남긴다
    }
    decks.push({ squad });
  }
  return { fiveDeckMode, decks };
}

/** 옛 형식(NIKKE1-): 이름만 취한다 — 남의 수치가 담겨 있어도 절대 적용하지 않는다. */
function decodeLegacy(body: string): SharePayload {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    throw new Error('공유 코드를 해석하지 못했습니다. 코드 전체를 그대로 붙여넣었는지 확인해 주세요.');
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('공유 코드 내용이 올바르지 않습니다.');
  }
  const decks = (payload as SharePayload).decks;
  if (!Array.isArray(decks) || decks.length === 0) {
    throw new Error('공유 코드에 편성 정보가 없습니다.');
  }
  return {
    fiveDeckMode: Boolean((payload as SharePayload).fiveDeckMode),
    decks: decks.slice(0, 5).map((deck) => ({
      squad: Array.isArray(deck?.squad)
        ? deck.squad.slice(0, SLOTS).map((name) => (typeof name === 'string' ? name : ''))
        : [],
    })),
  };
}

/**
 * 디코드한 편성을 현재 덱에 적용한다.
 *
 * 캐릭터 스펙은 **받는 사람 것을 쓴다** — CSV 로스터를 넣어 뒀으면 그 설정이
 * 그대로 얹히고, 없으면 계산기 기본값으로 돈다. 공유 코드에는 이름만 들어 있다.
 * 카탈로그에 없는 이름(미등록·상대방의 커스텀 니케)은 빼고 알린다.
 */
/**
 * 어디에 적용할지.
 *
 * `'all'`은 판 전체를 코드대로 갈아 끼운다 — 코드에 없는 덱은 비운다. 공유 링크나
 * 계산 기록처럼 «그때 그 판을 통째로 되살린다»는 뜻일 때 쓴다.
 *
 * 숫자를 주면 **그 덱 한 칸만** 바꾸고 나머지는 손대지 않는다(0부터). 덱 하나를
 * 주고받는 일이 실제로는 더 잦은데, 예전에는 그것도 판을 통째로 덮어 2~5덱이
 * 조용히 지워졌다.
 */
export type ApplyTarget = 'all' | number;

export function applyShareToDecks(
  payload: SharePayload,
  decks: DeckState[],
  isKnown: (name: string) => boolean,
  myOverrides?: (name: string) => DeckState['characters'][string] | undefined,
  target: ApplyTarget = 'all',
): { applied: number; skipped: string[] } {
  const skipped: string[] = [];
  let applied = 0;

  const fill = (deck: DeckState, shared: { squad: string[] } | undefined): void => {
    if (!shared) {
      deck.squad = ['', '', '', '', ''];
      deck.characters = {};
      return;
    }
    const squad = Array.from({ length: SLOTS }, (_, slot) => {
      const name = (shared.squad[slot] ?? '').trim();
      if (!name) return '';
      // 해시를 못 찾은 자리는 \u0000으로 표시해 뒀다 — 이름을 모르니 '알 수 없음'으로 센다.
      if (name.startsWith('\u0000')) { skipped.push('알 수 없는 니케'); return ''; }
      if (!isKnown(name)) { skipped.push(name); return ''; }
      return name;
    });
    deck.squad = squad;
    deck.characters = {};
    for (const name of squad) {
      if (!name) continue;
      const mine = myOverrides?.(name);
      if (mine) deck.characters[name] = mine;
    }
    if (squad.some((name) => name !== '')) applied += 1;
  };

  if (target === 'all') {
    decks.forEach((deck, index) => fill(deck, payload.decks[index]));
  } else {
    // 한 칸만 받을 때는 코드의 **첫 덱**을 그 자리에 넣는다. 5덱짜리 코드를 한 칸에
    // 떨어뜨려도 나머지 덱이 사라지지 않는다.
    const deck = decks[target];
    if (deck) fill(deck, payload.decks[0]);
  }
  return { applied, skipped: [...new Set(skipped)] };
}


// ── 전투 조건 공유 (NK3) ──────────────────────────────────────────────────
// 조합 코드(NK2)가 «누가 편성됐나»를 나른다면, 이쪽은 «어떤 상황에서 쟀나»를 나른다.
// 족자·속저 구간까지 손으로 옮겨 적기는 번거롭고 틀리기 쉬워서다.
//
// **콘솔은 일부러 뺀다** — 계정 육성 상태라 남의 값이 딸려 오면 자기 스펙으로 잰
// 결과가 아니게 된다. 조합 코드가 개인 스펙을 빼는 것과 같은 이유다.
//
// 코드를 짧게 유지하는 규칙 셋:
//   1. **기본값과 같은 항목은 아예 싣지 않는다** — 대개 한두 개만 바꾸므로 이게 가장 크다
//   2. 키는 두 글자로 줄인다
//   3. 속성·시각을 숫자로 눌러 담는다 (코드는 색인, 시각은 0.1초 단위 정수)
// 기본 설정이면 `NK3-fQ`(8자)까지 줄고, 조건을 몇 개 바꿔도 50~80자 안쪽이다.
// 항목이 늘어도 옛 코드가 그대로 읽힌다 — 없는 키는 기본값으로 채워지기 때문이다.
const BATTLE_PREFIX = 'NK3-';

/**
 * 전투 조건에서 공유하는 부분. **콘솔과 싱크로 레벨은 빠진다** — 둘 다 계정 육성
 * 상태라, 남의 값이 딸려 오면 자기 스펙으로 잰 결과가 아니게 된다.
 */
export type BattleShare = Omit<BattleSettings, 'console' | 'synchroLevel'>;

const CODES: BattleSettings['enemyCode'][] = ['', '풍압', '수냉', '작열', '전격', '철갑'];

/** 안 실으면 이 값으로 친다. 인코딩·디코딩이 같은 표를 본다. */
const BATTLE_DEFAULTS: BattleShare = {
  duration: 180,
  enemyDef: 31_784,
  enemyCode: '',
  coreEnabled: false,
  corePx: 52,
  hasParts: false,
  seed: 42,
  optimalRangeWeapons: [],
  normalHitCoeff: {},
  immuneWindows: [],
  elementWindows: [],
  rngMode: 'expected',
  immuneBlocksBurst: true,
  burstRegenTime: 2,
  burstReaction: 0.05,
};

const num = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

// 시각은 0.1초 단위 정수로 담는다 — 소수점을 그대로 실으면 자릿수가 길어지고
// 부동소수 찌꺼기(10.000000000000002)까지 따라온다.
const toTenth = (v: number): number => Math.round(v * 10);
const fromTenth = (v: number): number => Math.round(v) / 10;
const toHundredth = (v: number): number => Math.round(v * 100);
const fromHundredth = (v: number): number => Math.round(v) / 100;

/** 전투 조건을 코드 한 줄로. 콘솔은 담지 않고, 기본값과 같은 항목은 생략한다. */
export function encodeBattleCode(
  battle: BattleSettings,
  coeffDefaults: Record<string, number> = {},
): string {
  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown, fallback: unknown) => {
    if (JSON.stringify(value) !== JSON.stringify(fallback)) out[key] = value;
  };
  const d = BATTLE_DEFAULTS;
  put('d', Math.trunc(battle.duration), d.duration);
  put('ed', Math.trunc(battle.enemyDef), d.enemyDef);
  put('ec', Math.max(0, CODES.indexOf(battle.enemyCode)), 0);
  put('ce', battle.coreEnabled ? 1 : 0, 0);
  put('cp', Math.trunc(battle.corePx), d.corePx);
  put('hp', battle.hasParts ? 1 : 0, 0);
  put('s', Math.trunc(battle.seed), d.seed);
  put('or', [...(battle.optimalRangeWeapons ?? [])].sort(), []);
  put('rm', battle.rngMode === 'random' ? 1 : 0, 0);
  put('ib', battle.immuneBlocksBurst ? 1 : 0, 1);
  put('br', toTenth(battle.burstRegenTime), toTenth(d.burstRegenTime));
  // 반응속도는 0.05초 단위라 10분의 1로는 담기지 않는다 — 100분의 1로 싣는다.
  put('rt', toHundredth(battle.burstReaction), toHundredth(d.burstReaction));

  // 평타 계수는 **기본값과 다른 무기군만** 싣는다. 여섯 개를 다 실으면 그것만으로
  // 코드가 60자 넘게 길어지는데, 손대는 사람은 거의 없다.
  const coeff: Record<string, number> = {};
  for (const [weapon, value] of Object.entries(battle.normalHitCoeff ?? {})) {
    const base = coeffDefaults[weapon] ?? 1;
    if (Math.abs(value - base) > 1e-9) coeff[weapon] = value;
  }
  put('hc', coeff, {});

  put('iw', (battle.immuneWindows ?? []).map((w) => [toTenth(w.from), toTenth(w.to)]), []);
  put('ew', (battle.elementWindows ?? []).map(
    (w) => [toTenth(w.from), toTenth(w.to), Math.max(1, CODES.indexOf(w.code))]), []);

  return BATTLE_PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(out)));
}

const windowsOf = (raw: unknown, withCode: boolean): Array<PhaseWindow | ElementWindow> => {
  if (!Array.isArray(raw)) return [];
  const out: Array<PhaseWindow | ElementWindow> = [];
  for (const item of raw.slice(0, 20)) {
    if (!Array.isArray(item)) continue;
    const from = fromTenth(num(item[0], 0, 1800, -1));
    const to = fromTenth(num(item[1], 0, 1800, -1));
    if (from < 0 || to < 0 || from >= to) continue;   // 못 쓰는 구간은 조용히 버린다
    if (!withCode) { out.push({ from, to }); continue; }
    const code = CODES[num(item[2], 1, 5, 0)];
    if (!code) continue;
    out.push({ from, to, code });
  }
  return out;
};

/**
 * 전투 조건 코드를 해석한다. 없는 키는 기본값으로 채우고, 범위를 벗어난 값도
 * 기본값으로 되돌린다 — 남이 만든 코드가 계산을 깨뜨리면 안 된다.
 */
export function decodeBattleCode(code: string): BattleShare {
  const trimmed = code.trim();
  if (!trimmed) throw new Error('전투 조건 코드를 입력해 주세요.');
  const body = trimmed.startsWith(BATTLE_PREFIX)
    ? trimmed.slice(BATTLE_PREFIX.length) : trimmed;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as Record<string, unknown>;
  } catch {
    throw new Error('전투 조건 코드를 해석하지 못했습니다. 코드 전체를 그대로 붙여넣었는지 확인해 주세요.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('전투 조건 코드의 내용이 올바르지 않습니다.');
  }

  const d = BATTLE_DEFAULTS;
  const coeff: Record<string, number> = {};
  if (raw.hc && typeof raw.hc === 'object') {
    for (const [key, value] of Object.entries(raw.hc as Record<string, unknown>)) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0 && n <= 2) coeff[key] = n;
    }
  }

  return {
    duration: Math.trunc(num(raw.d, 10, 180, d.duration)),
    enemyDef: Math.trunc(num(raw.ed, 0, 999_999, d.enemyDef)),
    enemyCode: CODES[Math.trunc(num(raw.ec, 0, 5, 0))] ?? '',
    coreEnabled: Boolean(raw.ce),
    corePx: Math.trunc(num(raw.cp, 0, 1_000, d.corePx)),
    hasParts: Boolean(raw.hp),
    seed: Math.trunc(num(raw.s, 0, 2_147_483_647, d.seed)),
    optimalRangeWeapons: Array.isArray(raw.or)
      ? (raw.or as unknown[]).filter((w): w is string => typeof w === 'string')
      : [],
    normalHitCoeff: coeff,
    immuneWindows: windowsOf(raw.iw, false) as PhaseWindow[],
    elementWindows: windowsOf(raw.ew, true) as ElementWindow[],
    rngMode: raw.rm ? 'random' : 'expected',
    immuneBlocksBurst: raw.ib === undefined ? d.immuneBlocksBurst : Boolean(raw.ib),
    burstRegenTime: fromTenth(num(raw.br, 0, 200, toTenth(d.burstRegenTime))),
    // 없는 키는 기본값이 된다 — 이 항목이 생기기 전에 만들어진 코드는 0.05초로 읽힌다.
    burstReaction: fromHundredth(num(raw.rt, 0, 300, toHundredth(d.burstReaction))),
  };
}


// ── 유니온 레이드 판 공유 (NK4) ───────────────────────────────────────────
// 유니온 레이드는 보스가 다섯인데 그때마다 조건도 덱도 다르다. 지금까지는 칸마다
// NK3 하나와 NK2 셋을 손으로 붙여넣어야 해서 판 하나를 옮기는 데 스무 번을 붙여넣었다.
// 이 코드는 그 스무 개를 **하나로 묶는다**.
//
// 담는 것은 «코드 문자열»뿐이다 — NK3·NK2를 풀지 않고 본문 바이트를 그대로 싣는다.
// 그래서 전투 조건에 항목이 늘어도 이 파일은 손댈 일이 없고, 옛 NK4도 그대로 읽힌다.
//
// **유니온원 명단은 담지 않는다.** 닉네임·openid는 남의 계정 정보다. 공유되는 것은
// 보스 이름과 조건, 그리고 어떤 조합을 돌렸는지까지다.
//
// 형식:
//   [0] 예비 플래그(지금은 0)
//   [1] 보스 수
//   보스마다: [플래그(bit0=켬)] [이름 길이] 이름 UTF-8
//             [NK3 본문 길이] NK3 본문
//             [덱 수] (덱마다 [NK2 본문 길이] NK2 본문)
const UNION_PREFIX = 'NK4-';

/** 이름은 이 길이(UTF-8 바이트)에서 자른다. 길이를 1바이트로 싣기 때문이다. */
const UNION_NAME_MAX = 60;

/** 유니온 레이드 보스 한 칸. 코드만 들고 있다 — 뜻은 NK3·NK2가 안다. */
export interface UnionBossShare {
  name: string;
  enabled: boolean;
  /** 전투 조건 코드(`NK3-…`). 비면 조건을 안 정한 칸이다. */
  battleCode: string;
  /** 덱 코드(`NK2-…`). 빈 문자열이 빈 칸이다 — 자리는 지킨다. */
  deckCodes: string[];
}

export interface UnionShare {
  bosses: UnionBossShare[];
}

const utf8 = new TextEncoder();
const utf8Decode = new TextDecoder();

/** `NK3-`·`NK2-`를 떼고 본문 바이트만. 접두사가 아니면 빈 바이트로 친다. */
function bodyBytes(code: string, prefix: string): Uint8Array {
  const trimmed = code.trim();
  if (!trimmed.startsWith(prefix)) return new Uint8Array(0);
  try {
    return fromBase64Url(trimmed.slice(prefix.length));
  } catch {
    return new Uint8Array(0);
  }
}

/** 뒤쪽 빈 것을 잘라 낸다. 다섯 칸 중 둘만 쓰면 코드도 그만큼 짧아진다. */
function trimTail<T>(list: T[], isEmpty: (item: T) => boolean): T[] {
  const out = [...list];
  while (out.length > 0 && isEmpty(out[out.length - 1]!)) out.pop();
  return out;
}

/** 유니온 레이드 판 하나를 코드 한 줄로. 빈 칸은 잘라 짧게 만든다. */
export function encodeUnionCode(share: UnionShare): string {
  const bosses = trimTail(share.bosses, (boss) =>
    boss.name.trim() === ''
    && boss.battleCode.trim() === ''
    && boss.deckCodes.every((code) => code.trim() === ''));

  const bytes: number[] = [0, bosses.length];
  for (const boss of bosses) {
    bytes.push(boss.enabled ? 1 : 0);

    let name = utf8.encode(boss.name.trim());
    if (name.length > UNION_NAME_MAX) name = name.slice(0, UNION_NAME_MAX);
    bytes.push(name.length, ...name);

    const battle = bodyBytes(boss.battleCode, BATTLE_PREFIX);
    bytes.push(battle.length, ...battle);

    const decks = trimTail(boss.deckCodes, (code) => code.trim() === '');
    bytes.push(decks.length);
    for (const code of decks) {
      const deck = bodyBytes(code, PREFIX);
      bytes.push(deck.length, ...deck);
    }
  }
  return UNION_PREFIX + toBase64Url(Uint8Array.from(bytes));
}

/** 유니온 판 코드를 읽는다. 잘린 코드는 «어디서 끊겼는지»가 아니라 한 줄로 알린다. */
export function decodeUnionCode(code: string): UnionShare {
  const trimmed = code.trim();
  if (!trimmed) throw new Error('유니온 판 코드를 입력해 주세요.');
  if (!trimmed.startsWith(UNION_PREFIX)) {
    throw new Error('유니온 판 코드는 «NK4-»로 시작합니다. 조건 코드(NK3-)나 조합 코드(NK2-)는 각 칸에 따로 넣어 주세요.');
  }

  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(trimmed.slice(UNION_PREFIX.length));
  } catch {
    throw new Error('유니온 판 코드를 해석하지 못했습니다. 코드 전체를 그대로 붙여넣었는지 확인해 주세요.');
  }

  let cursor = 0;
  const need = (count: number): void => {
    if (cursor + count > bytes.length) {
      throw new Error('유니온 판 코드가 중간에 끊겼습니다. 코드 전체를 그대로 붙여넣었는지 확인해 주세요.');
    }
  };
  const take = (count: number): Uint8Array => {
    need(count);
    const out = bytes.slice(cursor, cursor + count);
    cursor += count;
    return out;
  };
  const byte = (): number => {
    need(1);
    return bytes[cursor++]!;
  };

  need(2);
  cursor += 1;                     // 예비 플래그 — 지금은 읽지 않는다
  const count = byte();
  const bosses: UnionBossShare[] = [];
  for (let i = 0; i < count; i += 1) {
    const flags = byte();
    const name = utf8Decode.decode(take(byte()));
    const battle = take(byte());
    const deckCount = byte();
    const deckCodes: string[] = [];
    for (let d = 0; d < deckCount; d += 1) {
      const deck = take(byte());
      deckCodes.push(deck.length > 0 ? PREFIX + toBase64Url(deck) : '');
    }
    bosses.push({
      name,
      enabled: (flags & 1) === 1,
      battleCode: battle.length > 0 ? BATTLE_PREFIX + toBase64Url(battle) : '',
      deckCodes,
    });
  }
  return { bosses };
}

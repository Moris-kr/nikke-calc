import type { DeckState } from './types';

// 조합 공유 코드 — **누가 편성됐는지(캐릭터 이름)만** 한 줄 텍스트로 주고받는다.
// 오버로드·공격력·돌파·스킬·큐브·소장품·컨트롤 같은 개인 스펙과 전투 조건은
// 일부러 담지 않는다: 남의 계정 수치가 딸려 나가면 안 되고, 받는 쪽도 자기 스펙
// 그대로 조합만 얹어 보는 게 목적이기 때문이다.
// 페이로드는 JSON → UTF-8 → base64url로만 옮긴다(압축 라이브러리를 들이지 않는다).

const PREFIX = 'NIKKE1-';

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

/** 편성(+전투 조건)을 공유 코드 문자열로. 빈 덱은 빼서 코드를 짧게 만든다. */
export function encodeShareCode(decks: DeckState[], fiveDeckMode: boolean): string {
  const payload: SharePayload = {
    fiveDeckMode,
    // 이름만 싣는다 — deck.characters(개인 스펙)는 의도적으로 제외한다.
    decks: decks.map((deck) => ({ squad: deck.squad.map((name) => name ?? '') })),
  };
  // 뒤쪽 빈 덱은 정보가 없으니 잘라낸다.
  while (payload.decks.length > 1) {
    const last = payload.decks[payload.decks.length - 1]!;
    if (last.squad.some((name) => name.trim() !== '')) break;
    payload.decks.pop();
  }
  const json = JSON.stringify(payload);
  return PREFIX + toBase64Url(new TextEncoder().encode(json));
}

/** 공유 코드를 해석한다. 형식이 아니면 사람이 읽을 오류를 던진다. */
export function decodeShareCode(code: string): SharePayload {
  const trimmed = code.trim();
  if (!trimmed) throw new Error('공유 코드를 입력해 주세요.');
  const body = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed;
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
  // 옛 코드(스펙까지 담던 형식)를 받아도 이름만 취한다 — 남의 수치는 절대 적용하지 않는다.
  return {
    fiveDeckMode: Boolean((payload as SharePayload).fiveDeckMode),
    decks: decks.slice(0, 5).map((deck) => ({
      squad: Array.isArray(deck?.squad)
        ? deck.squad.slice(0, 5).map((name) => (typeof name === 'string' ? name : ''))
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
export function applyShareToDecks(
  payload: SharePayload,
  decks: DeckState[],
  isKnown: (name: string) => boolean,
  myOverrides?: (name: string) => DeckState['characters'][string] | undefined,
): { applied: number; skipped: string[] } {
  const skipped: string[] = [];
  let applied = 0;
  decks.forEach((deck, index) => {
    const shared = payload.decks[index];
    if (!shared) {
      deck.squad = ['', '', '', '', ''];
      deck.characters = {};
      return;
    }
    const squad = Array.from({ length: 5 }, (_, slot) => {
      const name = (shared.squad[slot] ?? '').trim();
      if (!name) return '';
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
  });
  return { applied, skipped: [...new Set(skipped)] };
}

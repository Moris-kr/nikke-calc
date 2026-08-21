import type { BattleSettings, DeckState } from './types';

// 조합 공유 코드 — 5덱 편성과 캐릭터 설정을 한 줄 텍스트로 주고받는다.
// 서버 없이 붙여넣기만으로 남의 세팅을 그대로 재현하는 게 목적이라, 페이로드는
// JSON → UTF-8 → base64url로만 옮긴다(압축 라이브러리를 새로 들이지 않는다).

const PREFIX = 'NIKKE1-';

export interface SharePayload {
  decks: Array<{ squad: string[]; characters: DeckState['characters'] }>;
  fiveDeckMode: boolean;
  battle?: Partial<BattleSettings>;
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
export function encodeShareCode(
  decks: DeckState[],
  fiveDeckMode: boolean,
  battle?: BattleSettings,
): string {
  const payload: SharePayload = {
    fiveDeckMode,
    decks: decks.map((deck) => {
      const squad = deck.squad.map((name) => name ?? '');
      const characters: DeckState['characters'] = {};
      for (const [name, override] of Object.entries(deck.characters)) {
        if (squad.includes(name)) characters[name] = override;
      }
      return { squad, characters };
    }),
    ...(battle ? {
      battle: {
        duration: battle.duration,
        enemyDef: battle.enemyDef,
        enemyCode: battle.enemyCode,
        coreEnabled: battle.coreEnabled,
        corePx: battle.corePx,
        hasParts: battle.hasParts,
        seed: battle.seed,
        // 계정 콘솔도 딜에 영향을 주므로 같이 실어 재현성을 맞춘다.
        console: battle.console,
      },
    } : {}),
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
  return {
    fiveDeckMode: Boolean((payload as SharePayload).fiveDeckMode),
    decks: decks.slice(0, 5).map((deck) => ({
      squad: Array.isArray(deck?.squad)
        ? deck.squad.slice(0, 5).map((name) => (typeof name === 'string' ? name : ''))
        : [],
      characters: (deck?.characters && typeof deck.characters === 'object')
        ? deck.characters as DeckState['characters']
        : {},
    })),
    ...((payload as SharePayload).battle ? { battle: (payload as SharePayload).battle } : {}),
  };
}

/** 디코드한 편성을 현재 덱에 적용한다. 카탈로그에 없는 이름(미등록·커스텀)은 빼고 알린다. */
export function applyShareToDecks(
  payload: SharePayload,
  decks: DeckState[],
  isKnown: (name: string) => boolean,
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
    for (const [name, override] of Object.entries(shared.characters ?? {})) {
      if (squad.includes(name)) deck.characters[name] = override;
    }
    if (squad.some((name) => name !== '')) applied += 1;
  });
  return { applied, skipped: [...new Set(skipped)] };
}

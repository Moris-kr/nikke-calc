/**
 * 여러 나라 말로 읽히게 하는 층.
 *
 * 이 계산기는 한국어로 지어졌다. 데이터도 한국어가 정본이고(엔진이 한국어 스킬문을
 * 읽는다), 코드에 박힌 글도 한국어다. 그래서 **한국어를 열쇠로 삼는다** — 화면에 적힌
 * 그 문장을 그대로 찾아 다른 말로 바꾼다.
 *
 * 열쇠를 따로 짓지 않은 이유
 * -------------------------
 * `t('battle.duration')` 같은 이름을 이천 개 짓는 길도 있다. 그러면 코드를 읽을 때
 * **무슨 글이 뜨는지 알 수 없고**, 이 저장소가 지켜 온 「코드를 읽으면 화면이 보인다」는
 * 성질이 통째로 사라진다. 한국어를 열쇠로 두면 사전에 없는 글은 한국어로 나온다 —
 * 번역이 덜 된 자리가 **빈칸이 아니라 원문**이라, 반쯤 번역된 상태로도 쓸 수 있다.
 *
 * 두 갈래로 바꾼다
 * ---------------
 * * `t()` — 코드가 만드는 글. 숫자가 끼는 문장은 `{n}` 자리를 두고 값을 넣는다.
 * * `localizeTree()` — 이미 그려진 DOM을 훑어 글자·title·placeholder를 바꾼다.
 *   화면 절반이 한 덩어리 HTML 문자열이라, 그 자리마다 `t()`를 끼우는 것보다
 *   **다 그린 뒤 한 번 훑는** 편이 안전하다(고칠 것이 없으니 실수할 것도 없다).
 *   새로 그려지는 부분은 `watchLocalize()`가 지켜보다가 같은 일을 한다.
 *
 * 이름은 사전이 아니라 **데이터**다(`data/locale_text.json`) — 캐릭터·스킬·큐브·애장품은
 * 게임사가 정한 이름이라 우리가 옮길 것이 아니다.
 */

import { EN } from './locale/en';
import { JA } from './locale/ja';
import { ZH_TW } from './locale/zh-tw';

export type Lang = 'ko' | 'en' | 'ja' | 'zh-TW';

export const LANGS: Array<{ code: Lang; label: string }> = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh-TW', label: '繁體中文' },
];

/** 고른 말을 적어 두는 자리. 브라우저마다 따로 기억한다. */
export const LANG_KEY = 'nikke-lang-v1';

/** 게임사가 정한 이름들. 언어를 바꿀 때 받아 와 꽂는다. */
export interface LocaleNames {
  characters?: Record<string, Record<string, string>>;
  skills?: Record<string, Record<string, string>>;
  cubes?: Record<string, Record<string, string>>;
  favorites?: Record<string, Record<string, string>>;
}

const DICTS: Record<Lang, Record<string, string>> = { ko: {}, en: EN, ja: JA, 'zh-TW': ZH_TW };

const TRADITIONAL_CHINESE = /^(zh-tw|zh-hk|zh-mo)\b|hant/;

let current: Lang = 'ko';
let names: LocaleNames = {};
/** 이름 표를 한 장으로 접어 둔 것. 갈래를 가리지 않고 한 번에 찾는다. */
let nameIndex: Map<string, string> = new Map();

/**
 * 브라우저가 말하는 언어. 저장해 둔 것이 있으면 그것이 먼저다 — 사람이 고른 것은
 * 브라우저 설정보다 세다.
 */
export function detectLang(stored: string | null, accepted: readonly string[]): Lang {
  if (stored === 'ko' || stored === 'en' || stored === 'ja' || stored === 'zh-TW') return stored;
  if (stored && TRADITIONAL_CHINESE.test(stored.toLowerCase().replaceAll('_', '-'))) return 'zh-TW';
  for (const raw of accepted) {
    const tag = raw.toLowerCase().replaceAll('_', '-');
    if (tag.startsWith('ko')) return 'ko';
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('en')) return 'en';
    if (TRADITIONAL_CHINESE.test(tag)) return 'zh-TW';
  }
  return 'ko';
}

export const lang = (): Lang => current;

export function setLang(next: Lang): void {
  current = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

/** 이름 표를 꽂는다. 언어가 한국어면 부를 일이 없다. */
export function setLocaleNames(next: LocaleNames): void {
  names = next ?? {};
  nameIndex = new Map();
  for (const group of [names.characters, names.skills, names.cubes, names.favorites]) {
    for (const [korean, translations] of Object.entries(group ?? {})) {
      const translated = translations?.[current];
      if (translated) nameIndex.set(korean, translated);
    }
  }
}

/**
 * 게임 안 이름 하나. 표에 없으면 한국어 그대로 — 새로 나온 캐릭터가 이름을 잃지 않는다.
 *
 * 스킬 이름은 뒤에 번호가 붙기도 한다(「버블 오더 4」). 그 번호는 우리가 붙인 것이라
 * 떼고 찾은 뒤 다시 붙인다.
 */
export function tName(korean: string): string {
  if (current === 'ko' || !korean) return korean;
  const direct = nameIndex.get(korean);
  if (direct) return direct;
  const numbered = /^(.*?)\s+(\d+)$/.exec(korean);
  if (numbered) {
    const base = nameIndex.get(numbered[1]!);
    if (base) return `${base} ${numbered[2]}`;
  }
  // 「화무십일홍 · 파죽 3」처럼 이름 둘을 이어 붙인 자리도 있다 — 조각마다 찾는다.
  if (korean.includes(' · ')) {
    const parts = korean.split(' · ');
    const moved = parts.map((part) => tName(part));
    if (moved.some((part, at) => part !== parts[at])) return moved.join(' · ');
  }
  return korean;
}

/**
 * 게임 안 이름이면 이름표에서, 아니면 사전에서. 데이터가 주는 짧은 이름표는 둘 중
 * 어느 쪽인지 부르는 자리에서 알 수 없다 — 이름표를 먼저 보고 없으면 사전을 본다.
 */
export const tLabel = (korean: string): string => {
  const named = tName(korean);
  return named === korean ? t(korean) : named;
};

/** `{n}` 자리를 값으로 채운다. 값이 없으면 자리 글자를 그대로 둔다(빈칸보다 낫다). */
const fill = (text: string, vars?: Record<string, string | number>): string =>
  vars ? text.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole)) : text;

/** 화면에 적을 글 하나. 사전에 없으면 한국어 원문이 그대로 나온다. */
export function t(korean: string, vars?: Record<string, string | number>): string {
  if (current === 'ko') return fill(korean, vars);
  return fill(DICTS[current][korean] ?? korean, vars);
}

/** 사전에 있는 글인가. 화면을 훑을 때 손댈 곳을 가린다. */
const translatable = (text: string): string | null => {
  if (current === 'ko') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  // 사전이 먼저고, 없으면 이름표를 본다 — 이름표는 번호가 붙거나 둘이 이어 붙은
  // 모양까지 풀어 주므로 `tName`을 그대로 쓴다.
  const hit = DICTS[current][trimmed] ?? tName(trimmed);
  return hit && hit !== trimmed ? hit : null;
};

/** 글자를 담고 있는 속성들. 눈에 보이거나 마우스를 올리면 보이는 것들이다. */
const TEXT_ATTRS = ['title', 'placeholder', 'aria-label', 'alt'] as const;

/**
 * 이미 그려진 나무를 훑어 우리말을 그 나라 말로 바꾼다.
 *
 * **바꾼 자리는 다시 안 바꾼다** — 사전의 열쇠는 한국어뿐이라, 한 번 영어가 된 글은
 * 다음 훑기에서 아무것도 걸리지 않는다(그래서 여러 번 불려도 안전하다).
 */
export function localizeTree(root: Node): void {
  if (current === 'ko') return;
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 0x01 | 0x04 /* ELEMENT | TEXT */);
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      const hit = translatable(node.nodeValue ?? '');
      if (hit) {
        // 앞뒤 공백은 지킨다 — 지우면 붙어 있던 글자와 들러붙는다.
        const raw = node.nodeValue ?? '';
        const lead = raw.slice(0, raw.length - raw.trimStart().length);
        const tail = raw.slice(raw.trimEnd().length);
        node.nodeValue = `${lead}${hit}${tail}`;
      }
      return;
    }
    const element = node as Element;
    for (const attr of TEXT_ATTRS) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const hit = translatable(value);
      if (hit) element.setAttribute(attr, hit);
    }
  };
  if (root.nodeType === 1 || root.nodeType === 3) visit(root);
  let node = walker.nextNode();
  while (node) {
    visit(node);
    node = walker.nextNode();
  }
}

/**
 * 새로 그려지는 것까지 따라가며 바꾼다. 화면은 끊임없이 다시 그려지므로, 그릴 때마다
 * 부르라고 하는 대신 한 자리에서 지켜본다 — 부르는 것을 잊은 자리가 곧 번역이 빠진
 * 자리가 되는 구조를 만들지 않으려는 것이다.
 */
export function watchLocalize(root: HTMLElement): () => void {
  if (current === 'ko' || typeof MutationObserver === 'undefined') return () => undefined;
  localizeTree(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const added of record.addedNodes) localizeTree(added);
      if (record.type === 'attributes' && record.target.nodeType === 1) {
        localizeTree(record.target);
      }
      // 글자만 갈아 끼우는 자리(textContent = …)도 잡는다.
      if (record.type === 'characterData') localizeTree(record.target);
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TEXT_ATTRS],
  });
  return () => observer.disconnect();
}

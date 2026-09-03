// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { EN } from './locale/en';
import { JA } from './locale/ja';
import { ZH_TW } from './locale/zh-tw';
import {
  detectLang, lang, localizeTree, setLang, setLocaleNames, t, tName, watchLocalize,
} from './i18n';

afterEach(() => { setLang('ko'); setLocaleNames({}); });

describe('언어 고르기', () => {
  it('저장해 둔 것이 브라우저 설정보다 세다', () => {
    // 사람이 고른 것은 기계가 말하는 것보다 앞선다.
    expect(detectLang('ja', ['en-US', 'en'])).toBe('ja');
    expect(detectLang(null, ['en-US', 'en'])).toBe('en');
    expect(detectLang(null, ['ja-JP'])).toBe('ja');
    expect(detectLang(null, ['ko-KR', 'en'])).toBe('ko');
    expect(detectLang('zh-TW', ['en-US'])).toBe('zh-TW');
    expect(detectLang(null, ['zh-TW', 'en'])).toBe('zh-TW');
    expect(detectLang(null, ['zh-HK'])).toBe('zh-TW');
    expect(detectLang(null, ['zh-Hant-TW'])).toBe('zh-TW');
  });

  it('간체 중국어는 번체로 가지 않는다', () => {
    // 번체 사전이 간체 자리를 훔치면 대륙 사람이 읽을 수 없는 화면이 된다.
    expect(detectLang(null, ['zh-CN', 'en'])).toBe('en');
    expect(detectLang(null, ['zh-Hans'])).toBe('ko');
  });

  it('모르는 말이면 한국어로 간다', () => {
    // 이 계산기의 정본은 한국어다 — 모를 때 돌아갈 자리도 거기다.
    expect(detectLang('de', ['de-DE', 'fr'])).toBe('ko');
    expect(detectLang(null, [])).toBe('ko');
  });
});

describe('글 바꾸기', () => {
  it('사전에 없으면 한국어 원문이 그대로 나온다', () => {
    setLang('en');
    expect(t('전투 조건')).toBe('Battle setup');
    // 번역이 덜 된 자리가 빈칸이 아니라 원문이라, 반쯤 된 사전으로도 쓸 수 있다.
    expect(t('아직 안 옮긴 문장입니다')).toBe('아직 안 옮긴 문장입니다');
  });

  it('한국어일 때는 아무것도 안 바꾼다', () => {
    setLang('ko');
    expect(t('전투 조건')).toBe('전투 조건');
    expect(lang()).toBe('ko');
  });

  it('{n} 자리는 값으로 채운다', () => {
    setLang('en');
    expect(t('{n}명 지원', { n: 200 })).toBe('200 characters');
    setLang('ko');
    expect(t('{n}명 지원', { n: 7 })).toBe('7명 지원');
    // 값이 없으면 자리 글자를 그대로 둔다 — 빈칸보다 낫다.
    expect(t('{n}명 지원')).toBe('{n}명 지원');
  });
});

describe('게임 안 이름', () => {
  const names = {
    characters: {
      '라피 : 레드 후드': {
        en: 'Rapi: Red Hood', ja: 'ラピ：レッドフード', 'zh-TW': '拉毗：小紅帽',
      },
    },
    skills: { '버블 오더': { en: 'Bubble Order', ja: 'バブルオーダー', 'zh-TW': '泡沫指令' } },
  };

  it('표에 있으면 그 말로 부른다', () => {
    setLang('en');
    setLocaleNames(names);
    expect(tName('라피 : 레드 후드')).toBe('Rapi: Red Hood');
  });

  it('표에 없는 이름은 한국어 그대로 — 새 캐릭터가 이름을 잃지 않는다', () => {
    setLang('en');
    setLocaleNames(names);
    expect(tName('아직 없는 니케')).toBe('아직 없는 니케');
  });

  it('우리가 붙인 번호는 떼고 찾은 뒤 다시 붙인다', () => {
    setLang('ja');
    setLocaleNames(names);
    expect(tName('버블 오더 4')).toBe('バブルオーダー 4');
  });

  it('번체 중국어 이름도 같은 표에서 꺼낸다', () => {
    setLang('zh-TW');
    setLocaleNames(names);
    expect(tName('라피 : 레드 후드')).toBe('拉毗：小紅帽');
    expect(tName('버블 오더 4')).toBe('泡沫指令 4');
  });
});

describe('그려진 화면 훑기', () => {
  const html = `
    <button title="전투 조건 보기">전투 조건</button>
    <input placeholder="닉네임" />
    <p>아직 안 옮긴 문장입니다</p>`;

  it('글자와 속성을 함께 바꾼다', () => {
    setLang('en');
    const host = document.createElement('div');
    host.innerHTML = html;
    localizeTree(host);
    expect(host.querySelector('button')!.textContent).toBe('Battle setup');
    expect(host.querySelector('button')!.title).toBe('Battle setup view');
    expect(host.querySelector('input')!.placeholder).toBe('Nickname');
    // 사전에 없는 글은 손대지 않는다.
    expect(host.querySelector('p')!.textContent).toBe('아직 안 옮긴 문장입니다');
  });

  it('여러 번 훑어도 한 번 바꾼 것을 또 바꾸지 않는다', () => {
    setLang('en');
    const host = document.createElement('div');
    host.innerHTML = html;
    localizeTree(host);
    const once = host.innerHTML;
    localizeTree(host);
    localizeTree(host);
    expect(host.innerHTML).toBe(once);
  });

  it('한국어일 때는 훑어도 그대로다', () => {
    setLang('ko');
    const host = document.createElement('div');
    host.innerHTML = html;
    const before = host.innerHTML;
    localizeTree(host);
    expect(host.innerHTML).toBe(before);
  });

  it('나중에 그려진 것도 따라가 바꾼다', async () => {
    setLang('en');
    const host = document.createElement('div');
    document.body.append(host);
    const stop = watchLocalize(host);
    const later = document.createElement('button');
    later.textContent = '닫기';
    host.append(later);
    // MutationObserver는 마이크로태스크 뒤에 온다.
    await Promise.resolve();
    await new Promise((done) => { setTimeout(done, 0); });
    expect(later.textContent).toBe('Close');
    stop();
    host.remove();
  });
});

describe('사전 세 벌', () => {
  it('영어·일본어·번체가 같은 열쇠를 가진다', () => {
    // 한쪽에만 있는 열쇠는 그 말로 볼 때만 한국어가 튀어나온다는 뜻이다.
    const onlyEn = Object.keys(EN).filter((key) => !(key in JA) || !(key in ZH_TW));
    const onlyJa = Object.keys(JA).filter((key) => !(key in EN) || !(key in ZH_TW));
    const onlyZh = Object.keys(ZH_TW).filter((key) => !(key in EN) || !(key in JA));
    expect({ onlyEn, onlyJa, onlyZh }).toEqual({ onlyEn: [], onlyJa: [], onlyZh: [] });
  });

  it('빈 번역이 없다', () => {
    for (const [key, value] of Object.entries({ ...EN, ...JA, ...ZH_TW })) {
      expect(value.length, key).toBeGreaterThan(0);
    }
  });

  it('{n} 같은 자리 글자가 짝을 잃지 않는다', () => {
    const slots = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const [korean, english] of Object.entries(EN)) {
      expect(slots(english), korean).toBe(slots(korean));
      expect(slots(JA[korean] ?? ''), korean).toBe(slots(korean));
      expect(slots(ZH_TW[korean] ?? ''), korean).toBe(slots(korean));
    }
  });

  it('번체 사전은 한국어 열쇠를 그 말로 바꾼다', () => {
    setLang('zh-TW');
    expect(t('전투 조건')).toBe('戰鬥條件');
    expect(t('{n}명 지원', { n: 200 })).toBe('支援 200 位妮姬');
    expect(t('억')).toBe('億');
  });
});

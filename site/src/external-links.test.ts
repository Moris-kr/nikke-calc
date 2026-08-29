import { describe, expect, it } from 'vitest';
import { EXTERNAL_LINKS, hostOf } from './external-links';

describe('외부고리 표', () => {
  it('네 곳으로 나간다', () => {
    expect(EXTERNAL_LINKS.map((link) => link.label))
      .toEqual(['렛츠도로', '딜도로', '솔레 금서고', '도로파티']);
  });

  it('모든 고리가 https이고 이름·설명이 비어 있지 않다', () => {
    for (const link of EXTERNAL_LINKS) {
      expect(link.url.startsWith('https://')).toBe(true);
      expect(link.label.trim()).not.toBe('');
      // 들어가 보기 전에 무엇을 하는 곳인지 알 수 있어야 한다.
      expect(link.note.trim()).not.toBe('');
    }
  });

  it('같은 곳을 두 번 적지 않는다', () => {
    const urls = EXTERNAL_LINKS.map((link) => link.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('hostOf', () => {
  it('주소에서 사람이 알아보는 부분만 남긴다', () => {
    expect(hostOf('https://letsdoro.com/')).toBe('letsdoro.com');
    expect(hostOf('https://www.example.com/some/path')).toBe('example.com');
    expect(hostOf('https://soloraidhistory.vercel.app/')).toBe('soloraidhistory.vercel.app');
  });

  it('주소가 아니면 그대로 돌려준다 — 카드가 빈칸이 되지 않게', () => {
    expect(hostOf('주소아님')).toBe('주소아님');
  });
});

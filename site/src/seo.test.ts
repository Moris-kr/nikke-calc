import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 검색에 걸리는 자리는 화면이 아니라 `index.html`이라, 고칠 때 조용히 빠지기 쉽다.
// 여기서 «있어야 하는 것»만 못 박는다 — 문구 자체는 자유롭게 다듬을 수 있게 둔다.

const root = join(import.meta.dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

describe('검색엔진에 걸리는 자리', () => {
  it('정본 주소를 한 번만 가리킨다', () => {
    // 여러 개면 어느 것이 정본인지 엔진이 고르게 되고, 없으면 주소가 갈린다.
    const canonical = [...html.matchAll(/<link\s+rel="canonical"[^>]*>/g)];
    expect(canonical).toHaveLength(1);
    expect(canonical[0]![0]).toContain('https://moris-kr.github.io/nikke-calc/');
  });

  it('검색 결과에 실릴 설명이 짧지 않다', () => {
    const found = /<meta name="description" content="([^"]+)"/.exec(html);
    expect(found).not.toBeNull();
    // 너무 짧으면 엔진이 본문에서 아무 줄이나 뽑아 쓴다.
    expect(found![1]!.length).toBeGreaterThan(80);
  });

  it('네 나라 말로 나온다는 사실을 알린다', () => {
    for (const locale of ['en_US', 'ja_JP', 'zh_TW']) {
      expect(html, locale).toContain(`og:locale:alternate" content="${locale}"`);
    }
  });

  it('구조화 데이터가 실제로 파싱되는 JSON이다', () => {
    // 깨진 JSON-LD는 조용히 통째로 무시된다 — 눈으로는 안 보인다.
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    expect(block).not.toBeNull();
    const data = JSON.parse(block![1]!) as Record<string, unknown>;
    expect(data['@type']).toBe('WebApplication');
    expect(data.url).toBe('https://moris-kr.github.io/nikke-calc/');
  });

  it('자바스크립트를 안 돌리는 크롤러에게도 읽을 글이 있다', () => {
    // 화면을 전부 스크립트가 그리므로, 이 글이 없으면 이 페이지는 빈 종이다.
    const app = /<main id="app">([\s\S]*?)<\/main>/.exec(html);
    expect(app).not.toBeNull();
    const body = app![1]!;
    expect(body).toContain('<h1>');
    expect(body).toContain('<noscript>');
    // 사람들이 실제로 치는 말이 본문에 있어야 한다.
    for (const word of ['니케', 'NIKKE', '오버로드', '유니온 레이드']) {
      expect(body, word).toContain(word);
    }
    // 계산기가 뜨면 `#app` 안쪽이 통째로 갈리므로 이 글은 사라진다 — 그래서 **안쪽**이어야 한다.
    expect(body.length).toBeGreaterThan(200);
  });

  it('크롤러를 막지 않고 사이트맵을 가리킨다', () => {
    const robots = readFileSync(join(root, 'public', 'robots.txt'), 'utf8');
    expect(robots).toContain('Allow: /');
    expect(robots).not.toMatch(/^Disallow: \/$/m);
    expect(robots).toContain('Sitemap: https://moris-kr.github.io/nikke-calc/sitemap.xml');
  });

  it('사이트맵이 올바른 이름공간을 쓴다', () => {
    // 이름공간이 한 글자만 틀려도(sitemap/sitemaps) 통째로 안 읽힌다.
    const sitemap = readFileSync(join(root, 'public', 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('http://www.sitemaps.org/schemas/sitemap/0.9');
    expect(sitemap).toContain('<loc>https://moris-kr.github.io/nikke-calc/</loc>');
  });
});

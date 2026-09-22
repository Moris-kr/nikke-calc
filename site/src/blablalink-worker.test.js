import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from '../../worker/src/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BlablaLink Worker health', () => {
  it('갱신일로부터 30일을 남은 기간으로 센다 — 갱신일이 없으면 null', async () => {
    const { cookieAge } = await import('../../worker/src/index.js');
    const now = Date.parse('2026-09-22T00:00:00Z');
    expect(cookieAge('2026-09-20T05:00:00Z', now)).toMatchObject({ validDays: 30, daysLeft: 28, expiresAt: '2026-10-20T05:00:00.000Z' });
    expect(cookieAge('2026-08-01T00:00:00Z', now).daysLeft).toBeLessThan(0);
    expect(cookieAge(undefined, now)).toMatchObject({ renewedAt: null, daysLeft: null, expiresAt: null });
    expect(cookieAge('not a date', now).daysLeft).toBeNull();
  });
});

describe('BlablaLink Worker server selection', () => {
  it('수동 서버를 고르면 그 지역만 상류 API에 요청한다', async () => {
    const requestedAreas = [];
    vi.stubGlobal('fetch', async (url, init) => {
      const body = JSON.parse(init.body);
      requestedAreas.push(body.nikke_area_id);
      const route = String(url);
      if (route.endsWith('Game/GetUserCharacters')) {
        return Response.json({ code: 0, data: { characters: [{ name_code: 5001 }] } });
      }
      if (route.endsWith('Game/GetUserCharacterDetails')) {
        return Response.json({
          code: 0,
          data: { character_details: [{ name_code: 5001 }], state_effects: [] },
        });
      }
      if (route.endsWith('Game/GetUserProfileOutpostInfo')) {
        return Response.json({ code: 0, data: { outpost_info: null } });
      }
      throw new Error(`unexpected route: ${route}`);
    });

    const request = new Request('https://worker.example/sync', {
      method: 'POST',
      headers: {
        Origin: 'https://moris-kr.github.io',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ profileUrl: '15361668407129878426', area: 84 }),
    });
    const response = await worker.fetch(request, {
      ALLOWED_ORIGINS: 'https://moris-kr.github.io',
      BLABLA_COOKIE: 'game_token=test',
    });

    expect(response.status).toBe(200);
    expect(requestedAreas).toEqual([84, 84, 84]);
  });

  it('자동 선택용 응답에는 공식 서버 다섯 곳을 모두 담는다', async () => {
    vi.stubGlobal('fetch', async (url) => {
      const route = String(url);
      if (route.endsWith('Game/GetUserCharacters')) {
        return Response.json({ code: 0, data: { characters: [{ name_code: 5001 }] } });
      }
      if (route.endsWith('Game/GetUserCharacterDetails')) {
        return Response.json({
          code: 0,
          data: { character_details: [{ name_code: 5001 }], state_effects: [] },
        });
      }
      if (route.endsWith('Game/GetUserProfileOutpostInfo')) {
        return Response.json({ code: 0, data: { outpost_info: null } });
      }
      throw new Error(`unexpected route: ${route}`);
    });

    const request = new Request('https://worker.example/sync', {
      method: 'POST',
      headers: {
        Origin: 'https://moris-kr.github.io',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ profileUrl: '15361668407129878426' }),
    });
    const response = await worker.fetch(request, {
      ALLOWED_ORIGINS: 'https://moris-kr.github.io',
      BLABLA_COOKIE: 'game_token=test',
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.areas.map((area) => area.area)).toEqual([83, 81, 84, 82, 85]);
  });
});

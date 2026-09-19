// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPickupHistory, filterPickupCards, filterPickupEvents, validatePickupHistory, pickupHonor, expandPickupCards, pickupExportLayout, type PickupHistory } from './pickup-history';
import type { CharacterMeta } from './types';

const data: PickupHistory = {
  updatedAt: '2026-09-19', coverageNote: '확인된 기록',
  sources: [{ id: 'official', title: '공지', url: 'https://example.com/news' }],
  events: [
    { id: 'b', start: '2025-02-01', names: ['시험 캐릭터'], kind: 'rerun', limited: true, sourceIds: ['official'] },
    { id: 'a', start: '2024-01-01', names: ['시험 캐릭터'], kind: 'new', sourceIds: ['official'] },
  ],
};
describe('pickup history', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });
  it('places and searches the free character beside the collab pickup without relabeling it as a pickup', async () => {
    const fixture = { ...data, events: [{ ...data.events[0]!, collab: true, gifts: ['배포 캐릭터'], giftNote: '출석 보상' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => fixture }));
    const host = document.createElement('div'); await renderPickupHistory(host, []);
    const cards = [...host.querySelectorAll('.pickup-card')];
    expect(cards).toHaveLength(2);
    expect(cards.map(n => n.querySelector('.pickup-name')?.textContent)).toEqual(['시험 캐릭터', '배포 캐릭터']);
    expect(cards.every(n => n.querySelectorAll('.pickup-person').length === 1)).toBe(true);
    expect(cards[1]!.textContent).toContain('배포');
    expect(cards[1]!.textContent).not.toContain('복각');
    expect(cards[1]!.classList.contains('pickup-limited')).toBe(false);
    expect(filterPickupEvents(fixture.events, { year: '', kind: 'collab', query: '배포', order: 'desc' }, [])).toHaveLength(1);
    expect(() => validatePickupHistory({ ...fixture, events: [{ ...fixture.events[0], gifts: ['시험 캐릭터'] }] })).toThrow();
  });
  it('filters pickup and giveaway portraits by their own element and resets the selection', async () => {
    const fixture = { ...data, events: [{ ...data.events[0]!, names: ['시험 캐릭터', '다른 캐릭터'], collab: true, gifts: ['배포 캐릭터'] }] };
    const catalog = [{ name: '시험 캐릭터', elementCode: '작열' }, { name: '다른 캐릭터', elementCode: '풍압' }, { name: '배포 캐릭터', elementCode: '수냉' }] as CharacterMeta[];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => fixture }));
    const host = document.createElement('div'); await renderPickupHistory(host, catalog);
    expect([...host.querySelectorAll<HTMLImageElement>('.pickup-element')].map(icon => icon.alt)).toEqual(['작열', '풍압', '수냉']);
    const select = host.querySelector<HTMLSelectElement>('[aria-label="픽업 속성"]')!;
    select.value = '수냉'; select.dispatchEvent(new Event('change'));
    expect(host.querySelectorAll('.pickup-card')).toHaveLength(1);
    expect(host.querySelector('.pickup-gift-card .pickup-name')?.textContent).toBe('배포 캐릭터');
    const filters = { year: '', kind: '', query: '', order: 'asc' as const, element: '작열' };
    expect(filterPickupCards(fixture.events, filters, catalog).map(card => card.names)).toEqual([['시험 캐릭터']]);
    select.value = '철갑'; select.dispatchEvent(new Event('change'));
    expect(host.querySelector<HTMLButtonElement>('.pickup-export')!.disabled).toBe(true);
    [...host.querySelectorAll('button')].find(button => button.textContent === '초기화')!.click();
    expect(select.value).toBe('');
    expect(host.querySelectorAll('.pickup-element')).toHaveLength(3);
  });
  it('uses separate adjacent gift cards for both chronological directions and PNG input', () => {
    const events = [{ ...data.events[0]!, collab: true, gifts: ['배포1', '배포2'] }, data.events[1]!];
    for (const order of ['asc', 'desc'] as const) {
      const cards = expandPickupCards(filterPickupEvents(events, { year: '', kind: '', query: '', order }, []));
      const index = cards.findIndex(e => e.id === 'b');
      expect(cards.slice(index, index + 3).map(e => e.names)).toEqual([['시험 캐릭터'], ['배포1'], ['배포2']]);
      expect(cards[index + 1]!.end).toBeUndefined();
      expect(cards[index + 1]!.gifts).toBeUndefined();
    }
  });
  it('fits all cards into one PNG and grows only the row containing a grouped pickup', () => {
    const cards = Array.from({ length: 155 }, (_, i) => ({ ...data.events[0]!, id: String(i) }));
    cards[6] = { ...cards[6]!, names: ['A', 'B', 'C', 'D', 'E', 'F'] };
    const layout = pickupExportLayout(cards);
    expect(layout.rows).toHaveLength(26);
    expect(layout.rows[0]!.height).toBe(240);
    expect(layout.rows[1]!.height).toBeGreaterThan(240);
    expect(layout.rows[2]!.height).toBe(240);
    expect(layout.rows.at(-1)!.y + layout.rows.at(-1)!.height).toBeLessThan(layout.height);
    expect(layout.pixelWidth).toBe(1200);
    const large = pickupExportLayout([...cards, ...cards, ...cards]);
    expect(large.rows).toHaveLength(78);
    expect(large.pixelHeight).toBeLessThanOrEqual(8192);
    expect(large.scale).toBeLessThan(1);
  });
  it('distinguishes special limited cards, ignores unrelated tags, and remembers dark mode', async () => {
    const fixture = { ...data, events: [{ ...data.events[0]!, tags: ['오버스펙'] }, { ...data.events[1]!, tags: ['기타'] }] };
    const catalog = [{ name: '시험 캐릭터', manufacturer: '필그림' }] as CharacterMeta[];
    expect(pickupHonor(fixture.events[1]!, new Map())).toBe('');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => fixture }));
    const host = document.createElement('div'); await renderPickupHistory(host, catalog);
    expect(host.querySelectorAll('.pickup-special')).toHaveLength(2);
    expect(host.querySelectorAll('.pickup-prestige')).toHaveLength(1);
    expect(host.querySelector('.pickup-prestige .pickup-honor')?.textContent).toBe('✦ 한정 필그림 · 오버스펙');
    host.querySelector<HTMLButtonElement>('.pickup-theme')!.click();
    expect(host.querySelector('.pickup-history')?.getAttribute('data-theme')).toBe('dark');
    await renderPickupHistory(host, catalog);
    expect(host.querySelector('.pickup-theme')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.pickup-history')?.getAttribute('data-theme')).toBe('dark');
  });
  it('marks upcoming pickups against the current KST date, not the last data update', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T14:59:00Z'));
    const upcoming = { ...data, updatedAt: '2026-09-19', events: [{ ...data.events[0]!, start: '2026-09-24' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => upcoming }));
    const host = document.createElement('div');
    await renderPickupHistory(host, []);
    expect(host.querySelector('.pickup-card')?.textContent).toContain('예정');
    vi.setSystemTime(new Date('2026-09-23T15:01:00Z'));
    await renderPickupHistory(host, []);
    expect(host.querySelector('.pickup-card')?.textContent).not.toContain('예정');
  });
  it('renders unknown characters without broken images and keeps active filters on search', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
    const host = document.createElement('div');
    await renderPickupHistory(host, []);
    expect(host.querySelectorAll('.pickup-card')).toHaveLength(2);
    expect(host.querySelectorAll('img')).toHaveLength(0);
    const year = host.querySelector<HTMLSelectElement>('[aria-label="픽업 연도"]')!;
    year.value = '2025'; year.dispatchEvent(new Event('change'));
    const search = host.querySelector<HTMLInputElement>('input')!;
    search.value = '시험'; search.dispatchEvent(new Event('input'));
    expect(host.querySelectorAll('.pickup-card')).toHaveLength(1);
    expect(year.value).toBe('2025');
    expect(host.querySelector('.pickup-card')?.textContent).toContain('2025.02.01');
  });
  it('combines year, type and alias search without mutating chronology', () => {
    expect(filterPickupEvents(data.events, { year: '2025', kind: 'limited', query: '별명', order: 'asc' }, [{ name: '시험 캐릭터', aliases: ['별명'] }]).map(e => e.id)).toEqual(['b']);
    expect(filterPickupEvents(data.events, { year: '', kind: '', query: 'ㅅㅎ', order: 'asc' }, []).map(e => e.id)).toEqual(['a', 'b']);
    expect(data.events[0]!.id).toBe('b');
  });
  it('validates source references and rejects executable links or impossible dates', () => {
    expect(validatePickupHistory(data)).toEqual(data);
    expect(() => validatePickupHistory({ ...data, sources: [{ ...data.sources[0], url: 'javascript:alert(1)' }] })).toThrow();
    expect(() => validatePickupHistory({ ...data, sources: [] })).toThrow();
    expect(() => validatePickupHistory({ ...data, events: [{ ...data.events[0], start: '2025-02-30' }] })).toThrow();
  });
});

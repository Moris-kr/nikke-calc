// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPickupHistory, filterPickupEvents, validatePickupHistory, type PickupHistory } from './pickup-history';

const data: PickupHistory = {
  updatedAt: '2026-09-19', coverageNote: '확인된 기록',
  sources: [{ id: 'official', title: '공지', url: 'https://example.com/news' }],
  events: [
    { id: 'b', start: '2025-02-01', names: ['시험 캐릭터'], kind: 'rerun', limited: true, sourceIds: ['official'] },
    { id: 'a', start: '2024-01-01', names: ['시험 캐릭터'], kind: 'new', sourceIds: ['official'] },
  ],
};
describe('pickup history', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
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

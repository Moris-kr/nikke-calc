import { describe, expect, it } from 'vitest';

import {
  applyBackup, backupFileName, buildBackup, readBackup,
  BACKUP_KEYS, BACKUP_KIND, BACKUP_SKIPPED,
} from './backup';

const store = (entries: Record<string, string>) =>
  (key: string): string | null => entries[key] ?? null;

describe('백업 뜨기', () => {
  it('사람이 쌓은 것만 담고 빈 칸은 안 담는다', () => {
    const file = buildBackup(store({
      'nikke-state-v1': '{"decks":[]}',
      'nikke-presets-v1': '[]',
      'nikke-calc-results': '큰 덩어리',   // 캐시는 안 담는다
    }));
    expect(file.kind).toBe(BACKUP_KIND);
    expect(Object.keys(file.data).sort()).toEqual(['nikke-presets-v1', 'nikke-state-v1']);
    expect(file.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('못 읽는 열쇠가 있어도 나머지는 담는다 — 한 칸 때문에 백업을 잃지 않는다', () => {
    const file = buildBackup((key) => {
      if (key === 'nikke-roster-v1') throw new Error('읽을 수 없음');
      return key === 'nikke-state-v1' ? '{}' : null;
    });
    expect(file.data['nikke-state-v1']).toBe('{}');
    expect(file.data['nikke-roster-v1']).toBeUndefined();
  });

  it('담는 열쇠와 일부러 빼는 열쇠가 겹치지 않는다', () => {
    // 겹치면 «담는다/안 담는다»가 어느 쪽인지 코드를 읽어야 알게 된다.
    const skipped = new Set<string>(BACKUP_SKIPPED);
    for (const key of BACKUP_KEYS) expect(skipped.has(key), key).toBe(false);
  });

  it('파일 이름에 날짜가 들어간다 — 여러 장을 구분해야 한다', () => {
    expect(backupFileName(new Date('2026-09-13T10:00:00Z'))).toMatch(/^니케계산기_백업_2026\d{4}\.json$/);
  });
});

describe('백업 읽기', () => {
  const good = JSON.stringify({
    kind: BACKUP_KIND, version: 1, savedAt: '2026-09-13T00:00:00.000Z',
    data: { 'nikke-state-v1': '{"decks":[]}' },
  });

  it('제 파일이면 담긴 것을 돌려준다', () => {
    expect(readBackup(good).data).toEqual({ 'nikke-state-v1': '{"decks":[]}' });
  });

  it('모르는 열쇠는 버린다 — 남이 준 파일이 저장소에 아무거나 쓰게 두지 않는다', () => {
    const mixed = JSON.stringify({
      kind: BACKUP_KIND, version: 1, savedAt: 'x',
      data: { 'nikke-state-v1': '{}', 'evil-key': '나쁜 것', 'nikke-feedback-admin': '열쇠' },
    });
    const read = readBackup(mixed);
    expect(Object.keys(read.data)).toEqual(['nikke-state-v1']);
    expect(read.skipped.sort()).toEqual(['evil-key', 'nikke-feedback-admin']);
  });

  it('무엇이 잘못됐는지 말해 준다 — 「실패」 한 줄로는 다음에 뭘 할지 모른다', () => {
    expect(() => readBackup('{{{')).toThrow(/JSON/);
    expect(() => readBackup('{"kind":"남의것"}')).toThrow(/이 계산기의 백업 파일이 아닙니다/);
    expect(() => readBackup(JSON.stringify({ kind: BACKUP_KIND }))).toThrow(/담긴 내용이 없습니다/);
    expect(() => readBackup(JSON.stringify({ kind: BACKUP_KIND, data: { x: 1 } })))
      .toThrow(/되살릴 것을 찾지 못했습니다/);
  });

  it('뜬 것을 그대로 되부으면 같은 상태가 된다', () => {
    const entries = { 'nikke-state-v1': '{"decks":[1]}', 'nikke-presets-v1': '[{"name":"가"}]' };
    const file = buildBackup(store(entries));
    const back: Record<string, string> = {};
    const done = applyBackup(readBackup(JSON.stringify(file)).data, (k, v) => { back[k] = v; });
    expect(done).toBe(2);
    expect(back).toEqual(entries);
  });

  it('저장소가 꽉 차도 넣을 수 있는 만큼은 넣는다', () => {
    const done = applyBackup({ a: '1', b: '2' }, (key) => {
      if (key === 'a') throw new Error('꽉 참');
    });
    expect(done).toBe(1);
  });
});

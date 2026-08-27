import { describe, expect, it } from 'vitest';

import {
  buildJobs, deckForMember, estimateScanSeconds, groupResults, humanSeconds,
  parseMemberList, readBossCode, readDeckCode, remainingSeconds,
} from './union-raid';
import type { BossSlot, JobResult, MemberRow } from './union-raid';
import { encodeBattleCode, encodeShareCode } from './share-code';
import type { BattleSettings, DeckState } from './types';

const battle: BattleSettings = {
  duration: 90, synchroLevel: 400, enemyDef: 31_784, enemyCode: '전격', coreEnabled: false,
  corePx: 52, hasParts: false, seed: 42, optimalRangeWeapons: [], normalHitCoeff: {},
  immuneWindows: [], elementWindows: [], rngMode: 'expected', immuneBlocksBurst: false,
  console: { common_level: 0, class_level: {}, company_level: {} }, burstRegenTime: 1,
  burstReaction: 0.05,
};

const member = (over: Partial<MemberRow> = {}): MemberRow => ({
  name: '김붕붕', openid: '10620366463748434922', synchro: 843, level: 894, area: 83,
  state: 'public', picked: true, ...over,
});

describe('유니온 명단 읽기', () => {
  it('블라블라링크 응답을 그대로 붙여넣어도 읽는다', () => {
    const raw = JSON.stringify({
      code: 0, msg: 'ok',
      data: {
        guild_id: '5690', nikke_area_id: 83,
        items: [
          { nickname: '모래마녀', member_id: '12510910120603196324', synchro_level: 1082, level: 918, bind_area_id: 83 },
          { nickname: '팡머', member_id: '4135413158395518039', synchro_level: 842, level: 910, bind_area_id: 83 },
        ],
      },
    });
    expect(parseMemberList(raw)).toEqual([
      { name: '모래마녀', openid: '12510910120603196324', synchro: 1082, level: 918, area: 83 },
      { name: '팡머', openid: '4135413158395518039', synchro: 842, level: 910, area: 83 },
    ]);
  });

  it('안쪽 배열만 떼어 왔어도, 손으로 적은 표여도 받아 준다', () => {
    const inner = parseMemberList('[{"nickname":"우이","member_id":"10275666595543253798","synchro_level":873}]');
    expect(inner[0]!.name).toBe('우이');
    const table = parseMemberList('라코프\t9448586161078717048\t872\t912\t83\n빈 줄\n');
    expect(table).toEqual([{ name: '라코프', openid: '9448586161078717048', synchro: 872, level: 912, area: 83 }]);
  });

  it('같은 사람이 두 번 들어와도 한 번만 센다', () => {
    const twice = parseMemberList(JSON.stringify([
      { nickname: '우이', member_id: '1027', synchro_level: 873 },
      { nickname: '우이(중복)', member_id: '1027', synchro_level: 873 },
    ]));
    expect(twice).toHaveLength(1);
  });

  it('로그인이 풀린 응답은 그 사실을 말해 준다', () => {
    expect(() => parseMemberList('{"code":1303001,"msg":"user no bind role"}'))
      .toThrow(/user no bind role/);
    expect(() => parseMemberList('   ')).toThrow(/비어 있습니다/);
    expect(() => parseMemberList('아무 말이나')).toThrow(/알아보지 못했습니다/);
  });
});

describe('보스·덱 칸', () => {
  it('전투 조건 코드를 읽고, 싱크로·콘솔은 0으로 자리를 채워 둔다', () => {
    // 싱크로와 콘솔은 코드에 담기지 않는다 — 유니온원마다 자기 것으로 덮어야 한다.
    // 자리를 «비우면» 엔진이 빠진 소속이라며 거절하므로, 0을 적어 둔다.
    const code = encodeBattleCode(battle);
    const slot = readBossCode({ name: '', code, enabled: true, decks: [] });
    expect(slot.error).toBeUndefined();
    expect(slot.battle?.duration).toBe(90);
    expect(slot.battle?.enemyCode).toBe('전격');
    expect(slot.battle?.console.common_level).toBe(0);
    expect(Object.keys(slot.battle!.console.class_level).sort())
      .toEqual(['방어형', '지원형', '화력형']);
    expect(Object.values(slot.battle!.console.company_level).every((level) => level === 0)).toBe(true);
  });

  it('빈 칸은 오류가 아니고, 망가진 코드는 이유를 남긴다', () => {
    expect(readBossCode({ name: '', code: '  ', enabled: true, decks: [] }).error).toBeUndefined();
    expect(readBossCode({ name: '', code: 'NK3-쓰레기', enabled: true, decks: [] }).error).toMatch(/해석/);
  });

  it('조합 코드에서 니케 다섯을 뽑는다', () => {
    const deck: DeckState = { id: 1, squad: ['리타', '라피', '', '', ''], characters: {} };
    const code = encodeShareCode([deck], false);
    const slot = readDeckCode({ code }, ['리타', '라피']);
    expect(slot.squad?.slice(0, 2)).toEqual(['리타', '라피']);
    expect(slot.error).toBeUndefined();
  });
});

describe('돌릴 것 늘어놓기', () => {
  const bossWith = (over: Partial<BossSlot> = {}): BossSlot => ({
    name: '보스', code: 'x', enabled: true, battle,
    decks: [{ code: 'a', squad: ['리타', '라피', '', '', ''] }], ...over,
  });

  it('체크 해제한 보스는 아예 돌리지 않는다', () => {
    const jobs = buildJobs([member()], [bossWith({ name: '켠 보스' }), bossWith({ name: '끈 보스', enabled: false })]);
    expect(jobs.map((job) => job.bossName)).toEqual(['켠 보스']);
  });

  it('공개가 아니거나 체크 안 한 유니온원도 건너뛴다', () => {
    const rows = [member({ name: '공개' }), member({ name: '비공개', openid: '2', state: 'private' }),
      member({ name: '뺀 사람', openid: '3', picked: false })];
    expect(buildJobs(rows, [bossWith()]).map((job) => job.member.name)).toEqual(['공개']);
  });

  it('이름 없는 보스 칸에는 번호를 붙인다', () => {
    const jobs = buildJobs([member()], [bossWith({ name: '   ' })]);
    expect(jobs[0]!.bossName).toBe('보스 1');
  });
});

describe('유니온원 로스터로 덱 짜기', () => {
  it('안 가진 니케가 있으면 이름을 돌려준다 — 기본 스펙으로 채우지 않는다', () => {
    const roster = { 리타: { growthStage: 3 } };
    const { deck, missing } = deckForMember(['리타', '라피', '', '', ''], roster);
    expect(missing).toEqual(['라피']);
    expect(Object.keys(deck.characters)).toEqual(['리타']);
    expect(deck.squad).toEqual(['리타', '라피', '', '', '']);
  });
});

describe('결과 접기', () => {
  it('유니온원 → 보스 → 덱 순서로 접는다', () => {
    const job = (name: string, bossIndex: number, bossName: string, deckIndex: number) => ({
      member: member({ name, openid: name }), bossIndex, bossName, deckIndex,
      squad: ['리타'], battle,
    });
    const results: JobResult[] = [
      { job: job('가', 1, '2보스', 1), damage: 20 },
      { job: job('가', 0, '1보스', 1), damage: 10 },
      { job: job('가', 0, '1보스', 0), damage: 30 },
      { job: job('나', 0, '1보스', 0), missing: ['라피'] },
    ];
    const reports = groupResults(results);
    expect(reports.map((report) => report.member.name)).toEqual(['가', '나']);
    expect(reports[0]!.bosses.map((boss) => boss.name)).toEqual(['1보스', '2보스']);
    expect(reports[0]!.bosses[0]!.rows.map((row) => row.damage)).toEqual([30, 10]);
    expect(reports[1]!.bosses[0]!.rows[0]!.missing).toEqual(['라피']);
  });
});

describe('시간 안내', () => {
  it('스캔 시간은 인원에 비례하고, 사람이 읽는 말로 적는다', () => {
    expect(estimateScanSeconds(0)).toBe(0);
    expect(estimateScanSeconds(32)).toBe(57);          // 둘씩 동시 + 간격 · 실측과 같은 자릿수
    expect(humanSeconds(45)).toBe('45초');
    expect(humanSeconds(80)).toBe('1분 20초');
    expect(humanSeconds(120)).toBe('2분');
  });

  it('남은 시간은 이미 돌린 것으로 어림한다', () => {
    expect(remainingSeconds(0, 10, 0)).toBe(0);
    expect(remainingSeconds(2, 10, 4000)).toBe(16);    // 한 판 2초 × 남은 8판
  });
});

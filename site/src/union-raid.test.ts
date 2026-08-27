import { describe, expect, it } from 'vitest';

import {
  buildJobs, deckForMember, estimateScanSeconds, groupResults, humanSeconds,
  DIRECT_SNIPPET, MEMBER_SNIPPET, parseDirectScan, parseMemberList, readBossCode, readDeckCode,
  readUnionCode, remainingSeconds, unionCodeOf, unionShareOf,
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

describe('명단 스니펫', () => {
  it('유니온 정보가 data.card에 있다는 것을 안다', () => {
    // 처음엔 `data.guild_info`로 짚었다가 유니온원 0명을 담았다(실측 2026-08-27).
    // 실제 응답은 `data.card`다 — 다른 모양도 함께 받아 두되 card가 먼저다.
    expect(MEMBER_SNIPPET).toContain('box.card');
    expect(MEMBER_SNIPPET.indexOf('box.card')).toBeLessThan(MEMBER_SNIPPET.indexOf('box.guild_info'));
    expect(MEMBER_SNIPPET).toContain('Game/GetGuildMembers');
  });

  it('두 스니펫 다 문법이 성립한다', () => {
    // `const box`를 한 스코프에 두 번 적어 «Identifier has already been declared»로
    // 스니펫이 통째로 안 돌던 적이 있다(2026-08-27). 문법은 사람 눈으로 지키지 않는다.
    // 컴파일만 하고 실행하지는 않는다 — 여기서 블라블라링크를 부를 일은 없다.
    for (const snippet of [MEMBER_SNIPPET, DIRECT_SNIPPET]) {
      expect(() => new Function(`return (async () => { ${snippet} })()`)).not.toThrow();
    }
  });

  it('클립보드가 막혀도 길이 있다', () => {
    // 콘솔에서 실행하면 문서가 포커스를 잃어 `navigator.clipboard`가 거절된다.
    // 데브툴의 `copy()`를 먼저 쓰고, 둘 다 막히면 페이지에 상자를 띄워 골라 둔다 —
    // 「우클릭 → Copy string contents」는 엣지에 없어서 길로 삼을 수 없다.
    expect(MEMBER_SNIPPET).toContain('copy(text)');
    expect(MEMBER_SNIPPET).toContain('navigator.clipboard.writeText');
    expect(MEMBER_SNIPPET).toContain('createElement(\'textarea\')');
    expect(MEMBER_SNIPPET).toContain('holder.select()');
    expect(MEMBER_SNIPPET).not.toContain('Copy string contents');
  });

  it('띄운 상자는 눈에 보이는 길로 닫힌다', () => {
    // Esc만 두면 상자 밖을 눌러 포커스를 잃은 사람은 닫을 방법이 없다(제보 2026-08-27).
    for (const snippet of [MEMBER_SNIPPET, DIRECT_SNIPPET]) {
      expect(snippet).toContain("close.textContent = '✕'");
      expect(snippet).toContain('close.addEventListener(\'click\', shut)');
      expect(snippet).toContain("ev.key === 'Escape'");
      expect(snippet).toContain('wrap.remove()');
    }
  });

  it('스니펫이 뱉는 모양을 그대로 읽는다', () => {
    const spat = JSON.stringify({
      guild_name: '니삭스',
      items: [{ nickname: '모래마녀', member_id: '12510910120603196324', synchro_level: 1082, level: 918, bind_area_id: 83 }],
    });
    expect(parseMemberList(spat)).toEqual([
      { name: '모래마녀', openid: '12510910120603196324', synchro: 1082, level: 918, area: 83 },
    ]);
  });
});

describe('직접 긁기', () => {
  const packed = {
    v: 1,
    guild_name: '니삭스',
    members: [
      { name: '유니온만공개', openid: '111', synchro: 900, level: 910, area: 83, state: 'public',
        profile: { openid: '111', areas: [{ area: 83, characters: [], details: [], stateEffects: [], outpost: null }] } },
      { name: '진짜비공개', openid: '222', synchro: 800, level: 900, area: 83, state: 'private', note: '1301002' },
    ],
  };

  it('날 JSON도 읽는다 — gzip을 못 쓰는 브라우저를 위한 길이다', async () => {
    const rows = await parseDirectScan(JSON.stringify(packed));
    expect(rows.map((row) => [row.name, row.state]))
      .toEqual([['유니온만공개', 'public'], ['진짜비공개', 'private']]);
    expect(rows[0]!.profile).toBeTruthy();
    expect(rows[1]!.note).toBe('1301002');
  });

  it('gzip+base64로 눌러 온 것도 푼다', async () => {
    // 스니펫이 실제로 만드는 모양 — 200종 상세 32명치는 눌러야 붙여넣을 크기가 된다.
    const gz = new Blob([JSON.stringify(packed)]).stream()
      .pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(gz).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const rows = await parseDirectScan(`NKU1-${btoa(binary)}`);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.synchro).toBe(900);
  });

  it('잘려 온 자료와 빈 자료는 그 사실을 말해 준다', async () => {
    await expect(parseDirectScan('NKU1-이건망가진것')).rejects.toThrow(/푸는 데 실패/);
    await expect(parseDirectScan('  ')).rejects.toThrow(/비어 있습니다/);
    await expect(parseDirectScan('{"members":[]}')).rejects.toThrow(/찾지 못했습니다/);
  });

  it('스니펫이 프록시를 거치지 않고 직접 부른다', () => {
    // 이 길이 있는 이유는 하나다 — 「유니온원에게만 공개」는 우리 프록시 계정이 못 본다.
    expect(DIRECT_SNIPPET).toContain('Game/GetUserCharacterDetails');
    expect(DIRECT_SNIPPET).toContain('Game/GetUserProfileOutpostInfo');
    expect(DIRECT_SNIPPET).toContain('credentials: \'include\'');
    expect(DIRECT_SNIPPET).toContain('NKU1-');
    expect(DIRECT_SNIPPET).not.toContain('workers.dev');
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

  it('사람마다 보스를 갈라 맡길 수 있다', () => {
    // 아래 보스 체크가 켜져 있어도, 그 사람에게서 뺐으면 안 돌린다.
    const rows = [member({ name: '풍압만', openid: '1', bossPicks: { 1: false } }),
      member({ name: '둘 다', openid: '2' })];
    const jobs = buildJobs(rows, [bossWith({ name: '1보스' }), bossWith({ name: '2보스' })]);
    expect(jobs.map((job) => `${job.member.name}/${job.bossName}`))
      .toEqual(['풍압만/1보스', '둘 다/1보스', '둘 다/2보스']);
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

  it('로스터 자체가 없으면(개인용·CSV 미입력) 기본 스펙으로 돌린다', () => {
    // 그때 빠진 이름은 «못 가졌다»가 아니라 «모른다»다. 전부 미보유로 막으면
    // 개인용 모드가 한 판도 못 돈다.
    const { deck, missing } = deckForMember(['리타', '라피', '', '', ''], {}, true);
    expect(missing).toEqual([]);
    expect(deck.squad).toEqual(['리타', '라피', '', '', '']);
    expect(Object.keys(deck.characters)).toEqual([]);
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

describe('유니온 판 코드 (NK4)', () => {
  const NAMES = ['리타', '라피', '크라운', '앨리스'];
  const deckCode = (squad: string[]): string =>
    encodeShareCode([{ id: 1, squad, characters: {} } as DeckState], false);

  const board = (): BossSlot[] => [
    {
      name: '작열 글러트니', code: encodeBattleCode({ ...battle, enemyCode: '작열' }),
      enabled: true,
      decks: [
        { code: deckCode(['리타', '라피', '', '', '']) },
        { code: deckCode(['크라운', '앨리스', '', '', '']) },
        { code: '' },
      ],
    },
    {
      name: '전격 기차', code: encodeBattleCode(battle), enabled: false,
      decks: [{ code: deckCode(['앨리스', '', '', '', '']) }, { code: '' }, { code: '' }],
    },
    ...Array.from({ length: 3 }, () => ({
      name: '', code: '', enabled: true,
      decks: [{ code: '' }, { code: '' }, { code: '' }],
    })),
  ];

  it('판을 코드로 냈다가 그대로 되살린다', () => {
    const back = readUnionCode(unionCodeOf(board()), NAMES);

    expect(back).toHaveLength(5);
    expect(back[0]!.name).toBe('작열 글러트니');
    expect(back[0]!.enabled).toBe(true);
    expect(back[0]!.battle?.enemyCode).toBe('작열');
    expect(back[0]!.decks[0]!.squad?.slice(0, 2)).toEqual(['리타', '라피']);
    expect(back[0]!.decks[1]!.squad?.slice(0, 2)).toEqual(['크라운', '앨리스']);
    expect(back[0]!.decks[2]!.squad).toBeUndefined();

    expect(back[1]!.name).toBe('전격 기차');
    expect(back[1]!.enabled).toBe(false);        // 꺼 둔 보스는 꺼진 채로 온다
    expect(back[1]!.battle?.enemyCode).toBe('전격');
  });

  it('빈 보스 칸은 꺼진 채로 온다 — 지난 판이 섞이지 않게', () => {
    const back = readUnionCode(unionCodeOf(board()), NAMES);
    expect(back[2]!.enabled).toBe(false);
    expect(back[2]!.name).toBe('');
    expect(back[2]!.decks).toHaveLength(3);
    expect(back[4]!.enabled).toBe(false);
  });

  it('명단은 담지 않는다', () => {
    const share = unionShareOf(board());
    const dump = JSON.stringify(share);
    expect(dump).not.toContain('openid');
    expect(dump).not.toContain('김붕붕');
    expect(Object.keys(share)).toEqual(['bosses']);
  });

  it('덱 칸은 언제나 셋으로 채워 온다 — 코드에 하나만 들었어도', () => {
    const one = unionCodeOf([{
      name: '수냉 니힐', code: encodeBattleCode(battle), enabled: true,
      decks: [{ code: deckCode(['리타', '', '', '', '']) }],
    }]);
    const back = readUnionCode(one, NAMES);
    expect(back[0]!.decks).toHaveLength(3);
    expect(back[0]!.decks[1]!.code).toBe('');
  });

  it('종류가 다른 코드는 거절한다', () => {
    expect(() => readUnionCode(encodeBattleCode(battle), NAMES)).toThrow(/NK4/);
  });
});

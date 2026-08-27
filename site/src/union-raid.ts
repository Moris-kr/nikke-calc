/**
 * 유니온 레이드 (BETA) — 유니온원 각자의 실제 스펙으로 같은 보스·같은 덱을 돌려
 * «누가 얼마나 기여할 수 있나»를 견준다.
 *
 * 데이터가 오는 길이 둘로 갈린다. 그 이유를 여기 적어 둔다:
 *
 *   명단(닉네임·openid·싱크로) → **본인 브라우저에서만** 온다.
 *       `Game/GetGuildMembers`는 호출자가 게임 계정에 묶인 로그인이어야 한다.
 *       우리 프록시 계정은 게임 롤이 없어 `user no bind role`로 거부된다(실측
 *       2026-08-27). 그래서 붙여넣기로 받는다 — 쿠키를 우리가 만지지 않는 길이다.
 *
 *   유니온원 스펙(니케·장비·오버로드·콘솔) → 기존 프록시로 온다.
 *       공개 계정은 그대로 오고, 비공개는 `1301002`로 막힌다. 그 갈림이 곧 «공개여부»다.
 *
 * 보스와 덱은 **공유 코드**로 채운다(전투 조건 `NK3-`, 조합 `NK2-`). 이미 있는 문법을
 * 그대로 쓰면 유니온원끼리 세팅을 주고받기도 쉽고, 이 탭이 편집기를 새로 만들지 않아도 된다.
 */

import {
  decodeBattleCode, decodeShareCode, decodeUnionCode, encodeUnionCode,
  type UnionShare,
} from './share-code';
import { DEFAULT_SYNCHRO_LEVEL, SYNCHRO_MEASURED_MAX } from './model';
import type { BattleSettings, DeckState, SimulationResult } from './types';

/** 유니온원 한 명. `GetGuildMembers`가 주는 것만 담는다. */
export interface UnionMember {
  name: string;
  /** `member_id` — 프로필 조회에 쓰는 intl_open_id다. */
  openid: string;
  /** 싱크로 디바이스 레벨. 계산에 그대로 반영한다(400 고정이 아니다). */
  synchro: number;
  /** 계정 레벨. 화면 참고용이다. */
  level: number;
  /** `bind_area_id` — 서버. 스펙 조회에 넣어야 5개 서버를 다 뒤지지 않는다. */
  area: number;
}

/** 공개여부 스캔 결과. */
export type MemberState = 'unknown' | 'scanning' | 'public' | 'private' | 'error';

export interface MemberRow extends UnionMember {
  state: MemberState;
  /** 공개일 때 계산기가 다루는 니케 수. */
  owned?: number;
  /** 비공개·오류일 때 사람에게 보여 줄 한 줄. */
  note?: string;
  /** 계산에 넣을지. 공개인 사람만 켤 수 있다. */
  picked: boolean;
  /**
   * 이 사람에게 어느 보스를 맡길지. 보스 번호(0~4) → 켬/끔이고, 안 적힌 보스는 켠 것으로 친다.
   * 풍압엔 강한데 전격엔 약한 사람이 있어서, 보스별로 사람을 갈라 맡길 수 있어야 한다.
   */
  bossPicks?: Record<number, boolean>;
}

/** 보스 한 칸. 체크를 끄면 그 보스는 통째로 건너뛴다. */
export interface BossSlot {
  name: string;
  code: string;
  enabled: boolean;
  battle?: BattleSettings;
  /** 코드가 잘못됐을 때의 사유. */
  error?: string;
  decks: DeckSlot[];
}

/** 덱 한 칸. 니케 이름 다섯만 쓴다 — 수치는 유니온원 각자의 것을 쓴다. */
export interface DeckSlot {
  code: string;
  squad?: string[];
  error?: string;
}

export const BOSS_SLOTS = 5;
export const DECK_SLOTS = 3;

/**
 * 명단을 뜨는 한 줄. 유니온 스퀘어에 **로그인한 채로** 콘솔에 붙여넣으면
 * 명단 JSON이 클립보드에 담긴다. 여기서 하는 일은 그 페이지가 이미 하는 호출 하나뿐이고,
 * 쿠키는 브라우저가 알아서 싣는다 — 우리가 받아 보관하는 값이 아니다.
 */
/**
 * 클립보드가 둘 다 막혔을 때 페이지에 띄우는 상자. 두 스니펫이 같이 쓴다.
 *
 * 닫는 길을 **눈에 보이게** 둔다 — Esc만 두면 상자 밖을 눌러 포커스를 잃은 사람은
 * 닫을 방법이 없다(실제로 그런 제보가 왔다). ✕ 단추, Esc, 바깥 누르기 셋 다 받는다.
 */
const COPY_BOX = `
  const wrap = document.createElement('div');
  wrap.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:rgba(2,7,13,.72);display:flex;align-items:center;justify-content:center');
  const card = document.createElement('div');
  card.setAttribute('style', 'width:90%;max-width:900px;background:#0b1420;border:2px solid #45d6d0;padding:12px;box-shadow:0 20px 60px rgba(0,0,0,.5)');
  const head = document.createElement('div');
  head.setAttribute('style', 'display:flex;align-items:center;gap:10px;margin-bottom:8px;color:#cfeceb;font:700 13px system-ui,sans-serif');
  const title = document.createElement('span');
  title.textContent = '계산기에 붙여넣을 내용 — Ctrl+A → Ctrl+C';
  const close = document.createElement('button');
  close.textContent = '✕';
  close.setAttribute('style', 'margin-left:auto;width:30px;height:30px;cursor:pointer;background:transparent;border:1px solid rgba(146,176,201,.4);color:#cfeceb;font:700 14px system-ui,sans-serif');
  close.title = '닫기 (Esc)';
  head.appendChild(title); head.appendChild(close);
  const holder = document.createElement('textarea');
  holder.value = text;
  holder.setAttribute('style', 'width:100%;height:52vh;padding:10px;font:12px ui-monospace,monospace;background:#03090f;color:#e8f1f8;border:1px solid rgba(146,176,201,.25);resize:vertical');
  card.appendChild(head); card.appendChild(holder); wrap.appendChild(card);
  document.body.appendChild(wrap);
  holder.focus(); holder.select();
  try { document.execCommand('copy'); } catch (e) {}
  const shut = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); shut(); } };
  close.addEventListener('click', shut);
  wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap) shut(); });
  document.addEventListener('keydown', onKey, true);
`;

export const MEMBER_SNIPPET = `await (async () => {
  const call = async (route, body) => (await fetch('https://api.blablalink.com/api/game/proxy/' + route, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Channel-Type': '2', 'X-Language': 'ko',
      'X-Common-Params': JSON.stringify({ game_id: '29080', area_id: 'global', source: 'pc_web', intl_game_id: '29080', language: 'ko', env: 'prod' }) },
    body: JSON.stringify(body),
  })).json();
  const mine = await call('Game/GetMyGuildInfo', { latest: false });
  const box = mine.data || {};
  const info = box.card || box.guild_info || box.guild_detail || box;
  if (!info.guild_id) { console.error('유니온을 찾지 못했습니다:', mine.msg || mine.code, '— 로그인한 채 유니온 스퀘어에서 실행해 주세요.'); return; }
  const members = await call('Game/GetGuildMembers', { guild_id: String(info.guild_id), nikke_area_id: String(info.nikke_area_id || '') });
  const items = (members.data || {}).items || [];
  if (!items.length) { console.error('명단이 비어 있습니다:', members.msg || members.code); return; }
  const text = JSON.stringify({ guild_name: info.guild_name, items: items });
  const done = (how) => console.log(info.guild_name + ' · 유니온원 ' + items.length + '명 ' + how);
  try { copy(text); done('을 클립보드에 담았습니다. 계산기에 붙여넣으세요.'); return; } catch (e) {}
  try { await navigator.clipboard.writeText(text); done('을 클립보드에 담았습니다. 계산기에 붙여넣으세요.'); return; } catch (e) {}
  // 클립보드가 둘 다 막히면(콘솔에 포커스가 있으면 그렇다) 페이지에 상자를 띄우고
  // 내용을 통째로 골라 둔다 — 브라우저마다 이름이 다른 우클릭 메뉴를 찾을 필요가 없다.
  ${COPY_BOX}
  done('을 페이지 상자에 띄웠습니다. Ctrl+A → Ctrl+C로 복사해 계산기에 붙여넣고, ✕나 Esc로 닫으세요.');
})();`;

/**
 * 직접 긁기 스니펫. **저희 프록시를 거치지 않고** 지휘관님 세션으로 유니온원 스펙을
 * 그대로 받아 온다. 이 길이 따로 있어야 하는 이유는 하나다 —
 * 「유니온원에게만 공개」로 둔 사람은 우리 프록시 계정(그 유니온 소속이 아니다)이
 * 영원히 못 본다. 같은 유니온인 지휘관님 브라우저만 볼 수 있다.
 *
 * 200종 상세를 32명치 받으면 12MB가 넘는다. 계산에 쓰는 칸만 남기고(26%) gzip으로
 * 눌러 base64로 옮긴다 — 한 명에 9KB, 32명이면 300KB쯤이라 붙여넣기로 옮길 수 있다.
 */
export const DIRECT_SNIPPET = `await (async () => {
  const call = async (route, body) => (await fetch('https://api.blablalink.com/api/game/proxy/' + route, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Channel-Type': '2', 'X-Language': 'ko',
      'X-Common-Params': JSON.stringify({ game_id: '29080', area_id: 'global', source: 'pc_web', intl_game_id: '29080', language: 'ko', env: 'prod' }) },
    body: JSON.stringify(body),
  })).json();
  const gap = (ms) => new Promise((done) => setTimeout(done, ms));

  const mine = await call('Game/GetMyGuildInfo', { latest: false });
  const box0 = mine.data || {};
  const info = box0.card || box0.guild_info || box0.guild_detail || box0;
  if (!info.guild_id) { console.error('유니온을 찾지 못했습니다:', mine.msg || mine.code); return; }
  const list = await call('Game/GetGuildMembers', { guild_id: String(info.guild_id), nikke_area_id: String(info.nikke_area_id || '') });
  const roster = (list.data || {}).items || [];
  if (!roster.length) { console.error('명단이 비어 있습니다:', list.msg || list.code); return; }

  const PARTS = ['head', 'torso', 'arm', 'leg'];
  const KEEP = ['name_code', 'skill1_lv', 'skill2_lv', 'ulti_skill_lv', 'favorite_item_tid',
    'favorite_item_lv', 'harmony_cube_tid', 'harmony_cube_lv'];
  for (const part of PARTS) {
    KEEP.push(part + '_equip_tier', part + '_equip_lv',
      part + '_equip_option1_id', part + '_equip_option2_id', part + '_equip_option3_id');
  }
  const slimDetail = (detail) => {
    const out = {};
    for (const key of KEEP) if (detail[key]) out[key] = detail[key];
    return out;
  };

  const members = [];
  for (let i = 0; i < roster.length; i += 1) {
    const person = roster[i];
    const area = person.bind_area_id;
    const row = { name: person.nickname, openid: String(person.member_id),
      synchro: person.synchro_level || 0, level: person.level || 0, area: area, state: 'private' };
    try {
      await gap(500);
      const chars = await call('Game/GetUserCharacters', { intl_open_id: row.openid, nikke_area_id: area });
      const characters = chars.code === 0 ? ((chars.data || {}).characters || []) : [];
      if (characters.length === 0) {
        row.note = chars.msg || String(chars.code || '');
      } else {
        const codes = characters.map((c) => c.name_code);
        const details = [], effects = [];
        for (let at = 0; at < codes.length; at += 60) {
          await gap(500);
          const chunk = await call('Game/GetUserCharacterDetails',
            { intl_open_id: row.openid, nikke_area_id: area, name_codes: codes.slice(at, at + 60) });
          const data = chunk.data || {};
          for (const d of data.character_details || []) details.push(slimDetail(d));
          for (const e of data.state_effects || []) {
            const first = (e.function_details || [])[0] || {};
            effects.push({ id: e.id, function_details: [{ function_type: first.function_type, function_value: first.function_value }] });
          }
        }
        let outpost = null;
        try {
          await gap(500);
          const info2 = await call('Game/GetUserProfileOutpostInfo', { intl_open_id: row.openid, nikke_area_id: area });
          const got = (info2.data || {}).outpost_info;
          if (got) outpost = { recycle_room_researches: (got.recycle_room_researches || []).map((r) => ({ tid: r.tid, lv: r.lv })), synchro_level: got.synchro_level };
        } catch (e) {}
        row.state = 'public';
        row.profile = { openid: row.openid, areas: [{ area: area,
          characters: characters.map((c) => ({ name_code: c.name_code, grade: c.grade, core: c.core })),
          details: details, stateEffects: effects, outpost: outpost }] };
      }
    } catch (e) { row.state = 'error'; row.note = String(e).slice(0, 80); }
    members.push(row);
    console.log((i + 1) + '/' + roster.length + ' ' + row.name + ' · ' + (row.state === 'public' ? '공개' : row.state === 'error' ? '오류' : '비공개'));
  }

  const packed = JSON.stringify({ v: 1, guild_name: info.guild_name, members: members });
  let text = packed;
  if (typeof CompressionStream === 'function') {
    const gz = new Blob([packed]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(gz).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    text = 'NKU1-' + btoa(binary);
  }
  const open = members.filter((m) => m.state === 'public').length;
  const done = (how) => console.log('유니온원 ' + members.length + '명(공개 ' + open + '명) ' + how);
  try { copy(text); done('을 클립보드에 담았습니다. 계산기에 붙여넣으세요.'); return; } catch (e) {}
  try { await navigator.clipboard.writeText(text); done('을 클립보드에 담았습니다. 계산기에 붙여넣으세요.'); return; } catch (e) {}
  ${COPY_BOX}
  done('을 페이지 상자에 띄웠습니다. Ctrl+A → Ctrl+C로 복사해 계산기에 붙여넣고, ✕나 Esc로 닫으세요.');
})();`;

/** 직접 긁어 온 유니온원 한 명. `profile`은 `areaToOverrides`가 그대로 먹는 모양이다. */
export interface DirectMember {
  name: string;
  openid: string;
  synchro: number;
  level: number;
  area: number;
  state: 'public' | 'private' | 'error';
  note?: string;
  profile?: { openid: string; areas: unknown[] };
}

/** 직접 긁기 결과를 푼다. `NKU1-`은 gzip+base64, 아니면 날 JSON이다. */
export async function parseDirectScan(text: string): Promise<DirectMember[]> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('붙여넣은 내용이 비어 있습니다.');
  let json = trimmed;
  if (trimmed.startsWith('NKU1-')) {
    try {
      const binary = atob(trimmed.slice(5));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      json = await new Response(stream).text();
    } catch {
      throw new Error('직접 긁은 자료를 푸는 데 실패했습니다. 복사가 중간에 잘리지 않았는지 확인해 주세요.');
    }
  }
  let box: { members?: unknown };
  try {
    box = JSON.parse(json) as { members?: unknown };
  } catch {
    throw new Error('직접 긁은 자료를 알아보지 못했습니다. 스니펫이 준 내용을 통째로 붙여넣어 주세요.');
  }
  const rows = Array.isArray(box.members) ? box.members : [];
  const out: DirectMember[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, any>;
    const openid = String(row.openid ?? '').trim();
    const name = String(row.name ?? '').trim();
    if (!name || !/^\d+$/.test(openid)) continue;
    out.push({
      name,
      openid,
      synchro: num(row.synchro, 0),
      level: num(row.level, 0),
      area: num(row.area, 0),
      state: row.state === 'public' ? 'public' : row.state === 'error' ? 'error' : 'private',
      note: typeof row.note === 'string' && row.note ? row.note : undefined,
      profile: row.profile,
    });
  }
  if (out.length === 0) throw new Error('직접 긁은 자료에서 유니온원을 찾지 못했습니다.');
  return out;
}

const num = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * 붙여넣은 것을 명단으로 읽는다. 받아들이는 모양 셋:
 *   `{data:{items:[...]}}`  — API 응답 그대로 (스니펫이 주는 것)
 *   `{items:[...]}` / `[...]` — 안쪽만 떼어 온 경우
 *   탭·쉼표로 나눈 표 — 손으로 정리해 온 경우 (이름, openid, 싱크로)
 * 사람이 옮겨 붙이다 어디까지 집었는지 알 수 없으니, 셋 다 받아 준다.
 */
export function parseMemberList(text: string): UnionMember[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('붙여넣은 내용이 비어 있습니다.');

  let items: unknown[] | null = null;
  try {
    const raw = JSON.parse(trimmed) as unknown;
    if (Array.isArray(raw)) items = raw;
    else if (raw && typeof raw === 'object') {
      const box = raw as Record<string, any>;
      if (box.code !== undefined && box.code !== 0 && !box.data) {
        throw new Error(`블라블라링크가 «${box.msg ?? box.code}»를 돌려줬습니다. 로그인한 채로 다시 떠 주세요.`);
      }
      const found = box.data?.items ?? box.items ?? box.data?.members ?? box.members;
      if (Array.isArray(found)) items = found;
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('블라블라링크')) throw error;
    items = null;                                  // JSON이 아니면 표로 읽어 본다
  }

  if (items) {
    const rows = items
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        name: String(item.nickname ?? item.name ?? '').trim(),
        openid: String(item.member_id ?? item.intl_open_id ?? item.openid ?? '').trim(),
        synchro: num(item.synchro_level ?? item.synchro, 0),
        level: num(item.level, 0),
        area: num(item.bind_area_id ?? item.nikke_area_id ?? item.area, 0),
      }))
      .filter((row) => row.name && /^\d+$/.test(row.openid));
    if (rows.length === 0) throw new Error('명단에서 유니온원을 찾지 못했습니다. 스니펫이 알려 준 내용을 그대로 붙여넣어 주세요.');
    return dedupe(rows);
  }

  const rows: UnionMember[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const cells = line.split(/\t|,/).map((cell) => cell.trim());
    const openid = cells.find((cell) => /^\d{6,}$/.test(cell));
    const name = cells.find((cell) => cell && cell !== openid);
    if (!openid || !name) continue;
    const numbers = cells.filter((cell) => cell !== openid && /^\d+$/.test(cell)).map(Number);
    rows.push({ name, openid, synchro: numbers[0] ?? 0, level: numbers[1] ?? 0, area: numbers[2] ?? 0 });
  }
  if (rows.length === 0) {
    throw new Error('명단을 알아보지 못했습니다. 아래 스니펫을 유니온 스퀘어에서 실행한 결과를 붙여넣어 주세요.');
  }
  return dedupe(rows);
}

const dedupe = (rows: UnionMember[]): UnionMember[] => {
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.openid) ? false : (seen.add(row.openid), true)));
};

/**
 * 공개여부 스캔에 걸리는 시간(초). 실측(2026-08-27, 3명 동시)에서
 * 비공개는 0.7초, 공개는 니케 200종 상세까지 받느라 4~6초였다.
 * 몇 명이 공개인지는 해 봐야 아는 값이라, 절반이 공개라고 보고 어림한다.
 */
export function estimateScanSeconds(count: number, concurrency = 2): number {
  if (count <= 0) return 0;
  const perMember = (0.7 + 5.0) / 2 + 0.7;      // 조회 + 간격 벌리기
  return Math.max(1, Math.round((count * perMember) / concurrency));
}

/** 「1분 20초」처럼 읽히게. 초 단위는 1분 아래에서만 적는다. */
export function humanSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}초`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes}분` : `${minutes}분 ${rest}초`;
}

/** 보스 칸 하나를 코드에서 읽는다. 빈 칸은 조용히 비운다 — 아직 안 채운 것뿐이다. */
export function readBossCode(slot: BossSlot, synchro = DEFAULT_SYNCHRO_LEVEL): BossSlot {
  const code = slot.code.trim();
  if (!code) return { ...slot, battle: undefined, error: undefined };
  try {
    const share = decodeBattleCode(code);
    // 싱크로와 콘솔은 코드에 담기지 않는다(계정 육성 상태다). 유니온원마다 자기 것으로 덮으므로
    // 여기서는 자리만 채워 둔다.
    return {
      ...slot,
      battle: { ...share, synchroLevel: synchro, console: emptyConsole() },
      error: undefined,
    };
  } catch (error) {
    return { ...slot, battle: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 덱 칸 하나를 조합 코드에서 읽는다. 첫 덱만 쓴다 — 이 칸이 곧 덱 하나다. */
export function readDeckCode(slot: DeckSlot, catalogNames: string[]): DeckSlot {
  const code = slot.code.trim();
  if (!code) return { ...slot, squad: undefined, error: undefined };
  try {
    const payload = decodeShareCode(code, catalogNames);
    const squad = (payload.decks[0]?.squad ?? []).map((name) => name.trim());
    const filled = squad.filter(Boolean);
    if (filled.length === 0) return { ...slot, squad: undefined, error: '코드에 니케가 없습니다.' };
    return { ...slot, squad, error: undefined };
  } catch (error) {
    return { ...slot, squad: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 지금 짜 둔 판을 유니온 판 코드(NK4)로 옮길 모양으로 바꾼다.
 *
 * 코드 문자열만 옮긴다 — 해석된 `battle`·`squad`는 코드에서 다시 나오므로 담지 않는다.
 * **유니온원 명단은 여기 들어가지 않는다.** 닉네임과 openid는 남의 계정 정보다.
 */
export function unionShareOf(bosses: BossSlot[]): UnionShare {
  return {
    bosses: bosses.map((boss) => ({
      name: boss.name,
      enabled: boss.enabled,
      battleCode: boss.code,
      deckCodes: boss.decks.map((deck) => deck.code),
    })),
  };
}

/**
 * 받은 판을 보스 칸으로 편다.
 *
 * 코드에 든 보스가 다섯보다 적으면 **남은 칸은 비운다** — 「지난 시즌 것을 통째로
 * 불러온다」는 뜻인데 이전 판의 3·4번 보스가 남아 있으면 섞인 판이 된다.
 */
export function applyUnionShare(
  share: UnionShare,
  catalogNames: string[],
  synchro = DEFAULT_SYNCHRO_LEVEL,
): BossSlot[] {
  return Array.from({ length: BOSS_SLOTS }, (_, index) => {
    const shared = share.bosses[index];
    const decks = Array.from({ length: DECK_SLOTS }, (_, deckIndex) =>
      readDeckCode({ code: shared?.deckCodes[deckIndex] ?? '' }, catalogNames));
    const slot: BossSlot = {
      name: shared?.name ?? '',
      code: shared?.battleCode ?? '',
      // 코드에 없는 칸은 끈 채로 둔다 — 빈 보스가 켜져 있으면 실행 단추가 헷갈린다.
      enabled: shared?.enabled ?? false,
      decks,
    };
    return { ...readBossCode(slot, synchro), decks };
  });
}

/** 지금 판을 코드 한 줄로. 유니온방에 붙여넣으면 그대로 옮겨진다. */
export function unionCodeOf(bosses: BossSlot[]): string {
  return encodeUnionCode(unionShareOf(bosses));
}

/** 받은 코드를 보스 칸으로. 코드가 잘못되면 던진다 — 잡아서 한 줄로 알린다. */
export function readUnionCode(
  code: string,
  catalogNames: string[],
  synchro = DEFAULT_SYNCHRO_LEVEL,
): BossSlot[] {
  return applyUnionShare(decodeUnionCode(code), catalogNames, synchro);
}

/** 시뮬레이션 한 칸. 유니온원 × 보스 × 덱. */
export interface Job {
  member: MemberRow;
  bossIndex: number;
  bossName: string;
  deckIndex: number;
  squad: string[];
  battle: BattleSettings;
}

/**
 * 돌릴 것을 늘어놓는다. 순서는 **유니온원 → 보스 → 덱**이다 — 결과가 사람 단위로
 * 완성돼 가는 편이, 보스별로 흩어져 채워지는 것보다 기다리는 동안 읽을 것이 된다.
 */
export function buildJobs(members: MemberRow[], bosses: BossSlot[]): Job[] {
  const jobs: Job[] = [];
  for (const member of members) {
    if (!member.picked || member.state !== 'public') continue;
    bosses.forEach((boss, bossIndex) => {
      if (!boss.enabled || !boss.battle) return;
      // 아래 보스 체크가 켜져 있어도, 이 사람에게서 뺐으면 돌리지 않는다.
      if (member.bossPicks?.[bossIndex] === false) return;
      boss.decks.forEach((deck, deckIndex) => {
        if (!deck.squad) return;
        jobs.push({
          member,
          bossIndex,
          bossName: boss.name.trim() || `보스 ${bossIndex + 1}`,
          deckIndex,
          squad: deck.squad,
          battle: boss.battle!,
        });
      });
    });
  }
  return jobs;
}

/** 한 칸의 결과. 못 돌린 이유도 결과의 하나로 남긴다 — 빈칸은 «왜»를 못 말한다. */
export interface JobResult {
  job: Job;
  damage?: number;
  /** 못 돌렸을 때: 미보유 니케 이름들, 또는 오류 한 줄. */
  missing?: string[];
  error?: string;
}

/**
 * 유니온원의 로스터로 덱을 짠다. 안 가진 니케가 하나라도 있으면 **돌리지 않는다** —
 * 없는 니케를 기본 스펙으로 채워 넣으면 «이 사람이 낼 수 있는 딜»이 아니게 된다.
 */
export function deckForMember(
  squad: string[],
  roster: Record<string, DeckState['characters'][string]>,
  allowDefaults = false,
): { deck: DeckState; missing: string[] } {
  const missing: string[] = [];
  const characters: DeckState['characters'] = {};
  for (const name of squad) {
    if (!name) continue;
    const found = roster[name];
    // `allowDefaults`는 «로스터 자체가 없다»는 뜻이다(개인용인데 CSV를 안 넣은 경우).
    // 그때는 못 가진 게 아니라 **모르는** 것이므로 기본 스펙으로 돌린다.
    if (!found) { if (!allowDefaults) missing.push(name); continue; }
    characters[name] = found;
  }
  return { deck: { id: 1, squad: [...squad], characters }, missing };
}

/** 결과를 화면 뼈대대로 «유니온원 → 보스 → 덱»으로 접는다. */
export interface MemberReport {
  member: MemberRow;
  bosses: Array<{ name: string; rows: JobResult[] }>;
}

export function groupResults(results: JobResult[]): MemberReport[] {
  const byMember = new Map<string, MemberReport>();
  for (const result of results) {
    const key = result.job.member.openid;
    let report = byMember.get(key);
    if (!report) {
      report = { member: result.job.member, bosses: [] };
      byMember.set(key, report);
    }
    let boss = report.bosses.find((entry) => entry.name === result.job.bossName);
    if (!boss) {
      boss = { name: result.job.bossName, rows: [] };
      report.bosses.push(boss);
    }
    boss.rows.push(result);
  }
  for (const report of byMember.values()) {
    for (const boss of report.bosses) boss.rows.sort((a, b) => a.job.deckIndex - b.job.deckIndex);
    report.bosses.sort((a, b) => {
      const ai = a.rows[0]?.job.bossIndex ?? 0;
      const bi = b.rows[0]?.job.bossIndex ?? 0;
      return ai - bi;
    });
  }
  return [...byMember.values()];
}

/** 시뮬 한 판이 얼마나 걸리는지는 기기마다 달라 **재 보고** 알린다. */
export function remainingSeconds(done: number, total: number, elapsedMs: number): number {
  if (done <= 0) return 0;
  return ((elapsedMs / done) * (total - done)) / 1000;
}

export type Simulate = (squad: string[], characters: DeckState['characters'],
  battle: BattleSettings) => Promise<SimulationResult>;

// ── 화면 ────────────────────────────────────────────────────────────────────

import { areaToOverrides, consoleFrom, emptyConsole, pickArea } from './blablalink';
import type { RawProfile } from './blablalink';
import { requestForDeck } from './model';
import { mountSharePanel, squadPreview, type SharePanel } from './share-panel';
import { summarizeBattle, summarizeSquad, summarizeUnion, type ShareItem, type ShareKind, type ShareServer } from './share-server';
import type { CharacterMeta, CharacterOverrides, SettingsCatalog } from './types';

export interface UnionHosts {
  panel: HTMLElement;
}

export interface UnionDeps {
  /** 블라블라링크 조회 프록시. 비어 있으면 이 탭 자체를 띄우지 않는다. */
  proxy: string;
  settings: SettingsCatalog;
  catalog: CharacterMeta[];
  simulate: (request: ReturnType<typeof requestForDeck>) => Promise<SimulationResult>;
  imageOf: (name: string) => string | undefined;
  /** 지금 계산기에 잡아 둔 전투 조건을 코드로. 「가져오기」 단추가 쓴다. */
  currentBattleCode: () => string;
  /** 지금 계산기 덱 하나를 코드로. 인자는 0부터. */
  currentDeckCode: (index: number) => string;
  /** 계산기가 아는 니케 이름 전부 — 조합 코드 해석에 쓴다. */
  catalogNames: () => string[];
  /**
   * 설정 공유 서버. 없으면(주소를 안 잡아 뒀으면) «공유에서 고르기»를 아예 그리지 않는다 —
   * 누를 수 없는 단추를 남겨 두는 쪽이 더 헷갈린다.
   */
  shareServer?: ShareServer | null;
  /** 한 번에 몇 판을 함께 돌릴지(병렬 설정). 1이면 한 판씩. */
  concurrency?: () => number;
  /**
   * 개인용 모드에서 쓰는 «나». 명단·공개여부를 건너뛰고 계산기에 잡아 둔 내 스펙으로
   * 보스×덱을 돈다 — 「남의 딜은 궁금하지 않고 내 것만 보고 싶다」는 요청에서 나왔다.
   */
  me: () => { name: string; synchro: number; console: BattleSettings['console'];
    roster: Record<string, CharacterOverrides>; owned: number };
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const pick = <T extends HTMLElement>(root: HTMLElement, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`유니온 탭에 ${selector}가 없습니다.`);
  return found;
};

const DAMAGE = new Intl.NumberFormat('ko-KR');

/** 엔진 오류는 파이썬 트레이스백째로 온다 — 줄마다 쏟지 않고 마지막 한 줄만 적는다. */
export function lastLine(message: string): string {
  const lines = message.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? message;
}

/** 조회 시작 사이의 최소 간격(ms). 상류가 «너무 잦다»고 되던지는 선을 피한다. */
const REQUEST_GAP_MS = 700;
/** 실패했을 때 물러서는 간격. 세 번까지 더 해 보고 포기한다. */
const BACKOFF_MS = [1500, 4000, 9000];

/** 유니온 탭 전체를 배선한다. 상태는 이 안에만 산다 — 탭을 떠나도 남는다. */
export function mountUnionRaid(hosts: UnionHosts, deps: UnionDeps): void {
  const { panel } = hosts;
  let members: MemberRow[] = [];
  let rosters = new Map<string, Record<string, CharacterOverrides>>();
  let consoles = new Map<string, BattleSettings['console']>();
  let bosses: BossSlot[] = Array.from({ length: BOSS_SLOTS }, () => ({
    name: '', code: '', enabled: true,
    decks: Array.from({ length: DECK_SLOTS }, () => ({ code: '' } as DeckSlot)),
  }));
  let results: JobResult[] = [];
  let running = false;
  let cancelled = false;

  // 모드 — 유니온원을 훑는 «유니온»과, 내 스펙만 쓰는 «개인용».
  let personal = false;
  const modeButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-union-mode]')];

  /** 내 로스터를 실제로 가져다 뒀는가. 없으면 개인용은 기본 스펙으로 돈다. */
  const hasMyRoster = () => (rosters.get('me') ? Object.keys(rosters.get('me')!).length > 0 : false);

  /** 계산기에 잡아 둔 내 스펙을 «유니온원 한 명»처럼 세운다 — 뒤 단계가 그대로 돈다. */
  const loadMe = () => {
    const me = deps.me();
    members = [{
      name: me.name, openid: 'me', synchro: me.synchro, level: 0, area: 0,
      state: 'public', picked: true, owned: me.owned,
      note: me.owned > 0 ? undefined : '가져온 스펙이 없어 기본 스펙으로 계산합니다',
    }];
    rosters = new Map([['me', me.roster]]);
    consoles = new Map([['me', me.console]]);
    results = [];
  };

  const setMode = (next: boolean) => {
    personal = next;
    for (const button of modeButtons) {
      const on = (button.dataset.unionMode === 'personal') === personal;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
    }
    if (personal) loadMe();
    else { members = []; rosters = new Map(); consoles = new Map(); results = []; }
    const unionLede = panel.querySelector<HTMLElement>('[data-union-lede-union]');
    const personalLede = panel.querySelector<HTMLElement>('[data-union-lede-personal]');
    if (unionLede) unionLede.hidden = personal;
    if (personalLede) personalLede.hidden = !personal;
    showStep('1', !personal);
    showStep('2', !personal && members.length > 0);
    showStep('3', personal || members.some((row) => row.state === 'public'));
    renderMembers();
    renderReport();
    refreshRunGate();
  };

  const steps = new Map<string, HTMLElement>();
  for (const step of panel.querySelectorAll<HTMLElement>('[data-union-step]')) {
    steps.set(step.dataset.unionStep!, step);
  }
  const showStep = (id: string, on: boolean) => {
    const step = steps.get(id);
    if (step) step.hidden = !on;
  };

  // ── 1단계 · 명단 ─────────────────────────────────────────────────────────
  const snippetBox = pick<HTMLTextAreaElement>(panel, '[data-union-snippet]');
  const copyButton = pick<HTMLButtonElement>(panel, '[data-union-copy]');
  const pasteBox = pick<HTMLTextAreaElement>(panel, '[data-union-paste]');
  const readButton = pick<HTMLButtonElement>(panel, '[data-union-read]');
  const listStatus = pick(panel, '[data-union-list-status]');
  snippetBox.value = MEMBER_SNIPPET;

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(MEMBER_SNIPPET);
      listStatus.textContent = '복사했습니다. 블라블라링크 유니온 스퀘어에서 콘솔(F12)에 붙여넣으세요.';
    } catch {
      snippetBox.select();
      listStatus.textContent = '복사가 막혀 있습니다 — 위 상자의 내용을 직접 복사하세요.';
    }
  });

  readButton.addEventListener('click', () => {
    try {
      const parsed = parseMemberList(pasteBox.value);
      members = parsed.map((row) => ({ ...row, state: 'unknown', picked: false }));
      results = [];
      renderMembers();
      renderReport();
      showStep('2', true);
      listStatus.textContent = `유니온원 ${members.length}명을 읽었습니다. `
        + `공개여부 확인에 ${humanSeconds(estimateScanSeconds(members.length))}쯤 걸립니다.`;
    } catch (error) {
      listStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  // ── 2단계 · 공개여부 ─────────────────────────────────────────────────────
  const scanButton = pick<HTMLButtonElement>(panel, '[data-union-scan]');
  const scanStop = pick<HTMLButtonElement>(panel, '[data-union-scan-stop]');
  const scanStatus = pick(panel, '[data-union-scan-status]');
  const scanBar = pick(panel, '[data-union-scan-progress]');
  const memberBox = pick(panel, '[data-union-members]');
  const ask = pick(panel, '[data-union-ask]');
  const askText = pick(panel, '[data-union-ask-text]');

  const setBar = (bar: HTMLElement, done: number, total: number) => {
    bar.hidden = total === 0;
    const fill = bar.firstElementChild as HTMLElement | null;
    if (fill) fill.style.width = `${total === 0 ? 0 : Math.round((done / total) * 100)}%`;
  };

  /**
   * 싱크로 칸. 실측 스탯표는 1000까지라 그 위는 이어 붙인 추정치다 — 그 사실을
   * 딜 옆이 아니라 **사람 옆에** 적는다. 왜 이 사람 숫자만 덜 미더운지가 거기서 읽힌다.
   */
  const syncCell = (row: MemberRow): HTMLElement => {
    if (row.synchro <= 0) return el('span', 'union-sync', '싱크로 ?');
    const cell = el('span', 'union-sync', `싱크로 ${row.synchro}`);
    if (row.synchro > SYNCHRO_MEASURED_MAX) {
      cell.classList.add('is-estimated');
      cell.append(el('b', 'union-est', '추정'));
      cell.title = `실측이 닿는 곳이 ${SYNCHRO_MEASURED_MAX}레벨까지입니다. `
        + '그 위는 같은 성장 곡선을 이어 붙여 계산합니다.';
    }
    return cell;
  };

  /**
   * 유니온원 줄 오른쪽의 보스 칩. **아래 보스 체크와 연동한다** — 꺼 둔 보스는 칩 자체가
   * 안 나온다. 여기서 끄면 그 사람만 그 보스를 건너뛴다(풍압은 되는데 전격은 아닌 사람).
   */
  const bossChips = (row: MemberRow): HTMLElement => {
    const wrap = el('div', 'union-boss-picks');
    const live = bosses.filter((boss) => boss.enabled);
    if (live.length === 0 || row.state !== 'public') return wrap;
    bosses.forEach((boss, index) => {
      if (!boss.enabled) return;
      const chip = el('label', 'union-boss-chip');
      const mark = document.createElement('input');
      mark.type = 'checkbox';
      mark.checked = row.bossPicks?.[index] !== false;
      mark.dataset.unionBossPick = String(index);
      const label = boss.name.trim() || `보스 ${index + 1}`;
      chip.title = `${row.name} — ${label}`;
      chip.classList.toggle('is-off', !mark.checked);
      mark.addEventListener('change', (event) => {
        event.stopPropagation();
        row.bossPicks = { ...(row.bossPicks ?? {}), [index]: mark.checked };
        chip.classList.toggle('is-off', !mark.checked);
        refreshRunGate();
      });
      chip.append(mark, el('span', '', String(index + 1)));
      wrap.append(chip);
    });
    return wrap;
  };

  function renderMembers(): void {
    memberBox.replaceChildren();
    if (members.length === 0) return;
    const table = el('div', 'union-table');
    for (const row of members) {
      const line = el('label', 'union-row');
      line.dataset.unionMember = row.openid;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = row.picked;
      box.disabled = row.state !== 'public';
      box.addEventListener('change', () => {
        row.picked = box.checked;
        refreshRunGate();
      });
      const state = el('span', `union-state is-${row.state}`, {
        unknown: '미확인', scanning: '확인 중', public: '공개', private: '비공개', error: '오류',
      }[row.state]);
      // 개인용은 «나» 한 줄뿐이다 — 고를 것도, 공개여부를 따질 것도 없어 아예 안 그린다
      // (`hidden`만으로는 격자 자리가 남아 줄이 어긋난다).
      const owned = row.owned !== undefined && row.owned > 0 ? `니케 ${row.owned}종` : '';
      const note = el('span', 'union-note', [owned, row.note ?? ''].filter(Boolean).join(' · '));
      if (personal) {
        line.classList.add('is-personal');
        line.append(el('span', 'union-name', row.name), syncCell(row), note, bossChips(row));
      } else {
        line.append(box, el('span', 'union-name', row.name), syncCell(row), state, note, bossChips(row));
      }
      table.append(line);
    }
    memberBox.append(table);

    const open = members.filter((row) => row.state === 'public');
    const done = members.filter((row) => row.state !== 'unknown' && row.state !== 'scanning');
    ask.hidden = done.length !== members.length || members.length === 0;
    if (!ask.hidden) {
      askText.textContent = open.length > 0
        ? `공개된 유니온원 ${open.length}명 대상으로 테스트를 해보시겠습니까?`
        : '공개된 유니온원이 없습니다. 「나의 니케」를 공개로 바꾼 뒤 다시 스캔해 주세요.';
    }
    refreshRunGate();
  }

  // 호출 간격을 벌리는 문지기. 한 사람을 여는 데 상류 호출이 예닐곱 번 나가서,
  // 그냥 몰아치면 «212000 request too frequently»가 돌아온다(실측 2026-08-27).
  let nextStart = 0;
  const spaced = async (): Promise<void> => {
    const now = Date.now();
    const wait = Math.max(0, nextStart - now);
    nextStart = Math.max(now, nextStart) + REQUEST_GAP_MS;
    if (wait > 0) await new Promise((done) => { setTimeout(done, wait); });
  };

  /**
   * 한 명을 조회한다. 상류가 흔들리거나 «너무 잦다»고 하면 **간격을 벌려 다시** 부른다 —
   * 여럿을 훑는 동안 잠깐 튄 것을 «비공개»로 굳혀 버리면, 실제로 공개한 사람이
   * 계산에서 빠진다. 비공개는 상류가 그렇게 말한 것이므로 다시 부르지 않는다.
   */
  const scanOne = async (row: MemberRow, attempt = 0): Promise<void> => {
    await spaced();
    row.state = 'scanning';
    try {
      const response = await fetch(`${deps.proxy}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileUrl: row.openid,
          ...(row.area > 0 ? { area: row.area } : {}),
        }),
      });
      const payload = await response.json() as RawProfile & { error?: string; reason?: string };
      if (!response.ok) {
        if (payload.reason !== 'private' && attempt < BACKOFF_MS.length) {
          await new Promise((done) => { setTimeout(done, BACKOFF_MS[attempt]); });
          return scanOne(row, attempt + 1);
        }
        row.state = payload.reason === 'private' ? 'private' : 'error';
        row.note = payload.reason === 'private' ? '니케 목록 비공개' : (payload.error ?? `조회 실패 (${response.status})`);
        return;
      }
      const area = pickArea(payload, row.area > 0 ? row.area : undefined);
      if (!area) { row.state = 'private'; row.note = '니케 목록이 비어 있습니다'; return; }
      const { overrides, matched } = areaToOverrides(area, deps.settings, deps.catalog);
      if (matched.length === 0) { row.state = 'private'; row.note = '계산기가 아는 니케가 없습니다'; return; }
      rosters.set(row.openid, overrides);
      const levels = consoleFrom(area);
      if (levels) consoles.set(row.openid, levels);
      row.state = 'public';
      row.owned = matched.length;
      // 전초기지가 비공개면 콘솔을 모른다. 0으로 치고 계산하되, 그 사실을 줄에 적는다 —
      // 딜이 낮게 나온 이유가 스펙이 아니라 «못 본 값»일 수 있어서다.
      row.note = levels ? undefined : '콘솔 비공개 · 0으로 계산';
      row.picked = true;
    } catch (error) {
      if (attempt < BACKOFF_MS.length) {
        await new Promise((done) => { setTimeout(done, BACKOFF_MS[attempt]); });
        return scanOne(row, attempt + 1);
      }
      row.state = 'error';
      row.note = error instanceof Error ? error.message : String(error);
    }
  };

  const runScan = async () => {
    if (running || members.length === 0) return;
    running = true;
    cancelled = false;
    scanButton.disabled = true;
    scanStop.hidden = false;
    const total = members.length;
    let done = 0;
    const started = Date.now();
    const queue = [...members];
    const worker = async () => {
      while (queue.length > 0 && !cancelled) {
        const row = queue.shift()!;
        await scanOne(row);
        done += 1;
        setBar(scanBar, done, total);
        scanStatus.textContent = `${done}/${total} · 남은 시간 약 `
          + humanSeconds(remainingSeconds(done, total, Date.now() - started));
        renderMembers();
      }
    };
    // 둘씩만 동시에 부른다. 셋으로 돌렸더니 공개한 사람이 실패로 튀어 «비공개»로
    // 잘못 잡히는 일이 실제로 났다(2026-08-27). 조금 느려도 맞는 답이 낫다.
    await Promise.all([worker(), worker()]);
    running = false;
    scanButton.disabled = false;
    scanStop.hidden = true;
    const open = members.filter((row) => row.state === 'public').length;
    scanStatus.textContent = cancelled
      ? `중단했습니다 (${done}/${total} 확인).`
      : `${total}명 확인 · 공개 ${open}명 · ${humanSeconds((Date.now() - started) / 1000)} 걸렸습니다.`;
    renderMembers();
    if (open > 0) showStep('3', true);
  };

  scanButton.addEventListener('click', () => { void runScan(); });

  // 직접 긁기 — 저희 프록시를 거치지 않는 길. 「유니온원에게만 공개」는 이쪽으로만 보인다.
  const directSnippet = pick<HTMLTextAreaElement>(panel, '[data-union-direct-snippet]');
  const directCopy = pick<HTMLButtonElement>(panel, '[data-union-direct-copy]');
  const directPaste = pick<HTMLTextAreaElement>(panel, '[data-union-direct-paste]');
  const directRead = pick<HTMLButtonElement>(panel, '[data-union-direct-read]');
  const directStatus = pick(panel, '[data-union-direct-status]');
  directSnippet.value = DIRECT_SNIPPET;

  directCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(DIRECT_SNIPPET);
      directStatus.textContent = '복사했습니다. 블라블라링크에서 콘솔(F12)에 붙여넣으세요 — 32명이면 2~3분 걸립니다.';
    } catch {
      directSnippet.select();
      directStatus.textContent = '복사가 막혀 있습니다 — 위 상자의 내용을 직접 복사하세요.';
    }
  });

  directRead.addEventListener('click', () => {
    directStatus.textContent = '푸는 중…';
    void (async () => {
      try {
        const rows = await parseDirectScan(directPaste.value);
        members = rows.map((row) => ({
          name: row.name, openid: row.openid, synchro: row.synchro, level: row.level, area: row.area,
          state: row.state, picked: false, note: row.note,
        }));
        rosters = new Map();
        consoles = new Map();
        results = [];
        let open = 0;
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]!;
          const seat = members[index]!;
          if (row.state !== 'public' || !row.profile) continue;
          const area = pickArea(row.profile as never, row.area > 0 ? row.area : undefined);
          if (!area) { seat.state = 'private'; seat.note = '니케 목록이 비어 있습니다'; continue; }
          const { overrides, matched } = areaToOverrides(area, deps.settings, deps.catalog);
          if (matched.length === 0) { seat.state = 'private'; seat.note = '계산기가 아는 니케가 없습니다'; continue; }
          rosters.set(seat.openid, overrides);
          const levels = consoleFrom(area);
          if (levels) consoles.set(seat.openid, levels);
          seat.owned = matched.length;
          seat.note = levels ? undefined : '콘솔 비공개 · 0으로 계산';
          seat.picked = true;
          open += 1;
        }
        renderMembers();
        renderReport();
        showStep('2', true);
        if (open > 0) showStep('3', true);
        directStatus.textContent = `유니온원 ${members.length}명을 읽었습니다 · 공개 ${open}명. `
          + '서버 스캔 없이 바로 고르실 수 있습니다.';
      } catch (error) {
        directStatus.textContent = error instanceof Error ? error.message : String(error);
      }
    })();
  });

  scanStop.addEventListener('click', () => { cancelled = true; });
  pick<HTMLButtonElement>(panel, '[data-union-pick-all]').addEventListener('click', () => {
    for (const row of members) row.picked = row.state === 'public';
    renderMembers();
  });
  pick<HTMLButtonElement>(panel, '[data-union-pick-none]').addEventListener('click', () => {
    for (const row of members) row.picked = false;
    renderMembers();
  });

  // ── 3단계 · 보스와 덱 ────────────────────────────────────────────────────
  const bossBox = pick(panel, '[data-union-bosses]');

  // ── 공유에서 고르기 ──────────────────────────────────────────────────────
  // 보스 조건·덱·판 전체가 같은 목록 구조를 쓰므로 창 하나에 판 셋을 얹고 필요한 것만
  // 보인다. 「어디에 넣을지」는 창을 열 때 정하고, 아래 콜백들이 그 값을 읽는다.
  type ShareTarget =
    | { kind: 'boss'; boss: number }
    | { kind: 'squad'; boss: number; deck: number }
    | { kind: 'union' };

  const shareModal = panel.querySelector<HTMLElement>('[data-union-share-modal]');
  const sharePanels = new Map<ShareKind, SharePanel>();
  const shareHosts = new Map<ShareKind, HTMLElement>();
  let shareTarget: ShareTarget = { kind: 'union' };
  let openSharePicker: ((target: ShareTarget) => void) | null = null;

  const shareMsg = shareModal?.querySelector<HTMLElement>('[data-union-share-msg]') ?? null;
  const notifyShare = (message: string, ok = false): void => {
    if (!shareMsg) return;
    shareMsg.textContent = message;
    shareMsg.hidden = message === '';
    shareMsg.classList.toggle('is-ok', ok);
  };

  /** 지금 그 칸에 있는 것을 「올리기」 탭에 넘긴다. 창을 열 때 정한 자리를 본다. */
  const currentFor = (kind: ShareKind): { code: string; auto: string } => {
    if (kind === 'union') {
      return { code: unionCodeOf(bosses), auto: summarizeUnion(unionShareOf(bosses).bosses) };
    }
    if (kind === 'boss' && shareTarget.kind === 'boss') {
      const boss = bosses[shareTarget.boss];
      return {
        code: boss?.code ?? '',
        auto: boss?.battle ? summarizeBattle(boss.battle) : '조건 없음',
      };
    }
    if (kind === 'squad' && shareTarget.kind === 'squad') {
      const deck = bosses[shareTarget.boss]?.decks[shareTarget.deck];
      return {
        code: deck?.code ?? '',
        auto: summarizeSquad([{ squad: deck?.squad ?? [] }], false),
      };
    }
    return { code: '', auto: '' };
  };

  /** 목록에서 고른 것을 그 자리에 넣는다. 코드가 깨졌으면 던져서 창이 알리게 둔다. */
  const applyShared = (kind: ShareKind, item: ShareItem): void => {
    if (kind === 'union') {
      bosses = readUnionCode(item.code, deps.catalogNames(), DEFAULT_SYNCHRO_LEVEL);
      renderBosses();
      renderMembers();
      notifyShare(`«${item.name}» 판을 깔았습니다.`, true);
      return;
    }
    if (kind === 'boss' && shareTarget.kind === 'boss') {
      const at = shareTarget.boss;
      const boss = bosses[at];
      if (!boss) return;
      bosses[at] = { ...readBossCode({ ...boss, code: item.code }), decks: boss.decks };
      const failed = bosses[at]!.error;
      renderBosses();
      if (failed) throw new Error(failed);
      notifyShare(`보스 ${at + 1} 칸에 «${item.name}» 조건을 넣었습니다.`, true);
      return;
    }
    if (kind === 'squad' && shareTarget.kind === 'squad') {
      const { boss: at, deck: deckAt } = shareTarget;
      const boss = bosses[at];
      if (!boss) return;
      boss.decks[deckAt] = readDeckCode({ code: item.code }, deps.catalogNames());
      const failed = boss.decks[deckAt]!.error;
      renderBosses();
      if (failed) throw new Error(failed);
      notifyShare(`보스 ${at + 1}의 ${deckAt + 1}덱에 «${item.name}»을 넣었습니다.`, true);
    }
  };

  if (shareModal && deps.shareServer) {
    const server = deps.shareServer;
    const body = pick(shareModal, '[data-union-share-body]');
    const title = pick(shareModal, '[data-union-share-title]');
    const desc = pick(shareModal, '[data-union-share-desc]');

    const closeShare = (): void => { shareModal.hidden = true; };
    pick<HTMLButtonElement>(shareModal, '[data-union-share-close]')
      .addEventListener('click', closeShare);
    shareModal.addEventListener('click', (event) => {
      if (event.target === shareModal) closeShare();
    });

    for (const kind of ['boss', 'squad', 'union'] as ShareKind[]) {
      const host = el('div', 'union-share-host');
      host.hidden = true;
      const tabs = el('div', 'share-tabs');
      const upload = el('div', 'share-pane');
      const list = el('div', 'share-pane');
      const code = el('div', 'share-pane');
      host.append(tabs, upload, list, code);
      body.append(host);
      shareHosts.set(kind, host);

      sharePanels.set(kind, mountSharePanel({ tabs, upload, list, code }, {
        kind,
        server,
        // 코드 칸은 보스·덱 칸에 이미 나와 있다 — 창 안에 또 두지 않는다.
        tabs: ['upload', 'list'],
        current: () => currentFor(kind),
        apply: (item) => applyShared(kind, item),
        notify: notifyShare,
        preview: kind === 'squad' ? (item) => {
          try {
            const payload = decodeShareCode(item.code, deps.catalogNames());
            const squads = payload.decks
              .map((entry) => entry.squad.filter((name) => name.trim() !== ''))
              .filter((squad) => squad.length > 0);
            return squads.length > 0 ? squadPreview(squads, deps.imageOf) : null;
          } catch {
            return null;
          }
        } : undefined,
      }));
    }

    const LABELS: Record<ShareKind, { title: string; desc: string }> = {
      boss: {
        title: '보스 조건 고르기',
        desc: '남들이 올린 <b>전투 조건</b>입니다. 고르면 이 보스 칸에 그대로 들어갑니다 — 싱크로와 콘솔은 담기지 않으므로 유니온원 각자의 값이 그대로 쓰입니다.',
      },
      squad: {
        title: '조합 고르기',
        desc: '남들이 올린 <b>조합</b>입니다. 고르면 이 덱 칸에 들어갑니다 — 누가 편성됐는지만 담기고, 수치는 유니온원 각자의 것을 씁니다.',
      },
      union: {
        title: '유니온 레이드 판 고르기',
        desc: '보스 다섯과 각 칸의 덱까지 <b>한 판을 통째로</b> 담은 것입니다. 고르면 지금 짜 둔 판을 덮어씁니다. <b>유니온원 명단은 담기지 않습니다.</b>',
      },
    };

    openSharePicker = (target: ShareTarget): void => {
      shareTarget = target;
      title.textContent = LABELS[target.kind].title;
      desc.innerHTML = LABELS[target.kind].desc;
      for (const [kind, host] of shareHosts) host.hidden = kind !== target.kind;
      notifyShare('');
      shareModal.hidden = false;
      sharePanels.get(target.kind)?.open();
    };
  }

  // ── 판 코드 (NK4) ────────────────────────────────────────────────────────
  const setStatus = pick(panel, '[data-union-set-status]');
  const setBox = pick(panel, '[data-union-set-box]');
  const setCode = pick<HTMLTextAreaElement>(panel, '[data-union-set-code]');

  const sayBoard = (message: string, ok = false): void => {
    setStatus.textContent = message;
    setStatus.classList.toggle('is-ok', ok);
  };

  pick<HTMLButtonElement>(panel, '[data-union-set-copy]').addEventListener('click', async () => {
    const code = unionCodeOf(bosses);
    setBox.hidden = false;
    setCode.value = code;
    try {
      await navigator.clipboard.writeText(code);
      sayBoard('판 코드를 복사했습니다. 유니온방에 그대로 붙여넣으면 됩니다.', true);
    } catch {
      setCode.select();
      sayBoard('자동 복사가 막혀 코드를 선택해 뒀습니다. Ctrl+C로 복사해 주세요.');
    }
  });

  pick<HTMLButtonElement>(panel, '[data-union-set-paste]').addEventListener('click', () => {
    setBox.hidden = false;
    setCode.value = '';
    setCode.focus();
    sayBoard('받은 판 코드(NK4-…)를 붙여넣고 「이 판 적용」을 누르세요.');
  });

  pick<HTMLButtonElement>(panel, '[data-union-set-apply]').addEventListener('click', () => {
    try {
      bosses = readUnionCode(setCode.value, deps.catalogNames(), DEFAULT_SYNCHRO_LEVEL);
      renderBosses();
      renderMembers();
      const live = bosses.filter((boss) => boss.enabled).length;
      sayBoard(`판을 깔았습니다 — 보스 ${live}개.`, true);
      setBox.hidden = true;
    } catch (error) {
      sayBoard(error instanceof Error ? error.message : String(error));
    }
  });

  pick<HTMLButtonElement>(panel, '[data-union-set-close]').addEventListener('click', () => {
    setBox.hidden = true;
    sayBoard('');
  });

  const setShare = panel.querySelector<HTMLButtonElement>('[data-union-set-share]');
  if (setShare) {
    if (openSharePicker) {
      const open = openSharePicker;
      setShare.addEventListener('click', () => open({ kind: 'union' }));
    } else {
      setShare.hidden = true;
    }
  }

  function renderBosses(): void {
    bossBox.replaceChildren();
    bosses.forEach((boss, index) => {
      const card = el('div', 'union-boss');
      if (!boss.enabled) card.classList.add('is-off');

      const head = el('div', 'union-boss-head');
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = boss.enabled;
      toggle.title = '끄면 이 보스는 계산하지 않습니다';
      toggle.addEventListener('change', () => {
        boss.enabled = toggle.checked;
        renderBosses();
        renderMembers();       // 줄 오른쪽 칩이 보스 체크를 따라간다
      });
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'union-boss-name';
      name.placeholder = `보스 ${index + 1} 이름`;
      name.value = boss.name;
      name.addEventListener('input', () => {
        boss.name = name.value;
        refreshRunGate();
        for (const chip of memberBox.querySelectorAll<HTMLElement>('.union-boss-chip')) {
          const at = Number(chip.querySelector<HTMLInputElement>('[data-union-boss-pick]')?.dataset.unionBossPick);
          if (at === index) chip.title = `${chip.title.split(' — ')[0]} — ${boss.name.trim() || `보스 ${index + 1}`}`;
        }
      });
      head.append(toggle, name, el('span', 'union-boss-summary', battleSummary(boss)));
      card.append(head);

      const codeRow = el('div', 'union-code-row');
      const code = document.createElement('input');
      code.type = 'text';
      code.className = 'union-code';
      code.placeholder = '전투 조건 코드 (NK3-…)';
      code.value = boss.code;
      code.addEventListener('input', () => {
        bosses[index] = { ...readBossCode({ ...boss, code: code.value }), decks: boss.decks };
        boss = bosses[index]!;
        renderBosses();
      });
      const grab = el('button', 'roster-import', '지금 조건');
      (grab as HTMLButtonElement).type = 'button';
      grab.title = '계산기에 잡아 둔 전투 조건을 그대로 가져옵니다';
      grab.addEventListener('click', () => {
        bosses[index] = { ...readBossCode({ ...boss, code: deps.currentBattleCode() }), decks: boss.decks };
        renderBosses();
      });
      codeRow.append(code, grab);
      if (openSharePicker) {
        const open = openSharePicker;
        const fromShare = el('button', 'roster-import', '공유에서');
        (fromShare as HTMLButtonElement).type = 'button';
        fromShare.title = '남들이 올린 보스 조건 목록에서 고릅니다';
        fromShare.addEventListener('click', () => open({ kind: 'boss', boss: index }));
        codeRow.append(fromShare);
      }
      card.append(codeRow);
      if (boss.error) card.append(el('p', 'union-error', boss.error));

      const deckBox = el('div', 'union-decks');
      boss.decks.forEach((deck, deckIndex) => {
        const row = el('div', 'union-deck');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'union-code';
        input.placeholder = `덱 ${deckIndex + 1} 조합 코드 (NK2-…)`;
        input.value = deck.code;
        input.addEventListener('input', () => {
          boss.decks[deckIndex] = readDeckCode({ code: input.value }, deps.catalogNames());
          renderBosses();
        });
        const take = el('button', 'roster-import', `지금 ${deckIndex + 1}덱`);
        (take as HTMLButtonElement).type = 'button';
        take.title = '지금 계산기에 짜 둔 이 번호의 덱을 그대로 가져옵니다';
        take.addEventListener('click', () => {
          boss.decks[deckIndex] = readDeckCode({ code: deps.currentDeckCode(deckIndex) }, deps.catalogNames());
          renderBosses();
        });
        row.append(input, take);
        if (openSharePicker) {
          const open = openSharePicker;
          const fromShare = el('button', 'roster-import', '공유에서');
          (fromShare as HTMLButtonElement).type = 'button';
          fromShare.title = '남들이 올린 조합 목록에서 고릅니다';
          fromShare.addEventListener('click', () =>
            open({ kind: 'squad', boss: index, deck: deckIndex }));
          row.append(fromShare);
        }
        if (deck.squad) row.append(squadPreview([deck.squad.filter(Boolean)], deps.imageOf));
        if (deck.error) row.append(el('p', 'union-error', deck.error));
        deckBox.append(row);
      });
      card.append(deckBox);
      bossBox.append(card);
    });
    refreshRunGate();
  }

  const battleSummary = (boss: BossSlot): string => {
    if (!boss.battle) return '조건 없음';
    const parts = [`${boss.battle.duration}초`, boss.battle.enemyCode || '무속성',
      `방어 ${DAMAGE.format(boss.battle.enemyDef)}`];
    const decks = boss.decks.filter((deck) => deck.squad).length;
    parts.push(decks > 0 ? `덱 ${decks}개` : '덱 없음');
    return parts.join(' · ');
  };

  // ── 4단계 · 실행 ─────────────────────────────────────────────────────────
  const runButton = pick<HTMLButtonElement>(panel, '[data-union-run]');
  const runStop = pick<HTMLButtonElement>(panel, '[data-union-stop]');
  const runStatus = pick(panel, '[data-union-run-status]');
  const runBar = pick(panel, '[data-union-run-progress]');
  const reportBox = pick(panel, '[data-union-report]');

  function refreshRunGate(): void {
    const jobs = buildJobs(members, bosses);
    const ready = jobs.length > 0 && !running;
    runButton.disabled = !ready;
    showStep('4', jobs.length > 0 || results.length > 0);
    if (!running) {
      const people = new Set(jobs.map((job) => job.member.openid)).size;
      runStatus.textContent = jobs.length === 0
        ? (personal ? '보스와 덱을 채워야 돌립니다.' : '고른 유니온원과 보스·덱이 있어야 돌립니다.')
        : (personal
          ? `${jobs.length}판을 돌립니다 — 보스·덱 조합만큼입니다.`
          : `${jobs.length}판을 돌립니다 — 유니온원 ${people}명 × 보스·덱.`);
    }
  }

  const runAll = async () => {
    // 개인용은 돌리기 직전에 내 스펙을 다시 읽는다 — 그 사이 싱크로나 로스터를
    // 바꿨을 수 있고, 그때 화면에 적힌 값과 계산이 어긋나면 안 된다.
    if (personal) { loadMe(); renderMembers(); }
    const jobs = buildJobs(members, bosses);
    if (jobs.length === 0 || running) return;
    running = true;
    cancelled = false;
    runButton.disabled = true;
    runStop.hidden = false;
    results = [];
    renderReport();
    const started = Date.now();
    let done = 0;
    const runJob = async (job: Job) => {
      const roster = rosters.get(job.member.openid) ?? {};
      const { deck, missing } = deckForMember(job.squad, roster, personal && !hasMyRoster());
      if (missing.length > 0) {
        results.push({ job, missing });
      } else {
        try {
          const battle: BattleSettings = {
            ...job.battle,
            // 싱크로와 콘솔은 **그 사람 것**을 쓴다 — 400 고정이 아니다.
            synchroLevel: job.member.synchro > 0 ? job.member.synchro : job.battle.synchroLevel,
            console: consoles.get(job.member.openid) ?? job.battle.console,
          };
          const result = await deps.simulate(requestForDeck(deck, battle));
          results.push({ job, damage: result.squadTotal });
        } catch (error) {
          results.push({ job, error: lastLine(error instanceof Error ? error.message : String(error)) });
        }
      }
      done += 1;
      setBar(runBar, done, jobs.length);
      runStatus.textContent = `${done}/${jobs.length} · ${job.member.name} · ${job.bossName} `
        + `· 남은 시간 약 ${humanSeconds(remainingSeconds(done, jobs.length, Date.now() - started))}`;
      renderReport();     // 도착 순서와 무관하게 사람→보스→덱으로 다시 세운다
    };
    // 판마다 서로 독립이라 나눠 돌려도 결과가 같다. 여기가 병렬로 가장 크게 덕을 보는
    // 자리다 — 유니온원 × 보스 × 덱이라 수십 판이 쌓인다.
    const lanes = Math.max(1, Math.trunc(deps.concurrency?.() ?? 1));
    const queue = [...jobs];
    const lane = async () => {
      while (queue.length > 0 && !cancelled) await runJob(queue.shift()!);
    };
    await Promise.all(Array.from({ length: Math.min(lanes, jobs.length) }, lane));
    running = false;
    runStop.hidden = true;
    runButton.disabled = false;
    // 문지기가 «몇 판을 돌립니다»로 되돌리기 전에 부르고, 마무리 문구를 마지막에 적는다.
    refreshRunGate();
    runStatus.textContent = cancelled
      ? `중단했습니다 (${results.length}/${jobs.length}판).`
      : `${jobs.length}판을 ${humanSeconds((Date.now() - started) / 1000)} 만에 마쳤습니다.`;
  };

  runButton.addEventListener('click', () => { void runAll(); });
  runStop.addEventListener('click', () => { cancelled = true; });

  function renderReport(): void {
    reportBox.replaceChildren();
    for (const report of groupResults(results)) {
      const card = el('div', 'union-report-card');
      const head = el('div', 'union-report-head');
      head.append(el('b', 'union-report-name', report.member.name),
        el('span', 'union-report-sync', `싱크로 ${report.member.synchro}`));
      card.append(head);
      for (const boss of report.bosses) {
        card.append(el('h4', 'union-report-boss', boss.name));
        for (const row of boss.rows) {
          const line = el('div', 'union-report-row');
          line.append(squadPreview([row.job.squad.filter(Boolean)], deps.imageOf));
          if (row.damage !== undefined) {
            line.append(el('b', 'union-report-damage', DAMAGE.format(Math.round(row.damage))));
          } else if (row.missing) {
            line.append(el('span', 'union-report-skip', `미보유 · ${row.missing.join(', ')}`));
          } else {
            line.append(el('span', 'union-report-skip', row.error ?? '계산 실패'));
          }
          card.append(line);
        }
      }
      reportBox.append(card);
    }
  }

  for (const button of modeButtons) {
    button.addEventListener('click', () => setMode(button.dataset.unionMode === 'personal'));
  }

  renderBosses();
  setMode(false);
}

/**
 * 전투 시뮬레이션 로그 및 결과 데이터클래스.
 *
 * 이식: calculator/sim_result.py
 *
 * 데이터클래스는 키워드 인자 객체 하나를 받는 클래스다(`new HitEvent({ t, caster, ... })`).
 * 기본값은 **생략(undefined)했을 때만** 채운다 — 파이썬에서 None을 명시하면 None이 들어가듯
 * null을 넘기면 null이 들어간다. `field(default_factory=...)`는 인스턴스마다 새로 만든다.
 */
import { round, sorted, sum, truthy } from './py';

// ── 서식 (파이썬 format spec 중 이 모듈이 쓰는 것만) ──────────────────────
// [<|>][width][,][.Nf]. 숫자는 기본 오른쪽, 문자열은 기본 왼쪽 정렬. 폭은 코드 포인트 수.

function _group(s: string): string {
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf('.');
  const ip = dot >= 0 ? body.slice(0, dot) : body;
  const fp = dot >= 0 ? body.slice(dot) : '';
  return (neg ? '-' : '') + ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fp;
}

function _fmt(v: any, spec: string): string {
  const m = /^([<>^])?(\d+)?(,)?(?:\.(\d+)f)?$/.exec(spec);
  if (!m) throw new Error(`unsupported format spec: ${spec}`);
  const [, align, width, comma, prec] = m;
  let s: string;
  const isNum = typeof v === 'number';
  if (isNum && prec !== undefined) {
    const p = Number(prec);
    // 파이썬 `.Nf`는 정확한 이진값 기준 반올림(동률은 짝수) — round(x, n) 뒤 toFixed로 자리만 맞춘다.
    s = Number.isFinite(v) ? round(v, p).toFixed(p) : (Number.isNaN(v) ? 'nan' : (v > 0 ? 'inf' : '-inf'));
  } else if (isNum) {
    s = String(v);
  } else if (typeof v === 'boolean') {
    s = v ? 'True' : 'False';
  } else if (v === null || v === undefined) {
    s = 'None';
  } else {
    s = String(v);
  }
  if (comma && isNum) s = _group(s);
  const w = width !== undefined ? Number(width) : 0;
  const len = [...s].length;
  if (len >= w) return s;
  const pad = ' '.repeat(w - len);
  const a = align ?? (isNum ? '>' : '<');
  if (a === '<') return s + pad;
  if (a === '>') return pad + s;
  const left = Math.floor((w - len) / 2);
  return ' '.repeat(left) + s + ' '.repeat(w - len - left);
}

// ── 공통 헬퍼 ─────────────────────────────────────────────────────────────

export const _NORMAL_ATK_TAGS: ReadonlySet<string> = new Set([
  'normal', 'core', 'full_charge_hit', 'core+full_charge_hit',
]);

// py: calculator/sim_result.py:37
/**
 * HitEvent가 일반공격 계열이면 True.
 * 발사 루프가 만든 히트라도 **이름이 붙어 있으면 스킬로 본다** (나유타 `기억 연소`).
 */
export function _is_normal(ev: HitEvent): boolean {
  if (ev.skill_name === '기본 공격') {
    return true;
  }
  if (truthy(ev.skill_name) && ev.skill_name !== '기본 공격' && _NORMAL_ATK_TAGS.has(ev.hit_tag)) {
    return false;
  }
  const tag = ev.hit_tag;
  if (tag.startsWith('pellet:') || tag.startsWith('core:pellet:')) {
    return true;
  }
  return _NORMAL_ATK_TAGS.has(tag);
}

// ── HitEvent ──────────────────────────────────────────────────────────────

export interface HitEventInit {
  t: number;
  caster: string;
  damage: number;
  is_crit: boolean;
  hit_tag: string;
  skill_name?: string;
  core_frac?: number | null;
}

// py: calculator/sim_result.py:61
/** 단일 피격 이벤트. simulate()가 생성하는 가장 기본 단위. */
export class HitEvent {
  t: number;          // 발생 시각 (초)
  caster: string;     // 딜러 캐릭터명
  damage: number;     // 최종 피해량 (방어력 계산 후 정수)
  is_crit: boolean;   // 크리티컬 여부
  hit_tag: string;    // 피격 종류 식별자 (원본 주석 참고)
  skill_name: string; // 스킬명 (일반공격은 "기본 공격")
  // 이 히트가 코어를 맞은 몫(0~1). **사격에서 나온 히트에만** 값이 있고, 그 외는 None.
  core_frac: number | null;

  constructor(kw: HitEventInit) {
    this.t = kw.t;
    this.caster = kw.caster;
    this.damage = kw.damage;
    this.is_crit = kw.is_crit;
    this.hit_tag = kw.hit_tag;
    this.skill_name = kw.skill_name !== undefined ? kw.skill_name : '기본 공격';
    this.core_frac = kw.core_frac !== undefined ? kw.core_frac : null;
  }
}

// ── SimLog 구성 엔트리들 ──────────────────────────────────────────────────

export interface BurstLogEntryInit {
  t: number;
  event: string;
  caster: string;
  planned_end?: number | null;
}

// py: calculator/sim_result.py:91
/** 버스트 흐름에서 발생한 단일 이벤트. */
export class BurstLogEntry {
  t: number;       // 발생 시각 (초)
  event: string;   // "stage:N 사용" / "reenter:N 사용" / "full_burst 시작" / "full_burst 종료"
  caster: string;  // 스킬 사용자 캐릭터명 ("full_burst 시작/종료"는 빈 문자열)
  planned_end: number | null; // 풀버스트 시작 시 확정된 종료 시각

  constructor(kw: BurstLogEntryInit) {
    this.t = kw.t;
    this.event = kw.event;
    this.caster = kw.caster;
    this.planned_end = kw.planned_end !== undefined ? kw.planned_end : null;
  }
}

export interface BuffEntryInit {
  name: string;
  caster: string;
  expires_at: number;
}

// py: calculator/sim_result.py:104
/** BuffSnapshot에 기록된 활성 버프 1건. */
export class BuffEntry {
  name: string;        // 버프 이름 (parsed_skills의 effect.name)
  caster: string;      // 버프를 건 캐릭터명
  expires_at: number;  // 만료 시각 (초). Infinity = 영구 지속

  constructor(kw: BuffEntryInit) {
    this.name = kw.name;
    this.caster = kw.caster;
    this.expires_at = kw.expires_at;
  }
}

export interface BuffSnapshotInit {
  t: number;
  buffs_by_char: Record<string, BuffEntry[]>;
}

// py: calculator/sim_result.py:112
/** 풀버스트 진입 시각에 찍은 스쿼드 전체 버프 상태 스냅샷. */
export class BuffSnapshot {
  t: number;                                  // 스냅샷 시각 (초)
  buffs_by_char: Record<string, BuffEntry[]>; // 캐릭터명 → 해당 캐릭터에 적용된 버프 목록

  constructor(kw: BuffSnapshotInit) {
    this.t = kw.t;
    this.buffs_by_char = kw.buffs_by_char;
  }
}

export interface BuffEventInit {
  t: number;
  kind: string;
  name: string;
  caster: string;
  target: string;
  expires_at: number;
  value?: number | null;
  stat?: string | null;
  stack?: number | null;
  max_stack?: number | null;
}

// py: calculator/sim_result.py:122
/** 버프 1건의 활성/갱신/만료 이벤트. */
export class BuffEvent {
  t: number;              // 발생 시각 (초)
  kind: string;           // "activate" | "expire"
  name: string;           // 버프 이름
  caster: string;         // 버프를 건 캐릭터명
  target: string;         // 버프를 받은 캐릭터명
  expires_at: number;     // 활성화 시 예정 만료 시각 (expire 이벤트에서는 실제 만료 시각)
  value: number | null;   // 버프 수치 (스킬 레벨 기준); expire 이벤트는 None
  stat: string | null;    // 버프 stat 종류
  stack: number | null;   // 이 시점의 중첩 수. 스택 버프가 아니면 1
  max_stack: number | null; // 그 버프가 쌓을 수 있는 최대 중첩(-1이면 상한 없음)

  constructor(kw: BuffEventInit) {
    this.t = kw.t;
    this.kind = kw.kind;
    this.name = kw.name;
    this.caster = kw.caster;
    this.target = kw.target;
    this.expires_at = kw.expires_at;
    this.value = kw.value !== undefined ? kw.value : null;
    this.stat = kw.stat !== undefined ? kw.stat : null;
    this.stack = kw.stack !== undefined ? kw.stack : null;
    this.max_stack = kw.max_stack !== undefined ? kw.max_stack : null;
  }
}

export interface InstantEventInit {
  t: number;
  name: string;
  caster: string;
  target: string;
  stat: string;
  value: number | null;
}

// py: calculator/sim_result.py:137
/** 인스턴트 효과 발동 이벤트. */
export class InstantEvent {
  t: number;            // 발생 시각 (초)
  name: string;         // 효과 이름
  caster: string;       // 시전자
  target: string;       // 대상 캐릭터명
  stat: string;         // stat 종류
  value: number | null; // 수치

  constructor(kw: InstantEventInit) {
    this.t = kw.t;
    this.name = kw.name;
    this.caster = kw.caster;
    this.target = kw.target;
    this.stat = kw.stat;
    this.value = kw.value;
  }
}

export interface GaugeLogEntryInit {
  t: number;
  caster: string;
  source: string;
  amount: number;
  gauge: number;
}

// py: calculator/sim_result.py:148
/** 버스트 게이지 가산 1건. `burst_gauge_mode`와 무관하게 언제나 기록된다. */
export class GaugeLogEntry {
  t: number;       // 발생 시각 (초)
  caster: string;  // 게이지를 만든 캐릭터명
  source: string;  // 출처: "weapon" / "weapon:full_charge" / "skill:스킬명" / "charge_pct:스킬명"
  amount: number;  // 이번에 실제로 들어간 양(%). 상한에 걸려 잘린 뒤의 값
  gauge: number;   // 가산 후 게이지(%)

  constructor(kw: GaugeLogEntryInit) {
    this.t = kw.t;
    this.caster = kw.caster;
    this.source = kw.source;
    this.amount = kw.amount;
    this.gauge = kw.gauge;
  }
}

export interface ReloadLogEntryInit {
  t: number;
  caster: string;
  event: string;
}

// py: calculator/sim_result.py:162
/** 재장전 시작 또는 완료 이벤트. */
export class ReloadLogEntry {
  t: number;       // 발생 시각 (초)
  caster: string;  // 재장전 캐릭터명
  event: string;   // "재장전 시작" 또는 "재장전 완료"

  constructor(kw: ReloadLogEntryInit) {
    this.t = kw.t;
    this.caster = kw.caster;
    this.event = kw.event;
  }
}

export interface AmmoLogEntryInit {
  t: number;
  caster: string;
  ammo: number;
}

// py: calculator/sim_result.py:170
/** 탄환 수 변화 이벤트. */
export class AmmoLogEntry {
  t: number;      // 발생 시각 (초)
  caster: string; // 캐릭터명
  ammo: number;   // 변화 후 남은 탄환 수

  constructor(kw: AmmoLogEntryInit) {
    this.t = kw.t;
    this.caster = kw.caster;
    this.ammo = kw.ammo;
  }
}

export interface ChargeLogEntryInit {
  caster: string;
  start: number;
  full_at: number;
  fire: number;
  full: boolean;
  value: number;
}

// py: calculator/sim_result.py:178
/** 차지 무기 한 발의 차지 구간 — 화면의 차징 게이지용. 딜 계산에는 쓰지 않는다. */
export class ChargeLogEntry {
  caster: string;
  start: number;    // 차지를 시작한 시각
  full_at: number;  // 풀차지에 닿는(닿았을) 시각 — 톡톡이면 발사보다 뒤다
  fire: number;     // 발사 시각
  full: boolean;    // 풀차지로 나갔나
  value: number;    // 이 발 시점의 풀차지 배율(%)

  constructor(kw: ChargeLogEntryInit) {
    this.caster = kw.caster;
    this.start = kw.start;
    this.full_at = kw.full_at;
    this.fire = kw.fire;
    this.full = kw.full;
    this.value = kw.value;
  }
}

// ── SimLog ────────────────────────────────────────────────────────────────

export interface SimLogInit {
  burst_log?: BurstLogEntry[];
  buff_snapshots?: BuffSnapshot[];
  buff_events?: BuffEvent[];
  instant_events?: InstantEvent[];
  reload_log?: ReloadLogEntry[];
  ammo_log?: AmmoLogEntry[];
  gauge_log?: GaugeLogEntry[];
  charge_log?: ChargeLogEntry[];
  max_ammo_log?: AmmoLogEntry[];
}

// py: calculator/sim_result.py:196
/** verbose=True 시뮬 시 채워지는 전투 이벤트 로그 컨테이너. */
export class SimLog {
  burst_log: BurstLogEntry[];
  // 버스트 단계 사용, 풀버스트 시작/종료 이벤트 시간순 목록
  buff_snapshots: BuffSnapshot[];
  // 풀버스트 진입마다 찍힌 버프 스냅샷 목록 (풀버스트 횟수만큼 쌓임)
  buff_events: BuffEvent[];
  // 버프 활성/만료 이벤트 전체 목록 — 전투 전 구간 버프 타임라인 재구성용
  instant_events: InstantEvent[];
  // 인스턴트 효과 발동 이벤트 목록
  reload_log: ReloadLogEntry[];
  // 전 캐릭터의 재장전 시작/완료 이벤트 시간순 목록
  ammo_log: AmmoLogEntry[];
  gauge_log: GaugeLogEntry[];
  charge_log: ChargeLogEntry[];
  // 그때그때의 최대 장탄(바뀔 때만). 재생 화면 표시용 — `ammo`에 최대 장탄이 들어간다.
  max_ammo_log: AmmoLogEntry[];
  // 차지 무기의 발마다 차지 구간과 풀차지 배율(재생 화면의 차징 게이지)

  constructor(kw: SimLogInit = {}) {
    this.burst_log = kw.burst_log !== undefined ? kw.burst_log : [];
    this.buff_snapshots = kw.buff_snapshots !== undefined ? kw.buff_snapshots : [];
    this.buff_events = kw.buff_events !== undefined ? kw.buff_events : [];
    this.instant_events = kw.instant_events !== undefined ? kw.instant_events : [];
    this.reload_log = kw.reload_log !== undefined ? kw.reload_log : [];
    this.ammo_log = kw.ammo_log !== undefined ? kw.ammo_log : [];
    this.gauge_log = kw.gauge_log !== undefined ? kw.gauge_log : [];
    this.charge_log = kw.charge_log !== undefined ? kw.charge_log : [];
    this.max_ammo_log = kw.max_ammo_log !== undefined ? kw.max_ammo_log : [];
  }

  // py: calculator/sim_result.py:224
  /**
   * 버스트 게이지 충전 내역을 사이클별로 묶어 출력한다.
   * `top`을 주면 사이클마다 기여 상위 몇 명까지만 적는다(0 = 전원).
   */
  gauge_summary(top: number = 0): string {
    const lines: string[] = ['[버스트 게이지 충전]'];
    let cycle: GaugeLogEntry[] = [];

    const flush = (): void => {
      if (!truthy(cycle)) {
        return;
      }
      // (caster, source) 튜플 키 → 삽입 순서를 지키는 Map
      const by_src = new Map<string, [[string, string], number]>();
      for (const e of cycle) {
        if (e.source === 'consume') { // 1단계 진입 소모 — 사이클 경계일 뿐 기여가 아니다
          continue;
        }
        const k = JSON.stringify([e.caster, e.source]);
        const prevEntry = by_src.get(k);
        by_src.set(k, [[e.caster, e.source], (prevEntry !== undefined ? prevEntry[1] : 0.0) + e.amount]);
      }
      let rows = sorted([...by_src.values()], (kv) => -kv[1]);
      if (truthy(top)) {
        rows = rows.slice(0, top);
      }
      const first = cycle[0]!;
      const last = cycle[cycle.length - 1]!;
      lines.push(`  t=${_fmt(first.t, '7.3f')}s → ${_fmt(last.t, '7.3f')}s`
        + `  (${_fmt(last.t - first.t, '5.2f')}초, ${_fmt(last.gauge, '6.2f')}%)`);
      for (const [[caster, source], amt] of rows) {
        lines.push(`      ${_fmt(amt, '7.2f')}%  ${caster}  [${source}]`);
      }
    };

    let prev = 0.0;
    for (const e of this.gauge_log) {
      if (e.gauge < prev - 1e-9) { // 게이지가 줄었다 = 1단계가 소모했다 = 새 사이클
        flush();
        cycle = [];
      }
      cycle.push(e);
      prev = e.gauge;
    }
    flush();
    return lines.join('\n');
  }

  // py: calculator/sim_result.py:258
  /**
   * 버스트 흐름 전체를 시간순으로 출력한다.
   * chars 지정 시 해당 캐릭터가 사용자인 이벤트만 표시.
   */
  burst_summary(chars: string[] | null = null): string {
    const lines: string[] = ['[버스트 사이클]'];
    for (const e of this.burst_log) {
      if (truthy(chars) && truthy(e.caster) && !chars!.includes(e.caster)) {
        continue;
      }
      const caster_str = truthy(e.caster) ? `  ${e.caster}` : '';
      lines.push(`  t=${_fmt(e.t, '7.3f')}s  ${e.event}${caster_str}`);
    }
    return lines.join('\n');
  }

  // py: calculator/sim_result.py:272
  /**
   * 풀버스트 진입마다 찍힌 버프 스냅샷을 출력한다.
   * chars 지정 시 해당 캐릭터의 버프만 표시.
   */
  buff_summary(chars: string[] | null = null): string {
    const lines: string[] = ['[버프 스냅샷 — 풀버스트 진입 시]'];
    for (const snap of this.buff_snapshots) {
      lines.push(`\n  ── t=${_fmt(snap.t, '.3f')}s ──`);
      for (const [char, buffs] of Object.entries(snap.buffs_by_char)) {
        if (truthy(chars) && !chars!.includes(char)) {
          continue;
        }
        if (!truthy(buffs)) {
          continue;
        }
        lines.push(`  ${char}:`);
        for (const b of buffs) {
          const exp = b.expires_at === Infinity ? '영구' : `${_fmt(b.expires_at, '.2f')}s까지`;
          lines.push(`    [${b.name}] by ${b.caster}  (${exp})`);
        }
      }
    }
    return lines.join('\n');
  }
}

// ── SimResult ─────────────────────────────────────────────────────────────

export interface SimResultInit {
  hits?: HitEvent[];
  char_total?: Record<string, number>;
  squad_total?: number;
  shotgun_stats?: Record<string, Record<string, number>>;
  shotgun_report?: Record<string, any>;
  duration?: number;
  log?: SimLog | null;
}

// py: calculator/sim_result.py:296
/** simulate() 반환값. 히트 목록과 딜 합산, 분석 출력 메서드를 포함한다. */
export class SimResult {
  hits: HitEvent[];
  // 전투 중 발생한 모든 HitEvent. simulate() 종료 시 시각순 정렬.
  char_total: Record<string, number>;
  // 캐릭터명 → 전투 전체 누적 피해량
  squad_total: number;
  // 스쿼드 전체 누적 피해량 (char_total 합산)
  shotgun_stats: Record<string, Record<string, number>>;
  shotgun_report: Record<string, any>;
  // Expected joint pellet masses, not realized random-mode counts.
  duration: number;
  // 시뮬레이션 지속 시간 (초)
  log: SimLog | null;
  // verbose=True 시 채워지는 전투 이벤트 로그. False이면 None.

  constructor(kw: SimResultInit = {}) {
    this.hits = kw.hits !== undefined ? kw.hits : [];
    this.char_total = kw.char_total !== undefined ? kw.char_total : {};
    this.squad_total = kw.squad_total !== undefined ? kw.squad_total : 0;
    this.shotgun_stats = kw.shotgun_stats !== undefined ? kw.shotgun_stats : {};
    this.shotgun_report = kw.shotgun_report !== undefined ? kw.shotgun_report : {};
    this.duration = kw.duration !== undefined ? kw.duration : 0.0;
    this.log = kw.log !== undefined ? kw.log : null;
  }

  // py: calculator/sim_result.py:317
  /**
   * 스쿼드 총 딜과 캐릭터별 딜량·비율을 출력한다.
   * chars 지정 시 해당 캐릭터만 표시 (스쿼드 총 딜 기준 비율은 유지). 딜량 내림차순 정렬.
   */
  summary(chars: string[] | null = null): string {
    const lines: string[] = [
      `시뮬레이션 ${_fmt(this.duration, '.1f')}초  `
      + `스쿼드 총 딜: ${_fmt(this.squad_total, ',')}`,
    ];
    for (const [name, dmg] of sorted(Object.entries(this.char_total), (x) => -x[1])) {
      if (truthy(chars) && !chars!.includes(name)) {
        continue;
      }
      const pct = truthy(this.squad_total) ? dmg / this.squad_total * 100 : 0;
      lines.push(`  ${name}: ${_fmt(dmg, ',')} (${_fmt(pct, '.1f')}%)`);
    }
    return lines.join('\n');
  }

  // py: calculator/sim_result.py:334
  /**
   * 캐릭터별 기본공격/스킬 딜 비율을 한 줄 요약으로 출력한다.
   * chars 지정 시 해당 캐릭터만 표시. 딜량 내림차순 정렬.
   */
  dmg_breakdown(chars: string[] | null = null): string {
    const lines: string[] = [`${_fmt('캐릭터', '<28')} ${_fmt('캐릭터 딜', '>14')} ${_fmt('기본공격', '>9')} ${_fmt('스킬', '>9')}`];
    lines.push('-'.repeat(64));
    for (const [name, total] of sorted(Object.entries(this.char_total), (x) => -x[1])) {
      if (truthy(chars) && !chars!.includes(name)) {
        continue;
      }
      const normal = sum(this.hits.filter((e) => e.caster === name && _is_normal(e)).map((e) => e.damage));
      const skill = sum(this.hits.filter((e) => e.caster === name && !_is_normal(e)).map((e) => e.damage));
      const n_pct = truthy(total) ? normal / total * 100 : 0;
      const s_pct = truthy(total) ? skill / total * 100 : 0;
      lines.push(`${_fmt(name, '<28')} ${_fmt(total, '>14,')} ${_fmt(n_pct, '>8.1f')}% ${_fmt(s_pct, '>8.1f')}%`);
    }
    return lines.join('\n');
  }

  // py: calculator/sim_result.py:352
  /**
   * 버스트 사이클별 스킬 딜량·히트수를 집계해 출력한다.
   * verbose=False(log=None)이면 전체 전투를 사이클 0 단일 구간으로 집계한다.
   */
  skill_breakdown_by_cycle(chars: string[] | null = null): string {
    const skill_key = (ev: HitEvent): string => (_is_normal(ev) ? '일반공격' : ev.skill_name);

    // 풀버스트 시작 시각으로 사이클 경계 수집
    let burst_starts: number[] = [];
    // `if self.log:` — 데이터클래스 인스턴스는 늘 참이다(None만 거짓).
    if (this.log != null) {
      burst_starts = this.log.burst_log.filter((e) => e.event === 'full_burst 시작').map((e) => e.t);
    }

    // 구간 정의: (label, t_start, t_end)
    const boundaries: [string, number, number][] = [];
    const all_bounds = [0.0, ...burst_starts, Infinity];
    for (let i = 0; i < all_bounds.length - 1; i += 1) {
      const t0 = all_bounds[i]!;
      const t1 = all_bounds[i + 1]!;
      const label = `사이클 ${i}  (t=${_fmt(t0, '.3f')}s`
        + (t1 !== Infinity ? ` ~ ${_fmt(t1, '.3f')}s)` : ' ~ 종료)');
      boundaries.push([label, t0, t1]);
    }

    // 출력 대상 캐릭터 목록 (딜 내림차순)
    const target_chars = sorted(Object.entries(this.char_total), (x) => -x[1])
      .filter(([name]) => !truthy(chars) || chars!.includes(name))
      .map(([name]) => name);

    const lines: string[] = ['[버스트 사이클별 스킬 딜 집계]'];

    for (const [label, t0, t1] of boundaries) {
      const cycle_hits = this.hits.filter((e) => t0 <= e.t && e.t < t1);
      if (!truthy(cycle_hits)) {
        continue;
      }

      lines.push(`\n── ${label} ──`);

      for (const name of target_chars) {
        const char_hits = cycle_hits.filter((e) => e.caster === name);
        if (!truthy(char_hits)) {
          continue;
        }

        // 스킬명 키 — 삽입 순서를 지키도록 Map
        const dmg_by_skill = new Map<string, number>();
        const cnt_by_skill = new Map<string, number>();
        for (const ev of char_hits) {
          const key = skill_key(ev);
          dmg_by_skill.set(key, (dmg_by_skill.get(key) ?? 0) + ev.damage);
          cnt_by_skill.set(key, (cnt_by_skill.get(key) ?? 0) + 1);
        }

        const char_total = sum(dmg_by_skill.values());
        lines.push(`  ${name}`);
        lines.push(`    ${_fmt('스킬명', '<28')} ${_fmt('딜량', '>14')} ${_fmt('히트수', '>7')} ${_fmt('비율', '>7')}`);
        lines.push(`    ${'-'.repeat(60)}`);
        for (const [skill, dmg] of sorted([...dmg_by_skill.entries()], (x) => -x[1])) {
          const pct = truthy(char_total) ? dmg / char_total * 100 : 0;
          const cnt = cnt_by_skill.get(skill)!;
          lines.push(`    ${_fmt(skill, '<28')} ${_fmt(dmg, '>14,')} ${_fmt(cnt, '>7')} ${_fmt(pct, '>6.1f')}%`);
        }
        lines.push(`    ${_fmt('합계', '<28')} ${_fmt(char_total, '>14,')}`);
      }
    }

    return lines.join('\n');
  }

  // py: calculator/sim_result.py:419
  /**
   * 히트 목록을 시간순으로 출력한다. 재장전·버스트 이벤트를 인터리브한다.
   */
  hit_summary(chars: string[] | null = null): string {
    const lines: string[] = ['[히트 목록]'];

    // 재장전 + 버스트 이벤트를 하나의 인터리브 목록으로 합산
    let inline_events: [number, string][] = [];
    for (const e of (this.log ? this.log.reload_log : [])) {
      if (!truthy(chars) || chars!.includes(e.caster)) {
        inline_events.push([e.t, `${_fmt(e.caster, '<18')} [${e.event}]`]);
      }
    }
    for (const e of (this.log ? this.log.burst_log : [])) {
      const caster_str = truthy(e.caster) ? e.caster : '스쿼드';
      if (!truthy(chars) || !truthy(e.caster) || chars!.includes(e.caster)) {
        inline_events.push([e.t, `${_fmt(caster_str, '<18')} [버스트: ${e.event}]`]);
      }
    }
    inline_events = sorted(inline_events, (x) => x[0]);
    let inline_idx = 0;

    for (const ev of this.hits) {
      while (inline_idx < inline_events.length && inline_events[inline_idx]![0] <= ev.t) {
        const [it, msg] = inline_events[inline_idx]!;
        lines.push(`  t=${_fmt(it, '7.3f')}s  ${msg}`);
        inline_idx += 1;
      }

      if (truthy(chars) && !chars!.includes(ev.caster)) {
        continue;
      }
      let flags = '';
      if (ev.is_crit) {
        flags += ' 크리';
      }
      if (ev.hit_tag.includes('core')) {
        flags += ' 코어';
      }
      lines.push(
        `  t=${_fmt(ev.t, '7.3f')}s  ${_fmt(ev.caster, '<18')} ${_fmt(ev.skill_name, '<20')}`
        + `  ${_fmt(ev.damage, '>12,')}${flags}`,
      );
    }

    while (inline_idx < inline_events.length) {
      const [it, msg] = inline_events[inline_idx]!;
      lines.push(`  t=${_fmt(it, '7.3f')}s  ${msg}`);
      inline_idx += 1;
    }

    return lines.join('\n');
  }
}

// ── 버스트 구간 분류 분석 ──────────────────────────────────────────────────

export interface CategoryStatInit {
  damage?: number;
  hits?: number;
}

// py: calculator/sim_result.py:473
/** 딜량·히트수 묶음. DamageBreakdown의 각 카테고리를 나타낸다. */
export class CategoryStat {
  damage: number;
  hits: number;

  constructor(kw: CategoryStatInit = {}) {
    this.damage = kw.damage !== undefined ? kw.damage : 0;
    this.hits = kw.hits !== undefined ? kw.hits : 0;
  }

  // py: calculator/sim_result.py:478
  /** total 대비 이 카테고리의 딜 비율(%). */
  pct(total: number): number {
    return truthy(total) ? this.damage / total * 100 : 0.0;
  }
}

export interface DamageBreakdownInit {
  char_name: string;
  normal_atk?: CategoryStat;
  skill?: CategoryStat;
  fb_self?: CategoryStat;
  fb_other?: CategoryStat;
  non_fb?: CategoryStat;
  _skill_detail?: Record<string, CategoryStat>;
}

// py: calculator/sim_result.py:484
/**
 * 캐릭터 1명의 대미지 분석 결과. analyze_damage()가 반환한다.
 * 피해 유형(normal_atk / skill) × 버스트 구간(fb_self / fb_other / non_fb).
 */
export class DamageBreakdown {
  char_name: string;

  normal_atk: CategoryStat;
  skill: CategoryStat;

  fb_self: CategoryStat;
  fb_other: CategoryStat;
  non_fb: CategoryStat;

  _skill_detail: Record<string, CategoryStat>;
  // 스킬명 → CategoryStat. skill 카테고리의 세부 내역.

  constructor(kw: DamageBreakdownInit) {
    this.char_name = kw.char_name;
    this.normal_atk = kw.normal_atk !== undefined ? kw.normal_atk : new CategoryStat();
    this.skill = kw.skill !== undefined ? kw.skill : new CategoryStat();
    this.fb_self = kw.fb_self !== undefined ? kw.fb_self : new CategoryStat();
    this.fb_other = kw.fb_other !== undefined ? kw.fb_other : new CategoryStat();
    this.non_fb = kw.non_fb !== undefined ? kw.non_fb : new CategoryStat();
    this._skill_detail = kw._skill_detail !== undefined ? kw._skill_detail : {};
  }

  // py: calculator/sim_result.py:514
  get total(): number {
    return this.normal_atk.damage + this.skill.damage;
  }

  // py: calculator/sim_result.py:517
  /** 피해 유형별·버스트 구간별 분석 결과를 출력한다. */
  summary(): string {
    const total = this.total;
    const fb_total = this.fb_self.damage + this.fb_other.damage + this.non_fb.damage;

    const lines: string[] = [`=== [${this.char_name}] 대미지 분석 ===`, ''];

    lines.push('─ 피해 유형별 비중 ─');
    lines.push(`  총 대미지  : ${_fmt(total, '>15,')}`);
    lines.push(
      `  기본 공격  : ${_fmt(this.normal_atk.damage, '>15,')}  `
      + `(${_fmt(this.normal_atk.pct(total), '5.1f')}%)  [${this.normal_atk.hits}회]`,
    );
    lines.push(
      `  스킬       : ${_fmt(this.skill.damage, '>15,')}  `
      + `(${_fmt(this.skill.pct(total), '5.1f')}%)  [${this.skill.hits}회]`,
    );

    if (truthy(this._skill_detail)) {
      lines.push('');
      lines.push('  ┌ 스킬 상세');
      for (const [sname, stat] of sorted(Object.entries(this._skill_detail), (x) => -x[1].damage)) {
        lines.push(
          `  │  ${_fmt(sname, '<30')} ${_fmt(stat.damage, '>14,')}  `
          + `(${_fmt(stat.pct(total), '5.1f')}%)  [${stat.hits}회]`,
        );
      }
      lines.push('  └');
    }

    lines.push('');
    lines.push('─ 버스트 구간별 비중 ─');
    lines.push(`  총 대미지      : ${_fmt(fb_total, '>15,')}`);
    lines.push(
      `  풀버스트 (본인) : ${_fmt(this.fb_self.damage, '>15,')}  `
      + `(${_fmt(this.fb_self.pct(fb_total), '5.1f')}%)  [${this.fb_self.hits}회]`,
    );
    lines.push(
      `  풀버스트 (타인) : ${_fmt(this.fb_other.damage, '>15,')}  `
      + `(${_fmt(this.fb_other.pct(fb_total), '5.1f')}%)  [${this.fb_other.hits}회]`,
    );
    lines.push(
      `  비풀버스트      : ${_fmt(this.non_fb.damage, '>15,')}  `
      + `(${_fmt(this.non_fb.pct(fb_total), '5.1f')}%)  [${this.non_fb.hits}회]`,
    );

    return lines.join('\n');
  }
}

// py: calculator/sim_result.py:564
/**
 * 특정 캐릭터의 대미지를 피해 유형별·버스트 구간별로 분석한다.
 * log가 없으면 fb_self / fb_other / non_fb 통계는 모두 0으로 남는다.
 */
export function analyze_damage(result: SimResult, char_name: string): DamageBreakdown {
  const bd = new DamageBreakdown({ char_name });

  const fb_intervals: [number, number, boolean][] = [];

  if (result.log != null) {
    let pending_casters = new Set<string>();
    let fb_start: number | null = null;

    for (const entry of result.log.burst_log) {
      if (entry.event.endsWith('사용')) {
        if (truthy(entry.caster)) {
          pending_casters.add(entry.caster);
        }
      } else if (entry.event === 'full_burst 시작') {
        fb_start = entry.t;
      } else if (entry.event === 'full_burst 종료') {
        if (fb_start != null) {
          fb_intervals.push([fb_start, entry.t, pending_casters.has(char_name)]);
        }
        fb_start = null;
        pending_casters = new Set<string>();
      }
    }

    // 전투 종료 전 마지막 풀버스트가 닫히지 않은 경우
    if (fb_start != null) {
      fb_intervals.push([fb_start, result.duration, pending_casters.has(char_name)]);
    }
  }

  const _burst_category = (t: number): 'fb_self' | 'fb_other' | 'non_fb' => {
    for (const [start, end, is_self] of fb_intervals) {
      if (start <= t && t < end) {
        return is_self ? 'fb_self' : 'fb_other';
      }
    }
    return 'non_fb';
  };

  for (const ev of result.hits) {
    if (ev.caster !== char_name) {
      continue;
    }

    const burst_stat: CategoryStat = bd[_burst_category(ev.t)];
    burst_stat.damage += ev.damage;
    burst_stat.hits += 1;

    if (_is_normal(ev)) {
      bd.normal_atk.damage += ev.damage;
      bd.normal_atk.hits += 1;
    } else {
      bd.skill.damage += ev.damage;
      bd.skill.hits += 1;
      if (!Object.prototype.hasOwnProperty.call(bd._skill_detail, ev.skill_name)) {
        bd._skill_detail[ev.skill_name] = new CategoryStat();
      }
      bd._skill_detail[ev.skill_name]!.damage += ev.damage;
      bd._skill_detail[ev.skill_name]!.hits += 1;
    }
  }

  return bd;
}

// py: calculator/sim_result.py:625
/** 스쿼드 전원을 분석해 DamageBreakdown 목록으로 반환한다. 딜량 내림차순 정렬. */
export function analyze_team(result: SimResult): DamageBreakdown[] {
  const breakdowns = Object.keys(result.char_total).map((name) => analyze_damage(result, name));
  breakdowns.splice(0, breakdowns.length, ...sorted(breakdowns, (b) => -b.total));
  return breakdowns;
}

// py: calculator/sim_result.py:632
/**
 * 스쿼드 전체 분석 결과를 콘솔에 출력한다.
 * chars 지정 시 해당 캐릭터만 출력.
 */
export function print_team_analysis(result: SimResult, chars: string[] | null = null): void {
  console.log(result.summary(chars));
  console.log('');
  for (const bd of analyze_team(result)) {
    if (truthy(chars) && !chars!.includes(bd.char_name)) {
      continue;
    }
    console.log(bd.summary());
    console.log('');
  }
}

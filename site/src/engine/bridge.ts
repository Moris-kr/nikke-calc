/**
 * site/pybridge/bridge.py — 브라우저 요청을 계산기 API로 옮긴다. `run_request`와 `run_combat_power`.
 *
 * growth_comparison · recommendation 모듈은 `growth_comparison.ts` · `recommendation.ts`에 있다.
 */

import { data } from './data';
import { ValueError, deepcopy, get, has, int, isfinite, item, round, setdefault, sorted, truthy, or } from './py';
import {
  BUFF_TARGET_WATCH,
  normalize_burst_regen,
  normalize_character_overrides,
  normalize_console,
  normalize_element_windows,
  normalize_hacks,
  normalize_immune_windows,
  normalize_defense_rate_windows,
  normalize_normal_hit_coeff,
  normalize_burst_reaction,
  normalize_burst_sequence,
  normalize_optimal_range,
  normalize_optimal_range_windows,
  normalize_distance,
  normalize_distance_windows,
  normalize_range_model,
  normalize_synchro_level,
  _mark_float,
  _py_float,
  _py_float_repr,
  _py_is_dict,
  _py_repr,
  _py_str,
  _py_strip,
} from './customization';
// `_is_normal`은 히트 태그로 일반공격을 가려내는 엔진 정본이다.
import { _is_normal } from './sim_result';
import type { SimResult } from './sim_result';
import { simulate } from './timeline';
import * as char_spec from './spec';
import { combat_power } from './combat_power';

// 타임라인 버킷 크기(초).
export const TIMELINE_BUCKET = 1;

// 「정밀 분석」에서 쓰는 칸 크기(초).
export const FINE_BUCKET = 0.1;

// 보스 메이커의 사격 트랙이 쓰는 칸 크기(초).
export const SHOT_BUCKET = 0.1;

// 장탄 레인(계산기 타임라인)이 쓰는 칸.
export const STATE_BUCKET = 0.25;

// 무한 장탄의 센티널.
export const AMMO_SENTINEL = 99_999;

// py: site/pybridge/bridge.py:60
export function _build_shots(result: SimResult, names: string[], bucket: number = SHOT_BUCKET): Record<string, any> {
  const buckets = result.duration > 0 ? int(Math.ceil(result.duration / bucket)) : 0;
  const empty: Record<string, number[]> = {
    normal: new Array(buckets).fill(0), skill: new Array(buckets).fill(0),
    core: new Array(buckets).fill(0), explode: new Array(buckets).fill(0),
  };
  const chars: Record<string, Record<string, number[]>> = {};
  for (const name of names) {
    const row: Record<string, number[]> = {};
    for (const [key, r] of Object.entries(empty)) row[key] = [...r];
    chars[name] = row;
  }
  for (const hit of result.hits) {
    const row = get<Record<string, number[]> | undefined>(chars, hit.caster);
    if (row == null) {
      continue;
    }
    let index = int((hit.t + 1e-9) / bucket);
    if (index === buckets) {
      index = buckets - 1;
    }
    if (!(0 <= index && index < buckets)) {
      continue;
    }
    const tag = or(hit.hit_tag, '');
    row[_is_normal(hit) ? 'normal' : 'skill']![index]! += 1;
    if (tag.includes('core')) {
      row['core']![index]! += 1;
    }
    if (tag.includes('explosion')) {
      row['explode']![index]! += 1;
    }
  }
  return { bucket: bucket, buckets: buckets, chars: chars };
}

// py: site/pybridge/bridge.py:88
export function _burst_skill_name(name: string): string {
  for (const effect of get<any[]>(data().parsed_skills, name, [])) {
    if (get(effect, 'source') !== '스킬3') {
      continue;
    }
    const label = _py_strip(_py_str(or(get(effect, 'name'), '')).replace(/[0123456789 ]+$/, ''));
    if (label) {
      return label;
    }
  }
  return '';
}

// py: site/pybridge/bridge.py:109
// py: site/pybridge/bridge.py _fill_at_bucket_start
/** (시각, 값) 기록 → 칸마다 «칸이 시작될 때의 값». 첫 칸은 첫 기록, 기록이 없으면 0. */
export function _fill_at_bucket_start(out: number[], log: Array<[number, number]>, bucket: number): void {
  let at = 0;
  let current = log.length ? log[0]![1] : 0;
  for (let index = 0; index < out.length; index += 1) {
    const start = index * bucket;
    while (at < log.length && log[at]![0] < start) {
      current = log[at]![1];
      at += 1;
    }
    out[index] = current;
  }
}

export function _build_states(result: SimResult, names: string[], bucket: number = SHOT_BUCKET): Record<string, any> {
  if (result.log == null) {
    return {};
  }
  const buckets = result.duration > 0 ? int(Math.ceil(result.duration / bucket)) : 0;
  const chars: Record<string, any> = {};
  for (const name of names) {
    chars[name] = { ammo: new Array(buckets).fill(0), reload: [], maxAmmo: 0, maxAmmoTrack: new Array(buckets).fill(0) };
  }

  // 이름이 정수 모양이면 JS 객체 순회 순서가 바뀐다 — 순서가 결과에 영향은 없지만 Map으로 둔다.
  const events = new Map<string, Array<[number, number]>>();
  for (const name of names) events.set(name, []);
  for (const entry of result.log.ammo_log) {
    if (events.has(entry.caster)) {
      events.get(entry.caster)!.push([_py_float(entry.t), int(entry.ammo)]);
    }
  }
  for (const [name, log0] of events) {
    const log = sorted(log0, (it) => it[0]);
    log0.splice(0, log0.length, ...log);
    const row = chars[name];
    let mx = 0;
    let any = false;
    for (const [, ammo] of log) {
      if (ammo < AMMO_SENTINEL && (!any || ammo > mx)) { mx = ammo; any = true; }
    }
    row['maxAmmo'] = any ? mx : 0;
    _fill_at_bucket_start(row['ammo'], log, bucket);
  }

  // 칸마다 그때의 최대 장탄(엔진 `max_ammo_log`). py: bridge.py _build_states
  const maxEvents = new Map<string, Array<[number, number]>>();
  for (const name of names) maxEvents.set(name, []);
  for (const entry of result.log.max_ammo_log) {
    if (maxEvents.has(entry.caster)) {
      maxEvents.get(entry.caster)!.push([_py_float(entry.t), int(entry.ammo)]);
    }
  }
  for (const [name, log0] of maxEvents) {
    const log = sorted(log0, (it) => it[0]);
    _fill_at_bucket_start(chars[name]['maxAmmoTrack'], log, bucket);
  }

  for (const entry of result.log.reload_log) {
    const row = get(chars, entry.caster);
    if (row == null) {
      continue;
    }
    if (entry.event.includes('시작')) {
      row['reload'].push([round(_py_float(entry.t), 2), null]);
    } else if (row['reload'].length && row['reload'][row['reload'].length - 1][1] == null) {
      row['reload'][row['reload'].length - 1][1] = round(_py_float(entry.t), 2);
    }
  }
  for (const row of Object.values(chars)) {
    for (const span of row['reload']) {
      if (span[1] == null) {
        span[1] = round(_py_float(result.duration), 2);
      }
    }
  }

  return { bucket: bucket, buckets: buckets, chars: chars };
}

// py: site/pybridge/bridge.py:165
export function _build_timeline(result: SimResult, names: string[], bucket: number = TIMELINE_BUCKET): Record<string, any> {
  const buckets = result.duration > 0 ? int(Math.ceil(result.duration / bucket)) : 0;
  const damage: Record<string, number[]> = {};
  for (const name of names) damage[name] = new Array(buckets).fill(0);
  for (const hit of result.hits) {
    // 부동소수 나눗셈이 0.3/0.1 = 2.9999…로 떨어져 앞 칸에 붙는 일이 있다 — 보정한다.
    let index = int((hit.t + 1e-9) / bucket);
    // 마지막 순간의 히트는 마지막 칸에 넣는다.
    if (index === buckets) {
      index = buckets - 1;
    }
    if (0 <= index && index < buckets) {
      const row = get<number[] | undefined>(damage, hit.caster);
      if (row != null) {
        row[index]! += int(hit.damage);
      }
    }
  }

  const bursts: Record<string, any[]> = {};
  for (const name of names) bursts[name] = [];
  const full_burst: number[][] = [];
  const summary: Record<string, any> = {
    count: 0, lastStart: null, lastDuration: null,
    lastPlannedDuration: null, lastTruncated: false,
  };
  if (result.log != null) {
    let pending_start: number | null = null;
    let planned_end: number | null = null;
    for (const event of result.log.burst_log) {
      if (truthy(event.caster) && has(bursts, event.caster) && event.event.includes('사용')) {
        let stage = '';
        if (event.event.includes(':')) {
          const after = event.event.slice(event.event.indexOf(':') + 1);
          const sp = after.indexOf(' ');
          stage = sp < 0 ? after : after.slice(0, sp);
        }
        const entry: Record<string, any> = { t: round(event.t, 2), stage: stage };
        const skill = _burst_skill_name(event.caster);
        if (skill) {
          entry['skill'] = skill;
        }
        bursts[event.caster]!.push(entry);
      } else if (event.event === 'full_burst 시작') {
        pending_start = event.t;
        planned_end = event.planned_end ?? null;
        summary['count'] += 1;
        summary['lastStart'] = round(event.t, 2);
        summary['lastPlannedDuration'] = (
          planned_end != null ? round(planned_end - event.t, 2) : null);
      } else if (event.event === 'full_burst 종료' && pending_start != null) {
        full_burst.push([round(pending_start, 2), round(event.t, 2)]);
        summary['lastDuration'] = round(event.t - pending_start, 2);
        pending_start = null;
      }
    }
    if (pending_start != null) {
      const end = planned_end != null ? Math.min(result.duration, planned_end) : result.duration;
      full_burst.push([round(pending_start, 2), round(end, 2)]);
      summary['lastDuration'] = round(Math.max(0, end - pending_start), 2);
      summary['lastTruncated'] = planned_end != null && planned_end > result.duration + 1e-8;
    }
  }

  // 버스트 게이지(%) — 칸 **끝** 시점의 값.
  let gauge: number[] | null = null;
  if (result.log != null && result.log.gauge_log.length) {
    gauge = new Array(buckets).fill(0.0);
    const events = result.log.gauge_log;
    let j = 0;
    let cur = 0.0;
    for (let i = 0; i < buckets; i += 1) {
      const end = (i + 1) * bucket + 1e-9;
      while (j < events.length && events[j]!.t <= end) {
        cur = events[j]!.gauge;
        j += 1;
      }
      gauge[i] = round(cur, 1);
    }
  }

  // 게이지 점열 — 로그의 엔진 최소 단위(프레임) 그대로 [t, %]. 같은 (t, %)가 잇달아 오면 하나로 접는다.
  let gauge_points: number[][] | null = null;
  if (result.log != null && result.log.gauge_log.length) {
    gauge_points = [];
    for (const event of result.log.gauge_log) {
      const point = [round(event.t, 3), round(event.gauge, 1)];
      const last = gauge_points[gauge_points.length - 1];
      if (!gauge_points.length || last![0] !== point[0] || last![1] !== point[1]) {
        gauge_points.push(point);
      }
    }
  }

  return {
    bucket: bucket,
    buckets: buckets,
    damage: damage,
    bursts: bursts,
    fullBurst: full_burst,
    fullBurstSummary: summary,
    buffs: _build_buff_spans(result, names),
    ...(gauge != null ? { gauge: gauge } : {}),
    ...(gauge_points != null ? { gaugePoints: gauge_points } : {}),
  };
}

// 늘 걸려 있는 것들 — 타임라인에서 뺀다.
export const ALWAYS_ON_PREFIXES = ['소장품', '큐브', '장비 옵션'] as const;

// py: site/pybridge/bridge.py:266
export function _is_always_on(name: string): boolean {
  return ALWAYS_ON_PREFIXES.some((prefix) => name.startsWith(prefix));
}

// 화면에 실어 보낼 버프 줄 상한.
export const BUFF_TRACK_LIMIT = 60;
// 이보다 짧은 버프는 뺀다.
export const BUFF_MIN_SPAN = 0.2;

/** 튜플 키 → Map 키. */
const _tk = (...parts: unknown[]): string => JSON.stringify(parts);

// py: site/pybridge/bridge.py:276
export function _build_buff_spans(result: SimResult, names: string[]): Array<Record<string, any>> {
  if (result.log == null) {
    return [];
  }
  const duration = _py_float(or(result.duration, 0.0));
  // 파이썬 dict[tuple, dict] — 삽입 순서(pop 후 재삽입은 맨 뒤)까지 Map이 같다.
  const open_spans = new Map<string, Record<string, any>>();
  const tracks = new Map<string, Record<string, any>>();

  const track_for = (event: any): Record<string, any> => {
    const key = _tk(event.name, event.caster);
    let found = tracks.get(key);
    if (found === undefined) {
      found = {
        name: event.name, caster: event.caster, targets: [],
        stat: event.stat ?? null, value: event.value ?? null,
        maxStack: truthy(event.max_stack) ? int(event.max_stack) : 1,
        // 구간(행) → 그 구간을 받은 사람들. 파이썬 dict[tuple, list] — Map(키: 행 튜플).
        _spans: new Map<string, { row: [number, number, number]; who: string[] }>(),
      };
      tracks.set(key, found);
    }
    if (truthy(event.target) && !found['targets'].includes(event.target)) {
      found['targets'].push(event.target);
    }
    return found;
  };

  const close = (key: string, at: number): void => {
    const span = open_spans.get(key);
    if (span === undefined) {
      return;
    }
    open_spans.delete(key);
    const start = span['from'];
    if (at - start < BUFF_MIN_SPAN) {
      return;
    }
    const row: [number, number, number] = [round(start, 2), round(at, 2), span['stack']];
    const spans: Map<string, { row: [number, number, number]; who: string[] }> = span['track']['_spans'];
    const rk = _tk(...row);
    let entry = spans.get(rk);
    if (entry === undefined) {
      entry = { row, who: [] };
      spans.set(rk, entry);
    }
    const who = entry.who;
    if (truthy(span['target']) && !who.includes(span['target'])) {
      who.push(span['target']);
    }
  };

  for (const event of result.log.buff_events) {
    if (!names.includes(event.target) && !names.includes(event.caster)) {
      continue;
    }
    if (_is_always_on(event.name)) {
      continue;
    }
    const key = _tk(event.name, event.caster, event.target);
    if (event.kind === 'activate') {
      const stack = truthy(event.stack) ? int(event.stack!) : 1;
      let open_span = open_spans.get(key);
      if (open_span !== undefined && open_span['stack'] !== stack) {
        close(key, event.t);
        open_span = undefined;
      }
      const track = track_for(event);
      if (event.value != null) {
        track['value'] = event.value;
      }
      if (open_span === undefined) {
        open_spans.set(key, {
          from: event.t, stack: stack, target: event.target,
          track: track, expires: event.expires_at,
        });
      } else {
        open_span['expires'] = event.expires_at;
      }
    } else {
      close(key, event.t);
    }
  }

  for (const [key, span] of [...open_spans.entries()]) {
    const expires = span['expires'];
    const end = (expires == null || expires === Infinity) || expires > duration ? duration : _py_float(expires);
    close(key, end);
  }

  const kept: Array<Record<string, any>> = [];
  for (const track of tracks.values()) {
    const spansMap: Map<string, { row: [number, number, number]; who: string[] }> = track['_spans'];
    delete track['_spans'];
    const rows = sorted([...spansMap.values()], (e) => e.row);
    if (!rows.length) {
      continue;
    }
    // 구간마다 대상이 같으면 줄 하나에 한 번만 적는다. 갈릴 때만 구간에 붙인다.
    const sets = rows.map((e) => sorted(new Set(e.who)).join('\u0000'));
    const varies = new Set(sets).size > 1;
    const spans: any[] = [];
    for (const { row: [start, end, stack], who } of rows) {
      if (varies) {
        spans.push([start, end, stack,
          who.map((name) => track['targets'].indexOf(name))]);
      } else {
        spans.push([start, end, stack]);
      }
    }
    track['spans'] = spans;
    kept.push(track);
  }
  // 처음 걸린 순서대로 세운다.
  const ordered = sorted(kept, (track) => [track['spans'][0][0], track['name']]);
  return ordered.slice(0, BUFF_TRACK_LIMIT);
}

// py: site/pybridge/bridge.py:377
export function _build_breakdown(result: SimResult, names: string[]): Record<string, any> {
  const breakdown: Record<string, any> = {};
  for (const name of names) {
    const hits = result.hits.filter((hit) => hit.caster === name);
    let normal_damage = 0;
    let skill_damage = 0;
    let normal_hits = 0;
    let skill_hits = 0;
    // 코어 명중은 **쏜 것**에만 있다.
    let shots = 0;
    let core_shots = 0.0;
    const per_skill = new Map<string, { damage: number; hits: number }>();
    for (const hit of hits) {
      if (hit.core_frac != null) {
        shots += 1;
        core_shots += hit.core_frac;
      }
      if (_is_normal(hit)) {
        normal_damage += hit.damage;
        normal_hits += 1;
        continue;
      }
      skill_damage += hit.damage;
      skill_hits += 1;
      let entry = per_skill.get(hit.skill_name);
      if (entry === undefined) {
        entry = { damage: 0, hits: 0 };
        per_skill.set(hit.skill_name, entry);
      }
      entry.damage += hit.damage;
      entry.hits += 1;
    }
    breakdown[name] = {
      normal: int(normal_damage),
      normalHits: normal_hits,
      skill: int(skill_damage),
      skillHits: skill_hits,
      shots: shots,
      // 기대값 모드에서는 한 발이 «코어 0.148발»처럼 쪼개져 들어온다.
      coreShots: round(core_shots, 3),
      skills: sorted(
        [...per_skill.entries()].map(([skill, v]) => ({ name: skill, damage: int(v.damage), hits: v.hits })),
        (it) => -it.damage,
      ),
    };
  }
  return breakdown;
}

export const _REQUIRED_NIKKE_FIELDS = [
  'rarity', 'element_code', 'class', 'weapon_type', 'burst_stage',
  'burst_cooldown', 'max_ammo', 'reload_time', 'fire_rate', 'damage_coeff',
] as const;

// py: site/pybridge/bridge.py:432
/**
 * 브라우저에서 넘어온 커스텀 니케를 엔진 전역에 병합한다.
 *
 * 파이썬은 parsed_nikke·parsed_skills 사본을 모듈마다 들고 있어(timeline · base_stat · buff_manager ·
 * growth · spec) 전부에 얹는다. 여기서는 모든 모듈이 `data().parsed_nikke` · `data().parsed_skills`
 * 한 벌을 함께 보므로 그 둘에 얹으면 전부에 반영된다.
 */
export function _inject_custom_characters(custom: any): void {
  if (!truthy(custom)) {
    return;
  }
  char_spec._nikke();  // spec의 지연 캐시를 먼저 로드(여기서는 할 일 없음)
  const nikke_stores = [data().parsed_nikke];
  const skill_stores = [data().parsed_skills];
  for (const [name, d] of Object.entries(custom as Record<string, any>)) {
    if (!_py_is_dict(d) || !has(d, 'nikke') || !has(d, 'skills')) {
      throw ValueError(`커스텀 니케 '${name}': nikke와 skills가 필요합니다`);
    }
    const nikke: Record<string, any> = { ...(d['nikke'] as Record<string, any>) };
    let skills = d['skills'];
    const missing = _REQUIRED_NIKKE_FIELDS.filter((f) => !has(nikke, f));
    if (missing.length) {
      throw ValueError(`커스텀 니케 '${name}': 누락된 스탯 ${_py_repr(missing)}`);
    }
    if (!Array.isArray(skills)) {
      throw ValueError(`커스텀 니케 '${name}': skills는 배열이어야 합니다`);
    }
    // 사용자 JSON은 숫자 단계와 "버스트스킬" 표기를 허용한다.
    nikke['burst_stage'] = _py_str(nikke['burst_stage']);
    skills = skills.map((effect: any) => (_py_is_dict(effect) && get(effect, 'source') === '버스트스킬'
      ? { ...effect, source: '스킬3' }
      : effect));
    for (const store of nikke_stores) {
      store[name] = nikke;
    }
    for (const store of skill_stores) {
      store[name] = skills;
    }
  }
}

// py: site/pybridge/bridge.py:471
export function _build_buff_targets(result: SimResult, names: string[]): Record<string, any> {
  const log = (result as any).log ?? null;
  if (log == null) {
    return {};
  }
  const out: Record<string, any[]> = {};
  for (const caster of names) {
    const watches = get(BUFF_TARGET_WATCH, caster);
    if (!truthy(watches)) {
      continue;
    }
    const rows: any[] = [];
    for (const [buff_name, label] of watches!) {
      const sequence: Array<Record<string, any>> = [];
      for (const ev of log.buff_events) {
        if (ev.kind !== 'activate' || ev.caster !== caster) {
          continue;
        }
        // 같은 스킬의 판본(애장품 등)이 이름 뒤에 붙어 오는 경우가 있다.
        if (ev.name !== buff_name && !ev.name.startsWith(`${buff_name} (`)) {
          continue;
        }
        if (names.includes(ev.target)) {
          sequence.push({ t: round(ev.t, 2), target: ev.target });
        }
      }
      // 처음 받은 순서대로 중복을 없앤다.
      const order: string[] = [];
      for (const it of sequence) {
        if (!order.includes(it['target'])) {
          order.push(it['target']);
        }
      }
      rows.push({
        label: label,
        buff: buff_name,
        targets: order,
        sequence: sequence,
        count: sequence.length,
      });
    }
    if (rows.length) {
      out[caster] = rows;
    }
  }
  return out;
}

// py: site/pybridge/bridge.py:514
/**
 * 캐릭터별 인게임 전투력. 목록 정렬에만 쓰고 딜 계산과는 무관하다.
 *
 * `{"characters": {이름: 오버라이드}}` 를 받아 `{이름: 전투력}` 을 준다.
 * 오버라이드가 없는 캐릭터는 기본 스펙으로 잰다.
 */
export function run_combat_power(raw: string | Record<string, any>): string {
  const payload = _loads(raw);
  _inject_custom_characters(or(get(payload, 'customCharacters'), {}));
  const raw_characters = or(get(payload, 'characters'), {} as Record<string, any>) as Record<string, any>;
  // `payload.get("names") or raw_characters` — 사전을 순회하면 키.
  const name_src = or(get(payload, 'names'), raw_characters) as any;
  const names: string[] = (Array.isArray(name_src) ? name_src : Object.keys(name_src)).map((n: any) => _py_str(n));

  // 파이썬 dict — 조회만 한다.
  const overrides: Record<string, any> = {};
  for (const name of names) {
    if (has(raw_characters, name)) {
      overrides[name] = normalize_character_overrides(get(raw_characters, name), { character_name: name });
    }
  }
  // 싱크로와 콘솔은 계정 육성 상태다 — 딜 계산과 **같은 값**을 받아야 화면의 두 숫자가 어긋나지 않는다.
  const console_ = normalize_console(get(payload, 'console'));
  const synchro = normalize_synchro_level(get(payload, 'synchroLevel'));
  for (const name of names) {
    if (truthy(console_)) {
      const over = setdefault(overrides, name, {} as Record<string, any>);
      over['console'] = { ...char_spec.DEFAULT_CHAR['console'], ...console_ };
    }
    if (synchro != null) {
      setdefault(overrides, name, {} as Record<string, any>)['level'] = synchro;
    }
  }
  // 파이썬 dict 삽입 순서 — 응답 키 순서(정수 모양 이름 대비 Map).
  const out = new Map<string, number>();
  for (const name of names) {
    try {
      const char = char_spec.build_squad([name], overrides)[0]!;
      out.set(name, round(combat_power(char), 2));
    } catch {
      // 한 명이 걸려도 목록 전체가 죽으면 안 된다 — 그 캐릭터만 뺀다.
      continue;
    }
  }
  return '{' + [...out].map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',') + '}';
}

/** 파이썬 `json.loads`처럼 매번 새 객체를 쓴다(이미 파싱된 객체를 받으면 사본을 뜬다). */
function _loads(raw: string | Record<string, any>): Record<string, any> {
  return typeof raw === 'string' ? JSON.parse(raw) : deepcopy(raw);
}

/** 파이썬 `isinstance(x, (int, float))` — bool도 int다. */
function _is_real(x: unknown): boolean {
  return typeof x === 'number' || typeof x === 'boolean';
}

let _LAST_RESULT: SimResult | null = null;

/** TS 전용(대조 도구) — 마지막 `simulate` 결과의 히트 `[t, 시전자, 대미지, 스킬, 태그, 크리]`. */
export function __lastHits(): unknown[] | undefined {
  return _LAST_RESULT?.hits.map((h) => [h.t, h.caster, h.damage, h.skill_name, h.hit_tag, truthy(h.is_crit)]);
}

// py: site/pybridge/bridge.py:553
// py: site/pybridge/bridge.py _in_slot_order
/** 캐릭터별 값을 편성 자리 순서로. 편성에 없는 키(있다면)는 뒤에 원래 순서대로. */
export function _in_slot_order(totals: Record<string, number>, names: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of names) if (Object.prototype.hasOwnProperty.call(totals, n)) out[n] = totals[n]!;
  for (const [k, v] of Object.entries(totals)) if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = v;
  return out;
}

export function run_request(raw: string | Record<string, any>, include_effective: boolean = false): string {
  _LAST_RESULT = null;
  const payload = _loads(raw);
  _inject_custom_characters(or(get(payload, 'customCharacters'), {}));
  const names: string[] = (item(payload, 'squad') as any[]).map((name) => _py_strip(_py_str(name)));
  const raw_characters = or(get(payload, 'characters'), {} as Record<string, any>) as Record<string, any>;
  if (!_py_is_dict(raw_characters)) {
    throw ValueError('캐릭터 설정은 객체여야 합니다.');
  }
  const nameSet = new Set(names);
  const outside = sorted(Object.keys(raw_characters).filter((k) => !nameSet.has(k)));
  if (outside.length) {
    throw ValueError(`스쿼드에 없는 캐릭터 설정: ${_py_repr(outside)}`);
  }
  // 파이썬 dict — 순회 순서가 config에 실리므로(정수 모양 이름 대비) Map으로 삽입 순서를 지킨다.
  const characters = new Map<string, Record<string, any>>();
  for (const name of names) {
    if (has(raw_characters, name)) {
      // 같은 이름이 두 번이면 파이썬 dict 컴프리헨션처럼 다시 계산해 덮어쓴다(자리는 처음 것 — Map도 같다).
      characters.set(name, normalize_character_overrides(
        get(raw_characters, name), { character_name: name },
      ));
    }
  }
  const _setdefault = (name: string): Record<string, any> => {
    let o = characters.get(name);
    if (o === undefined) {
      o = {};
      characters.set(name, o);
    }
    return o;
  };
  // 콘솔은 계정 속성이라 요청 최상위로 온다 — 스쿼드 전원에게 똑같이 얹는다.
  const console_ = normalize_console(get(payload, 'console'));
  if (truthy(console_)) {
    for (const name of names) {
      const overrides = _setdefault(name);
      overrides['console'] = {
        ...char_spec.DEFAULT_CHAR['console'], ...console_,
      };
    }
  }
  // 싱크로 레벨도 계정 속성이다.
  const synchro = normalize_synchro_level(get(payload, 'synchroLevel'));
  if (synchro != null) {
    for (const name of names) {
      _setdefault(name)['level'] = synchro;
    }
  }
  // 버스트 게이지 충전 시간도 계정/전투 단위다.
  const burst_regen = normalize_burst_regen(get(payload, 'burstRegenTime'));
  if (burst_regen != null) {
    for (const name of names) {
      const o = _setdefault(name);
      o['burst_regen_time'] = burst_regen;
      _mark_float(o, 'burst_regen_time');   // float(raw)
    }
  }
  const characters_dict: Record<string, any> = {};
  for (const [k, v] of characters) characters_dict[k] = v;
  const squad = char_spec.build_squad(names, characters_dict);
  const effective = include_effective ? deepcopy(squad) : null;
  const config_in: Record<string, any> = { duration: int(item(payload, 'duration')) };
  // 버스트 운용 배정 → config["burst_pattern"].
  const burst_pattern: Record<string, any> = {};
  const no_burst: string[] = [];
  for (const [name, overrides] of characters) {
    const assignment = get(overrides, '_burst_assignment');
    if (!_py_is_dict(assignment)) {
      continue;
    }
    if (get(assignment, 'mode') === 'priority') {
      burst_pattern[name] = `every:${int(get(assignment, 'every', 1))}`;
    } else if (get(assignment, 'mode') === 'endgame') {
      // 남은 시간이 N초 미만이면 최우선.
      burst_pattern[name] = `last:${_py_float_repr(_py_float(get(assignment, 'seconds', 20.0)))}`;
    } else if (get(assignment, 'mode') === 'skip') {
      // 「안 씀」은 후보에서 빼는 것이다.
      no_burst.push(name);
    }
  }
  if (truthy(burst_pattern)) {
    config_in['burst_pattern'] = burst_pattern;
  }
  if (no_burst.length) {
    config_in['no_burst_chars'] = no_burst;
  }
  // 손으로 정한 버스트 순서 → config["burst_sequence"].
  const sequence = normalize_burst_sequence(get(payload, 'burstSequence'), names);
  if (sequence != null) {
    config_in['burst_sequence'] = sequence;
  }
  // 버스트 반응속도.
  const first_burst = _py_float(get(payload, 'firstBurstTime', 0));
  if (!isfinite(first_burst) || !(0 <= first_burst && first_burst <= 3600)) {
    throw ValueError('첫 버스트 시간은 0~3600초여야 합니다.');
  }
  config_in['first_burst_time'] = first_burst;
  const reaction = normalize_burst_reaction(get(payload, 'burstReaction'));
  if (reaction != null) {
    config_in['burst_reaction'] = reaction;
  }
  // 난수 처리: "random" / "expected"(기대값, 결정론적). 안 주면 기대값.
  const rng_mode = _py_str(or(get(payload, 'rngMode'), 'expected'));
  if (!['random', 'expected'].includes(rng_mode)) {
    throw ValueError('난수 모드는 random 또는 expected여야 합니다');
  }
  config_in['rng_mode'] = rng_mode;
  // 파츠 파괴 주기(초).
  const part_break = get(payload, 'partBreakInterval');
  if (part_break != null) {
    const interval = _py_float(part_break);
    if (!isfinite(interval) || interval < 0) {
      throw ValueError('파츠 파괴 주기는 0 이상이어야 합니다');
    }
    if (interval > 0) {
      config_in['part_break_interval'] = interval;
    }
  }
  // 족자 중 버스트 게이지 정지 여부. 안 주면 켠 것으로 본다.
  const blocks = get(payload, 'immuneBlocksBurst');
  config_in['immune_blocks_burst'] = blocks == null ? true : truthy(blocks);
  // 버스트 게이지 판정 — "new"(accumulate) / "legacy"(fixed). 안 주면 신 방식.
  const gauge_mode = _py_str(or(get(payload, 'burstGaugeMode'), 'new'));
  if (!['new', 'legacy'].includes(gauge_mode)) {
    throw ValueError('버스트 게이지 방식은 new 또는 legacy여야 합니다');
  }
  config_in['burst_gauge_mode'] = gauge_mode === 'new' ? 'accumulate' : 'fixed';
  // 핵. 하나도 안 켰으면 아예 안 싣는다.
  const hacks = normalize_hacks(get(payload, 'hacks'));
  if (hacks != null) {
    config_in['cheats'] = hacks;
  }
  const config = char_spec.build_config(squad, config_in);
  // 평타 계수는 우리 쪽 명중의 문제라 config에 둔다.
  const hit_coeff = normalize_normal_hit_coeff(get(payload, 'normalHitCoeff'));
  if (truthy(hit_coeff)) {
    config['normal_hit_coeff'] = hit_coeff;
  }

  const shotgun_rate = _py_float(get(payload, 'shotgunHitRate', 1));
  if (!isfinite(shotgun_rate) || !(0 <= shotgun_rate && shotgun_rate <= 1)) {
    throw ValueError('샷건 펠릿 명중 확률은 0~100%여야 합니다');
  }
  const shotgun_model = get(payload, 'shotgunModel', 'legacy');
  if (!['legacy', 'spatial-v1', 'spatial-convergence-v1'].includes(shotgun_model)) {
    throw ValueError('샷건 계산 방식이 올바르지 않습니다');
  }
  const shotgun_diameter = _py_float(get(payload, 'shotgunTargetDiameter', 360));
  if (!isfinite(shotgun_diameter) || !(1 <= shotgun_diameter && shotgun_diameter <= 2000)) {
    throw ValueError('보스 판정 직경은 1~2000이어야 합니다');
  }
  const size_windows = or(get(payload, 'shotgunSizeWindows'), [] as any[]) as any;
  if (!Array.isArray(size_windows) || size_windows.length > 100) {
    throw ValueError('보스 크기 구간은 최대 100개입니다');
  }
  for (let i = 0; i < size_windows.length; i += 1) {
    const w = size_windows[i];
    if (!_py_is_dict(w)
      || !['from', 'to', 'diameter'].every((k) => _is_real(get(w, k)) && isfinite(Number(w[k])))
      || !(0 <= w['from'] && w['from'] < w['to'] && w['to'] <= 180 && 1 <= w['diameter'] && w['diameter'] <= 2000)) {
      throw ValueError('보스 크기 구간의 시간 또는 직경이 올바르지 않습니다');
    }
    if (size_windows.slice(0, i).some((v: any) => w['from'] < v['to'] && v['from'] < w['to'])) {
      throw ValueError('보스 크기 구간은 서로 겹칠 수 없습니다');
    }
  }
  const enemy: Record<string, any> = {
    shotgun_model: shotgun_model,
    shotgun_report: truthy(get(payload, 'shotgunReport')),
    shotgun_target_diameter: shotgun_diameter,
    shotgun_size_windows: size_windows,
    shotgun_hit_rate: shotgun_rate,
    ...(get(payload, 'shotgunGeometry') != null ? { shotgun_geometry: payload['shotgunGeometry'] } : {}),
    def: int(item(payload, 'enemyDef')),
    code: _py_str(or(get(payload, 'enemyCode'), '')),
    core_px: _py_float(or(get(payload, 'corePx'), 0)),
    core_windows: normalize_immune_windows(get(payload, 'coreWindows')),
    defense_rate_windows: normalize_defense_rate_windows(get(payload, 'defenseRateWindows')),
    has_parts: truthy(get(payload, 'hasParts')),
    // 적정거리는 무기군 단위로 켜진다.
    optimal_range_weapons: normalize_optimal_range(
      get(payload, 'optimalRangeWeapons'),
    ),
    // 보스 페이즈 — 족자(딜 차단)와 속저(우월 코드만 통과).
    optimal_range_windows: normalize_optimal_range_windows(get(payload, 'optimalRangeWindows')),
    // 신식(distance)이면 거리가 적정거리 무기군·코어/보스 크기·탄착군 표를 정하고 위 두 값은 쓰지 않는다.
    range_model: normalize_range_model(get(payload, 'rangeModel')),
    distance: normalize_distance(get(payload, 'distance')),
    distance_windows: normalize_distance_windows(get(payload, 'distanceWindows')),
    immune_windows: normalize_immune_windows(get(payload, 'immuneWindows')),
    element_windows: normalize_element_windows(get(payload, 'elementWindows')),
  };
  // 관통이 꿰뚫는 몸통·파츠 수.
  const pierce = get(payload, 'piercePass');
  if (_py_is_dict(pierce)) {
    // `or`로 기본값을 주면 0이 1로 둔갑한다 — 없을 때만 채운다.
    const raw_shapes = get(pierce, 'shapes');
    const raw_parts = get(pierce, 'parts');
    const shapes = int(raw_shapes == null ? 1 : raw_shapes);
    const parts = int(raw_parts == null ? 0 : raw_parts);
    if (shapes < 1 || parts < 0 || shapes > 20 || parts > 20) {
      throw ValueError('관통 대상 수가 범위를 벗어났습니다');
    }
    enemy['pierce_pass'] = { shapes: shapes, parts: parts };
  }
  // simulate(squad, config=config, enemy=enemy, seed=..., verbose=True) — 위치 인자 순서는
  // 파이썬 시그니처(squad, config, enemy, verbose, seed) 그대로다.
  const result = simulate(
    squad,
    config,
    enemy,
    true,
    int(item(payload, 'seed')),
  );
  _LAST_RESULT = result;
  let response: Record<string, any> = {
    squadTotal: result.squad_total,
    duration: result.duration,
    hitCount: result.hits.length,
    // 엔진은 이름순으로 돈다(자리와 무관한 결과). 응답은 편성 자리 순서로 돌려준다.
    charTotals: _in_slot_order(result.char_total, names),
    ...(truthy(result.shotgun_stats) ? { shotgunStats: result.shotgun_stats } : {}),
    ...(truthy(result.shotgun_report) ? { shotgunReport: result.shotgun_report } : {}),
    charBreakdown: _build_breakdown(result, names),
    previewNote: char_spec.preview_note(names),
    deviations: char_spec.format_deviations(squad) + (
      names.includes('마스트 : 로망틱 메이드') && enemy['range_model'] !== 'distance'
        ? '\n계산 한계: 마스트 : 로망틱 메이드의 취기 명중률 감소는 중첩되지만, '
          + 'MG 탄착군은 현재 10px 고정 가정입니다. 예열·취기에 따른 탄착군 변화는 '
          + '실측 계수가 없어 반영되지 않으며, 10px 이상 코어의 크기 차이는 결과에 나타나지 않습니다.'
        : ''),
    timeline: _build_timeline(result, names),
    buffTargets: _build_buff_targets(result, names),
  };
  // 「정밀 분석」 — 같은 결과를 더 잘게 나눈 표를 하나 더 싣는다.
  if (truthy(get(payload, 'fineTimeline'))) {
    response['fineTimeline'] = _build_timeline(result, names, FINE_BUCKET);
  }
  // 보스 메이커 전용 — 사격 밀도.
  if (truthy(get(payload, 'shotTrack'))) {
    response['shots'] = _build_shots(result, names);
    // 사격 트랙을 볼 때는 탄환·재장전도 같이 본다.
    response['states'] = _build_states(result, names);
    // 차지 무기의 발마다 [시작, 풀차지 도달, 발사, 풀차지 배율%, 풀차지였나].
    const charges: Record<string, any[]> = {};
    if (result.log != null) {
      for (const entry of result.log.charge_log) {
        if (names.includes(entry.caster)) {
          setdefault(charges, entry.caster, [] as any[]).push([
            round(entry.start, 3), round(entry.full_at, 3), round(entry.fire, 3),
            round(entry.value, 1), truthy(entry.full) ? 1 : 0]);
        }
      }
    }
    if (truthy(charges)) {
      response['charges'] = charges;
    }
  } else if (truthy(get(payload, 'stateTrack'))) {
    // 계산기 타임라인의 장탄 레인.
    response['states'] = _build_states(result, names, STATE_BUCKET);
  }
  if (include_effective) {
    response = { result: response, effectiveCharacters: effective };
  }
  return JSON.stringify(response);
}

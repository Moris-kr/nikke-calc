/**
 * 육성 프로필(2.5층) — 파이썬 `context/spec.py`의 `GrowthProfile` · `load_profile`.
 *
 * 엔진 `spec.ts`는 파일 시스템을 쓰지 않아 이 둘을 옮기지 않았다. `build_char(..., profile)`은 오리
 * 타이핑으로 `profile.layer(이름)`만 부르므로, 같은 모양의 객체를 여기서 만든다.
 * `profiles/*.json`은 개인 자료라 저장소에 없다(.gitignore).
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { _DEFAULT_CHAR, GROWTH_KEYS, LEVEL_MODES } from '../../../../site/src/engine/spec';
import { _deepcopy_marked, _py_repr, _py_str, _is_float } from '../../../../site/src/engine/customization';
import { get, sorted, truthy } from '../../../../site/src/engine/py';
import { ROOT } from './engine_env';
import { SystemExit, loadJson } from './pycompat';

export const PROFILE_DIR = join(ROOT, 'profiles');

export class GrowthProfile {
  meta: Record<string, any>;
  account: Record<string, any>;
  chars: Record<string, any>;
  allow_unowned: boolean;
  level_mode: string;
  unowned: string[] = [];

  constructor(data: Record<string, any>, allow_unowned = false, level_mode = 'fixed') {
    if (!(LEVEL_MODES as readonly string[]).includes(level_mode)) {
      throw SystemExit(`레벨 정책은 ('fixed', 'sync') 중 하나여야 한다 (${_py_repr(level_mode)})`);
    }
    this.meta = truthy(data['_meta']) ? data['_meta'] : {};
    this.account = truthy(data['_account']) ? data['_account'] : {};
    this.chars = truthy(data['chars']) ? data['chars'] : {};
    this.allow_unowned = allow_unowned;
    this.level_mode = level_mode;
    if (level_mode === 'sync' && !truthy(get(this.account, 'synchro_level'))) {
      throw SystemExit(
        `프로필 '${_py_str(get(this.meta, 'name', '?'))}'에 동기화 소대 레벨이 없다 — `
        + '레벨 정책 sync를 쓸 수 없다. 프로필을 다시 받는다.');
    }
  }

  get name(): string {
    const n = get(this.meta, 'name');
    return truthy(n) ? _py_str(n) : '?';
  }

  layer(char_name: string): Record<string, any> {
    const entry = get(this.chars, char_name);
    if (entry == null) {
      if (!this.allow_unowned) {
        throw SystemExit(
          `[${char_name}] 육성 프로필 '${this.name}'에 없다 — 미보유이거나 수집 후 `
          + '영입한 캐릭터다. 고정 스펙으로 대체하려면 미보유 허용 옵션을 쓴다'
          + '(sim.py `--allow-unowned`). 최근에 영입했다면 프로필을 다시 받는다.');
      }
      if (!this.unowned.includes(char_name)) this.unowned.push(char_name);
      return {};
    }
    const out = _deepcopy_marked(entry);
    if (truthy(get(this.account, 'console'))) out['console'] = _deepcopy_marked(this.account['console']);
    if (this.level_mode === 'sync') out['level'] = this.account['synchro_level'];
    return out;
  }

  cube_notes(squad: Array<Record<string, any>>): string[] {
    const owned = (truthy(get(this.account, 'cubes')) ? this.account['cubes'] : {}) as Record<string, any>;
    if (!truthy(owned)) return [];
    const short = new Map<string, [any, any]>();
    for (const c of squad) {
      const cube = (truthy(get(c, 'cube')) ? c['cube'] : {}) as Record<string, any>;
      const nm = get(cube, 'name'); const lv = get(cube, 'level');
      if (nm != null && Object.prototype.hasOwnProperty.call(owned, nm) && lv != null && lv > owned[nm]) {
        short.set(nm, [lv, owned[nm]]);
      }
    }
    if (!short.size) return [];
    return ['요구 큐브 레벨이 관찰된 보유분보다 높다: '
      + [...short].map(([nm, [need, have]]) => `${nm} Lv${_py_str(need)}(보유 관찰 ${_py_str(have)})`).join(', ')
      + '. 관찰분은 장착 중이던 큐브에서 온 **하한**이라 실제로는 더 높을 수 있다'];
  }

  notes(names: string[]): string[] {
    const out: string[] = [];
    if (!truthy(get(this.account, 'console'))) {
      out.push(`프로필 '${this.name}'에 콘솔 레벨이 없다 — 기본 스펙 값`
        + '(공통 180 / 클래스 100 / 기업 100)으로 계산했다.');
    }
    out.push(...((get(this.account, 'console_warnings') || []) as string[]));
    const under: string[] = [];
    for (const n of names) {
      const sl = (get(get(this.chars, n) || {}, 'skill_levels', {}) || {}) as Record<string, any>;
      if (Object.values(sl).some((v) => v < 10)) under.push(n);
    }
    if (under.length) {
      out.push('스킬 레벨이 10 미만인 캐릭터: '
        + under.map((n) => {
          const sl = this.chars[n]['skill_levels'];
          return `${n} ${Object.keys(sl).map((k) => _py_str(sl[k], _is_float(sl, k))).join('/')}`;
        }).join(', ')
        + '. 딜이 낮게 나오는 게 정상이다 — 조합 탓이 아니다.');
    }
    const low: Array<[string, any]> = [];
    for (const n of names) {
      const e = get(this.chars, n) || {};
      const lv = get(e, 'favorite_stage');
      if (lv != null && lv < 3) low.push([n, _py_str(lv, _is_float(e, 'favorite_stage'))]);
    }
    if (low.length) {
      out.push('애장품 단계가 3 미만인 캐릭터: '
        + low.map(([n, lv]) => `${n} ${lv}단계`).join(', ')
        + '. 그 단계의 스킬 판본으로 계산했다 — 기본 스펙(3단계)보다 '
        + '딜이 낮게 나오는 게 정상이다.');
    }
    if (this.unowned.length) out.push(`프로필에 없어 **기본 스펙으로 대체**한 캐릭터: ${_py_repr(this.unowned)}`);
    return out;
  }

  level_text(): string {
    if (this.level_mode === 'sync') return `동기화 소대 레벨 ${_py_str(this.account['synchro_level'])}`;
    return `레벨 ${_py_str(_DEFAULT_CHAR()['level'])} 고정 (솔로레이드 기준)`;
  }

  header(): string {
    const m = this.meta;
    return `육성 프로필 '${this.name}' 적용 — 고정 스펙 아님. 다른 보고서와 총딜을 직접 `
      + `비교하지 않는다. (${this.level_text()}, 수집 ${_py_str(get(m, 'fetched_at', '?'))}, `
      + `로스터 ${_py_str(get(m, 'roster', '?'))}종)`;
  }
}

/** `profiles/<name>.json` → `GrowthProfile`. 없거나 형식이 어긋나면 끊는다. */
export function load_profile(name: string, allow_unowned = false, level_mode = 'fixed'): GrowthProfile {
  const path = join(PROFILE_DIR, `${name}.json`);
  if (!existsSync(path)) {
    const have = existsSync(PROFILE_DIR)
      ? sorted(readdirSync(PROFILE_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.raw.json'))
        .map((f) => f.slice(0, -5)))
      : [];
    throw SystemExit(
      `육성 프로필 '${name}'이 없다 (${path}). `
      + `있는 프로필: ${have.length ? _py_repr(have) : '없음'}. 만들려면 \`python scraper/profile_fetch.py\`.`);
  }
  const data = loadJson(path);
  if (!Object.prototype.hasOwnProperty.call(data, 'chars')) {
    throw SystemExit(`${path}: \`chars\` 키가 없다 — profile_fetch.py가 만든 파일이 아니다.`);
  }
  for (const [char_name, entry] of Object.entries(data['chars'] as Record<string, any>)) {
    const bad = sorted(Object.keys(entry).filter((k) => !k.startsWith('_') && !GROWTH_KEYS.has(k)));
    if (bad.length) {
      throw SystemExit(
        `${path}: [${char_name}]에 육성이 아닌 키가 있다 ${_py_repr(bad)}. 프로필은 육성만 담는다 `
        + '— 컨트롤·버스트 패턴은 운용이라 data/char_defaults.json이나 호출부에 둔다.');
    }
  }
  return new GrowthProfile(data, allow_unowned, level_mode);
}

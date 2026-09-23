/**
 * 육성 프로필 (2.5층, 선택) — `context/spec.py`의 `GrowthProfile`·`load_profile`을 옮긴 것이다.
 * 엔진(`src/engine/spec.ts`)은 프로필을 오리 타이핑으로 부른다(`layer`·`header`·`notes`·`cube_notes`).
 *
 * 고정 스펙 대신 **실제 계정의 육성 상태**로 돌릴 때만 끼는 레이어. 정본은
 * `profiles/<이름>.json`(gitignore, `scraper/profile_fetch.py`가 만든다).
 *
 * 프로필은 **육성만** 담는다. 컨트롤·버스트 패턴은 운용이라 조합·상황에 달려 있고 계정
 * 상태로 결정되지 않으므로 담지 않는다 — 실수로 들어오면 로드에서 끊는다.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { _deepcopy_marked, _py_repr, _py_str } from '../../src/engine/customization';
import { PyError, sorted } from '../../src/engine/py';
import { GROWTH_KEYS, LEVEL_MODES, _DEFAULT_CHAR } from '../../src/engine/spec';
import { ROOT } from './engine';
import { loadMarked } from './pyjson';

export const PROFILE_DIR = join(ROOT, 'profiles');

const SystemExit = (msg: string) => new PyError('SystemExit', msg);

/** 파이썬 튜플 repr `('fixed', 'sync')`. */
const tupleRepr = (xs: readonly string[]): string => `(${xs.map((x) => _py_repr(x)).join(', ')}${xs.length === 1 ? ',' : ''})`;

/**
 * 육성 프로필 한 벌. `layer(이름)`이 그 캐릭터의 2.5층을 준다.
 *
 * 미보유 캐릭터는 기본적으로 에러다. 고정 스펙으로 조용히 떨어지면 "내 계정 기준"이라는
 * 결과가 실제로는 만렙 가상 캐릭터를 섞은 게 되기 때문이다. `allow_unowned=true`로 허용할
 * 수 있고, 그때 대체된 이름은 `unowned`에 쌓여 러너가 결과에 함께 낸다.
 */
export class GrowthProfile {
  meta: Record<string, any>;
  account: Record<string, any>;
  chars: Record<string, any>;
  unowned: string[] = [];

  constructor(data: Record<string, any>, readonly allow_unowned = false, readonly level_mode = 'fixed') {
    if (!(LEVEL_MODES as readonly string[]).includes(level_mode)) {
      throw SystemExit(`레벨 정책은 ${tupleRepr(LEVEL_MODES)} 중 하나여야 한다 (${_py_repr(level_mode)})`);
    }
    this.meta = data['_meta'] || {};
    this.account = data['_account'] || {};
    this.chars = data['chars'] || {};
    if (level_mode === 'sync' && !this.account['synchro_level']) {
      throw SystemExit(
        `프로필 '${_py_str(this.meta['name'] ?? '?')}'에 동기화 소대 레벨이 없다 — `
        + '레벨 정책 sync를 쓸 수 없다. 프로필을 다시 받는다.');
    }
  }

  get name(): string {
    return _py_str(this.meta['name'] || '?');
  }

  layer(char_name: string): Record<string, any> {
    const entry = Object.prototype.hasOwnProperty.call(this.chars, char_name) ? this.chars[char_name] : undefined;
    if (entry == null) {
      if (!this.allow_unowned) {
        throw SystemExit(
          `[${char_name}] 육성 프로필 '${this.name}'에 없다 — 미보유이거나 수집 후 `
          + '영입한 캐릭터다. 고정 스펙으로 대체하려면 미보유 허용 옵션을 쓴다'
          + '(sim.ts `--allow-unowned`). 최근에 영입했다면 프로필을 다시 받는다.',
        );
      }
      if (!this.unowned.includes(char_name)) this.unowned.push(char_name);
      return {};
    }
    const out = _deepcopy_marked(entry);
    // 콘솔은 계정 단위라 캐릭터가 아니라 `_account`에 있다. 비어 있으면 1층 값이 남는다.
    if (this.account['console'] && Object.keys(this.account['console']).length) {
      out['console'] = _deepcopy_marked(this.account['console']);
    }
    // 레벨은 정책이 정한다. fixed면 아예 손대지 않아 1층의 400이 그대로 남는다.
    if (this.level_mode === 'sync') {
      out['level'] = this.account['synchro_level'];
    }
    return out;
  }

  /**
   * 스쿼드가 쓰는 큐브를 실제로 그 레벨로 갖고 있는지. 모르면 아무 말도 하지 않는다.
   *
   * 큐브는 프로필에 담기지 않는다(자유롭게 갈아끼우므로 육성이 아니라 케이스가 정하는
   * 축이다). 대신 `_account.cubes`에 **장착 중인 것에서 관찰된 보유 하한**이 있으므로,
   * 거기에 못 미치는 큐브를 요구하는 계산이면 "실제로는 못 하는 세팅"임을 알린다.
   * 하한일 뿐이라 목록에 없는 큐브는 판단하지 않는다 — 없다고 단정하면 오탐이 된다.
   */
  cube_notes(squad: Array<Record<string, any>>): string[] {
    const owned: Record<string, number> = this.account['cubes'] || {};
    if (!Object.keys(owned).length) return [];
    const short = new Map<string, [number, number]>();
    for (const c of squad) {
      const cube = c['cube'] || {};
      const nm = cube['name']; const lv = cube['level'];
      if (nm != null && Object.prototype.hasOwnProperty.call(owned, nm) && lv != null && lv > owned[nm]!) {
        short.set(nm, [lv, owned[nm]!]);
      }
    }
    if (!short.size) return [];
    return ['요구 큐브 레벨이 관찰된 보유분보다 높다: '
      + [...short].map(([nm, [need, have]]) => `${nm} Lv${_py_str(need)}(보유 관찰 ${_py_str(have)})`).join(', ')
      + '. 관찰분은 장착 중이던 큐브에서 온 **하한**이라 실제로는 더 높을 수 있다'];
  }

  /** 이 스쿼드에 걸리는 프로필 경고. 러너가 이탈 보고와 함께 그대로 낸다. */
  notes(names: string[]): string[] {
    const out: string[] = [];
    if (!(this.account['console'] && Object.keys(this.account['console']).length)) {
      out.push(`프로필 '${this.name}'에 콘솔 레벨이 없다 — 기본 스펙 값`
        + '(공통 180 / 클래스 100 / 기업 100)으로 계산했다.');
    }
    out.push(...(this.account['console_warnings'] || []));
    // 스킬 레벨은 레벨과 달리 고정되지 않는다. 기본 스펙(10/10/10)보다 낮으면 딜이 그만큼
    // 낮게 나오는데, 수치만 보면 조합이 나쁜 것처럼 읽히므로 따로 알린다.
    const entryOf = (n: string): Record<string, any> =>
      (Object.prototype.hasOwnProperty.call(this.chars, n) ? this.chars[n] : null) || {};
    const under = names.filter((n) => Object.values(entryOf(n)['skill_levels'] ?? {}).some((v: any) => v < 10));
    const underUniq = [...new Set(under)];
    if (underUniq.length) {
      out.push('스킬 레벨이 10 미만인 캐릭터: '
        + underUniq.map((n) => `${n} ${Object.values(this.chars[n]['skill_levels']).map((v) => _py_str(v)).join('/')}`).join(', ')
        + '. 딜이 낮게 나오는 게 정상이다 — 조합 탓이 아니다.');
    }
    // 애장품 단계는 스킬 판본을 바꾸므로(`buff_manager.char_effects()`) 딜에 직접 걸린다.
    // 기본 스펙은 3단계라, 낮은 단계로 계산된 캐릭터는 조합 탓처럼 읽히지 않게 따로 알린다.
    const low = new Map<string, any>();
    for (const n of names) {
      const lv = entryOf(n)['favorite_stage'];
      if (lv != null && lv < 3) low.set(n, lv);
    }
    if (low.size) {
      out.push('애장품 단계가 3 미만인 캐릭터: '
        + [...low].map(([n, lv]) => `${n} ${_py_str(lv)}단계`).join(', ')
        + '. 그 단계의 스킬 판본으로 계산했다 — 기본 스펙(3단계)보다 '
        + '딜이 낮게 나오는 게 정상이다.');
    }
    if (this.unowned.length) {
      out.push(`프로필에 없어 **기본 스펙으로 대체**한 캐릭터: ${_py_repr(this.unowned)}`);
    }
    return out;
  }

  level_text(): string {
    if (this.level_mode === 'sync') {
      return `동기화 소대 레벨 ${_py_str(this.account['synchro_level'])}`;
    }
    return `레벨 ${_py_str(_DEFAULT_CHAR()['level'])} 고정 (솔로레이드 기준)`;
  }

  header(): string {
    const m = this.meta;
    return `육성 프로필 '${this.name}' 적용 — 고정 스펙 아님. 다른 보고서와 총딜을 직접 `
      + `비교하지 않는다. (${this.level_text()}, 수집 ${_py_str(m['fetched_at'] ?? '?')}, `
      + `로스터 ${_py_str(m['roster'] ?? '?')}종)`;
  }
}

/** `profiles/<name>.json` → `GrowthProfile`. 없거나 형식이 어긋나면 끊는다. */
export function load_profile(name: string, allow_unowned = false, level_mode = 'fixed'): GrowthProfile {
  const path = join(PROFILE_DIR, `${name}.json`);
  if (!existsSync(path)) {
    const have = existsSync(PROFILE_DIR)
      ? sorted(readdirSync(PROFILE_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.raw.json')).map((f) => f.slice(0, -5)))
      : [];
    throw SystemExit(
      `육성 프로필 '${name}'이 없다 (${path}). `
      + `있는 프로필: ${have.length ? _py_repr(have) : '없음'}. 만들려면 \`python scraper/profile_fetch.py\`.`,
    );
  }
  const data = loadMarked(readFileSync(path, 'utf-8'));
  if (data === null || typeof data !== 'object' || Array.isArray(data) || !('chars' in data)) {
    throw SystemExit(`${path}: \`chars\` 키가 없다 — profile_fetch.py가 만든 파일이 아니다.`);
  }
  for (const [char_name, entry] of Object.entries(data['chars'] as Record<string, any>)) {
    const bad = sorted(Object.keys(entry).filter((k) => !k.startsWith('_') && !GROWTH_KEYS.has(k)));
    if (bad.length) {
      throw SystemExit(
        `${path}: [${char_name}]에 육성이 아닌 키가 있다 ${_py_repr(bad)}. 프로필은 육성만 담는다 `
        + '— 컨트롤·버스트 패턴은 운용이라 data/char_defaults.json이나 호출부에 둔다.',
      );
    }
  }
  return new GrowthProfile(data, allow_unowned, level_mode);
}

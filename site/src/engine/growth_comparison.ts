/**
 * site/pybridge/growth_comparison.py — 읽기 전용 육성 비교(정본 캐릭터 빌더 + 전투력 공식).
 */
import { combat_power } from './combat_power';
import { normalize_character_overrides, normalize_console, normalize_synchro_level, _py_is_dict, _py_str } from './customization';
import * as spec from './spec';
import { PyError, ValueError, deepcopy, get, has, round, truthy } from './py';

/** 파이썬 `type(x).__name__` (JSON 자료). */
function _py_type_name(v: unknown): string {
  if (v === null || v === undefined) return 'NoneType';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'string') return 'str';
  if (Array.isArray(v)) return 'list';
  return 'dict';
}

/** 파이썬 `x.get(k)` — 사전이 아니면 AttributeError(메시지 그대로). */
function _get_attr(x: unknown, key: string): any {
  if (!_py_is_dict(x)) {
    throw new AttributeError(`'${_py_type_name(x)}' object has no attribute 'get'`);
  }
  return get(x, key, null);
}

class AttributeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttributeError';
  }
}

// py: site/pybridge/growth_comparison.py:9
export function compare_growth(payload: Record<string, any>): Record<string, any> {
  const name = _get_attr(payload, 'name');
  const baseline: any = get(payload, 'baseline', null);
  const scenarios: any = get(payload, 'scenarios', null);
  if (!_py_is_dict(baseline) || !truthy(baseline)) {
    throw ValueError('현재 육성 정보가 없습니다. 브라우저에서 육성을 입력하거나 불러오세요.');
  }
  if (!Array.isArray(scenarios) || !(1 <= scenarios.length && scenarios.length <= 12)) {
    throw ValueError('육성 비교는 1~12개 변경안이 필요합니다.');
  }
  const synchro = normalize_synchro_level(get(payload, 'synchroLevel'));
  const console_ = normalize_console(get(payload, 'console'));

  const evaluate = (values: any): Record<string, any> => {
    const over = normalize_character_overrides(values, { character_name: name });
    if (synchro != null) {
      over['level'] = synchro;
    }
    if (console_ != null) {
      over['console'] = { ...spec.DEFAULT_CHAR['console'], ...console_ };
    }
    // 파이썬 `{name: over}`. 이름이 문자열이 아니면(None 등) 파이썬 `str(name)`으로 넘겨 build_char의
    // «메타데이터를 찾을 수 없다» 메시지가 파이썬과 같게 찍히게 한다.
    const key = _py_str(name);
    const char = spec.build_squad([key], { [key]: over })[0]!;
    return {
      combatPower: round(combat_power(char), 2), effectiveCharacter: char,
      deviations: spec.format_deviations([char]),
    };
  };

  const current = evaluate(baseline);
  const result: Array<Record<string, any>> = [];
  for (const scenario of scenarios) {
    const changes = _get_attr(scenario, 'changes');
    if (!_py_is_dict(changes) || !truthy(changes)) {
      throw ValueError('각 변경안에 변경할 육성을 지정하세요.');
    }
    // Merge web inputs before normalization: numeric OL levels replace tier strings.
    const values = spec.deep_merge(deepcopy(baseline), deepcopy(changes));
    const candidate = evaluate(values);
    const delta = round(candidate['combatPower'] - current['combatPower'], 2);
    if (!has(scenario, 'label')) {
      throw new PyError('KeyError', "'label'");
    }
    result.push({
      ...candidate, label: scenario['label'], changes: changes, delta: delta,
      percent: truthy(current['combatPower']) ? delta / current['combatPower'] * 100 : null,
    });
  }
  const missing = ['growthStage', 'equipLevels', 'collection', 'skillLevels', 'cube', 'overload']
    .filter((field) => !has(baseline, field));
  return {
    name: name, baseline: current, scenarios: result,
    baselineMissingFields: missing, previewNote: spec.preview_note([name]),
    limitations: ['예상 전투력입니다. 인게임 반올림·오버로드 단계 추정 때문에 표기값과 차이가 날 수 있습니다.',
      '각 변경안은 현재 육성에서 독립적으로 비교합니다. 누적 변경을 원하면 한 변경안에 함께 지정하세요.',
      '생략된 현재 육성은 기본값을 사용합니다. baselineMissingFields와 실제 적용값을 확인하세요.',
      '전투력 증가량은 대미지 증가량이나 캠페인 클리어 보장이 아닙니다.'],
  };
}

// py: site/pybridge/growth_comparison.py:51
export function run_growth_comparison(raw: string | Record<string, any>): string {
  const payload = typeof raw === 'string' ? JSON.parse(raw) : deepcopy(raw);
  return JSON.stringify(compare_growth(payload));
}

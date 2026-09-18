"""Read-only growth comparisons using the canonical character builder and CP formula."""
from copy import deepcopy
import json
from calculator.combat_power import combat_power
from calculator.customization import normalize_character_overrides, normalize_console, normalize_synchro_level
from context import spec


def compare_growth(payload: dict) -> dict:
    name = payload.get('name')
    baseline = payload.get('baseline')
    scenarios = payload.get('scenarios')
    if not isinstance(baseline, dict) or not baseline:
        raise ValueError('현재 육성 정보가 없습니다. 브라우저에서 육성을 입력하거나 불러오세요.')
    if not isinstance(scenarios, list) or not 1 <= len(scenarios) <= 12:
        raise ValueError('육성 비교는 1~12개 변경안이 필요합니다.')
    synchro = normalize_synchro_level(payload.get('synchroLevel'))
    console = normalize_console(payload.get('console'))

    def evaluate(values):
        over = normalize_character_overrides(values, character_name=name)
        if synchro is not None:
            over['level'] = synchro
        if console is not None:
            over['console'] = {**spec.DEFAULT_CHAR['console'], **console}
        char = spec.build_squad([name], {name: over})[0]
        return {'combatPower': round(combat_power(char), 2), 'effectiveCharacter': char,
                'deviations': spec.format_deviations([char])}

    current = evaluate(baseline)
    result = []
    for scenario in scenarios:
        changes = scenario.get('changes')
        if not isinstance(changes, dict) or not changes:
            raise ValueError('각 변경안에 변경할 육성을 지정하세요.')
        # Merge web inputs before normalization: numeric OL levels replace tier strings.
        values = spec.deep_merge(deepcopy(baseline), deepcopy(changes))
        candidate = evaluate(values)
        delta = round(candidate['combatPower'] - current['combatPower'], 2)
        result.append({**candidate, 'label': scenario['label'], 'changes': changes, 'delta': delta,
                       'percent': delta / current['combatPower'] * 100 if current['combatPower'] else None})
    missing = [field for field in ('growthStage', 'equipLevels', 'collection', 'skillLevels', 'cube', 'overload')
               if field not in baseline]
    return {'name': name, 'baseline': current, 'scenarios': result,
            'baselineMissingFields': missing, 'previewNote': spec.preview_note([name]),
            'limitations': ['예상 전투력입니다. 인게임 반올림·오버로드 단계 추정 때문에 표기값과 차이가 날 수 있습니다.',
                            '각 변경안은 현재 육성에서 독립적으로 비교합니다. 누적 변경을 원하면 한 변경안에 함께 지정하세요.',
                            '생략된 현재 육성은 기본값을 사용합니다. baselineMissingFields와 실제 적용값을 확인하세요.',
                            '전투력 증가량은 대미지 증가량이나 캠페인 클리어 보장이 아닙니다.']}


def run_growth_comparison(raw: str) -> str:
    return json.dumps(compare_growth(json.loads(raw)), ensure_ascii=False, separators=(',', ':'))

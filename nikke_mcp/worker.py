"""One request per process: never reuse mutable engine globals across requests."""
import json
import sys

from nikke_mcp.models import ROOT, CombatRequest

sys.path.insert(0, str(ROOT / 'site'))
from pybridge.bridge import run_request
from calculator.customization import normalize_character_overrides
from context.spec import build_squad, DEFAULT_CHAR


def main():
    try:
        request = CombatRequest.model_validate_json(sys.stdin.buffer.read(65537))
        result = json.loads(run_request(request.model_dump_json(exclude_none=True)))
        overrides = {name: normalize_character_overrides(value.model_dump(exclude_none=True), character_name=name)
                     for name, value in request.characters.items()}
        for name in request.squad:
            own = overrides.setdefault(name, {})
            own['level'] = request.synchroLevel
            if request.console is not None:
                own['console'] = {**DEFAULT_CHAR['console'], **request.console.model_dump()}
            if request.burstRegenTime is not None:
                own['burst_regen_time'] = request.burstRegenTime
        effective = build_squad(request.squad, overrides)
        output = {'result': result, 'effectiveCharacters': effective}
    except (ValueError, TypeError, KeyError) as error:
        output = {'error': str(error)[:1500]}
    sys.stdout.buffer.write(json.dumps(output, ensure_ascii=False, allow_nan=False).encode('utf-8'))


if __name__ == '__main__':
    main()

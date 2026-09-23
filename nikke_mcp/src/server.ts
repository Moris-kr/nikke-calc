/** MCP tool layer. No model API key is required. (py: nikke_mcp/server.py) */
import { OVERLOAD_FIELDS, MANUAL_STATS, COLLECTION_STAGES, CUBE_NAMES } from '../../site/src/engine/customization.ts';
import { inspect_squad_policy, query_squad_roles } from '../../site/src/engine/squad_policy.ts';
import { DEFAULT_CHAR } from '../../site/src/engine/spec.ts';
import { PyError } from '../../site/src/engine/py.ts';
import { BossCodeRequest, create_boss_code } from './boss_code.ts';
import { BrowserRelay } from './browser_relay.ts';
import { character_names, engine_version, ensureEngineData } from './engine.ts';
import { GUIDE_MODES, recommendation_guide, type GuideMode } from './enikk_guide.ts';
import { InvalidSettingsError, ToolError, fail, public_errors } from './errors.ts';
import {
  CharacterOverrides, CombatRequest, GrowthScenario, RecommendationCandidate, RecommendationScenario,
} from './models.ts';
import { ArgModel, Inst, ValidationError, bool, dict, dump, int, jsonSchema, list, lit, nullable, ref, str, type FieldDef } from './pydantic.ts';
import { PyFloat, isDict, numberOf, parseJson, toText, unbox } from './pyjson.ts';
import { withPythonFloats } from './pytypes.ts';
import { pyEqual } from './pyeq.ts';
import { evidence, type EvidenceMode } from './recommendation_evidence.ts';
import { CalculatorService, get_character, list_characters, pythonData } from './service.ts';
import { SharedState, inspect_shared, shared_request } from './shared_state.ts';

export const SERVER_NAME = 'NIKKE Calculator';
export const SERVER_VERSION = '1.0.0';

export const INSTRUCTIONS = 'PVP/아레나 관련 질문은 먼저 get_recommendation_guide(mode="arena")를 읽고 니케아리의 실제 기록을 확인하세요. '
  + '챔피언 아레나 자료의 범위·서버·시즌·표본을 밝히고, PvE 쿨감 필수 정책과 총딜 계산을 PVP 승패 판단에 적용하지 마세요. '
  + '다음 추천·계산 규칙은 PvE에만 적용합니다. 덱/조합 추천 요청(Campaign 스테이지, 속성별 솔로레이드, 유니온레이드 보스 등)은 '
  + '반드시 먼저 get_recommendation_guide를 호출해 해당 콘텐츠의 ENIKK 검색·근거 검증 지침을 읽으세요. '
  + '추천하는 각 덱에는 실제 발동 가능한 아군 버스트 쿨타임 감소 캐릭터를 반드시 포함하세요. '
  + 'validate_squad_policy로 검사하고, 사용자 지정 덱에 쿨감이 없으면 의도를 한 번 확인하세요. '
  + '예외는 솔린 대신 바니 소다를 쓰는 실제 샷건 편성뿐입니다. 자기 쿨감은 아군 쿨감이 아닙니다. '
  + 'get_recommendation_evidence의 날짜가 붙은 관측 조합으로 후보를 찾고 recommend_browser_squads로 실제 육성의 후보를 비교하세요. '
  + '지침 조회 자체는 최신 기록 조회가 아닙니다. 웹/브라우저 접근이 없으면 ENIKK를 확인했다고 말하지 마세요. '
  + '먼저 정식 이름과 설정을 조회하고 실제 simulate_squad/compare_setups 결과로 답하세요. '
  + '수치를 추측하지 마세요. 입력한 육성이 없으면 기본 육성이며 사용자 실제 계정으로 표현하지 마세요. '
  + '육성 전후 예상 전투력은 compare_browser_growth로 비교하세요. 전용 MCP 도구가 없는 기능은 '
  + 'get_settings.browserFallback 지침에 따라 실제 계산기 UI를 확인하세요. 브라우저 접근 없이 조작했다고 말하지 마세요. '
  + '보스 만들기 요청은 create_boss_code로 검증된 NK5 코드를 만들어 전달하세요. 도형은 실측 근거와 가정을 구분하고, '
  + 'settingsSource는 기본 drawing이며 전투 수치를 직접 쓸 때만 battle과 조건을 지정하세요. 코드 생성에는 브라우저 연결이 필요 없습니다. '
  + '엔진 버전, 전투 조건, 기본 이탈과 프리뷰 경고를 명시하세요. 비교는 입력 후보만의 순위입니다. '
  + '계산 호출은 반드시 순차 실행하세요. SERVER_BUSY는 기존 호출 완료 후 같은 입력으로 재시도하고, '
  + 'CALCULATION_TIMEOUT은 시간 제한입니다. 이 오류들을 특정 캐릭터의 계산 불가로 해석하지 마세요. '
  + '공개 HTTP 계산은 연결된 사용자 브라우저에서만 실행됩니다. connection_code가 필요하며 반환된 jobId는 '
  + 'get_browser_result로 확인하세요. 탭을 열어 두세요. 결과는 5분간 보관됩니다. 로컬 stdio는 로컬에서 계산합니다.';

export interface Annotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface Tool {
  name: string;
  description: string;
  args: ArgModel;
  annotations: Annotations;
  run: (args: Record<string, any>) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface CallResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ServerOptions {
  timeout?: number;
  maxConcurrent?: number;
  browserMode?: boolean;
  relay?: BrowserRelay;
  service?: CalculatorService;
}

/** Tool registry plus the state shared by every MCP session of this process. */
export class NikkeServer {
  readonly tools = new Map<string, Tool>();
  readonly relay: BrowserRelay;
  readonly service: CalculatorService | null;
  readonly browserMode: boolean;

  constructor(options: ServerOptions = {}) {
    ensureEngineData();
    this.browserMode = options.browserMode ?? false;
    this.service = this.browserMode ? null : (options.service ?? new CalculatorService(options.timeout ?? 60, options.maxConcurrent ?? 2));
    this.relay = options.relay ?? new BrowserRelay();
    registerTools(this);
  }

  add(name: string, description: string, fields: FieldDef[], annotations: Annotations, run: Tool['run']): void {
    this.tools.set(name, { name, description, args: new ArgModel(name, fields, parseJson), annotations, run });
  }

  listTools(): Array<Record<string, unknown>> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.args.schema(),
      outputSchema: { additionalProperties: true, title: `${tool.name}DictOutput`, type: 'object' },
      annotations: tool.annotations,
    }));
  }

  /** `tools/call`: arguments may hold {@link import('./pyjson.ts').PyFloat} from {@link parseJson}. */
  async callTool(name: string, args: Record<string, unknown> | undefined): Promise<CallResult> {
    const tool = this.tools.get(name);
    if (!tool) return errorResult(`Unknown tool: ${name}`);
    let validated: Record<string, any>;
    try {
      validated = tool.args.validate(args ?? {});
    } catch (error) {
      if (error instanceof ValidationError) return errorResult(`Error executing tool ${name}: ${error.toString()}`);
      logCrash(name, error);
      return errorResult(`Error executing tool ${name}`);
    }
    let result: Record<string, unknown>;
    try {
      result = await tool.run(validated);
    } catch (error) {
      if (error instanceof ToolError) return errorResult(`Error executing tool ${name}: ${error.message}`);
      logCrash(name, error);
      return errorResult(`Error executing tool ${name}`);
    }
    return { content: [{ type: 'text', text: toText(withPythonFloats(name, result)) }], structuredContent: unbox(result), isError: false };
  }
}

function errorResult(text: string): CallResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function logCrash(name: string, error: unknown): void {
  process.stderr.write(`Tool '${name}' raised an unexpected exception: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
}

const readOnly: Annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const f = {
  connection: (): FieldDef => ({ name: 'connection_code', type: str() }),
  optionalConnection: (): FieldDef => ({ name: 'connection_code', type: str(), default: '' }),
  detail: (): FieldDef => ({ name: 'detail', type: bool(), default: false }),
  characters: (): FieldDef => ({ name: 'characters', type: nullable(dict(ref(CharacterOverrides))), default: null }),
  names: (name: string): FieldDef => ({ name, type: nullable(list(str())), default: null }),
};

/** `{name: c.model_dump(exclude_unset=True)}` for the squad-policy overrides. */
function overridesOf(characters: Record<string, Inst> | null): Record<string, unknown> {
  return Object.fromEntries(Object.entries(characters ?? {}).map(([n, c]) => [n, dump(c, { excludeUnset: true })]));
}

/** The data-file entry (Python number types kept) an engine effect row was read from. */
function typedEffect(character: string, source: unknown, name: unknown, stat: unknown, favorite?: unknown): Record<string, any> | null {
  const effects = pythonData('data/parsed_skills.json')[character];
  if (!Array.isArray(effects)) return null;
  return effects.find((e: Record<string, any>) => e['source'] === source && e['name'] === name && e['stat'] === stat
    && (favorite === undefined || pyEqual(e['favorite'] ?? null, favorite ?? null))) ?? null;
}

/** The typed data value equal to `seconds` (fixed, or the per-level value the engine picked). */
function typedSeconds(effect: Record<string, any> | null, seconds: unknown): unknown {
  if (!effect || typeof seconds !== 'number') return seconds;
  const candidates = [effect['fixed_value'], ...(isDict(effect['values']) ? Object.values(effect['values']) : [])];
  return candidates.find((v) => numberOf(v) === seconds && v instanceof PyFloat) ?? seconds;
}

/** get_squad_roles / validate_squad_policy echo data-file numbers: give them Python's types back. */
function typedPolicyRows(result: Record<string, any>): Record<string, any> {
  const catalog = pythonData('data/parsed_nikke.json');
  for (const row of (result['characters'] ?? []) as Array<Record<string, any>>) {
    const cooldown = catalog[row['name']]?.['burst_cooldown'];
    if (cooldown instanceof PyFloat && numberOf(cooldown) === row['burstCooldown']) row['burstCooldown'] = cooldown;
    for (const effect of (row['cdrEffects'] ?? []) as Array<Record<string, any>>) {
      const typed = typedEffect(row['name'], effect['source'], effect['name'], effect['stat'], effect['favorite']);
      effect['seconds'] = typedSeconds(typed, effect['seconds']);
      if (typed && pyEqual(typed['trigger'], effect['trigger'])) effect['trigger'] = typed['trigger'];
    }
  }
  for (const key of ['cdrEffects', 'conditional']) {
    for (const row of (result[key] ?? []) as Array<Record<string, any>>) {
      row['seconds'] = typedSeconds(typedEffect(row['name'], row['source'], row['effect'], row['stat']), row['seconds']);
    }
  }
  return result;
}

function engineValueErrors<R>(body: () => R): R {
  try {
    return body();
  } catch (error) {
    if (error instanceof PyError && error.pyType === 'ValueError') throw new InvalidSettingsError(error.message);
    throw error;
  }
}

function registerTools(server: NikkeServer): void {
  const browserMode = server.browserMode;
  const relay = server.relay;
  const service = server.service;
  const calculation: Annotations = { ...readOnly, idempotentHint: !browserMode };

  server.add('create_boss_code',
    '보스 도형·파츠·코어·조준점과 선택적 전투 조건을 검증해 가져오기용 NK5 공유 코드를 만듭니다. 브라우저나 시뮬레이션 없이 동작합니다. 좌표/크기는 px, 구간/aimKeys.t는 초. windows는 {from,to} 목록이며 비면 상시 표시. settingsSource=drawing(기본)은 그림에서 코어·파츠·사거리를 적용하고 battle은 제공한 battle 수치를 사용합니다. 실측 근거 없이 도형을 실측이라고 표현하지 말고 가정을 설명하세요. 이미지·계정 육성·캐릭터별 폭발 반경/탄착군은 지원하지 않습니다. 반환된 코드를 계산기 → 보스 메이커 → 공유 → 받은 코드 넣기 → 새 보스로 받기에 붙여넣고 검토하도록 안내하세요.',
    [{ name: 'request', type: ref(BossCodeRequest) }], readOnly,
    ({ request }) => create_boss_code(request));

  server.add('get_recommendation_guide',
    '덱 추천·PVP/아레나 질문 전에 읽는 검색 지침. mode: overview/meta/campaign/soloraid/unionraid/arena(pvp도 동일). PvE는 ENIKK, PVP는 니케아리의 공격·방어 기록과 포함·제외 검색을 안내합니다. 캠페인·수냉 솔레·핑거즈 등 콘텐츠별 실제 기록 탐색, 표본/최신성, 사용자 브라우저 육성 적용 절차를 제공합니다. 최신 기록 자체를 수집하는 도구는 아닙니다.',
    [{ name: 'mode', type: lit(...GUIDE_MODES), default: 'overview' }], readOnly,
    ({ mode }) => recommendation_guide(mode as GuideMode));

  server.add('list_characters',
    '정식 캐릭터명·속성·무기·버스트를 검색합니다. 별칭을 추측하지 말고 이 목록의 이름을 사용하세요.',
    [{ name: 'query', type: str(), default: '' }], readOnly,
    ({ query }) => public_errors(() => list_characters(query)));

  server.add('get_squad_roles',
    '스킬 데이터에서 아군 버스트 쿨감과 발동 조건을 조회합니다. 자기 쿨감/음수 효과와 구분합니다. 실제 육성이 없으면 기본 스킬 기준이며 팀 조건은 validate_squad_policy로 검사하세요.',
    [f.names('names'), f.characters()], readOnly,
    ({ names, characters }) => public_errors(() => typedPolicyRows(engineValueErrors(() => query_squad_roles(names, overridesOf(characters))))));

  server.add('validate_squad_policy',
    'PvE 덱의 아군 쿨감·조건부 발동·버스트 구조를 검사합니다. PVP/아레나에는 적용하지 마세요. requiresConfirmation이면 쿨감 없는 편성이 원래 의도인지 한 번 물으세요. allow_no_cdr는 사용자 지정 편성에서 사용자가 확인한 뒤에만 true; 새 추천의 필수 조건을 우회하지 않습니다.',
    [{ name: 'squad', type: list(str()) }, f.characters(),
      { name: 'purpose', type: lit('recommendation', 'user_fixed'), default: 'recommendation' },
      { name: 'allow_no_cdr', type: bool(), default: false }], readOnly,
    ({ squad, characters, purpose, allow_no_cdr }) => public_errors(() => typedPolicyRows(engineValueErrors(
      () => inspect_squad_policy(squad, overridesOf(characters), purpose, allow_no_cdr)))));

  server.add('get_recommendation_evidence',
    '2026-09-18에 직접 확인한 ENIKK 조합·표본·해석의 연구 스냅샷입니다. 최신 검색 결과가 아니며 사용률은 성능/승률이 아닙니다. 실제 요청 조건은 ENIKK에서 재확인하세요.',
    [{ name: 'mode', type: lit('all', 'campaign', 'soloraid'), default: 'all' }], readOnly,
    ({ mode }) => evidence(mode as EvidenceMode));

  server.add('recommend_browser_squads',
    'ENIKK 등에서 구성한 1~20개 후보를 현재 브라우저 육성·전투 조건으로 계산하고 중복 없는 1~5덱을 선택합니다. 쿨감 필수 검사 후 expected 계산. 추가 전투 조건 최대2개에서 최대 상대 손실을 최소화합니다. include는 선택된 모든 덱의 합집합에 필수, exclude는 모든 덱에서 금지. 입력 후보 내 최적화이며 전체 최적해/클리어 보장 아님. 저장값은 변경하지 않습니다. get_browser_result로 완료까지 조회하세요.',
    [f.connection(), { name: 'candidates', type: list(ref(RecommendationCandidate)) },
      { name: 'squad_count', type: int(), default: 1 }, f.names('include'), f.names('exclude'),
      { name: 'scenarios', type: nullable(list(ref(RecommendationScenario))), default: null }], calculation,
    ({ connection_code, candidates, squad_count, include, exclude, scenarios }) => {
      if (!browserMode) fail('BROWSER_CONNECTION_REQUIRED', '공개 HTTP MCP와 연결한 사용자 브라우저에서 지원합니다.');
      if (!(candidates.length >= 1 && candidates.length <= 20) || !(squad_count >= 1 && squad_count <= 5) || (scenarios ?? []).length > 2) {
        fail('INVALID_SETTINGS', '후보 1~20개, 덱 수 1~5, 추가 조건 최대2개입니다.');
      }
      const required: string[] = include ?? [];
      const forbidden: string[] = exclude ?? [];
      const known = new Set(character_names());
      if (required.some((n) => forbidden.includes(n)) || [...required, ...forbidden].some((n) => !known.has(n))) {
        fail('INVALID_SETTINGS', '필수·제외 캐릭터의 충돌 또는 정식 이름을 확인하세요.');
      }
      return relay.submit(connection_code, { kind: 'recommend', options: {
        candidates: (candidates as Inst[]).map((c) => dump(c, { excludeNone: true, py: true })), squadCount: squad_count,
        include: required, exclude: forbidden,
        scenarios: ((scenarios ?? []) as Inst[]).map((s) => dump(s, { py: true })) } });
    });

  server.add('get_character',
    '캐릭터 스킬 원문을 지정 레벨(1~10)로 조회합니다. stats는 공통 육성 적용 전 데이터입니다.',
    [{ name: 'name', type: str() }, { name: 'skill_level', type: int(), default: 10 }], readOnly,
    ({ name, skill_level }) => public_errors(() => get_character(name, skill_level)));

  server.add('get_settings',
    '지원 입력 스키마, 기본 육성, 큐브·소장품·오버로드 옵션을 조회합니다.',
    [], readOnly,
    () => settings());

  server.add('compare_browser_growth',
    '현재 브라우저 육성에서 변경안별 예상 전투력·증가량을 비교합니다(1~12개). 사용자 PC에서 계산하며 저장 육성은 변경하지 않습니다. 각 변경안은 현재 기준 독립 비교입니다. 장비 4310은 머리4/팔3/몸통1/다리0 목표 단계이며 증가 단계가 아닙니다. 소장품 R15→SR5/SR15는 각각 별도 changes.collection.stage로 지정하세요. 결과는 get_browser_result로 조회합니다.',
    [f.connection(), { name: 'name', type: str() }, { name: 'scenarios', type: list(ref(GrowthScenario)) }], calculation,
    ({ connection_code, name, scenarios }) => {
      if (!browserMode) fail('BROWSER_CONNECTION_REQUIRED', '이 도구는 공개 HTTP MCP와 연결된 계산기 브라우저에서 지원합니다. get_settings.browserFallback을 확인하세요.');
      if (!character_names().includes(name) || !(scenarios.length >= 1 && scenarios.length <= 12)) {
        fail('INVALID_SETTINGS', '정식 캐릭터 이름과 변경안 1~12개를 지정하세요.');
      }
      return relay.submit(connection_code, { kind: 'growth', name,
        scenarios: (scenarios as Inst[]).map((s) => dump(s, { excludeNone: true, excludeUnset: true, py: true })) });
    });

  server.add('simulate_squad',
    '웹과 같은 엔진으로 계산합니다(최대 180초). detail=true는 타임라인도 반환합니다.',
    [{ name: 'request', type: ref(CombatRequest) }, f.detail(), f.optionalConnection()], calculation,
    ({ request, detail, connection_code }) => public_errors(() => {
      if (browserMode) return relay.submit(connection_code, { kind: 'simulate', requests: [dump(request, { excludeNone: true, py: true })], detail });
      return service!.simulate(request, detail);
    }));

  server.add('compare_setups',
    '동일 전투 조건의 2~5개 후보를 계산합니다. 후보별 실제 설정과 1번 대비 증감을 반환합니다.',
    [{ name: 'requests', type: list(ref(CombatRequest)) }, f.optionalConnection()], calculation,
    ({ requests, connection_code }) => public_errors(() => {
      if (browserMode) {
        if (!(requests.length >= 2 && requests.length <= 5)) throw new InvalidSettingsError('비교 후보는 2~5개입니다.');
        const conditions = (requests as Inst[]).map((r) => dump(r, { exclude: new Set(['squad', 'characters']) }));
        if (conditions.slice(1).some((c) => !pyEqual(c, conditions[0]))) throw new InvalidSettingsError('비교 후보의 전투 조건은 같아야 합니다.');
        return relay.submit(connection_code, { kind: 'simulate', requests: (requests as Inst[]).map((r) => dump(r, { excludeNone: true, py: true })), detail: false });
      }
      return service!.compare(requests);
    }));

  server.add('inspect_shared_state',
    '기존 공유 형식의 JSON 객체를 검증하는 호환 도구입니다. 현재 웹 육성은 inspect_browser_state로 조회하세요. 파일 경로나 URL은 받지 않습니다.',
    [{ name: 'state', type: ref(SharedState) }], readOnly,
    ({ state }) => ({ ...inspect_shared(state), engineVersion: engine_version() }));

  server.add('simulate_shared_state',
    '공유 JSON으로 계산합니다. 기본은 deck_index(1부터)의 설정 그대로. squad를 지정하면 공유 roster의 육성 + battle 조건으로 새 편성을 계산하며, 육성이 없는 캐릭터는 거절합니다. 매 호출에 state 전체를 전달하세요.',
    [{ name: 'state', type: ref(SharedState) }, { name: 'deck_index', type: int(), default: 1 }, f.names('squad'),
      f.detail(), f.optionalConnection()], calculation,
    ({ state, deck_index, squad, detail, connection_code }) => public_errors(() => {
      if (browserMode) {
        shared_request(state, deck_index, squad);
        return relay.submit(connection_code, { kind: 'shared', state: dump(state, { excludeNone: true, py: true }), deck_index, squad, detail });
      }
      return service!.simulate(shared_request(state, deck_index, squad), detail);
    }));

  server.add('export_overload_plan',
    '브라우저 육성효율 창에 설정한 목표·현재 옵션·잠금 재화를 조회합니다. 엔진이나 코드를 전달하지 않습니다. get_browser_result로 결과를 받으세요. 목표 계산은 calculate_overload_plan을 사용하세요.',
    [f.connection()], calculation,
    ({ connection_code }) => relay.submit(connection_code, { kind: 'module-export' }));

  server.add('calculate_overload_plan',
    '육성효율 창의 현재 목표를 사용자 브라우저에서 계산합니다. 목표는 먼저 창에서 설정하세요. 모듈 가성비 분석을 포함하며 시간이 걸릴 수 있습니다. get_browser_result로 딜·모듈·락 키 소모 결과를 받으세요. AI나 서버에 엔진 코드를 전달하지 않습니다.',
    [f.connection()], calculation,
    ({ connection_code }) => relay.submit(connection_code, { kind: 'module-calculate' }));

  server.add('inspect_browser_state',
    '연결된 브라우저의 현재 공유 가능한 육성·덱·조건을 조회하는 작업을 요청합니다.',
    [f.connection()], calculation,
    ({ connection_code }) => relay.submit(connection_code, { kind: 'inspect' }));

  server.add('simulate_browser_state',
    '현재 브라우저 육성으로 계산합니다. squad 생략 시 지정 덱, 지정 시 보유 육성으로 새 편성을 계산합니다.',
    [f.connection(), { name: 'deck_index', type: int(), default: 1 }, f.names('squad'), f.detail()], calculation,
    ({ connection_code, deck_index, squad, detail }) => {
      if (deck_index < 1 || deck_index > 100 || (squad !== null && (!(squad.length >= 1 && squad.length <= 5) || new Set(squad).size !== squad.length))) {
        fail('INVALID_SETTINGS', 'deck_index 또는 squad가 잘못되었습니다.');
      }
      return relay.submit(connection_code, { kind: 'shared', deck_index, squad, detail });
    });

  server.add('get_browser_result',
    '브라우저 작업 상태와 결과를 조회합니다. queued/running이면 잠시 후 재조회하세요.',
    [f.connection(), { name: 'job_id', type: str() }], readOnly,
    ({ connection_code, job_id }) => relay.result(connection_code, job_id));
}

function settings(): Record<string, unknown> {
  return {
    requestSchema: jsonSchema(CombatRequest),
    defaultCharacter: JSON.parse(JSON.stringify(DEFAULT_CHAR)),
    cubeNames: ['없음', ...CUBE_NAMES],
    collectionStages: [...COLLECTION_STAGES],
    overloadFields: JSON.parse(JSON.stringify(OVERLOAD_FIELDS)),
    manualStats: JSON.parse(JSON.stringify(MANUAL_STATS)),
    characterExample: { skillLevels: { 1: 10, 2: 10, 3: 10 }, cube: { name: '없음', level: 0 } },
    notes: ['큐브 없음은 Lv0, 착용 큐브는 Lv1~15입니다.',
      '기본 스펙은 실제 계정 정보가 아닙니다. 캐릭터별 기본 설정도 추가됩니다.',
      '지원: growthStage, skillLevels, overload, cube, collection, control, burst, equipLevels, manualStats, weaponModeSwapAt.',
      '현재 브라우저 육성은 inspect_browser_state와 get_browser_result로 확인합니다. 파일 공유는 필요 없습니다.',
      '미지원: 일반 백업/계정 로그인, 커스텀 캐릭터, 핵 옵션.'],
    sharedStateSchema: jsonSchema(SharedState),
    defenseRateGuide: {
      source: 'https://arca.live/b/nikketgv/183364010',
      example: { defenseRateWindows: [{ from: 30, to: 60, rate: 60 }, { from: 90, to: 120, rate: 60 }] },
      notes: ['리버렐리오 바디 심해의 장막: 일반 최종 대미지 ×0.4, 방어력 무시 대미지는 그대로인 커뮤니티 실험을 모델링합니다.',
        '장막의 실제 시작·종료 시각은 자동 추정하지 않습니다. 사용자 관측 구간을 입력하세요.',
        '방어력 증가나 받는 대미지 증가와 상쇄하는 항이 아닙니다. 방어력 무시 대미지 증가 버프만으로 공격 유형이 바뀌지는 않습니다.',
        '방어력 감소와 장막의 상호작용은 원문에서도 미검증입니다. 현재는 방깎 계산 후 독립 배율로 적용합니다. 겹치는 장막은 가장 높은 감소율 하나만 적용합니다.'],
    },
    browserFallback: {
      url: 'https://moris-kr.github.io/nikke-calc/',
      steps: [
        '전용 MCP 도구가 없으면 사용 가능한 웹/브라우저 도구로 계산기 페이지의 메뉴와 기능을 확인합니다. MCP가 임의의 브라우저 제어 기능을 제공하는 것은 아닙니다.',
        '사용자 육성 작업은 AI 연결이 켜진 실제 사용자 탭인지 확인합니다. 새 탭·다른 프로필·원격 브라우저의 육성값을 사용자 계정으로 간주하지 않습니다. 정보가 없다면 육성을 불러오도록 안내합니다.',
        '읽기 전용 웹 검색은 메뉴를 찾는 용도입니다. 입력·클릭은 실제 조작 가능한 브라우저 도구가 있을 때만 하며, 화면에 존재하는 컨트롤과 도움말을 근거로 진행합니다.',
        '요청 범위의 계산·조회는 진행하되, 원래 설정을 보존하고 비교용 임시 변경은 복구합니다. 저장·계정 연동·공개 공유·삭제 등 별도 영향을 주는 작업은 사용자 요청과 권한 범위를 확인합니다.',
        '결과가 실제 표시됐는지 확인하고 조건·수치를 보고합니다. 브라우저가 없거나 기능이 없거나 접근이 막히면 구체적인 제한과 사용자가 따라 할 메뉴/입력 순서를 안내합니다. 미실행 결과를 만들지 않습니다.',
      ],
    },
    engineVersion: engine_version(),
  };
}

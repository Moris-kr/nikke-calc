/**
 * 단발 시뮬 CLI (Claude 전용). `context/sim.py`를 옮긴 것이다.
 *
 * 파일을 수정하지 않고 임의 스쿼드를 돌린다.
 *
 *     cd site && npx tsx scripts/sim.ts "리틀 머메이드,크라운,라피 : 레드 후드,미하라,헬름"
 *     cd site && npx tsx scripts/sim.ts "..." --view breakdown
 *     cd site && npx tsx scripts/sim.ts "..." --no-burst "리틀 머메이드" --seed 42
 *     cd site && npx tsx scripts/sim.ts "..." --expected          # 크리·코어히트를 기대값으로 (1회로 결정론적)
 *     cd site && npx tsx scripts/sim.ts "..." --view buff --char "라피 : 레드 후드"
 *     cd site && npx tsx scripts/sim.ts "..." --profile me        # 고정 스펙 대신 내 계정의 실제 육성으로
 *
 * 캐릭터 이름에 콤마는 없지만 콜론·공백은 있다 (`라피 : 레드 후드`).
 * 구분자는 콤마이며 앞뒤 공백은 자동으로 벗겨진다.
 *
 * **정식 명칭만 받는다.** 유저가 쓰는 별칭(`마스트`·`돌니스`)은 `context/ALIASES.md`로
 * 먼저 변환한다. 변환을 빠뜨리면 스킬 미파싱 에러로 끊긴다 (조용히 틀리지 않는다).
 *
 * 출력은 전부 기존 SimResult / SimLog 메서드를 그대로 부른다 — 신규 표시 로직 없음.
 */
import { _mark_float, _py_repr } from '../src/engine/customization';
import { PyError, random, sorted } from '../src/engine/py';
import { print_team_analysis } from '../src/engine/sim_result';
import * as char_spec from '../src/engine/spec';
import { simulate } from '../src/engine/timeline';
import { exit, loadEngine, print, runMain } from './lib/engine';
import { load_profile, type GrowthProfile } from './lib/profile';

const VIEWS = ['summary', 'breakdown', 'analysis', 'burst', 'buff', 'hits', 'gauge'] as const;
const ENEMY_CODES = ['풍압', '수냉', '작열', '전격', '철갑'];

const PROG = 'sim.ts';

// ── 인자 (argparse와 같은 규칙: 긴 옵션은 모호하지 않은 앞부분만 써도 된다) ─────────

type Kind = 'flag' | 'value' | 'append' | 'append_opt';
interface Opt {
  flags: string[];
  dest: string;
  kind: Kind;
  type?: 'int' | 'float';
  choices?: readonly string[];
  dflt?: unknown;
  metavar?: string;
  help: string;
}

const OPTS: Opt[] = [
  { flags: ['--view'], dest: 'view', kind: 'value', choices: VIEWS, dflt: 'summary', help: '출력 형식' },
  { flags: ['--char'], dest: 'char', kind: 'append', help: '특정 캐릭터만 표시 (반복 지정 가능)' },
  { flags: ['--seed'], dest: 'seed', kind: 'value', type: 'int', help: '난수 시드. 지정하면 결과가 재현된다' },
  {
    flags: ['--expected'], dest: 'expected', kind: 'flag',
    help: '크리·코어히트를 확률 판정 대신 기대값으로 계산한다. 난수가 사라져 1회 실행으로 '
      + '결정론적 기대딜이 나온다(시드·반복 평균 불필요). 대신 히트 목록의 \'크리\'·\'코어\' '
      + '표시와 코어 hit_tag는 사라진다 — 배율이 히트마다 확률로 녹아 있어서다',
  },
  { flags: ['--no-burst'], dest: 'no_burst', kind: 'value', help: '버스트를 쓰지 않을 캐릭터' },
  { flags: ['--duration'], dest: 'duration', kind: 'value', type: 'float', help: '시뮬 시간(초). 기본 180' },
  { flags: ['--first-burst'], dest: 'first_burst', kind: 'value', type: 'float', dflt: 3.0, help: '첫 버스트 시각(초)' },
  {
    flags: ['--allow-unparsed'], dest: 'allow_unparsed', kind: 'flag',
    help: '스킬 미파싱 캐릭터를 스킬 0개로 돌린다. 파싱 전 신캐의 스탯·무기만 볼 때만 쓴다 '
      + '(기본은 에러 — 별칭을 정식 명칭으로 못 바꾼 경우가 대부분이다)',
  },
  { flags: ['--enemy-def'], dest: 'enemy_def', kind: 'value', type: 'int', help: '적 방어력' },
  {
    flags: ['--enemy-code'], dest: 'enemy_code', kind: 'value', choices: ENEMY_CODES,
    help: '적 속성 코드. 우월 코드(DealForm ⑦)·target_code 조건에 반영',
  },
  { flags: ['--core-px'], dest: 'core_px', kind: 'value', type: 'float', help: '코어 직경(px). 0이면 코어 없음' },
  { flags: ['--has-parts'], dest: 'has_parts', kind: 'flag', help: '파괴 가능 파츠 보유 보스로 설정' },
  {
    flags: ['--part-break-interval'], dest: 'part_break_interval', kind: 'value', type: 'float', dflt: 0.0,
    help: '파츠 파괴 주기(초). 0이면 무발동(기본). `event:part_destroy`에 반응하는 '
      + '캐릭터(아크레인저 블랙 배터리 충전)를 켜고 끄는 스위치',
  },
  {
    flags: ['--mode-swap'], dest: 'mode_swap', kind: 'append',
    help: '수동 재장전으로 무기 변경 모드에 진입시킬 캐릭터 (반복 지정 가능). '
      + '예: --mode-swap "신데렐라 : 크리스탈 웨이브" → 저격 모드 진입 후 유지',
  },
  {
    flags: ['--tap'], dest: 'tap', kind: 'append', metavar: '이름[:rate[:release[:풀차지간격[:정책]]]]',
    help: '톡톡이를 시킬 차지형(SR/RL) 캐릭터. rate 기본 3.6발/s, release 기본 0.03초. '
      + '풀차지간격(초)을 주면 그 간격마다 한 발은 풀차지로 쏜다 — `풀 차지 공격 시` '
      + '버프 유지용(밀크 관통 특화 6초 → 5.5). '
      + '예: --tap "앨리스:4.0" / --tap "밀크 : 블루밍 바니:4.0:0.03:5.5" '
      + '(context/CONTROL.md §톡톡이)',
  },
  {
    flags: ['--gauge-mode'], dest: 'gauge_mode', kind: 'value', choices: ['fixed', 'accumulate'], dflt: 'fixed',
    help: '버스트 게이지 판정. fixed(기본, 고정 시간) / accumulate(히트당 실누적 — 사이트 신 방식). '
      + '`--view gauge`로 충전 내역을 본다 (원본 저장소 docs/mechanics/버스트 게이지.md)',
  },
  {
    flags: ['--camera'], dest: 'camera', kind: 'value', metavar: '이름',
    help: '풀차지 게이지 배율을 받는 니케(카메라). 빈 문자열은 아무도 안 봄. '
      + '안 주면 버충 톡톡이 담당 → 컨트롤 1명(차지 무기) → 3번 자리 순으로 유도한다',
  },
  {
    flags: ['--reload-ctrl'], dest: 'reload_ctrl', kind: 'append', metavar: '이름:정책[:값]',
    help: '장전컨. 정책은 before_fb_end(값=lead, 기본 0.3) 또는 into_fb(값=margin, 기본 0.1). '
      + '예: --reload-ctrl "리버렐리오:into_fb" (context/CONTROL.md §장전컨)',
  },
  {
    flags: ['--cover-ctrl'], dest: 'cover_ctrl', kind: 'append', metavar: '이름:정책[:extend]',
    help: '버스트 엄폐컨. 정책은 own_full_burst — 본인이 버스트를 쓴 사이클의 풀버스트 동안 '
      + '엄폐해 한 발도 쏘지 않는다. extend(기본 0)는 풀버스트 종료 뒤 더 끄는 시간(초). '
      + '예: --cover-ctrl "미하라 : 본딩 체인:own_full_burst" (context/CONTROL.md §버스트 엄폐컨)',
  },
  {
    flags: ['--hold-ctrl'], dest: 'hold_ctrl', kind: 'append', metavar: '이름:정책[:lead]',
    help: '홀드컨(차지형 전용). 정책은 own_full_burst — 본인 버스트 사이클의 풀버스트 동안 '
      + '풀차지를 들고 있다가 종료 lead초 전(기본 0.5)에 뗀다. '
      + '예: --hold-ctrl "에이다:own_full_burst" (context/CONTROL.md §홀드)',
  },
  {
    flags: ['--auto'], dest: 'auto', kind: 'append_opt', metavar: '이름',
    help: '캐릭터별 기본 레이어(data/char_defaults.json — 컨트롤·장비 옵션 차이분)를 '
      + '통째로 건너뛴다. 이름 없이 주면 전원. 컨트롤 이득을 재는 대조군용. '
      + '예: --auto "앨리스" / --auto',
  },
  {
    flags: ['--favorite'], dest: 'favorite', kind: 'append', metavar: '이름:단계',
    help: '애장품 단계를 바꾼다. 단계는 0(미보유)~3, 기본 스펙은 3단계다. 애장품은 단계마다 '
      + '스킬 슬롯 하나를 애장품 판본으로 갈아끼운다 — 낮은 단계로 돌리려면 그 슬롯의 '
      + '기본(비애장품) 판본이 파싱돼 있어야 한다(없으면 시뮬이 끊는다). '
      + '예: --favorite "드레이크:0" (context/PARSING.md §애장품)',
  },
  {
    flags: ['--profile'], dest: 'profile', kind: 'value', metavar: '이름',
    help: '고정 스펙 대신 **실제 계정의 육성 상태**로 돌린다 (profiles/<이름>.json, '
      + '`python scraper/profile_fetch.py`가 만든다). 레벨·돌파·코강·호감도·스킬 레벨·'
      + '장비·오버로드·소장품이 프로필 값으로 바뀌고, 컨트롤·버스트 패턴은 그대로다. '
      + '결과에는 프로필을 썼다는 사실이 강제로 실린다 — 고정 스펙 결과와 총딜을 '
      + '직접 비교하면 안 된다. 예: --profile me',
  },
  {
    flags: ['--profile-level'], dest: 'profile_level', kind: 'value', choices: char_spec.LEVEL_MODES, dflt: 'fixed',
    help: '--profile 을 쓸 때 캐릭터 레벨을 무엇으로 볼지. fixed(기본) = 기본 스펙 레벨 400 '
      + '고정 — 솔로레이드가 그렇게 돌기 때문이다. sync = 동기화 소대 레벨. '
      + '인게임 개별 레벨은 쓰지 않는다 (소대에 넣었는지에 달린 편성 상태일 뿐이다)',
  },
  {
    flags: ['--allow-unowned'], dest: 'allow_unowned', kind: 'flag',
    help: '--profile 을 쓸 때 프로필에 없는(미보유) 캐릭터를 기본 스펙으로 대체한다. '
      + '기본은 에러 — 조용히 만렙 가상 캐릭터가 섞이면 \'내 계정 기준\'이 거짓말이 된다. '
      + '대체한 캐릭터는 결과에 목록으로 실린다',
  },
  {
    flags: ['--burst-pattern'], dest: 'burst_pattern', kind: 'append', metavar: '이름:패턴',
    help: '버스트 운용 패턴을 바꾼다. 패턴 이름은 data/char_defaults.json의 '
      + '`_burst_patterns`에 등록된 것, 또는 `없음`(패턴 해제). '
      + '예: --burst-pattern "마스트 : 로망틱 메이드:1,3,5,9,11,14" (HARNESS §버스트 운용 패턴)',
  },
];

const metaOf = (o: Opt): string => o.metavar
  ?? (o.choices ? `{${o.choices.join(',')}}` : o.dest.toUpperCase());

function usage(): string {
  const parts = ['[-h]'];
  for (const o of OPTS) {
    const f = o.flags[0]!;
    if (o.kind === 'flag') parts.push(`[${f}]`);
    else if (o.kind === 'append_opt') parts.push(`[${f} [${metaOf(o)}]]`);
    else parts.push(`[${f} ${metaOf(o)}]`);
  }
  return `usage: ${PROG} ${parts.join(' ')}\n              squad`;
}

const EPILOG = `--view 종류
  summary    스쿼드 총딜 + 캐릭터별 딜·비율 (기본)
  breakdown  버스트 사이클별 스킬 딜 집계
  analysis   캐릭터별 유형·버스트구간 분석
  burst      버스트 사이클 이벤트 전체
  buff       풀버스트 진입 시점 버프 스냅샷
  hits       히트 목록 (재장전·버스트 인터리브)
`;

function helpText(): string {
  const lines = [usage(), '', '단발 시뮬 실행 (파일 수정 불필요)', '', 'positional arguments:',
    '  squad                 캐릭터 이름 콤마 구분 (1~5명)', '', 'options:',
    '  -h, --help            show this help message and exit'];
  for (const o of OPTS) {
    const head = o.kind === 'flag' ? o.flags[0]! : o.kind === 'append_opt'
      ? `${o.flags[0]} [${metaOf(o)}]` : `${o.flags[0]} ${metaOf(o)}`;
    lines.push(`  ${head}`, `                        ${o.help}`);
  }
  return `${lines.join('\n')}\n\n${EPILOG}`;
}

function argError(msg: string): never {
  process.stderr.write(`${usage()}\n${PROG}: error: ${msg}\n`);
  return exit(2);
}

/** 파이썬 `float(s)`. */
function pyFloat(s: string): number {
  const t = s.trim().replace(/_/g, '');
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  const m = /^([+-]?)(inf|infinity|nan)$/i.exec(t);
  if (m) return m[2]!.toLowerCase() === 'nan' ? NaN : (m[1] === '-' ? -Infinity : Infinity);
  throw new PyError('ValueError', `could not convert string to float: ${_py_repr(s)}`);
}

function convert(o: Opt, v: string): unknown {
  const name = o.flags.join('/');
  if (o.type === 'int') {
    if (!/^\s*[+-]?\d+(_\d+)*\s*$/.test(v)) argError(`argument ${name}: invalid int value: ${_py_repr(v)}`);
    return parseInt(v.trim().replace(/_/g, ''), 10);
  }
  if (o.type === 'float') {
    try { return pyFloat(v); } catch { argError(`argument ${name}: invalid float value: ${_py_repr(v)}`); }
  }
  if (o.choices && !o.choices.includes(v)) {
    argError(`argument ${name}: invalid choice: ${_py_repr(v)} (choose from ${o.choices.join(', ')})`);
  }
  return v;
}

/** 옵션처럼 보이는가(음수 값은 값으로 본다 — argparse와 같다). */
const looksLikeOpt = (s: string): boolean => s.startsWith('-') && s.length > 1 && !/^-\d+$|^-\d*\.\d+$/.test(s);

function parseArgs(argv: string[]): Record<string, any> {
  const args: Record<string, any> = {};
  for (const o of OPTS) {
    args[o.dest] = o.kind === 'flag' ? false : (o.dflt ?? null);
  }
  const positionals: string[] = [];
  let onlyPositional = false;
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i]!;
    if (onlyPositional || !looksLikeOpt(tok)) { positionals.push(tok); continue; }
    if (tok === '--') { onlyPositional = true; continue; }
    if (tok === '-h' || tok === '--help') { process.stdout.write(helpText()); exit(0); }
    let flag = tok; let inline: string | undefined;
    const eqAt = tok.indexOf('=');
    if (tok.startsWith('--') && eqAt > 0) { flag = tok.slice(0, eqAt); inline = tok.slice(eqAt + 1); }
    let opt = OPTS.find((o) => o.flags.includes(flag));
    if (!opt && flag.startsWith('--')) {
      const cands = OPTS.filter((o) => o.flags.some((f) => f.startsWith(flag)));
      if (cands.length > 1) {
        argError(`ambiguous option: ${flag} could match ${cands.map((o) => o.flags[0]).join(', ')}`);
      }
      opt = cands[0];
    }
    if (!opt) { argError(`unrecognized arguments: ${tok}`); return args; }
    const name = opt.flags.join('/');
    if (opt.kind === 'flag') {
      if (inline !== undefined) argError(`argument ${name}: ignored explicit argument ${_py_repr(inline)}`);
      args[opt.dest] = true;
      continue;
    }
    let value: string | undefined = inline;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !looksLikeOpt(next)) { value = next; i += 1; }
    }
    if (value === undefined) {
      if (opt.kind === 'append_opt') { (args[opt.dest] ??= []).push('__all__'); continue; }
      argError(`argument ${name}: expected one argument`);
    }
    const v = convert(opt, value!);
    if (opt.kind === 'append' || opt.kind === 'append_opt') (args[opt.dest] ??= []).push(v);
    else args[opt.dest] = v;
  }
  if (positionals.length === 0) argError('the following arguments are required: squad');
  if (positionals.length > 1) argError(`unrecognized arguments: ${positionals.slice(1).join(' ')}`);
  args['squad'] = positionals[0];
  return args;
}

// ── 본체 ──────────────────────────────────────────────────────────────────

/** 파이썬 float 값을 사전에 넣는다(이탈 보고에 `4.0`으로 찍히게). */
function setFloat(d: Record<string, any>, k: string, v: number): void {
  d[k] = v;
  _mark_float(d, k);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  loadEngine();

  const members = (args['squad'] as string).split(',').map((n) => n.trim()).filter((n) => n);
  if (!(members.length >= 1 && members.length <= 5)) {
    print(`스쿼드는 1~5명이어야 한다 (입력 ${members.length}명: ${_py_repr(members)})`);
    exit(2);
  }

  const config: Record<string, any> = {};
  setFloat(config, 'first_burst_time', args['first_burst']);
  config['allow_unparsed'] = args['allow_unparsed'];
  config['burst_gauge_mode'] = args['gauge_mode'];
  if (args['camera'] !== null) config['camera'] = args['camera'];
  if (args['expected']) config['rng_mode'] = 'expected';
  if (args['no_burst']) config['no_burst_char'] = (args['no_burst'] as string).trim();
  if (args['duration']) setFloat(config, 'duration', args['duration']);
  if (args['part_break_interval']) setFloat(config, 'part_break_interval', args['part_break_interval']);

  const enemy: Record<string, any> = {};
  if (args['enemy_def'] !== null) enemy['def'] = args['enemy_def'];
  if (args['enemy_code']) enemy['code'] = args['enemy_code'];
  if (args['core_px'] !== null) setFloat(enemy, 'core_px', args['core_px']);
  if (args['has_parts']) enemy['has_parts'] = true;

  const swap = new Set<string>(((args['mode_swap'] ?? []) as string[]).map((c) => c.trim()));
  const unknownSwap = [...swap].filter((c) => !members.includes(c));
  if (unknownSwap.length) {
    print(`--mode-swap 대상이 스쿼드에 없다: ${_py_repr(sorted(unknownSwap))}`);
    exit(2);
  }

  // 컨트롤 (context/CONTROL.md). "이름[:값[:값]]" 형식을 char config의 control로 옮긴다
  const controls: Record<string, Record<string, any>> = {};
  const ctrlOf = (n: string): Record<string, any> => (controls[n] ??= {});

  /** 캐릭터 이름에 콜론이 들어가므로(`아니스 : 스타`) 스쿼드 이름으로 먼저 매칭한다. */
  const _split = (spec: string): string[] => {
    for (const n of members) {
      if (spec === n) return [n];
      if (spec.startsWith(n + ':')) return [n, ...spec.slice(n.length + 1).split(':')];
    }
    print(`컨트롤 대상이 스쿼드에 없다: ${_py_repr(spec)}`);
    return exit(2);
  };

  for (const spec of (args['tap'] ?? []) as string[]) {
    const parts = _split(spec.trim());
    const tap: Record<string, any> = {};
    setFloat(tap, 'rate', parts.length > 1 ? pyFloat(parts[1]!) : 3.6);
    if (parts.length > 2) setFloat(tap, 'release', pyFloat(parts[2]!));
    if (parts.length > 3) setFloat(tap, 'full_charge_interval', pyFloat(parts[3]!));
    // 다섯째 칸: 정책. `burst_charge`면 풀버스트 밖에서만 톡톡이한다(버충 톡톡이).
    if (parts.length > 4 && parts[4]) tap['policy'] = parts[4];
    ctrlOf(parts[0]!)['tap_fire'] = tap;
  }

  for (const spec of (args['reload_ctrl'] ?? []) as string[]) {
    const parts = _split(spec.trim());
    if (parts.length < 2) {
      print(`--reload-ctrl 는 정책이 필요하다: ${_py_repr(spec)}`);
      exit(2);
    }
    const rl: Record<string, any> = { policy: parts[1] };
    if (parts.length > 2) setFloat(rl, parts[1] === 'before_fb_end' ? 'lead' : 'margin', pyFloat(parts[2]!));
    ctrlOf(parts[0]!)['reload'] = rl;
  }

  for (const spec of (args['cover_ctrl'] ?? []) as string[]) {
    const parts = _split(spec.trim());
    if (parts.length < 2) {
      print(`--cover-ctrl 는 정책이 필요하다: ${_py_repr(spec)}`);
      exit(2);
    }
    const cv: Record<string, any> = { policy: parts[1] };
    if (parts.length > 2) setFloat(cv, 'extend', pyFloat(parts[2]!));
    ctrlOf(parts[0]!)['cover'] = cv;
  }

  for (const spec of (args['hold_ctrl'] ?? []) as string[]) {
    const parts = _split(spec.trim());
    if (parts.length < 2) {
      print(`--hold-ctrl 는 정책이 필요하다: ${_py_repr(spec)}`);
      exit(2);
    }
    const hd: Record<string, any> = { policy: parts[1] };
    if (parts.length > 2) setFloat(hd, 'lead', pyFloat(parts[2]!));
    ctrlOf(parts[0]!)['hold'] = hd;
  }

  // 스펙 합성은 spec — 기본 육성 스펙 → 캐릭터별 기본 레이어
  // (data/char_defaults.json: 앨리스 톡톡이 등) → 아래 CLI 인자.
  // `--tap` 등을 주면 그 캐릭터의 기본 컨트롤 위에 얹힌다.
  const over: Record<string, Record<string, any>> = {};
  for (const n of members) over[n] = { weapon_mode_swap: swap.has(n) };

  // --auto: 그 캐릭터는 기본 레이어를 통째로 건너뛴다 (컨트롤도 옵션도 기본 스펙 그대로).
  let auto = new Set<string>(((args['auto'] ?? []) as string[]).map((a) => a.trim()));
  if (auto.has('__all__')) auto = new Set(members);
  const strayAuto = [...auto].filter((a) => !members.includes(a));
  if (strayAuto.length) {
    print(`--auto 대상이 스쿼드에 없다: ${_py_repr(sorted(strayAuto))}`);
    exit(2);
  }

  for (const [n, ctrl] of Object.entries(controls)) over[n]!['control'] = ctrl;

  for (const spec of (args['burst_pattern'] ?? []) as string[]) {
    const parts = _split(spec.trim());
    if (parts.length < 2) {
      print(`--burst-pattern 은 패턴 이름이 필요하다: ${_py_repr(spec)}`);
      exit(2);
    }
    over[parts[0]!]!['burst_pattern'] = parts[1] === '없음' ? null : parts.slice(1).join(':');
  }

  for (const spec of (args['favorite'] ?? []) as string[]) {
    const parts = _split(spec.trim());
    if (parts.length !== 2 || !/^\d+$/.test(parts[1]!) || !(parseInt(parts[1]!, 10) >= 0 && parseInt(parts[1]!, 10) <= 3)) {
      print(`--favorite 는 \`이름:단계(0~3)\` 형식이다: ${_py_repr(spec)}`);
      exit(2);
    }
    over[parts[0]!]!['favorite_stage'] = parseInt(parts[1]!, 10);
  }

  if (!args['profile'] && (args['allow_unowned'] || args['profile_level'] !== 'fixed')) {
    print('--allow-unowned · --profile-level 은 --profile 과 함께만 의미가 있다');
    exit(2);
  }
  const profile: GrowthProfile | null = args['profile']
    ? load_profile(args['profile'], args['allow_unowned'], args['profile_level'])
    : null;

  const squad = char_spec.build_squad(members, over, null, auto, profile);
  const cfg = char_spec.build_config(squad, config);

  // seed를 주지 않으면 파이썬처럼 매 실행 다른 수열로 돈다(엔진의 난수는 시드 0으로 시작한다).
  if (args['seed'] === null) random.seed(Math.floor(Math.random() * 2 ** 32));

  // verbose=true: burst/buff/breakdown 뷰가 SimLog를 필요로 한다.
  let result;
  try {
    result = simulate(squad, cfg, Object.keys(enemy).length ? enemy : null, true, args['seed']);
  } catch (e) {
    if (e instanceof PyError && e.pyType === 'ValueError') {  // 이름 검증 실패 — 트레이스백은 도움이 안 된다
      print(e.message);
      exit(2);
    }
    throw e;
  }

  let seed_note: string;
  if (args['expected']) {
    seed_note = '  (기대값 모드 — 크리·코어히트 무작위 없음, 결정론적)';
  } else {
    seed_note = args['seed'] !== null ? `  (seed=${args['seed']})` : '  (seed 미지정 — 매 실행 결과가 다름)';
  }
  print(`스쿼드: ${members.join(', ')}${seed_note}`);
  // 기준선 이탈은 언제나 출력에 싣는다 — 수치만 보고 기본 스펙 결과로 오해하지 않도록.
  print(char_spec.format_deviations(squad, '', profile));
  print();

  const chars = args['char'] ? (args['char'] as string[]).map((c) => c.trim()) : null;

  switch (args['view']) {
    case 'summary':
      print(result.summary(chars));
      print();
      print(result.dmg_breakdown(chars));
      break;
    case 'breakdown':
      print(result.skill_breakdown_by_cycle(chars));
      break;
    case 'analysis':
      print_team_analysis(result, chars);
      break;
    case 'burst':
      print(result.log!.burst_summary(chars));
      break;
    case 'buff':
      print(result.log!.buff_summary(chars));
      break;
    case 'hits':
      print(result.hit_summary(chars));
      break;
    case 'gauge':
      print(result.log!.gauge_summary());
      break;
  }
}

runMain(main);

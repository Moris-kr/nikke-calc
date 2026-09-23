/**
 * 결정론적 스냅샷 회귀 하네스 (Claude 전용). `context/snapshot.py`를 옮긴 것이다.
 *
 * 계산기를 고친 뒤 기존 캐릭터가 조용히 틀어졌는지 잡는 도구다.
 * 정확성 검증 도구가 아니라 **변화 감지** 도구다 — baseline을 찍는 순간
 * 현재 코드의 기존 버그도 "정상"으로 고정된다. 정확성은 context/scenarios/*.md 담당.
 *
 *     cd site && npx tsx scripts/snapshot.ts                    # 전체 비교
 *     cd site && npx tsx scripts/snapshot.ts --squad 스쿼드1     # 일부만
 *     cd site && npx tsx scripts/snapshot.ts --update           # baseline 갱신
 *
 * ## 스냅샷 4층 구조
 *
 * 절대 시각은 저장하지 않는다. 발사 타이밍이 1프레임(0.0167s) 밀리는 건 노이즈지만
 * "버프가 적용된 다음에 대미지가 계산되는가" 하는 **순서**는 신호이기 때문이다.
 *
 *   L1 수치   — 캐릭터별 딜, 스킬별 딜·히트수, hit_tag 분포, 크리 수
 *   L2 발동   — 버프/인스턴트 이름별 발동 횟수와 대상 집합
 *   L3 순서   — 사이클별 이벤트 순서열 (시각 없음). 히트는 구간 집계로 압축
 *   L4 위상   — 사이클 간격(0.05초), 버프 발동 → 대상의 다음 히트까지 프레임 수 분포
 *
 * 자세한 사용법·diff 읽는 법은 context/HARNESS.md 참고.
 *
 * baseline 파일(context/baseline/*.json)은 파이썬 시절 `json.dumps(indent=1, ensure_ascii=False)`와 바이트까지
 * 같은 글로 쓴다(줄바꿈 LF — 저장소에 들어가는 모습과 같다).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

import { _is_float, _py_is_dict, _py_repr, _py_str } from '../src/engine/customization';
import { int, round, sorted } from '../src/engine/py';
import type { SimLog, SimResult } from '../src/engine/sim_result';
import * as spec from '../src/engine/spec';
import { _PARSED_SKILLS, simulate } from '../src/engine/timeline';
import { unifiedDiff } from './lib/difflib';
import { ROOT, exit, loadEngine, print, runMain } from './lib/engine';
import { floatList, floats, pyDumps } from './lib/pyjson';

let BASELINE_DIR = join(ROOT, 'context', 'baseline');

const DT = 1.0 / 60.0; // 시뮬레이터 프레임 간격 (timeline과 동일)

const PASS = '\x1b[92mPASS\x1b[0m';
const FAIL = '\x1b[91mFAIL\x1b[0m';

// ── 스쿼드 정의 ────────────────────────────────────────────────────────────
// 캐릭터 dict는 이름만 주면 `spec.build_squad`가 채운다 —
// 기본 육성 스펙(장비 옵션은 오버로드 레벨 10의 우월코드 4줄·공격력 2줄·최대장탄 2줄,
// 컨트롤 없음 — 수치의 정본은 `spec.overload()`다)에
// 캐릭터별 기본 레이어(`data/char_defaults.json`)를 얹은 값이다.
// 아래 `chars`는 **그 스쿼드에서만** 다른 것을 적는 자리다.
//
// 새 스쿼드 추가 → 여기에 항목 추가 후 `--update --squad <이름>` 으로 baseline 생성.
//
// 파이썬 float 리터럴(`3.0`·`30.0`)은 `floats(...)`로 표시한다 — baseline의 `"first_burst_time": 3.0`과
// 이탈 보고 글(`22.22 → 30.0`)이 파이썬 시절과 같게 찍히도록.

interface SquadInfo {
  members: string[];
  chars?: Record<string, Record<string, any>>;
  config?: Record<string, any>;
  enemy?: Record<string, any>;
  seed: number;
}

/** 스쿼드 공통 설정 `{"first_burst_time": 3.0, ...}` (파이썬 float 표시 포함). */
function cfg(extra: Record<string, any> = {}): Record<string, any> {
  return floats({ ...extra, first_burst_time: 3.0 }, 'first_burst_time');
}

export const SQUADS: Record<string, SquadInfo> = {
  '스쿼드1': {
    members: ['리틀 머메이드', '크라운', '라피 : 레드 후드', '미하라 : 본딩 체인', '헬름'],
    config: cfg(),
    seed: 42,
  },
  '스쿼드2': {
    // 리틀 머메이드 버스트 미사용
    members: ['츠바이', '나유타', '프리바티', '스노우 화이트 : 헤비암즈', '리틀 머메이드'],
    config: cfg({ no_burst_char: '리틀 머메이드' }),
    seed: 42,
  },
  '스쿼드3': {
    // = 실전 "작열샷건덱" (작열 약점 솔로레이드). 솔린 : 프로스트 티켓 버스트 미사용.
    // 작열 약점 적을 두는 유일한 초기 지그 — 아르카나 : 포츈 메이트·드레이크가 속성 유리를 받는다.
    members: ['토브', '아르카나 : 포츈 메이트', '도로시 : 세렌디피티', '드레이크', '솔린 : 프로스트 티켓'],
    config: cfg({ no_burst_char: '솔린 : 프로스트 티켓' }),
    enemy: { code: '풍압' },
    seed: 42,
  },
  '스쿼드4': {
    members: ['목단', '마스트 : 로망틱 메이드', '홍련 : 흑영', '리버렐리오', '앵커 : 이노센트 메이드'],
    chars: {
      // 택티컬 베어 큐브(탄충) = 유일한 instant 큐브. 다른 큐브는 전부 battle_start
      // 상시 버프라, 이 자리가 빠지면 `_make_cube_effects`의 instant 경로를
      // 어느 baseline도 밟지 않는다. 홍련 : 흑영은 실전에서도 탄충을 낀다.
      //
      // 이 스쿼드에서는 발동 32회가 잔탄 하한만 3 → 9로 올리고 **딜은 안 바뀐다** —
      // 홍련이 탄창을 비우는 일이 없어 재장전 시점이 그대로이기 때문이다.
      // 딜까지 움직이는 쪽은 `레이드_볼륨`이 덮는다(거기선 잔탄이 0을 찍는다).
      '홍련 : 흑영': { cube: { name: '택티컬 베어 큐브', level: 15 } },
    },
    config: cfg(),
    seed: 42,
  },
  '스쿼드5': {
    members: ['아니스 : 스타', '아르카나', '이사벨', '신데렐라', '크라운'],
    config: cfg(),
    seed: 42,
  },

  // ── 실전 레이드 조합 기반 (enikk.app 솔로레이드 시즌 30~39, 53,150 파스) ──
  // 미커버 31명을 덮기 위한 스쿼드. 조연은 임의 지그가 아니라 실제 상위 조합에서 가져왔다.
  //
  // 멤버 순서는 버스트 사용 순서다 — BurstController가 "스쿼드 입력 순서"를 우선순위로
  // 쓰므로, 커버 대상은 반드시 자기 단계(B1/B2/B3) 안에서 맨 앞에 둔다.
  // 뒤로 밀리면 같은 단계의 다른 캐릭터에게 선점당해 버스트를 아예 못 쓴다.
  //
  // 레드 후드(burst_stage "A")는 단계를 고정하지 않는다. 고정하면
  // 라피 : 레드 후드의 no_burst1_ally 조건이 깨져 라피가 1버로 전환되지 않는다.

  '레이드_미하라에이다': {
    // 커버: 에이다, D : 킬러 와이프, 그레이브, 미하라 : 본딩 체인, 미란다
    // D : 킬러 와이프는 버쿨감 용도로만 쓰이고 버스트는 미란다가 담당한다.
    members: ['미란다', '그레이브', '에이다', '미하라 : 본딩 체인', 'D : 킬러 와이프'],
    config: cfg({ no_burst_char: 'D : 킬러 와이프' }),
    seed: 42,
  },
  '레이드_레드후드퀀시': {
    // 커버: 민트, 프리카, 퀀시 : 이스케이프 퀸, 레드 후드
    // 팀에 고정 1버가 없어 라피 : 레드 후드가 1버로 전환된다. 라피를 레드 후드보다
    // 앞에 둬야 첫 사이클을 레드 후드가 1·2·3단계 독식하지 않는다.
    members: ['라피 : 레드 후드', '레드 후드', '프리카', '민트', '퀀시 : 이스케이프 퀸'],
    config: cfg(),
    seed: 42,
  },
  '레이드_아스카루드밀라': {
    // 커버: 아스카 : WILLE, 루드밀라 : 윈터 오너, 나가
    members: ['리틀 머메이드', '나가', '크라운', '아스카 : WILLE', '루드밀라 : 윈터 오너'],
    config: cfg(),
    seed: 42,
  },
  '레이드_헬름아쿠아스노우': {
    // 커버: 헬름 : 아쿠아마린, 스노우 화이트, 에이드 : 에이전트 바니
    members: ['미란다', '헬름 : 아쿠아마린', '에이드 : 에이전트 바니', '스노우 화이트', '에이다'],
    config: cfg(),
    seed: 42,
  },
  '레이드_앨리스브래디': {
    // 커버: 앨리스, 브래디
    members: ['아니스 : 스타', '앵커 : 이노센트 메이드', '마스트 : 로망틱 메이드', '앨리스', '브래디'],
    config: cfg(),
    seed: 42,
  },
  '레이드_네온벨벳': {
    // 커버: 네온 : 비전 아이, 벨벳
    members: ['리틀 머메이드', '벨벳', '나유타', '네온 : 비전 아이', '리버렐리오'],
    config: cfg(),
    seed: 42,
  },
  '레이드_이브레이븐': {
    // 커버: 이브, 레이븐
    members: ['목단', '민트', '프리카', '이브', '레이븐'],
    config: cfg(),
    seed: 42,
  },
  '레이드_소다': {
    // 커버: 소다 : 트윙클링 바니
    // 버쿨감 보유자가 없는 B3 3명 구성 — 사이클 20초가 정상이다.
    members: ['토브', '나유타', '소다 : 트윙클링 바니', '도로시 : 세렌디피티', '드레이크'],
    config: cfg(),
    seed: 42,
  },
  '레이드_일레그': {
    // 커버: 일레그 : 붐 앤 쇼크
    members: ['아니스 : 스타', '크라운', '일레그 : 붐 앤 쇼크', '헬름', '루드밀라 : 윈터 오너'],
    config: cfg(),
    seed: 42,
  },
  '레이드_델타': {
    // 커버: 델타 : 닌자 시프
    members: ['리틀 머메이드', '델타 : 닌자 시프', '크라운', '아스카 : WILLE', '라피 : 레드 후드'],
    config: cfg(),
    seed: 42,
  },
  '레이드_아니스서머메이든': {
    // 커버: 아니스 : 스파클링 서머, 메이든 : 아이스 로즈
    members: ['목단', '에이드 : 에이전트 바니', '아니스 : 스파클링 서머', '메이든 : 아이스 로즈', '프리바티'],
    config: cfg(),
    seed: 42,
  },
  '레이드_루주': {
    // 커버: 루주
    members: ['루주', '크라운', '마스트 : 로망틱 메이드', '신데렐라', '메이든 : 아이스 로즈'],
    config: cfg(),
    seed: 42,
  },
  '레이드_브리드디젤': {
    // 커버: 브리드 : 사일런트 트랙, 디젤 : 윈터 스위츠
    // 작열 약점 솔로레이드 실전 운용 그대로 — 멤버 순서와 마스트 운용이 실전 기준이다.
    //   · 디젤은 스노우 화이트 : 헤비암즈보다 **뒤**에 둔다 (B3 두 자리를 격 사이클로 나눠 쓴다)
    //   · 마스트 : 로망틱 메이드는 **3의 배수 사이클에만** 버스트한다. 종전에는 20엔트리
    //     `burst_sequence`를 손으로 박아 넣었는데, 이제 캐릭터별 기본 레이어의
    //     버스트 패턴(`every:3`)이 같은 일을 한다 — 도입 시 이 스쿼드가 무변동임을
    //     확인했다(그게 곧 패턴 컴파일러의 검증이었다).
    members: ['목단', '브리드 : 사일런트 트랙', '스노우 화이트 : 헤비암즈', '디젤 : 윈터 스위츠', '마스트 : 로망틱 메이드'],
    config: cfg(),
    enemy: { code: '풍압' },
    seed: 42,
  },
  '레이드_볼륨': {
    // 커버: 볼륨
    members: ['볼륨', '앵커 : 이노센트 메이드', '마스트 : 로망틱 메이드', '리버렐리오', '홍련 : 흑영'],
    chars: {
      // 스쿼드4와 같은 이유 — 홍련 : 흑영은 탄충 큐브로 굴린다.
      '홍련 : 흑영': { cube: { name: '택티컬 베어 큐브', level: 15 } },
    },
    config: cfg(),
    seed: 42,
  },
  // ── 작열 약점 솔로레이드 실전 조합 ──────────────────────────────────────
  // `enemy.code: "풍압"`이 작열 약점 보스다 (작열 → 풍압 우월, damage._CODE_ADVANTAGE).
  // 위 스쿼드들은 전부 무속성 적이라 is_element_match 경로가 스냅샷에 들어오지 않는다.
  // 같은 계열: `스쿼드3`(작열샷건덱) · `레이드_브리드디젤`(브브마디젤덱).
  // 풍압이 아닌 적은 `지그_라피1버전격` 하나뿐이다 — 로스터 코드가 아니라
  // `element_code_override`로 성립하는 우월 코드를 덮는 유일한 자리다.

  '레이드_라피앨리스': {
    // 커버: 앨리스(작열 SR) 속성 유리 · 라피 : 레드 후드
    //      + 컨트롤 두 종의 병행 — 앨리스 톡톡이 · 라피 장전컨(정책 A).
    // B3 셋 중 프리바티는 맨 뒤라 버스트를 쓰지 않는다 (`스쿼드2`가 커버).
    //
    // 실전 조작 순서는 "라피 장전컨이 우선, 아주 짧게 끝나므로 남은 시간은 앨리스 톡톡이"다.
    // 계산기는 동시 컨트롤 1명 제약을 검사하지 않으므로(CONTROL.md §미구현) 둘을 그냥 켠다 —
    // 라피를 조작하는 짧은 순간에 앨리스 톡톡이가 멈추는 손실만큼 낙관적인 상한이다.
    members: ['리틀 머메이드', '크라운', '라피 : 레드 후드', '앨리스', '프리바티'],
    chars: {
      // 앨리스의 톡톡이·차지속도 2줄(9.26%)은 캐릭터별 기본 레이어가 준다
      // (data/char_defaults.json) — 여기 다시 적지 않는다.
      //
      // 비버스트에 재장전이 걸리지 않도록 풀버스트가 끝나기 전에 미리 채운다.
      '라피 : 레드 후드': {
        control: { reload: { policy: 'before_fb_end', lead: 0.3 } },
      },
    },
    config: cfg(),
    enemy: { code: '풍압' },
    seed: 42,
  },
  '레이드_작열짬': {
    // 커버: 레이(작열 MG)·모더니아(작열 MG) — 둘 다 유일한 커버 스쿼드다.
    // + 장전컨 정책 B(`into_fb`).
    // 모더니아는 B3 셋 중 맨 뒤라 180초 동안 **버스트를 한 번도 쓰지 않는다** —
    // 실전 운용 그대로다(섬멸 모드는 무기계수를 낮추고 풀버스트를 5초 늘려
    // 사이클 간격을 밀어낸다). 그래서 `섬멸 모드` 자체는 이 스쿼드가 커버하지 않는다.
    //
    // 앨리스 한 명만 조작한다 — 톡톡이 + 풀버스트 시작 전에 재장전을 시작해
    // 시작 시점에 70%쯤 진행된 상태로 만든다. margin은 "완료가 풀버스트 시작 후
    // 몇 초 뒤인가"이므로 남은 30%에 해당하는 실초를 준다: 이 스쿼드의 앨리스
    // 재장전 실측이 1.42초(기본 2.0 + 재장 큐브·버프)라 0.3 × 1.42 ≒ 0.43.
    // 실측 진행률 68.2% (margin 0.6이면 56.5%로 모자란다).
    members: ['리타', '그레이브', '레이', '앨리스', '모더니아'],
    chars: {
      // 톡톡이·차지속도 옵션은 기본 레이어가 준다. 이 스쿼드에서만 다른 건 장전컨이다.
      '앨리스': {
        control: { reload: { policy: 'into_fb', margin: 0.43 } },
      },
    },
    config: cfg(),
    enemy: { code: '풍압' },
    seed: 42,
  },

  '레이드_트리나홍련': {
    // 커버: 홍련 — 자해(`current_hp_reduce`)로 자기 체력을 깎아
    // `self_hp_below:60`(크리 대미지)·`self_hp_below:50`(크리 확률)을 여는 유일한 캐릭터다.
    // **체력 모델이 딜에 직접 연결되는 자리**라, 자해가 현재 체력 비례가 아니게 되거나
    // 회복이 엉뚱한 대상에게 가면 여기가 먼저 운다.
    //
    // 트리나가 양방향으로 홍련의 체력을 움직인다 —
    //   ↓ `피스풀 트리`(`hp_only_caster_based_pct`)가 최대 체력만 올려 시작부터 hp_pct 67%
    //   ↑ `네이처 그레이스 2·3`(`allies_lowest_hp:2`)이 최저 체력 아군을 회복
    // 후자는 **instant target 해석이 시전자로 폴백하던 버그의 유일한 실사용 검출점**이다
    // (수정 전 홍련 hp_pct 수렴 12.7~19.1% → 수정 후 28.6~39.5%).
    //
    // 배치 주의: 홍련이 목단보다 **왼쪽**이어야 트리나의
    // `allies_code_weapon_leftmost:전격:AR:1` 버프 3종이 홍련에게 간다.
    // 둘 다 전격 AR이라 `allies_code_weapon:전격:AR` 쪽은 원래 양쪽 다 받는다.
    //
    // 적: 수냉 + 코어 보유. 전격 > 수냉이라 전격 4명이 우월 코드를 받는다
    // (기본 스펙의 장비 옵션 `우월코드 대미지 88.6%`가 실제로 실리는 자리다).
    // 코어 직경 52px는 `context/scenarios/명중률 탄착군.md`의 추정 코어 반경 26px에서
    // 온 값이며, 트리나의 `accuracy_pct` 버프가 코어히트율을 통해 딜에 반영되는
    // 경로를 함께 지킨다.
    members: ['트리나', '홍련', '아니스 : 스파클링 서머', '프리바티', '목단'],
    config: cfg(),
    enemy: { code: '수냉', core_px: 52 },
    seed: 42,
  },

  '지그_리타': {
    // 커버: 리타 — 시즌 30~39 실전 조합에 한 번도 등장하지 않아 템플릿 지그를 쓴다.
    members: ['리타', '크라운', 'test_B3', '스노우 화이트 : 헤비암즈'],
    config: cfg(),
    seed: 42,
  },

  '지그_리코리코': {
    // 커버: 타키나·치사토(CE008) — 둘 다 유일한 커버 스쿼드다. 나머지 셋은 기존 커버.
    // 방무(`armor_break_enabled` + `armor_break_dmg_pct`) 조합을 통째로 지키는 자리다:
    // 타키나가 아군 전체에 `armor_break_dmg_pct` +140.49를 뿌리고(스킬2, 15초 주기)
    // 치사토가 상시 방무 히트로 그걸 받아먹는다. 방무 경로가 깨지면 여기가 먼저 운다.
    //
    // 타키나 스킬2는 사이클(12.53s)이 아니라 **15초 고정 주기**라 위상이 계속 어긋난다
    // — 사이클과 무관한 `every:Ns` 트리거를 가진 유일한 하네스 스쿼드이기도 하다.
    // 상세는 context/scenarios/타키나.md.
    //
    // 에이다는 B3 셋 중 맨 뒤라 180초 동안 **버스트를 한 번도 쓰지 않는다**
    // (레이드_작열짬의 모더니아와 같은 패턴). 에이다 버스트는 레이드_미하라에이다·
    // 컨트롤_에이다미하라가 이미 덮는다.
    members: ['목단', '타키나', '치사토', '스노우 화이트 : 헤비암즈', '에이다'],
    config: cfg(),
    seed: 42,
  },

  '지그_라피1버전격': {
    // 커버 둘. 다른 스쿼드가 하나도 덮지 않는 경로다.
    //
    // ① `element_code_override` — 라피 : 레드 후드 `부착형 유탄`은 본인 코드(작열)와
    //    무관하게 **전격 적에게** 우월 코드를 성립시킨다. 아래 `enemy.code: "전격"`이
    //    그 유일한 스위치다. 코드 상성이 붙은 다른 스쿼드 6개는 전부 풍압이라,
    //    이 스쿼드가 빠지면 override 경로는 어느 baseline도 밟지 않는다.
    // ② **1버스트 라피** — 기본 B1 아군이 없어야 `no_burst1_ally` → `전투 보조`가
    //    걸린다. 스쿼드1·레이드_라피앨리스는 둘 다 리틀 머메이드가 있어 라피가 B3다.
    //    그래서 **B1 캐릭터를 넣으면 이 스쿼드의 의미가 사라진다.**
    //
    // 실전 조합이 아니라 GAMEPLAY.md §표준 테스트 스쿼드 템플릿이다 —
    // 철갑 약점(=전격 적) 시즌의 상위 조합 자료가 없어 지그로 둔다.
    // 라피 자신의 버쿨감(전황 파악 7.48 + 계승되는 힘 20)으로 40초 쿨이 매 사이클
    // 회복돼 12.533s 균일 사이클이 나온다 — 7.48 계열의 정상 간격열이다.
    // 크라운·test_B3(철갑)도 전격에 우월이라 ⑦가 넷 중 셋에 걸린다.
    members: ['라피 : 레드 후드', '크라운', 'test_B3', '스노우 화이트 : 헤비암즈'],
    config: cfg(),
    enemy: { code: '전격' },
    seed: 42,
  },

  '지그_아스카': {
    // 커버: 아스카(작열 AR) — GAMEPLAY.md §표준 테스트 스쿼드의 B3 템플릿 그대로다.
    // 실전 조합 자료가 없어 지그로 둔다. 시나리오는 `context/scenarios/아스카.md`.
    //
    // 이 스쿼드가 지키는 경로는 **`lifesteal_pct` → `event:heal_received` → 자기 버프**다.
    // 아스카 `호승심 2`(공격력 96.98%)의 유일한 트리거가 본인 버스트가 준 라이프스틸이고,
    // 보스 sim은 아군 피격 모델이 없어 그 회복이 전부 오버힐이다 — `_apply_lifesteal()`이
    // HP를 최대치에서 잘라내고도 notify하기 때문에 성립한다(GAMEPLAY.md §트리거 발동 의미).
    // 라이프스틸을 끊으면 아스카 딜이 −42.5%다. 힐 트리거를 자급하는 유일한 baseline.
    //
    // 크라운 `라스트 킹덤 2`가 매 사이클 `all_allies` 보호막을 깔아 `during_shield`를
    // 참으로 만든다 — 아스카 `돌격 전술`의 게이트다.
    members: ['리틀 머메이드', '크라운', '아스카', 'test_B3'],
    config: cfg(),
    seed: 42,
  },

  '지그_아스카풍압코어': {
    // 위와 같은 스쿼드에 **적만 바꾼 짝**이다. 기본 보스에서는 아스카 효과 8개 중
    // 5개가 조건 밖으로 빠져(`element_bonus_pct`·`core_dmg_pct`·`accuracy_pct`·
    // `pierce_enabled`·`shield_dmg_pct` 전부 딜 기여 0) 스킬2가 통째로 죽은 채
    // baseline이 굳는다. 풍압(작열 > 풍압) + 코어 보유로 그 셋을 살린다 —
    // 효과별 기여는 우월 코드 +11.4% · 코어 대미지 +15.2% · 명중률 +24.1%.
    // 코어 직경 52px는 `레이드_트리나홍련`과 같은 값이다(`scenarios/명중률 탄착군.md`).
    members: ['리틀 머메이드', '크라운', '아스카', 'test_B3'],
    config: cfg(),
    enemy: { code: '풍압', core_px: 52 },
    seed: 42,
  },

  // ── 컨트롤 스쿼드 ─────────────────────────────────────────────────────
  // 캐릭터가 아니라 **컨트롤 정책**을 커버한다. 다른 스쿼드는 전부 컨트롤이 꺼져 있어
  // 정책 코드가 스냅샷에 전혀 들어오지 않는다.

  '컨트롤_미란다미하라': {
    // 커버: 버스트 엄폐컨 own_full_burst (context/CONTROL.md §버스트 엄폐컨)
    // 미하라가 미란다 제외 공격력 1위여야 `웨이크업! 4`(크리확률 1발)를 받는다.
    // 기본 스펙으로는 헬름이 1위라 엄폐가 헛돌므로 장비 공격력으로 순위를 뒤집는다.
    // 미하라는 B3 두 명 중 뒤라 격 사이클로 버스트한다 — 정책의 양쪽 분기
    // (본인 버스트 사이클엔 엄폐 / 아닌 사이클엔 사격)가 한 스냅샷에 들어온다.
    // 엄폐컨 자체는 미란다가 있으면 레이어가 붙인다(`_control_rules`) — 여기 안 적는다.
    members: ['미란다', '브리드 : 사일런트 트랙', '헬름', '루주', '미하라 : 본딩 체인'],
    chars: {
      '미하라 : 본딩 체인': { equip_skills: floats({ atk_pct: 30.0 }, 'atk_pct') },
    },
    config: cfg(),
    enemy: { code: '풍압' },
    seed: 42,
  },
  '컨트롤_에이다미하라': {
    // 커버: 홀드컨 own_full_burst (context/CONTROL.md §홀드)
    // `레이드_미하라에이다`와 같은 조합·같은 컨트롤이고 우월 코드만 다르다. 에이다의
    // `은밀한 지원`이 직전에 버스트를 쓴 B3의 공격력을 올려 주므로 미란다
    // `웨이크업! 4`(크리확률 1발)가 사이클마다 에이다↔미하라로 번갈아 붙는다 —
    // 에이다는 홀드, 미하라는 엄폐로 아낀다. 둘 다 미란다가 있으면 레이어가 붙인다
    // (`_control_rules`) — 컨트롤을 끈 대조군은 `scripts/sim.ts --auto`로 본다.
    members: ['미란다', '그레이브', '에이다', '미하라 : 본딩 체인', 'D : 킬러 와이프'],
    config: cfg({ no_burst_char: 'D : 킬러 와이프' }),
    enemy: { code: '풍압' },
    seed: 42,
  },
};

/**
 * 이름 목록 → simulate()에 넘길 캐릭터 dict 목록.
 *
 * 스펙 합성은 `spec.build_squad`가 한다 — 기본 스펙 → 캐릭터별 기본 레이어
 * (`data/char_defaults.json`) → 여기의 `chars`. `chars`는 **그 스쿼드에서만** 다른 것을
 * 적는 자리다. 캐릭터를 어디서든 그렇게 굴린다면 `chars`가 아니라 레이어에 적는다.
 */
function build_squad(members: string[], chars?: Record<string, any>): Array<Record<string, any>> {
  return spec.build_squad(members, chars ?? null);
}

/** `context/spec.py`의 `_fmt` — 이탈 보고 한 칸(사전은 `{k=v, ...}`, 빈 사전은 `없음`). */
function specFmt(v: any, isFloat = false): string {
  if (_py_is_dict(v)) {
    const entries = Object.entries(v);
    return entries.length
      ? '{' + entries.map(([k, x]) => `${k}=${specFmt(x, _is_float(v, k))}`).join(', ') + '}'
      : '없음';
  }
  return _py_str(v, isFloat);
}

function deviationLines(squad: Array<Record<string, any>>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [nm, items] of spec.squad_deviations(squad)) {
    out.set(nm, items.map((row) => {
      const [k, b, c, src] = row;
      const [bf, cf] = row._float ?? [false, false];
      return `${k}: ${specFmt(b, bf)} → ${specFmt(c, cf)} (${src})`;
    }));
  }
  return out;
}

// ── 스냅샷 생성 ────────────────────────────────────────────────────────────
// 파이썬 dict는 삽입 순서를 지킨다. 키가 자료(이름·태그)에서 오는 사전은 `Map`으로 만들어
// 정수 모양 키가 JS 객체 규칙으로 앞당겨지지 않게 한다.

const strSorted = <T>(xs: Iterable<T>, key: (v: T) => string): T[] => sorted(xs, key);
const sortedMap = <V>(m: Map<string, V>): Map<string, V> =>
  new Map(strSorted([...m.entries()], (e) => e[0]));

/** 수치: 캐릭터별 딜·히트수·크리수·hit_tag 분포·스킬별 딜. */
function _layer1(result: SimResult): Record<string, any> {
  interface PC { hits: number; crits: number; hit_tags: Map<string, number>; skills: Map<string, { dmg: number; hits: number }> }
  const per_char = new Map<string, PC>();
  for (const ev of result.hits) {
    let c = per_char.get(ev.caster);
    if (!c) { c = { hits: 0, crits: 0, hit_tags: new Map(), skills: new Map() }; per_char.set(ev.caster, c); }
    c.hits += 1;
    if (ev.is_crit) c.crits += 1;
    c.hit_tags.set(ev.hit_tag, (c.hit_tags.get(ev.hit_tag) ?? 0) + 1);
    let s = c.skills.get(ev.skill_name);
    if (!s) { s = { dmg: 0, hits: 0 }; c.skills.set(ev.skill_name, s); }
    s.dmg += ev.damage;
    s.hits += 1;
  }

  const pc_out = new Map<string, unknown>();
  for (const [name, c] of sortedMap(per_char)) {
    pc_out.set(name, {
      hits: c.hits, crits: c.crits,
      hit_tags: sortedMap(c.hit_tags),
      skills: new Map([...sortedMap(c.skills)].map(([k, v]) => [k, { dmg: v.dmg, hits: v.hits }])),
    });
  }

  const fb_count = result.log ? result.log.burst_log.filter((e) => e.event === 'full_burst 시작').length : 0;

  return {
    squad_total: result.squad_total,
    char_total: sortedMap(new Map(Object.entries(result.char_total))),
    full_burst_count: fb_count,
    per_char: pc_out,
  };
}

/** 발동 횟수: 버프/인스턴트 이름별 횟수와 대상 집합. */
function _layer2(log: SimLog): Record<string, any> {
  interface Act { count: number; targets: Set<string>; stat: string | null }
  const buffs = new Map<string, Act>();
  for (const e of log.buff_events) {
    if (e.kind !== 'activate') continue;
    let b = buffs.get(e.name);
    if (!b) { b = { count: 0, targets: new Set(), stat: e.stat }; buffs.set(e.name, b); }
    b.count += 1;
    b.targets.add(e.target);
  }
  const instants = new Map<string, Act>();
  for (const e of log.instant_events) {
    let i = instants.get(e.name);
    if (!i) { i = { count: 0, targets: new Set(), stat: e.stat }; instants.set(e.name, i); }
    i.count += 1;
    i.targets.add(e.target);
  }
  const conv = (m: Map<string, Act>) => new Map([...sortedMap(m)].map(([k, v]) => [k, {
    count: v.count, targets: strSorted(v.targets, (x) => x), stat: v.stat,
  }]));
  return { buffs: conv(buffs), instants: conv(instants) };
}

// 같은 프레임에 서로 다른 로그 리스트의 이벤트가 있을 때의 정렬 우선순위.
// 실행 순서를 완벽히 복원하지는 못하지만 결정론적이며,
// 프레임이 다른 이벤트 간의 순서 변화(= 진짜 관심사)는 t로 정확히 잡힌다.
const _KIND_PRIO: Record<string, number> = { 'BURST': 0, 'B+': 1, 'I': 2, 'B-': 3 };

/** 파이썬 `bisect.bisect_left`. */
function bisectLeft(xs: number[], x: number): number {
  let lo = 0; let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * 순서: 사이클별 이벤트 순서열. 시각은 저장하지 않는다.
 *
 * 같은 (t, kind, name) 이벤트는 대상 집합으로 묶고,
 * 이벤트 사이 구간의 히트는 캐릭터별 집계 한 줄로 압축한다.
 */
function _layer3(result: SimResult, log: SimLog): Record<string, any> {
  interface Key { t: number; kind: string; name: string; order: number; targets: string[] }
  const grouped = new Map<string, Key>();
  const add = (t: number, kind: string, name: string, target: string, idx: number): void => {
    const rt = round(t, 6);
    const k = JSON.stringify([rt, kind, name]);
    let g = grouped.get(k);
    if (!g) { g = { t: rt, kind, name, order: idx, targets: [] }; grouped.set(k, g); }
    g.targets.push(target);
  };
  log.burst_log.forEach((e, i) => add(e.t, 'BURST', e.event, e.caster || '-', i));
  log.buff_events.forEach((e, i) => add(e.t, e.kind === 'activate' ? 'B+' : 'B-', e.name, e.target, i));
  log.instant_events.forEach((e, i) => add(e.t, 'I', e.name, e.target, i));

  const events = sorted([...grouped.values()], (k) => [k.t, _KIND_PRIO[k.kind] ?? 9, k.name, k.order]);

  // 사이클 경계 = 풀버스트 시작 시각
  const fb_starts = log.burst_log.filter((e) => e.event === 'full_burst 시작').map((e) => e.t);
  const bounds = [0.0, ...fb_starts, Infinity];

  // 히트를 시각순으로 (이미 정렬돼 있음) — 구간 집계용 인덱스
  const hit_ts = result.hits.map((h) => h.t);

  const hits_between = (t0: number, t1: number): string | null => {
    const lo = bisectLeft(hit_ts, t0);
    const hi = bisectLeft(hit_ts, t1);
    if (lo >= hi) return null;
    const agg = new Map<string, [number, number, number]>();
    for (let i = lo; i < hi; i += 1) {
      const h = result.hits[i]!;
      let a = agg.get(h.caster);
      if (!a) { a = [0, 0, 0]; agg.set(h.caster, a); }
      a[0] += 1;
      if (h.is_crit) a[1] += 1;
      if (h.hit_tag.includes('core')) a[2] += 1;
    }
    const parts = strSorted([...agg.entries()], (e) => e[0]).map(([name, [n, c, co]]) => `${name}:${n} crit:${c} core:${co}`);
    return 'HITS ' + parts.join(' | ');
  };

  const cycles: string[][] = [];
  for (let ci = 0; ci < bounds.length - 1; ci += 1) {
    const c0 = bounds[ci]!; const c1 = bounds[ci + 1]!;
    const seq: string[] = [];
    const cyc_events = events.filter((k) => c0 <= k.t && k.t < c1);

    let prev_t = c0;
    for (const key of cyc_events) {
      const h = hits_between(prev_t, key.t);
      if (h) seq.push(h);
      const targets = strSorted(new Set(key.targets), (x) => x);
      const tgt = targets.length === 1 ? targets[0] : `[${targets.join(', ')}]`;
      seq.push(`${key.kind} ${key.name} → ${tgt}`);
      prev_t = key.t;
    }

    const h = hits_between(prev_t, c1 !== Infinity ? c1 : result.duration + 1);
    if (h) seq.push(h);

    // 연속 동일 항목 런렝스 압축
    const compressed: string[] = [];
    for (const it of seq) {
      if (compressed.length && compressed[compressed.length - 1]!.split(' ×')[0] === it) {
        const base = compressed[compressed.length - 1]!.split(' ×');
        const n = base.length > 1 ? int(base[1]!) : 1;
        compressed[compressed.length - 1] = `${it} ×${n + 1}`;
      } else {
        compressed.push(it);
      }
    }
    cycles.push(compressed);
  }

  return { cycles };
}

/** 위상: 사이클 간격(0.05초)과 버프 발동 → 대상의 다음 히트까지 프레임 수 분포. */
function _layer4(result: SimResult, log: SimLog): Record<string, any> {
  const fb_starts = log.burst_log.filter((e) => e.event === 'full_burst 시작').map((e) => e.t);
  const gaps: number[] = [];
  for (let i = 0; i < fb_starts.length - 1; i += 1) {
    gaps.push(round((fb_starts[i + 1]! - fb_starts[i]!) / 0.05) * 0.05);
  }

  // 캐릭터별 히트 시각 (정렬됨) — bisect로 "다음 히트" 조회
  const by_char = new Map<string, number[]>();
  for (const h of result.hits) {
    let ts = by_char.get(h.caster);
    if (!ts) { ts = []; by_char.set(h.caster, ts); }
    ts.push(h.t);
  }

  const delays = new Map<string, Map<number, number>>();
  for (const e of log.buff_events) {
    if (e.kind !== 'activate') continue;
    const ts = by_char.get(e.target);
    if (!ts || !ts.length) continue;
    const idx = bisectLeft(ts, e.t);
    if (idx >= ts.length) continue;
    const frames = int(round((ts[idx]! - e.t) / DT));
    let c = delays.get(e.name);
    if (!c) { c = new Map(); delays.set(e.name, c); }
    c.set(frames, (c.get(frames) ?? 0) + 1);
  }

  return {
    cycle_gaps: floatList(gaps.map((g) => round(g, 2))),
    // 키는 JSON에서 어차피 문자열이 되므로 여기서 str로 통일한다.
    // (프레임 수 순서를 유지하려고 int로 정렬한 뒤 변환)
    buff_to_hit_frames: new Map([...sortedMap(delays)].map(([name, c]) => [
      name, new Map(sorted([...c.entries()], (e) => e[0]).map(([k, v]) => [String(k), v])),
    ])),
  };
}

/** 스냅샷 한 벌 — baseline 파일에 쓰는 글(파이썬 `json.dumps(indent=1)`)로 돌려준다. */
function snapshotText(squad_name: string, info: SquadInfo): string {
  const squad = build_squad(info.members, info.chars);
  const config = spec.build_config(squad, info.config ?? null);
  const result = simulate(squad, config, info.enemy ?? null, true, info.seed);
  const log = result.log!;
  const snap = {
    meta: {
      squad: squad_name,
      members: info.members,
      config,
      enemy: info.enemy ?? {},
      seed: info.seed,
      // 1층 이탈(레이어·오버라이드)을 스냅샷에 박아 둔다. 레이어가 조용히 바뀌면
      // 딜이 안 움직여도 여기서 FAIL이 난다 — 하네스 방식의 이탈 보고다.
      spec_deviations: deviationLines(squad),
    },
    L1_numbers: _layer1(result),
    L2_activations: _layer2(log),
    L3_order: _layer3(result, log),
    L4_phase: _layer4(result, log),
  };
  return pyDumps(snap, { indent: 1 });
}

// ── diff ──────────────────────────────────────────────────────────────────
// 비교는 파이썬과 같이 **읽어 들인 JSON 값**끼리 한다(저장된 baseline과 같은 표현).

type J = any;

/** 파이썬 `==` (JSON 값). 사전은 키 순서와 무관, 수는 값으로. */
function eq(a: J, b: J): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x: J, i: number) => eq(x, b[i]));
  const ka = Object.keys(a); const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && eq(a[k], b[k]));
}

const keysUnion = (a: J, b: J): string[] => strSorted(new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]), (x) => x);
const getk = (d: J, k: string, dflt: J = undefined): J =>
  (d != null && Object.prototype.hasOwnProperty.call(d, k) ? d[k] : dflt);

/** 파이썬 `f"{x:,}"` (정수). */
function commas(x: number): string {
  if (!Number.isInteger(x)) return _py_repr(x).replace(/^(-?)(\d+)/, (_, s, d) => s + d.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  const s = String(Math.abs(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return x < 0 ? `-${s}` : s;
}

/** 파이썬 `repr(None)`·`repr(int)` 등 — f-string에 dict 값을 그대로 넣는 자리. */
const pyv = (v: J): string => (v === undefined ? 'None' : _py_repr(v));

function _fmt_delta(old: number, nw: number): string {
  const d = nw - old;
  const pct = old ? (d / old) * 100 : Infinity;
  const pctText = Number.isFinite(pct)
    ? `${pct < 0 || Object.is(round(pct, 2), -0) ? '-' : '+'}${Math.abs(round(pct, 2)).toFixed(2)}`
    : '+inf';
  return `${commas(old)} → ${commas(nw)}  (${d >= 0 ? '+' : ''}${commas(d)}, ${pctText}%)`;
}

function _diff_l1(old: J, nw: J, out: string[]): void {
  if (old.squad_total !== nw.squad_total) {
    out.push(`  스쿼드 총딜  ${_fmt_delta(old.squad_total, nw.squad_total)}`);
  }

  for (const name of keysUnion(old.char_total, nw.char_total)) {
    const o = getk(old.char_total, name, 0); const n = getk(nw.char_total, name, 0);
    if (o !== n) out.push(`  [${name}] 총딜  ${_fmt_delta(o, n)}`);
  }

  if (old.full_burst_count !== nw.full_burst_count) {
    out.push(`  풀버스트 횟수  ${old.full_burst_count} → ${nw.full_burst_count}`);
  }

  for (const name of keysUnion(old.per_char, nw.per_char)) {
    const o = getk(old.per_char, name, {});
    const n = getk(nw.per_char, name, {});
    if (!eq(getk(o, 'hits', null), getk(n, 'hits', null))) out.push(`  [${name}] 히트수  ${pyv(o.hits)} → ${pyv(n.hits)}`);
    if (!eq(getk(o, 'crits', null), getk(n, 'crits', null))) out.push(`  [${name}] 크리수  ${pyv(o.crits)} → ${pyv(n.crits)}`);
    const ot = getk(o, 'hit_tags', {}); const nt = getk(n, 'hit_tags', {});
    for (const tag of keysUnion(ot, nt)) {
      const a = getk(ot, tag, 0); const b = getk(nt, tag, 0);
      if (a !== b) out.push(`  [${name}] hit_tag ${tag}  ${a} → ${b}`);
    }
    const os = getk(o, 'skills', {}); const ns = getk(n, 'skills', {});
    for (const sk of keysUnion(os, ns)) {
      const a = getk(os, sk, { dmg: 0, hits: 0 });
      const b = getk(ns, sk, { dmg: 0, hits: 0 });
      if (!eq(a, b)) {
        out.push(`  [${name}] 스킬 <${sk}>  딜 ${commas(a.dmg)} → ${commas(b.dmg)}  히트 ${a.hits} → ${b.hits}`);
      }
    }
  }
}

function _diff_l2(old: J, nw: J, out: string[]): void {
  for (const group of ['buffs', 'instants']) {
    const label = group === 'buffs' ? '버프' : '인스턴트';
    const o = old[group]; const n = nw[group];
    for (const name of keysUnion(o, n)) {
      const a = getk(o, name, null); const b = getk(n, name, null);
      if (eq(a, b)) continue;
      if (a === null) {
        out.push(`  + ${label} [${name}] 신규 발동 ${b.count}회 → ${_py_repr(b.targets)}`);
      } else if (b === null) {
        out.push(`  - ${label} [${name}] 발동 사라짐 (기존 ${a.count}회)`);
      } else {
        if (a.count !== b.count) out.push(`  ! ${label} [${name}] 발동 ${a.count} → ${b.count}회`);
        if (!eq(a.targets, b.targets)) out.push(`  ! ${label} [${name}] 대상 ${_py_repr(a.targets)} → ${_py_repr(b.targets)}`);
      }
    }
  }
}

function _diff_l3(old: J, nw: J, out: string[], max_lines = 12): void {
  const oc: string[][] = old.cycles; const nc: string[][] = nw.cycles;
  if (oc.length !== nc.length) out.push(`  사이클 수 ${oc.length} → ${nc.length}`);
  let shown = 0;
  for (let i = 0; i < Math.max(oc.length, nc.length); i += 1) {
    const a = i < oc.length ? oc[i]! : [];
    const b = i < nc.length ? nc[i]! : [];
    if (eq(a, b)) continue;
    out.push(`  ── 사이클 ${i} 순서 변화 ──`);
    for (const line of unifiedDiff(a, b, 1)) {
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue;
      out.push(`    ${line}`);
      shown += 1;
      if (shown >= max_lines) {
        out.push('    ... (이하 생략)');
        return;
      }
    }
  }
}

/** 사이클 간격 목록의 파이썬 repr (전부 float). */
const gapsRepr = (xs: number[]): string => _py_repr(floatList([...xs]));

function _diff_l4(old: J, nw: J, out: string[]): void {
  if (!eq(old.cycle_gaps, nw.cycle_gaps)) {
    out.push(`  사이클 간격  ${gapsRepr(old.cycle_gaps)}`);
    out.push(`           →  ${gapsRepr(nw.cycle_gaps)}`);
  }
  const o = old.buff_to_hit_frames; const n = nw.buff_to_hit_frames;
  for (const name of keysUnion(o, n)) {
    const a = getk(o, name, {}); const b = getk(n, name, {});
    if (eq(a, b)) continue;
    // 분포 전체를 찍으면 수백 개 키가 나와 읽을 수 없다. 달라진 프레임만 보인다.
    const frames = sorted(new Set([...Object.keys(a), ...Object.keys(b)]), (x) => int(x));
    const changed = frames
      .filter((f) => getk(a, f, 0) !== getk(b, f, 0))
      .map((f) => `${f}프레임 ${getk(a, f, 0)}→${getk(b, f, 0)}`);
    const head = changed.slice(0, 6).join(', ');
    const more = changed.length > 6 ? ` 외 ${changed.length - 6}건` : '';
    out.push(`  버프 [${name}] 발동→다음히트  ${head}${more}`);
  }
}

/** 기본 스펙 이탈(레이어·오버라이드) 변화. 딜이 안 움직여도 이건 잡아야 한다. */
function _diff_spec(old: J, nw: J, out: string[]): void {
  const o = getk(old, 'spec_deviations', {}); const n = getk(nw, 'spec_deviations', {});
  for (const name of keysUnion(o, n)) {
    const a = new Set<string>(getk(o, name, [])); const b = new Set<string>(getk(n, name, []));
    for (const line of strSorted([...b].filter((x) => !a.has(x)), (x) => x)) out.push(`  + [${name}] ${line}`);
    for (const line of strSorted([...a].filter((x) => !b.has(x)), (x) => x)) out.push(`  - [${name}] ${line}  (사라짐)`);
  }
}

/** 층별 diff 라인 목록. 비어 있으면 완전 일치. */
export function diff_snapshot(old: J, nw: J): string[] {
  const out: string[] = [];
  const buf: string[] = [];
  _diff_spec(getk(old, 'meta', {}), getk(nw, 'meta', {}), buf);
  if (buf.length) {
    out.push('\n  [기본 스펙 이탈 변화]');
    out.push(...buf);
  }
  const layers: Array<[string, (o: J, n: J, out: string[]) => void, string]> = [
    ['L1_numbers', _diff_l1, 'L1 수치'],
    ['L2_activations', _diff_l2, 'L2 발동 횟수'],
    ['L3_order', _diff_l3, 'L3 순서'],
    ['L4_phase', _diff_l4, 'L4 위상'],
  ];
  for (const [layer, fn, label] of layers) {
    const b: string[] = [];
    fn(old[layer], nw[layer], b);
    if (b.length) {
      out.push(`\n  [${label}]`);
      out.push(...b);
    }
  }
  return out;
}

// ── 실행 ──────────────────────────────────────────────────────────────────

const baseline_path = (squad_name: string): string => join(BASELINE_DIR, `${squad_name}.json`);

function save(squad_name: string, text: string): void {
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(baseline_path(squad_name), text, 'utf-8');
}

/**
 * (파싱된 캐릭터 수, 커버된 수, 미커버 이름 목록).
 *
 * `HARNESS.md §스쿼드 커버리지`가 이 함수를 정본으로 가리킨다 — 문서에 명단을 옮겨
 * 적으면 캐릭터가 추가될 때마다 조용히 낡는다. `test_*`는 지그용 더미라 제외한다.
 */
export function coverage(): [number, number, string[]] {
  const parsed = Object.keys(_PARSED_SKILLS()).filter((c) => !c.startsWith('test_'));
  const members = new Set(Object.values(SQUADS).flatMap((info) => info.members));
  const uncovered = strSorted(new Set(parsed.filter((c) => !members.has(c))), (x) => x);
  return [parsed.length, parsed.length - uncovered.length, uncovered];
}

/**
 * (이름, 스냅샷 글)을 `names` 순서 그대로 내놓는다.
 *
 * 스쿼드끼리 완전히 독립이고 시드가 고정이라(`HARNESS.md §왜 결정론적인가`) 어느
 * 순서로 돌리든, 몇 개를 동시에 돌리든 결과가 같다. 워커 스레드마다 엔진·난수를 따로 갖는다.
 * 출력 순서는 `names` 순서를 지키므로 순차 실행과 로그가 같다.
 */
async function* _snapshots(names: string[], jobs: number): AsyncGenerator<[string, string]> {
  if (jobs <= 1 || names.length <= 1) {
    for (const name of names) yield [name, snapshotText(name, SQUADS[name]!)];
    return;
  }
  const results = new Map<string, Promise<string>>();
  const queue = [...names];
  const nWorkers = Math.min(jobs, names.length);
  const workers: Worker[] = [];
  const waiters = new Map<string, { resolve: (s: string) => void; reject: (e: unknown) => void }>();
  for (const name of names) {
    results.set(name, new Promise<string>((resolve, reject) => waiters.set(name, { resolve, reject })));
    results.get(name)!.catch(() => undefined);  // 처리되지 않은 거부 경고 방지 — 아래 await에서 다시 던진다
  }
  const feed = (w: Worker): void => {
    const next = queue.shift();
    if (next === undefined) { void w.terminate(); return; }
    w.postMessage(next);
  };
  for (let i = 0; i < nWorkers; i += 1) {
    // 워커는 새 모듈 그래프라 tsx 로더를 다시 걸어 준 뒤 이 파일을 연다(`npx tsx`는 메인 스레드에만 건다).
    const boot = `import(${JSON.stringify(import.meta.resolve('tsx/esm/api'))})`
      + `.then((m) => { m.register(); return import(${JSON.stringify(import.meta.url)}); })`;
    const w = new Worker(boot, { eval: true, workerData: { baselineDir: BASELINE_DIR } });
    w.on('message', (msg: { name: string; text?: string; error?: string }) => {
      const wt = waiters.get(msg.name)!;
      if (msg.error !== undefined) wt.reject(new Error(`[${msg.name}] ${msg.error}`));
      else wt.resolve(msg.text!);
      feed(w);
    });
    w.on('error', (e) => { for (const wt of waiters.values()) wt.reject(e); });
    workers.push(w);
    feed(w);
  }
  try {
    for (const name of names) yield [name, await results.get(name)!];
  } finally {
    for (const w of workers) void w.terminate();
  }
}

async function run(names: string[], update: boolean, jobs: number): Promise<number> {
  let n_fail = 0;
  for (const name of names) {
    // 프리뷰(출시 전 카드 기준) 캐릭터가 낀 baseline은 출시 후 정식 등록에서 바뀔 수 있다
    const note = spec.preview_note(SQUADS[name]!.members);
    if (note) print(`⚠ [${name}] ${note}`);
  }

  for await (const [name, text] of _snapshots(names, jobs)) {
    const path = baseline_path(name);

    if (update || !existsSync(path)) {
      save(name, text);
      const action = update ? '갱신' : '신규 생성';
      print(`[${action}] ${name}  (${relative(ROOT, path)})`);
      continue;
    }

    const old = JSON.parse(readFileSync(path, 'utf-8'));
    const snap = JSON.parse(text);
    const lines = diff_snapshot(old, snap);
    if (!lines.length) {
      print(`[${PASS}] ${name}  총딜 ${commas(snap.L1_numbers.squad_total)}`);
    } else {
      n_fail += 1;
      print(`[${FAIL}] ${name}`);
      print(lines.join('\n'));
      print();
    }
  }
  return n_fail;
}

const USAGE = 'usage: snapshot.ts [-h] [--squad SQUAD] [--update] [--list] [--jobs JOBS] [--baseline-dir DIR]';
const HELP = `${USAGE}

결정론적 스냅샷 회귀 하네스

options:
  -h, --help            show this help message and exit
  --squad SQUAD         대상 스쿼드 (반복 지정 가능)
  --update              baseline을 현재 결과로 갱신
  --list                스쿼드 목록 출력
  --jobs JOBS, -j JOBS  동시에 돌릴 스쿼드 수 (기본: CPU 수, 최대 8). 1이면 순차 — 결과는 어느 쪽이든
                        같고, 디버깅할 때만 1로 둔다
  --baseline-dir DIR    baseline 폴더 (기본 context/baseline). 하네스 자체를 시험할 때만 바꾼다
`;

function argError(msg: string): never {
  process.stderr.write(`${USAGE}\nsnapshot.ts: error: ${msg}\n`);
  return exit(2);
}

function parseArgs(argv: string[]): { squad: string[] | null; update: boolean; list: boolean; jobs: number } {
  const args = { squad: null as string[] | null, update: false, list: false, jobs: Math.min(8, availableParallelism() || 1) };
  for (let i = 0; i < argv.length; i += 1) {
    let a = argv[i]!;
    let val: string | undefined;
    const eqAt = a.startsWith('--') ? a.indexOf('=') : -1;
    if (eqAt > 0) { val = a.slice(eqAt + 1); a = a.slice(0, eqAt); }
    const need = (): string => {
      if (val !== undefined) return val;
      const v = argv[i + 1];
      if (v === undefined || (v.startsWith('-') && v.length > 1 && !/^-\d/.test(v))) argError(`argument ${a}: expected one argument`);
      i += 1;
      return v!;
    };
    if (a === '-h' || a === '--help') { process.stdout.write(HELP); exit(0); }
    else if (a === '--squad') (args.squad ??= []).push(need());
    else if (a === '--update') args.update = true;
    else if (a === '--list') args.list = true;
    else if (a === '--jobs' || a === '-j') {
      const v = need();
      if (!/^[-+]?\d+$/.test(v.trim())) argError(`argument --jobs/-j: invalid int value: '${v}'`);
      args.jobs = parseInt(v, 10);
    } else if (a.startsWith('-j') && a.length > 2) {
      const v = a.slice(2);
      if (!/^[-+]?\d+$/.test(v)) argError(`argument --jobs/-j: invalid int value: '${v}'`);
      args.jobs = parseInt(v, 10);
    } else if (a === '--baseline-dir') BASELINE_DIR = need();
    else argError(`unrecognized arguments: ${argv.slice(i).join(' ')}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadEngine();

  if (args.list) {
    for (const [name, info] of Object.entries(SQUADS)) {
      const mark = existsSync(baseline_path(name)) ? '○' : '×';
      print(`  ${mark} ${name}: ${info.members.join(', ')}`);
      const squad = build_squad(info.members, info.chars);
      for (const [nm, lines] of deviationLines(squad)) {
        for (const line of lines) print(`      · [${nm}] ${line}`);
      }
    }
    const [parsed, covered, uncovered] = coverage();
    print(`\n총 ${Object.keys(SQUADS).length}스쿼드 · 파싱된 ${parsed}명 중 ${covered}명 커버`);
    print(`\n미커버 ${uncovered.length}명 (새 스쿼드를 짤 때 우선 후보):`);
    print('  ' + uncovered.join(' · '));
    return;
  }

  const names = args.squad ?? Object.keys(SQUADS);
  const unknown = names.filter((n) => !(n in SQUADS));
  if (unknown.length) {
    print(`알 수 없는 스쿼드: ${_py_repr(unknown)}\n사용 가능: ${_py_repr(Object.keys(SQUADS))}`);
    exit(2);
  }

  print(args.update ? '=== baseline 갱신 ===\n' : '=== 스냅샷 회귀 검사 ===\n');

  const n_fail = await run(names, args.update, args.jobs);

  if (args.update) {
    print(`\n${names.length}개 스쿼드 baseline 저장 완료`);
    return;
  }

  const n_pass = names.length - n_fail;
  print(`\n${n_pass}/${names.length} 통과`);
  if (n_fail) {
    print('\n변화가 의도된 것이면 `--update`로 baseline을 갱신한다.');
    print('의도치 않은 변화면 회귀다 — 원인을 찾을 때까지 갱신하지 않는다.');
  }
  exit(n_fail === 0 ? 0 : 1);
}

// ── 워커 스레드 ──────────────────────────────────────────────────────────
// 메인 스레드가 스쿼드 이름을 보내면 스냅샷 글을 돌려준다.

if (isMainThread) {
  runMain(main);
} else {
  BASELINE_DIR = (workerData as { baselineDir: string }).baselineDir;
  loadEngine();
  parentPort!.on('message', (name: string) => {
    try {
      parentPort!.postMessage({ name, text: snapshotText(name, SQUADS[name]!) });
    } catch (e) {
      parentPort!.postMessage({ name, error: (e as Error)?.stack ?? String(e) });
    }
  });
}


# Dual Code, Favorite Item, and Character Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 듀얼 우월 코드와 슈가 애장품 3단계를 정확히 계산하고, 캐릭터 상세 설정에서 오버로드 9종과 추천/직접 컨트롤을 설정하게 한다.

**Architecture:** 추가 우월 코드는 캐릭터의 기본 코드를 바꾸지 않고 구조화된 스킬 효과로 계산한다. 브라우저 설정은 Python 정본에서 메타데이터를 생성하고, 명시된 컨트롤만 캐릭터 레이어 뒤에서 완전 교체한다. UI는 캐릭터 카드 안에서 오버로드와 컨트롤을 편집하고 Pyodide 브리지의 단일 검증 경로를 통과한다.

**Tech Stack:** Python 3 표준 라이브러리/unittest, TypeScript, Vitest, Vite, Pyodide, JSON 정본 데이터

## Global Constraints

- 캐릭터 스킬 원문 정본은 `scraper/nikke_scraped.json`이다.
- 애장품 보유 캐릭터는 반드시 애장품 3단계로 적용한다.
- 추가 우월 코드는 공격 판정에만 사용하며 아군 코드 대상 선정에는 사용하지 않는다.
- 오버로드 항목은 `data/base_stat_tables/equipment_skills.json`의 9종을 모두 제공한다.
- 컨트롤은 각 캐릭터 상세 설정에 두며, 필드 미지정은 추천 자동, 빈 객체는 컨트롤 없음이다.
- 기존 사용자 변경과 무관한 파일은 수정하지 않는다.

---

### Task 1: 구조화된 듀얼 우월 코드 계산

**Files:**
- Modify: `data/parsed_skills.json`
- Modify: `calculator/buff_manager.py`
- Modify: `calculator/timeline.py`
- Modify: `calculator/test_timeline.py`
- Modify: `scraper/test_parse_nikke.py`

**Interfaces:**
- Consumes: 효과 객체 `{ "stat": "element_code_override", "target_code": "전격" }`
- Produces: 활성 추가 코드가 적 코드와 일치할 때 `get_buffs(...)["is_element_match"] == True`

- [ ] **Step 1: 실패하는 듀얼 코드 테스트 작성**

```python
def test_extra_element_advantage_does_not_replace_native_code(self):
    rapi = build_char("라피 : 레드 후드")
    assert advantage_for(rapi, "풍압") is True
    assert advantage_for(rapi, "전격") is True
    assert advantage_for(rapi, "작열") is False

def test_extra_element_does_not_change_ally_code_targeting(self):
    assert native_code("라피 : 레드 후드") == "작열"
```

- [ ] **Step 2: 테스트가 추가 전격 우월 판정에서 실패하는지 실행**

Run: `python -m unittest calculator.test_timeline -v`
Expected: FAIL because `element_code_override` is not applied to damage.

- [ ] **Step 3: 효과 데이터와 버프 판정 구현**

```python
if effect.get("stat") == "element_code_override":
    if effect.get("target_code") == self.enemy.code:
        out["is_element_match"] = True
```

타임라인의 각 공격 경로에서는 기본 판정을 덮어쓰지 않고 결합한다.

```python
buffs["is_element_match"] = (
    cs.is_element_match or bool(buffs.get("is_element_match"))
)
```

- [ ] **Step 4: 원문 누락 감지 테스트 추가**

```python
def test_every_extra_advantage_source_has_structured_target_code(self):
    expected = {"라피 : 레드 후드": "전격", "슈가": "작열"}
    assert scan_extra_advantage_sources() == expected
```

- [ ] **Step 5: 관련 Python 테스트 통과 확인**

Run: `python -m unittest calculator.test_timeline scraper.test_parse_nikke -v`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add data/parsed_skills.json calculator/buff_manager.py calculator/timeline.py calculator/test_timeline.py scraper/test_parse_nikke.py
git commit -m "feat: calculate extra elemental advantage"
```

### Task 2: 슈가 애장품 3단계 재구현과 안내 메타데이터

**Files:**
- Modify: `data/parsed_skills.json`
- Modify: `context/scenarios/슈가.md`
- Modify: `context/IMPL-STATUS.md`
- Modify: `site/scripts/export-settings.py`
- Modify: `site/src/types.ts`
- Modify: `site/src/character-settings.ts`
- Modify: `site/src/character-settings.test.ts`

**Interfaces:**
- Consumes: raw favorite item stages 1, 2, 3 for `슈가`
- Produces: `CharacterSettingsDefaults.favoriteItem?: { name: string; stage: 3 }`

- [ ] **Step 1: 슈가 애장품 효과 실패 테스트 작성**

```python
def test_sugar_uses_favorite_item_stage_three(self):
    skills = parsed_skills()["슈가"]
    assert find_effect(skills, "element_code_override")["target_code"] == "작열"
    assert find_effect(skills, "attack_speed_pct")
    assert find_effect(skills, "allies_code_weapon:수냉,철갑:SG")
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python -m unittest calculator.test_timeline -v`
Expected: FAIL because Sugar still has pre-favorite skills.

- [ ] **Step 3: 정본 원문에서 슈가 스킬 1·2·버스트를 애장품 3단계로 파싱**

`context/spec.py` 이외에서 캐릭터 dict 생성 경로를 추가하지 않는다. 단계 1의 작열 추가 우월, 단계 2의 SG/코드 아군 효과, 단계 3의 버스트 개선을 모두 구조화한다.

- [ ] **Step 4: 애장품 메타데이터와 UI 실패 테스트 작성**

```ts
expect(catalog.characters['슈가'].favoriteItem).toEqual({ name: expect.any(String), stage: 3 });
expect(container.textContent).toContain('애장품 보유 캐릭터는 반드시 애장품 3단계로 적용합니다.');
```

- [ ] **Step 5: 설정 내보내기와 안내 UI 구현**

```ts
export interface FavoriteItemMeta {
  name: string;
  stage: 3;
}
```

애장품 메타가 있는 캐릭터의 스킬 레벨 구역 바로 아래에 고정 안내를 렌더링한다.

- [ ] **Step 6: 슈가 시나리오와 구현 상태 갱신 후 테스트**

Run: `python -m unittest calculator.test_timeline -v`
Run: `npm test -- --run site/src/character-settings.test.ts`
Expected: both PASS.

- [ ] **Step 7: 커밋**

```bash
git add data/parsed_skills.json context/scenarios/슈가.md context/IMPL-STATUS.md site/scripts/export-settings.py site/src/types.ts site/src/character-settings.ts site/src/character-settings.test.ts
git commit -m "feat: apply Sugar favorite item stage three"
```

### Task 3: 오버로드 9종 전체 설정

**Files:**
- Modify: `calculator/customization.py`
- Modify: `calculator/test_customization.py`
- Modify: `site/src/character-settings.ts`
- Modify: `site/src/character-settings.test.ts`
- Regenerate: `site/public/settings.json`

**Interfaces:**
- Consumes: `OVERLOAD_FIELDS` entries keyed by the nine equipment skill IDs
- Produces: validated `equip_skills` override containing any subset of those nine IDs

- [ ] **Step 1: 9종 스키마 실패 테스트 작성**

```python
def test_all_canonical_overload_fields_are_browser_safe(self):
    assert set(OVERLOAD_FIELDS) == {
        "atk_pct", "def_pct", "element_bonus", "max_ammo_pct",
        "crit_rate", "crit_dmg", "charge_speed_pct",
        "charge_dmg_pct", "accuracy_pct",
    }
```

- [ ] **Step 2: 차지 속도·대미지 전달 실패 확인**

Run: `python -m unittest calculator.test_customization -v`
Expected: FAIL because three canonical options are absent from `OVERLOAD_FIELDS`.

- [ ] **Step 3: 정본 표에서 라벨과 최대 범위를 산출하도록 구현**

```python
OVERLOAD_IDS = (
    "atk_pct", "def_pct", "element_bonus", "max_ammo_pct",
    "crit_rate", "crit_dmg", "charge_speed_pct",
    "charge_dmg_pct", "accuracy_pct",
)
```

허용 최대값은 각 옵션 레벨 15 값의 4줄 합보다 작지 않게 설정하고 기존 큰 수동 입력 호환성을 유지한다.

- [ ] **Step 4: UI 9개 입력과 비차지 안내 테스트 작성 및 구현**

```ts
expect(container.querySelectorAll('[data-overload-key]')).toHaveLength(9);
expect(container.textContent).toContain('차지형 무기가 아니면 차지 옵션은 효과가 없습니다.');
```

- [ ] **Step 5: 설정 JSON 재생성과 테스트**

Run: `python site/scripts/export-settings.py > site/public/settings.json`
Run: `python -m unittest calculator.test_customization -v`
Run: `npm test -- --run site/src/character-settings.test.ts`
Expected: PASS and generated JSON contains all nine fields.

- [ ] **Step 6: 커밋**

```bash
git add calculator/customization.py calculator/test_customization.py site/src/character-settings.ts site/src/character-settings.test.ts site/public/settings.json
git commit -m "feat: expose every overload option"
```

### Task 4: 추천/직접 캐릭터 컨트롤 스키마

**Files:**
- Modify: `context/spec.py`
- Create: `context/test_spec.py`
- Modify: `calculator/customization.py`
- Modify: `calculator/test_customization.py`
- Modify: `site/scripts/export-settings.py`
- Modify: `site/src/types.ts`

**Interfaces:**
- Consumes: browser `control?: ControlSettings`; absent means automatic layer, `{}` means none
- Produces: engine `control` dict that completely replaces the resolved layer only when explicit

- [ ] **Step 1: 명시적 빈 컨트롤 교체 실패 테스트 작성**

```python
def test_explicit_empty_control_clears_character_layer(self):
    char = build_char("앨리스", {"control": {}})
    assert char["control"] == {}

def test_missing_control_keeps_character_layer(self):
    assert "tap_fire" in build_char("앨리스")["control"]
```

- [ ] **Step 2: 재귀 병합으로 첫 테스트가 실패하는지 확인**

Run: `python -m unittest context.test_spec -v`
Expected: FAIL because `{}` does not clear nested layer controls.

- [ ] **Step 3: 레이어 뒤 완전 교체 구현**

```python
explicit_control = "control" in (over or {})
control = copy.deepcopy((over or {}).get("control"))
c = deep_merge(c, over)
if explicit_control:
    c["control"] = control
```

- [ ] **Step 4: 브라우저 컨트롤 검증 실패 테스트 작성**

```python
def test_normalizes_supported_control_policies(self):
    result = normalize_character_overrides({
        "control": {
            "tap_fire": {"rate": 3.6, "release": 0.03},
            "reload": {"policy": "before_fb_end", "lead": 0.3},
            "hold": {"policy": "own_full_burst", "lead": 0.5},
            "cover": {"policy": "own_full_burst"},
        }
    })
    assert result["control"]["tap_fire"]["rate"] == 3.6
```

- [ ] **Step 5: 엄격한 컨트롤 스키마와 메타데이터 구현**

지원 정책은 `context/CONTROL.md`의 `tap_fire`, `reload.before_fb_end`, `reload.into_fb`, `hold.own_full_burst`, `cover.own_full_burst`로 제한한다. 숫자는 유한성·양수·합리적 상한을 검증하고 알 수 없는 키와 정책은 거부한다. 내보낸 캐릭터 메타에는 무기 유형, 추천 컨트롤, 조합 조건부 추천 여부를 포함한다.

- [ ] **Step 6: Python 테스트 통과 확인**

Run: `python -m unittest context.test_spec calculator.test_customization -v`
Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add context/spec.py context/test_spec.py calculator/customization.py calculator/test_customization.py site/scripts/export-settings.py site/src/types.ts
git commit -m "feat: support explicit character controls"
```

### Task 5: 캐릭터 상세 설정 컨트롤 UI

**Files:**
- Modify: `site/src/character-settings.ts`
- Modify: `site/src/character-settings.test.ts`
- Modify: `site/src/styles.css`
- Modify: `site/src/app.test.ts`

**Interfaces:**
- Consumes: `CharacterSettingsDefaults.recommendedControl`, `weaponType`, optional `CharacterOverrides.control`
- Produces: omitted `control` for 추천 자동 or an exact control object for 직접 설정

- [ ] **Step 1: 추천/직접 모드 실패 테스트 작성**

```ts
expect(container.textContent).toContain('추천 자동 적용');
manualMode.click();
expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ control: {} }));
```

- [ ] **Step 2: 무기별 토글과 정책 실패 테스트 작성**

```ts
expect(rlContainer.querySelector('[data-control="tap_fire"]')).not.toBeNull();
expect(arContainer.querySelector('[data-control="tap_fire"]')).toBeNull();
expect(arContainer.querySelector('[data-control="reload"]')).not.toBeNull();
```

- [ ] **Step 3: 컨트롤 편집 UI 구현**

추천 자동/직접 설정 라디오, 톡톡이·홀드·재장전·버스트 엄폐 토글을 렌더링한다. 직접 모드 전환 시 빈 객체로 시작하고 토글 ON 시 다음 정본 기본값을 쓴다.

```ts
const defaults = {
  tap_fire: { rate: 3.6, release: 0.03 },
  hold: { policy: 'own_full_burst', lead: 0.5 },
  reloadBefore: { policy: 'before_fb_end', lead: 0.3 },
  reloadInto: { policy: 'into_fb', margin: 0.43 },
  cover: { policy: 'own_full_burst' },
};
```

- [ ] **Step 4: 요약·경고·스타일 구현**

요약 줄에 `컨트롤 추천 자동` 또는 `컨트롤 직접 N개`를 표시한다. 한 덱에서 둘 이상의 캐릭터가 직접 컨트롤을 활성화하면 `여러 캐릭터 동시 컨트롤은 실제 조작보다 유리한 상한일 수 있습니다.`를 표시한다.

- [ ] **Step 5: 웹 테스트와 빌드 통과 확인**

Run: `npm test -- --run site/src/character-settings.test.ts site/src/app.test.ts`
Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add site/src/character-settings.ts site/src/character-settings.test.ts site/src/styles.css site/src/app.test.ts
git commit -m "feat: add per-character control settings"
```

### Task 6: 전체 회귀·문서·배포 검증

**Files:**
- Modify if required by verified behavior: `context/CONTROL.md`
- Modify if required by verified behavior: `context/CALCULATOR.md`
- Modify if required by verified behavior: `README.md`
- Regenerate: `site/public/settings.json`

**Interfaces:**
- Consumes: Tasks 1-5
- Produces: release-ready master with synchronized generated assets and documentation

- [ ] **Step 1: 생성 파일 최신화**

Run: `python site/scripts/export-settings.py > site/public/settings.json`
Expected: exit 0 and clean JSON parse.

- [ ] **Step 2: 전체 Python 회귀 실행**

Run: `python -m unittest discover -v`
Expected: PASS.

- [ ] **Step 3: 스냅샷과 문서 린트 실행**

Run: `python context/snapshot.py --check`
Run: `python context/doclint.py`
Expected: PASS. Confirmed intentional snapshot changes are regenerated and reviewed before acceptance.

- [ ] **Step 4: 전체 웹 테스트·빌드 실행**

Run: `npm test -- --run`
Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: 브라우저 스모크 테스트**

개발 서버에서 라피 : 레드 후드와 슈가를 선택해 애장품 안내, 오버로드 9종, 추천/직접 컨트롤을 확인한다. 전격/작열 적을 바꿔 듀얼 우월 결과 변화가 발생하고, 직접 컨트롤 없음이 추천 자동과 다른 결과를 낼 수 있음을 확인한다.

- [ ] **Step 6: 최종 변경 검토와 커밋**

Run: `git diff --check`
Run: `git status --short`
Expected: only reviewed documentation/generated updates remain.

```bash
git add context/CONTROL.md context/CALCULATOR.md README.md site/public/settings.json
git commit -m "docs: document character control settings"
```

- [ ] **Step 7: 원격 반영 확인**

Run: `git push origin master`
Run: `git status --short --branch`
Expected: `master...origin/master` with no working-tree changes.

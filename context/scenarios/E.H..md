# E.H. 시나리오

## 효과 매핑

| 효과 | 슬롯 | 타이밍 | 스탯·Lv10 | 대상 | 지속 |
|---|---|---|---|---|---|
| 폐품 수집 | 스킬2 | `battle_start` | `gauge_charge` 10.0 | `self` | 즉시 |
| 정크 헌팅 | 스킬2 | `battle_start` | `element_bonus_pct` 16.36 | `self` | 15 |
| 폐품 수집 2 | 스킬2 | `event:projectile_destroy` | `gauge_charge` 1.0 | `self` | 즉시 |
| 정크 헌팅 2 | 스킬2 | `event:projectile_destroy` | `element_bonus_pct` 16.36 | `self` | 15 |
| 폐품 수집 3 | 스킬2 | `event:part_destroy` | `gauge_charge` 5.0 | `self` | 즉시 |
| 정크 헌팅 3 | 스킬2 | `event:part_destroy` | `element_bonus_pct` 16.36 | `self` | 15 |
| 폐품 수집 4 | 스킬2 | `enemy_death` | `gauge_charge` 2.0 | `self` | 즉시 |
| 정크 헌팅 4 | 스킬2 | `enemy_death` | `element_bonus_pct` 16.36 | `self` | 15 |
| 사제 탄창 제작 | 스킬1 | `every:0.0167s` | `gauge_charge` 1 | `self` | 즉시 |
| 사제 탄창 제작 2 | 스킬1 | `every:0.0167s` | `atk_pct` 7.5 | `self` | -1 |
| 사제 탄창 제작 3 | 스킬1 | `every:0.0167s` | `gauge_consume` -1.0 | `self` | 즉시 |
| 인 투 더 헤븐 | 스킬3 | `burst_cast` | `weapon_change` — | `self` | 10.0 |
| 인 투 더 헤븐 탄창 소비 | 스킬3 | `hit_count:1` | `gauge_consume_as_ammo` 1.0 | `self` | 즉시 |
| 인 투 더 헤븐 2 | 스킬3 | `burst_cast` | `atk_pct` 430.05 | `self` | 10 |

## 특수 판정

폐품 10개마다 사제 탄창 1개로 변환하며 최대 4개다. 버스트 변경 무기 장탄은 시전 시 보유 사제 탄창 게이지를 읽는다.

## 확인 항목

- [ ] 기본 무기 발사 및 버스트 단계가 정상 진행된다.
- [ ] 위 효과의 Lv10 수치·대상·지속시간이 로그와 일치한다.
- [ ] 미지원 메커니즘은 `context/CHAR-SPECIAL-CASES.md` 상태와 일치한다.

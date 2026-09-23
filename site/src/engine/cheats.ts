/**
 * 핵 — 게임에 없는 값을 억지로 켜는 스위치.
 *
 * 이식: calculator/cheats.py (설명은 원본 docstring 참고)
 */
import { float, get, isfinite, or, reprFloat, truthy, ValueError } from './py';

//: 대미지 배수 상한. 이보다 크면 실수로 친 값으로 본다(부동소수점이 먼저 무너진다).
export const DMG_MULT_MAX = 1_000.0;

export interface CheatsInit {
  burst_charge?: boolean;
  infinite_ammo?: boolean;
  always_crit?: boolean;
  damage_mult?: number;
}

// py: calculator/cheats.py:30
/** 켜진 핵 묶음. 전부 꺼진 것이 기본값이다. (frozen dataclass → 생성 뒤 Object.freeze) */
export class Cheats {
  //: 버스트 게이지 충전 시간을 0으로. 개별 버스트 쿨타임은 그대로다.
  readonly burst_charge: boolean;
  //: 모든 니케의 장탄을 무한으로 — 탄이 줄지 않으니 재장전도 없다.
  readonly infinite_ammo: boolean;
  //: 크리티컬 확률 100%.
  readonly always_crit: boolean;
  //: 최종 대미지 배수.
  readonly damage_mult: number;

  constructor(kw: CheatsInit = {}) {
    this.burst_charge = kw.burst_charge !== undefined ? kw.burst_charge : false;
    this.infinite_ammo = kw.infinite_ammo !== undefined ? kw.infinite_ammo : false;
    this.always_crit = kw.always_crit !== undefined ? kw.always_crit : false;
    this.damage_mult = kw.damage_mult !== undefined ? kw.damage_mult : 1.0;
    Object.freeze(this);
  }

  // py: calculator/cheats.py:43
  /** 하나라도 켜져 있나. */
  get on(): boolean {
    return truthy(
      or(or(or(this.burst_charge, this.infinite_ammo), this.always_crit),
        this.damage_mult !== 1.0),
    );
  }

  // py: calculator/cheats.py:51
  /** `get_buffs`가 낸 표에 핵을 얹는다. */
  apply_to_buffs(buffs: Record<string, any>): void {
    if (truthy(this.always_crit)) {
      // 크리 확률은 0~1이다. 일반 공격용과 스킬용이 따로 누산되므로 둘 다 채운다.
      buffs['crit_rate'] = 1.0;
      buffs['crit_rate_skill'] = 1.0;
    }
    if (this.damage_mult !== 1.0) {
      buffs['cheat_dmg_mult'] = this.damage_mult;
    }
  }

  /** dataclass `__eq__` — 필드 전부가 같으면 같다. */
  equals(other: unknown): boolean {
    return other instanceof Cheats
      && this.burst_charge === other.burst_charge
      && this.infinite_ammo === other.infinite_ammo
      && this.always_crit === other.always_crit
      && this.damage_mult === other.damage_mult;
  }
}

//: 아무것도 안 켠 상태. 기본값으로 여기저기 쓰인다.
export const NO_CHEATS = new Cheats();

function _is_dict(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set);
}

// py: calculator/cheats.py:65
/** `config["cheats"]`를 읽는다. 없으면 `NO_CHEATS`. */
export function from_config(config: Record<string, any> | null | undefined): Cheats {
  const raw = or(get(or(config, {}), 'cheats'), {});
  if (!_is_dict(raw)) {
    throw ValueError('cheats는 dict여야 한다');
  }
  // `or`로 기본값을 주면 0이 1로 둔갑해 잘못된 값이 그대로 통과한다 — 없을 때만 채운다.
  const raw_mult = get(raw, 'damage_mult');
  const mult = raw_mult == null ? 1.0 : float(raw_mult);
  if (!isfinite(mult) || mult <= 0.0 || mult > DMG_MULT_MAX) {
    // f"{DMG_MULT_MAX:g}" → "1000", {mult!r} → 파이썬 float repr
    throw ValueError(`대미지 배수는 0 초과 1000 이하여야 한다: ${reprFloat(mult)}`);
  }
  return new Cheats({
    burst_charge: truthy(get(raw, 'burst_charge')),
    infinite_ammo: truthy(get(raw, 'infinite_ammo')),
    always_crit: truthy(get(raw, 'always_crit')),
    damage_mult: mult,
  });
}

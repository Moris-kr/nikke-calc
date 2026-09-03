"""핵 — 게임에 없는 값을 억지로 켜는 스위치.

이 계산기는 «인게임에서 이만큼 나온다»를 재는 물건이라, 여기 있는 것들은 전부 그
약속을 일부러 깨뜨린다. 그래서 엔진 곳곳에 흩뿌리지 않고 **이 파일 하나로** 모았다:
어디까지가 진짜 계산이고 어디부터가 장난인지 한눈에 보여야 하기 때문이다.
화면 쪽도 같은 이유로, 하나라도 켜져 있으면 결과 위에 크게 떠든다.

거는 방식은 둘뿐이다.

* `apply_to_buffs` — 계산식은 손대지 않고 **입력 표(buffs)만** 바꾼다. 크리 확률은
  엔진에 이미 있는 값(`crit_rate`)이라 그 자리에 100%를 얹으면 그만이다.
* 대미지 배수만은 엔진에 대응하는 값이 없어 `cheat_dmg_mult`라는 제 이름을 달고
  ①~⑦ 곱 **밖에서** 마지막에 곱해진다(`damage.calc_damage`) — 게임의 계산식
  어디에도 이런 자리는 없으니 그 안에 섞지 않는다.

버스트 게이지(시간의 문제)와 무한 장탄(탄창의 문제)은 표에 얹을 것이 아니라서
`timeline`이 이 묶음을 직접 읽는다. 무한 장탄에 엔진의 `max_ammo_infinite` 버프를
쓰지 않은 것은 그쪽이 «탄을 소비하지 않는다»는 뜻이어서다 — 그러면 「아군 탄 소비
N발마다」로 사는 니케(리틀 머메이드 등)가 통째로 멈춘다. 핵은 탄창이 안 비게 할
뿐이고 소비는 그대로 일어난다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

#: 대미지 배수 상한. 이보다 크면 실수로 친 값으로 본다(부동소수점이 먼저 무너진다).
DMG_MULT_MAX = 1_000.0


@dataclass(frozen=True)
class Cheats:
    """켜진 핵 묶음. 전부 꺼진 것이 기본값이다."""

    #: 버스트 게이지 충전 시간을 0으로. 개별 버스트 쿨타임은 그대로다.
    burst_charge: bool = False
    #: 모든 니케의 장탄을 무한으로 — 탄이 줄지 않으니 재장전도 없다.
    infinite_ammo: bool = False
    #: 크리티컬 확률 100%.
    always_crit: bool = False
    #: 최종 대미지 배수.
    damage_mult: float = 1.0

    @property
    def on(self) -> bool:
        """하나라도 켜져 있나."""
        return bool(
            self.burst_charge or self.infinite_ammo or self.always_crit
            or self.damage_mult != 1.0
        )

    def apply_to_buffs(self, buffs: dict) -> None:
        """`get_buffs`가 낸 표에 핵을 얹는다."""
        if self.always_crit:
            # 크리 확률은 0~1이다. 일반 공격용과 스킬용이 따로 누산되므로 둘 다 채운다.
            buffs["crit_rate"] = 1.0
            buffs["crit_rate_skill"] = 1.0
        if self.damage_mult != 1.0:
            buffs["cheat_dmg_mult"] = self.damage_mult


#: 아무것도 안 켠 상태. 기본값으로 여기저기 쓰인다.
NO_CHEATS = Cheats()


def from_config(config: dict | None) -> Cheats:
    """`config["cheats"]`를 읽는다. 없으면 `NO_CHEATS`."""
    raw = (config or {}).get("cheats") or {}
    if not isinstance(raw, dict):
        raise ValueError("cheats는 dict여야 한다")
    # `or`로 기본값을 주면 0이 1로 둔갑해 잘못된 값이 그대로 통과한다 — 없을 때만 채운다.
    raw_mult = raw.get("damage_mult")
    mult = 1.0 if raw_mult is None else float(raw_mult)
    if not math.isfinite(mult) or mult <= 0.0 or mult > DMG_MULT_MAX:
        raise ValueError(f"대미지 배수는 0 초과 {DMG_MULT_MAX:g} 이하여야 한다: {mult!r}")
    return Cheats(
        burst_charge=bool(raw.get("burst_charge")),
        infinite_ammo=bool(raw.get("infinite_ammo")),
        always_crit=bool(raw.get("always_crit")),
        damage_mult=mult,
    )

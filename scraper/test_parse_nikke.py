from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scraper import parse_nikke


def _fixture(rarity: str) -> dict:
    return {
        "레어도": rarity,
        "속성": "철갑",
        "클래스": "화력형",
        "기업": "엘리시온",
        "스쿼드": "Test",
        "스쿼드명": "테스트",
        "버스트 단계": "3",
        "무기상세": {
            "무기유형": "AR",
            "최대 장탄 수": "60",
            "재장전 시간": "1.0s",
            "조작 타입": "일반형",
            "무기스킬": "[공격력 13.65% 대미지]\n[코어 대미지 200%]",
        },
        "스킬": {
            "스킬 1": {},
            "스킬 2": {},
            "버스트": {"쿨타임": "40s"},
        },
    }


class ParseNikkeRarityTest(unittest.TestCase):
    def test_exports_canonical_rarity_for_every_character_type(self):
        source = {f"test_{rarity}": _fixture(rarity) for rarity in ("R", "SR", "SSR")}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "parsed.json"
            with patch.object(parse_nikke, "OUT", output), patch.object(
                parse_nikke, "load_preview", return_value={}
            ):
                parse_nikke.run(source)
            parsed = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(parsed["test_R"]["rarity"], "R")
        self.assertEqual(parsed["test_SR"]["rarity"], "SR")
        self.assertEqual(parsed["test_SSR"]["rarity"], "SSR")


if __name__ == "__main__":
    unittest.main()

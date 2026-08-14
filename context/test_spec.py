from __future__ import annotations

import unittest

from context.spec import build_char


class CharacterControlOverrideTest(unittest.TestCase):
    def test_missing_control_keeps_recommended_character_layer(self):
        self.assertIn("tap_fire", build_char("앨리스")["control"])

    def test_explicit_empty_control_replaces_recommended_character_layer(self):
        self.assertEqual(build_char("앨리스", {"control": {}})["control"], {})

    def test_explicit_control_replaces_instead_of_merging_layer(self):
        char = build_char("앨리스", {
            "control": {"reload": {"policy": "before_fb_end", "lead": 0.3}},
        })
        self.assertEqual(char["control"], {
            "reload": {"policy": "before_fb_end", "lead": 0.3},
        })


if __name__ == "__main__":
    unittest.main()

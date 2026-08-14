from __future__ import annotations

import unittest

from context.spec import build_char


class CharacterControlOverrideTest(unittest.TestCase):
    def test_missing_control_keeps_recommended_character_layer(self):
        self.assertIn("tap_fire", build_char("앨리스")["control"])

    def test_direct_python_control_keeps_recursive_layer_merge(self):
        char = build_char("앨리스", {
            "control": {"reload": {"policy": "before_fb_end", "lead": 0.3}},
        })
        self.assertIn("tap_fire", char["control"])
        self.assertIn("reload", char["control"])

    def test_browser_control_override_replaces_instead_of_merging_layer(self):
        char = build_char("앨리스", {
            "_control_override": {
                "reload": {"policy": "before_fb_end", "lead": 0.3},
            },
        })
        self.assertEqual(char["control"], {
            "reload": {"policy": "before_fb_end", "lead": 0.3},
        })

    def test_browser_empty_control_override_clears_recommended_layer(self):
        self.assertEqual(
            build_char("앨리스", {"_control_override": {}})["control"], {}
        )


if __name__ == "__main__":
    unittest.main()

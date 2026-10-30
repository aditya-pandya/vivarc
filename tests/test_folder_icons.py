import shutil
import unittest

from jsrun import run_js


def js(expr, **data):
    return run_js("09-folder-icons.js", f"window.__vm.folderIcons.{expr}", **data)


@unittest.skipUnless(shutil.which("node"), "node is needed to test the sidebar's JavaScript")
class Emoji(unittest.TestCase):
    def clean(self, text):
        return js("cleanEmoji(text)", text=text)

    def test_one_emoji_is_kept_including_ones_made_of_several_parts(self):
        self.assertEqual(self.clean("📚"), "📚")
        self.assertEqual(self.clean("🏋️"), "🏋️")
        self.assertEqual(self.clean("👨‍👩‍👧"), "👨‍👩‍👧")
        self.assertEqual(self.clean("🇯🇵"), "🇯🇵")
        self.assertEqual(self.clean("1️⃣"), "1️⃣")
        self.assertEqual(self.clean("👨🏿‍👩🏿‍👧🏿‍👦🏿"), "👨🏿‍👩🏿‍👧🏿‍👦🏿")

    def test_only_the_first_emoji_of_several_is_used_and_spaces_are_ignored(self):
        self.assertEqual(self.clean("  📚🎓 "), "📚")

    def test_text_and_nothing_are_not_emoji(self):
        for bad in ("", "   ", "abc", "1", "#", "a📚", "<script>", None):
            self.assertEqual(self.clean(bad), "")

    def test_the_saved_map_drops_anything_that_is_not_an_emoji(self):
        saved = {"1": "📚", "2": "hello", "3": 5, "4": "<b>", "5": "🎓🎓"}
        self.assertEqual(js("sanitize(saved)", saved=saved), {"1": "📚"})
        self.assertEqual(js("sanitize(null)"), {})
        self.assertEqual(js("sanitize('x')"), {})

    def test_the_palette_is_all_emoji(self):
        grid = js("GRID")
        self.assertTrue(len(grid) >= 24)
        self.assertTrue(all(js("cleanEmoji(e) === e", e=e) for e in grid))

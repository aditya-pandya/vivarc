import shutil
import unittest

from jsrun import run_js


def external(tab, focused=False):
    return run_js("12-little.js", "window.__vm.little.isExternalLink(tab, focused)", tab=tab, focused=focused)


@unittest.skipUnless(shutil.which("node"), "node is needed to test the sidebar's JavaScript")
class ExternalLink(unittest.TestCase):
    def test_a_web_tab_with_no_opener_while_vivaldi_is_in_the_background_is_an_outside_link(self):
        self.assertTrue(external({"id": 1, "url": "https://example.com/a"}))

    def test_a_pending_url_counts_before_the_tab_has_loaded(self):
        self.assertTrue(external({"id": 1, "url": "", "pendingUrl": "https://example.com/a"}))

    def test_a_tab_opened_while_vivaldi_is_focused_is_not(self):
        self.assertFalse(external({"id": 1, "url": "https://example.com/a"}, focused=True))

    def test_a_tab_opened_from_a_page_is_not(self):
        self.assertFalse(external({"id": 1, "url": "https://example.com/a", "openerTabId": 4}))

    def test_the_new_tab_page_and_internal_pages_are_not(self):
        self.assertFalse(external({"id": 1, "url": "vivaldi://newtab/"}))
        self.assertFalse(external({"id": 1, "url": "chrome://settings"}))

    def test_a_tab_opened_quietly_in_the_background_is_not(self):
        self.assertFalse(external({"id": 1, "url": "https://example.com/a", "active": False}))
        self.assertTrue(external({"id": 1, "url": "https://example.com/a", "active": True}))

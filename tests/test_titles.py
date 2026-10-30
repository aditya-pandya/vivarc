import json
import os
import shutil
import subprocess
import unittest

from jsrun import JS_DIR, run_js


def js(expr, **data):
    return run_js("13-titles.js", f"window.__vm.titles.{expr}", **data)


@unittest.skipUnless(shutil.which("node"), "node is needed to test the sidebar's JavaScript")
class Cleaning(unittest.TestCase):
    def clean(self, text):
        return js("cleanTitle(text)", text=text)

    def test_quotes_trailing_punctuation_and_extra_lines_go(self):
        self.assertEqual(self.clean('"Resume Generator."'), "Resume Generator")
        self.assertEqual(self.clean("\n  Job Search OS \nBecause it tracks jobs"), "Job Search OS")
        self.assertEqual(self.clean("Football scores —"), "Football scores")

    def test_a_long_answer_is_cut_at_a_word(self):
        self.assertEqual(self.clean("A very long tab name that keeps going and going"), "A very long tab name that keeps")

    def test_nothing_usable_gives_an_empty_name(self):
        self.assertEqual(self.clean(""), "")
        self.assertEqual(self.clean('""'), "")
        self.assertEqual(js("cleanTitle(null)"), "")

    def test_the_answer_is_read_from_the_text_blocks_of_the_response(self):
        body = {"content": [{"type": "thinking", "text": "x"}, {"type": "text", "text": "Tax Sign In"}]}
        self.assertEqual(js("answerOf(body)", body=body), "Tax Sign In")
        self.assertEqual(js("answerOf({})"), "")


@unittest.skipUnless(shutil.which("node"), "node is needed to test the sidebar's JavaScript")
class Privacy(unittest.TestCase):
    def test_only_the_origin_and_path_of_the_address_are_sent(self):
        text = js("userText(tab)", tab={"title": "Sign in", "url": "https://example.com/login?token=SECRET&x=1#frag"})
        self.assertIn("https://example.com/login", text)
        self.assertNotIn("SECRET", text)
        self.assertNotIn("frag", text)

    def test_the_request_carries_the_key_the_model_and_no_page_content(self):
        req = js("request('sk-test', 'claude-haiku-5-5', tab)", tab={"title": "T", "url": "https://a.example/b?c=d"})
        body = json.loads(req["init"]["body"])
        self.assertEqual((req["url"], req["init"]["headers"]["x-api-key"], body["model"]), ("https://api.anthropic.com/v1/messages", "sk-test", "claude-haiku-5-5"))
        self.assertEqual(body["messages"][0]["content"], "Title: T\nAddress: https://a.example/b")

    def test_only_web_pages_qualify(self):
        self.assertTrue(js("isWeb('https://a.example/')"))
        self.assertFalse(js("isWeb('vivaldi://settings')"))


SUGGEST = """
const fs = require("fs"), vm = require("vm");
const events = [], named = [], calls = [];
globalThis.window = { __vm: { config: JSON.parse(process.argv[1]), pins: { titleOf: (t) => t.custom, pinOf: (t) => t.pin }, nameTab: async (tab, t) => { named.push([tab.id, t]); } },
  dispatchEvent: (e) => events.push(e.detail) };
globalThis.document = {};
globalThis.chrome = { tabs: { get: async () => JSON.parse(process.argv[5] || process.argv[4]) } };
globalThis.CustomEvent = class { constructor(type, init) { this.detail = init.detail; } };
const reply = JSON.parse(process.argv[3]);
globalThis.fetch = async (url, init) => { calls.push([url, JSON.parse(init.body)]); return reply; };
const log = console.log; console.warn = () => {};
vm.runInThisContext(fs.readFileSync(process.argv[2], "utf8"));
(async () => {
  const tab = JSON.parse(process.argv[4]);
  const ok = await window.__vm.titles.suggest(tab);
  log(JSON.stringify({ ok, named, calls: calls.length, toast: events.map((e) => (typeof e === "string" ? e : e.message)) }));
  process.exit(0);
})();
"""


TAB = {"id": 4, "title": "Resume Generator | Local", "url": "https://127.0.0.1:8765/app?x=1"}


@unittest.skipUnless(shutil.which("node"), "node is needed to test the sidebar's JavaScript")
class Suggesting(unittest.TestCase):
    def run_with(self, config, reply, tab=TAB, now=None):
        script = SUGGEST.replace("const reply = JSON.parse(process.argv[3]);",
                                 "const raw = JSON.parse(process.argv[3]); const reply = { ok: raw.ok, status: raw.status, json: async () => raw.body };")
        result = subprocess.run(["node", "-e", script, json.dumps(config), os.path.join(JS_DIR, "13-titles.js"), json.dumps(reply), json.dumps(tab)] + ([json.dumps(now)] if now else []),
                                capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

    def test_without_a_key_nothing_is_sent_and_the_user_is_told_where_to_put_one(self):
        out = self.run_with({}, {"ok": True, "status": 200, "body": {}})
        self.assertEqual((out["ok"], out["calls"], out["named"]), (False, 0, []))
        self.assertIn("anthropicKey", out["toast"][0])

    def test_a_good_answer_names_the_tab_and_offers_undo(self):
        body = {"content": [{"type": "text", "text": '"Resume Generator"'}]}
        out = self.run_with({"anthropicKey": "k"}, {"ok": True, "status": 200, "body": body})
        self.assertEqual((out["ok"], out["named"], out["calls"]), (True, [[4, "Resume Generator"]], 1))
        self.assertEqual(out["toast"], ["Named “Resume Generator”"])

    def test_a_failed_request_changes_nothing(self):
        out = self.run_with({"anthropicKey": "k"}, {"ok": False, "status": 401, "body": {}})
        self.assertEqual((out["ok"], out["named"]), (False, []))
        self.assertEqual(out["toast"], ["Could not get a title suggestion"])

    def test_pages_that_are_not_web_pages_are_refused_before_any_request(self):
        out = self.run_with({"anthropicKey": "k"}, {"ok": True, "status": 200, "body": {}}, {"id": 1, "title": "Settings", "url": "vivaldi://settings"})
        self.assertEqual((out["ok"], out["calls"]), (False, 0))

    def test_a_pinned_tab_is_refused_before_any_request(self):
        out = self.run_with({"anthropicKey": "k"}, {"ok": True, "status": 200, "body": {}}, {**TAB, "pin": "p1"})
        self.assertEqual((out["ok"], out["calls"]), (False, 0))
        self.assertIn("pinned", out["toast"][0])

    GOOD_BODY = {"content": [{"type": "text", "text": "Resume Generator"}]}

    def test_an_answer_for_a_page_the_tab_has_left_is_dropped(self):
        out = self.run_with({"anthropicKey": "k"}, {"ok": True, "status": 200, "body": self.GOOD_BODY}, TAB, {**TAB, "url": "https://other.example/"})
        self.assertEqual((out["ok"], out["named"]), (False, []))

    def test_an_answer_is_dropped_when_the_tab_was_renamed_meanwhile(self):
        out = self.run_with({"anthropicKey": "k"}, {"ok": True, "status": 200, "body": self.GOOD_BODY}, TAB, {**TAB, "custom": "Mine"})
        self.assertEqual((out["ok"], out["named"]), (False, []))

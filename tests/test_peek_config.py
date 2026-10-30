import json
import os
import shutil
import subprocess
import unittest

STUBS = os.path.join(os.path.dirname(__file__), "..", "src", "optional", "peek-stubs.js")

HARNESS = """
const fs = require("fs"), vm = require("vm");
let file = process.argv[3] === "null" ? null : process.argv[3];
let writes = 0;
const handle = { getFile: async () => { if (file === null) throw new Error("none"); return { text: async () => file }; },
  createWritable: async () => ({ write: async (t) => { file = t; writes++; }, close: async () => {} }) };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => ({
  getFileHandle: async (name, opts) => { if (file === null && !(opts && opts.create)) throw new Error("none"); return handle; } }) }) } } });
globalThis.window = { __vmConfig: JSON.parse(process.argv[2]) };
const log = console.log; console.warn = () => {};
vm.runInThisContext(fs.readFileSync(process.argv[1], "utf8"));
setTimeout(() => { log(JSON.stringify({ file: file === null ? null : JSON.parse(file), writes })); process.exit(0); }, 100);
"""


def run(config, existing=None):
    arg = "null" if existing is None else json.dumps(existing)
    out = subprocess.run(["node", "-e", HARNESS, STUBS, json.dumps(config), arg], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


@unittest.skipUnless(shutil.which("node"), "node is needed to test the sidebar's JavaScript")
class PeekConfig(unittest.TestCase):
    def test_nothing_is_written_without_a_peek_block(self):
        self.assertEqual(run({}), {"file": None, "writes": 0})
        self.assertEqual(run({"peek": "no"}), {"file": None, "writes": 0})

    def test_the_settings_are_written_where_peek_reads_them(self):
        out = run({"peek": {"clickOpenModifiers": ["shift"]}})
        self.assertEqual(out["file"], {"mods": {"arcPeek": {"clickOpenModifiers": ["shift"]}}})

    def test_only_peeks_own_settings_are_passed_on(self):
        out = run({"peek": {"autoOpenList": [], "evil": 1}})
        self.assertEqual(out["file"]["mods"]["arcPeek"], {"autoOpenList": []})

    def test_what_is_already_in_the_file_is_kept(self):
        existing = {"theme": "x", "mods": {"other": {"a": 1}, "arcPeek": {"longPressHoldTime": 300}}}
        out = run({"peek": {"clickOpenModifiers": ["shift"]}}, existing)
        self.assertEqual(out["file"], {"theme": "x", "mods": {"other": {"a": 1}, "arcPeek": {"longPressHoldTime": 300, "clickOpenModifiers": ["shift"]}}})

    def test_an_unchanged_file_is_not_rewritten(self):
        existing = {"mods": {"arcPeek": {"autoOpenList": []}}}
        self.assertEqual(run({"peek": {"autoOpenList": []}}, existing)["writes"], 0)

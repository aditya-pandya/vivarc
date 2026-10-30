import json
import os
import shutil
import subprocess
import unittest

from jsrun import JS_DIR, run_js


def js(expr, **data):
    return run_js("09-split.js", f"window.__vm.split.{expr}" if not expr.startswith("(") else expr, **data)


def tab(id, tiling=None, index=0, **extra):
    ext = {"tiling": tiling} if tiling else {}
    return {"id": id, "index": index, "windowId": 1, "vivExtData": json.dumps(ext), **extra}


def tile(group, index, layout="row"):
    return {"id": group, "layout": layout, "type": "selection", "index": index}


RECT = {"left": 100, "top": 0, "width": 1000, "height": 800}


@unittest.skipUnless(shutil.which("node"), "node is needed to test the sidebar's JavaScript")
class DropEdge(unittest.TestCase):
    def edge(self, x, y, rect=RECT):
        return js("edgeOf(x, y, rect)", x=x, y=y, rect=rect)

    def test_near_each_edge_gives_that_edge(self):
        self.assertEqual(self.edge(110, 400), "left")
        self.assertEqual(self.edge(1090, 400), "right")
        self.assertEqual(self.edge(600, 10), "top")
        self.assertEqual(self.edge(600, 790), "bottom")

    def test_the_middle_is_not_a_drop(self):
        self.assertIsNone(self.edge(600, 400))

    def test_the_band_is_a_quarter_of_the_page_and_the_boundary_counts(self):
        self.assertEqual(self.edge(350, 400), "left")
        self.assertIsNone(self.edge(351, 400))

    def test_a_corner_goes_to_the_side_edge_on_a_tie(self):
        self.assertEqual(self.edge(100, 0), "left")
        self.assertEqual(self.edge(1100, 800), "right")

    def test_outside_or_degenerate_rectangles_give_nothing(self):
        self.assertIsNone(self.edge(50, 400))
        self.assertIsNone(self.edge(600, 900))
        self.assertIsNone(self.edge(5, 5, {"left": 0, "top": 0, "width": 0, "height": 10}))

    def test_placement_says_which_way_the_tiles_run_and_who_goes_first(self):
        self.assertEqual(js("placement('left')"), {"layout": "row", "first": True})
        self.assertEqual(js("placement('right')"), {"layout": "row", "first": False})
        self.assertEqual(js("placement('top')"), {"layout": "column", "first": True})
        self.assertEqual(js("placement('bottom')"), {"layout": "column", "first": False})


@unittest.skipUnless(shutil.which("node"), "node is needed to test the sidebar's JavaScript")
class Grouping(unittest.TestCase):
    def shape(self, tabs):
        return [[t["id"] for t in item["tabs"]] if "group" in item else item["tab"]["id"] for item in js("groupTabs(tabs)", tabs=tabs)]

    def test_no_tabs_and_loose_tabs_stay_loose(self):
        self.assertEqual(self.shape([]), [])
        self.assertEqual(self.shape([tab(1), tab(2)]), [1, 2])

    def test_two_tabs_of_one_group_become_one_item_in_tile_order(self):
        tabs = [tab(1), tab(2, tile("g", 1)), tab(3, tile("g", 0)), tab(4)]
        self.assertEqual(self.shape(tabs), [1, [3, 2], 4])

    def test_a_group_sits_at_its_first_member_even_if_the_members_are_not_adjacent(self):
        tabs = [tab(2, tile("g", 1)), tab(1), tab(3, tile("g", 0))]
        self.assertEqual(self.shape(tabs), [[3, 2], 1])

    def test_groups_of_three_stay_together(self):
        tabs = [tab(1, tile("g", 2)), tab(2, tile("g", 0)), tab(3, tile("g", 1))]
        self.assertEqual(self.shape(tabs), [[2, 3, 1]])

    def test_a_group_with_one_visible_member_is_a_loose_tab(self):
        self.assertEqual(self.shape([tab(1, tile("g", 0)), tab(2)]), [1, 2])

    def test_malformed_data_is_ignored_and_the_input_is_not_changed(self):
        tabs = [{"id": 1, "vivExtData": "{nope"}, {"id": 2, "vivExtData": json.dumps({"tiling": {"id": ""}})}, {"id": 3}]
        self.assertEqual(self.shape(tabs), [1, 2, 3])

    def test_two_separate_groups_are_two_items(self):
        tabs = [tab(1, tile("a", 0)), tab(2, tile("b", 0)), tab(3, tile("a", 1)), tab(4, tile("b", 1))]
        self.assertEqual(self.shape(tabs), [[1, 3], [2, 4]])


SERVICE = """
const fs = require("fs"), vm = require("vm");
globalThis.window = { __vm: { workspaces: { of: (t) => { try { return JSON.parse(t.vivExtData || "{}").workspaceId || 0; } catch (_) { return 0; } } } } };
const tabs = JSON.parse(process.argv[1]);
const writes = [];
globalThis.chrome = { tabs: {
  get: async (id) => { const t = tabs.find((x) => x.id === id); if (!t) throw new Error("gone"); return JSON.parse(JSON.stringify(t)); },
  query: async () => JSON.parse(JSON.stringify(tabs)),
  update: async (id, props) => { writes.push([id, JSON.parse(props.vivExtData)]); tabs.find((x) => x.id === id).vivExtData = props.vivExtData; },
  create: async () => { const t = { id: 99, index: 5, windowId: 1, vivExtData: "{}" }; tabs.push(t); return t; },
} };
vm.runInThisContext(fs.readFileSync(process.argv[2], "utf8"));
(async () => {
  const AsyncFunction = (async () => {}).constructor;
  const out = await (new AsyncFunction("split", "writes", "tabs", process.argv[3]))(window.__vm.split, writes, tabs);
  console.log(JSON.stringify(out, (k, v) => (v === undefined ? null : v)));
  process.exit(0);
})();
"""


def service(tabs, body):
    result = subprocess.run(["node", "-e", SERVICE, json.dumps(tabs), os.path.join(JS_DIR, "09-split.js"), body],
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


@unittest.skipUnless(shutil.which("node"), "node is needed to test the sidebar's JavaScript")
class Joining(unittest.TestCase):
    def test_dropping_on_the_right_edge_tiles_the_page_first_and_the_dragged_tab_second(self):
        out = service([tab(1), tab(2)], "const ok = await split.join(1, 2, 'right'); return [ok, writes.slice(0, 2)];")
        ok, writes = out
        self.assertTrue(ok)
        self.assertEqual([(w[0], w[1]["tiling"]["index"], w[1]["tiling"]["layout"]) for w in writes], [(1, 0, "row"), (2, 1, "row")])
        self.assertEqual(writes[0][1]["tiling"]["id"], writes[1][1]["tiling"]["id"])

    def test_dropping_on_the_top_edge_puts_the_dragged_tab_first_in_a_column(self):
        out = service([tab(1), tab(2)], "await split.join(1, 2, 'top'); return writes.slice(0, 2);")
        self.assertEqual([(w[0], w[1]["tiling"]["index"], w[1]["tiling"]["layout"]) for w in out], [(2, 0, "column"), (1, 1, "column")])

    def test_a_tab_cannot_be_dropped_on_itself_or_a_vanished_tab(self):
        self.assertEqual(service([tab(1)], "return [await split.join(1, 1, 'left'), await split.join(1, 7, 'left'), writes];"), [False, False, []])

    def test_tabs_of_another_window_or_space_are_not_paired(self):
        other_window = [tab(1), tab(2, windowId=2)]
        self.assertEqual(service(other_window, "return [await split.join(1, 2, 'left'), writes];"), [False, []])
        spaces = [{**tab(1), "vivExtData": json.dumps({"workspaceId": 5})}, tab(2)]
        self.assertEqual(service(spaces, "return [await split.join(1, 2, 'left'), writes];"), [False, []])

    def test_a_group_left_with_one_tab_is_dissolved(self):
        tabs = [tab(1, tile("old", 0)), tab(2, tile("old", 1)), tab(3)]
        out = service(tabs, "await split.join(3, 2, 'right'); return writes.filter((w) => w[0] === 1);")
        self.assertEqual(out, [[1, {}]])

    def test_a_larger_group_keeps_its_layout_with_its_order_closed_up(self):
        tabs = [tab(1, tile("old", 0, "column")), tab(2, tile("old", 1, "column")), tab(3, tile("old", 2, "column")), tab(4)]
        out = service(tabs, "await split.join(4, 2, 'right'); return writes.filter((w) => w[0] !== 4 && w[0] !== 2);")
        self.assertEqual([(w[0], w[1]["tiling"]["layout"], w[1]["tiling"]["index"]) for w in out], [(1, "column", 0), (3, "column", 1)])

    def test_unsplit_clears_every_member_and_ignores_a_tab_without_a_group(self):
        tabs = [tab(1, tile("g", 0)), tab(2, tile("g", 1)), tab(3)]
        self.assertEqual(service(tabs, "await split.unsplit(tabs[0]); return writes;"), [[1, {}], [2, {}]])
        self.assertEqual(service(tabs, "await split.unsplit(tabs[2]); return writes;"), [])

    def test_two_members_of_a_group_swap_places_in_the_layout(self):
        tabs = [tab(1, tile("g", 0)), tab(2, tile("g", 1))]
        out = service(tabs, "const ok = await split.swap(tabs[0], tabs[1]); return [ok, writes];")
        self.assertEqual([out[0], [(w[0], w[1]["tiling"]["index"]) for w in out[1]]], [True, [(1, 1), (2, 0)]])

    def test_swapping_tabs_of_different_groups_does_nothing(self):
        tabs = [tab(1, tile("a", 0)), tab(2, tile("b", 1))]
        self.assertEqual(service(tabs, "return [await split.swap(tabs[0], tabs[1]), writes];"), [False, []])

    def test_two_splits_in_a_row_each_get_their_delayed_second_write(self):
        tabs = [tab(1), tab(2), tab(3), tab(4)]
        out = service(tabs, "await split.join(1, 2, 'right'); await split.join(3, 4, 'right'); await new Promise((r) => setTimeout(r, 600)); return writes.length;")
        self.assertEqual(out, 8)

// Arc's Spaces on top of Vivaldi Workspaces: which workspace a tab is in, the list of spaces for the space bar,
// where switching to a space goes, and which pinned-links folder belongs to which space.
// A workspace is not a login: all of them share the profile's cookies (profiles are the isolation boundary).
(() => {
  const ARC_PREFIX = "Arc - ";

  // Vivaldi keeps the workspace id in the tab's vivExtData JSON; no key means the default space (id 0).
  const of = (tab) => {
    try { return Number(JSON.parse(tab?.vivExtData || "{}").workspaceId) || 0; } catch (_) { return 0; }
  };
  const tabsIn = (tabs, id) => tabs.filter((t) => of(t) === id);
  const activeId = (tabs) => {
    const active = tabs.find((t) => t.active);
    return active ? of(active) : 0;
  };

  // What the sidebar lists: the active space's tabs. With no known workspace everything is one space, so a failed
  // read of the list never hides tabs.
  const scope = (tabs, list) => {
    if (!list?.length) return { active: 0, tabs };
    const active = activeId(tabs);
    return { active, tabs: tabsIn(tabs, active) };
  };

  // Without any workspace there is only one space, so no bar.
  const items = (list, defaultName) => {
    if (!list?.length) return [];
    return [{ id: 0, name: defaultName, emoji: "" }, ...list.map((w) => ({ id: w.id, name: w.name, emoji: w.emoji || "" }))];
  };

  // Where switching to a space lands: its most recently used tab (Vivaldi then switches the workspace by itself).
  const recentTab = (tabs, id) => {
    const own = tabsIn(tabs, id);
    if (!own.length) return null;
    return own.reduce((best, t) => ((t.lastAccessed ?? 0) > (best.lastAccessed ?? 0) ||
      ((t.lastAccessed ?? 0) === (best.lastAccessed ?? 0) && t.index > best.index) ? t : best));
  };

  const label = (folder) => folder.title.startsWith(ARC_PREFIX) ? folder.title.slice(ARC_PREFIX.length) : folder.title;
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

  // folders: every bookmark folder that holds a Pinned folder, in bookmark order. A workspace takes the folder with
  // its name; the default space is the first folder nobody claims (the only one, if all are claimed).
  const assign = (folders, list) => {
    const byId = {};
    const used = new Set();
    for (const w of list || []) {
      const found = folders.find((f) => !used.has(f.id) && same(label(f), w.name));
      if (found) { byId[w.id] = found; used.add(found.id); }
    }
    return { default: folders.find((f) => !used.has(f.id)) ?? folders[0] ?? null, byId };
  };

  // A tab opened while a space is active joins it. Vivaldi does not do this for tabs a mod or a command bar opens,
  // so they would land in the default space. Returns the new vivExtData, or null when nothing needs writing.
  // Every window runs its own copy of the mod and sees the tabs of all windows, so only this window's tabs are stamped.
  const stamp = (tab, activeSpace, windowId) => {
    if (!activeSpace || tab?.windowId !== windowId) return null;
    let data;
    try { data = JSON.parse(tab?.vivExtData || "{}") || {}; } catch (_) { data = {}; }
    if ("workspaceId" in data) return null;
    return JSON.stringify({ ...data, workspaceId: activeSpace });
  };

  // A mod can neither create a workspace (Vivaldi reads its list once) nor press a shortcut for the user: events a
  // mod dispatches never reach Vivaldi's shortcut handler. So the install binds "Create New Workspace" to this chord,
  // and the + tile and the command bar tell the user to press it.
  const CREATE_KEY = "ctrl+meta+n";
  const KEY_NAMES = { ctrl: "Ctrl", meta: "Cmd", alt: "Option", shift: "Shift" };
  const CREATE_HINT = `Press ${CREATE_KEY.split("+").map((k) => KEY_NAMES[k] || k.toUpperCase()).join("+")} to create a space`;

  // Vivaldi has no extension API to delete a workspace, only its own store. Its webpack chunk array lives on the
  // background page (chrome.extension.getBackgroundPage), not on the window the mod runs in, and its push hands out the module
  // list; the module that defines removeWorkspace is found by its source and loaded
  // only if it already ran. Returns (windowId, id) => Promise, or null when Vivaldi no longer looks like this.
  const findManager = (chunks) => {
    try {
      let load;
      chunks.push([[Symbol("vivarc")], {}, (require) => { load = require; }]);
      for (const [id, factory] of Object.entries(load?.m || {})) {
        if (!String(factory).includes("removeWorkspace(")) continue;
        let exported;
        try { exported = load(id); } catch (_) { continue; }
        for (const key of Object.keys(exported || {})) {
          const manager = exported[key];
          if (typeof manager?.removeWorkspace === "function") return manager;
        }
      }
    } catch (_) {}
    return null;
  };
  const findRemover = (chunks) => {
    const manager = findManager(chunks);
    return manager ? (windowId, workspaceId) => manager.removeWorkspace(windowId, workspaceId) : null;
  };

  // The workspace ids in the order they should have after `id` moves next to `targetId` (before it, or after it).
  // null when nothing would change. The default space is not part of the list and always comes first.
  const reorder = (list, id, targetId, after) => {
    const ids = (list || []).map((w) => w.id);
    if (!ids.includes(id) || id === targetId) return null;
    const rest = ids.filter((i) => i !== id);
    const at = rest.indexOf(targetId);
    rest.splice(at < 0 ? 0 : at + (after ? 1 : 0), 0, id);
    return rest.every((v, i) => v === ids[i]) ? null : rest;
  };

  // The workspace next to `id` in the given direction (-1 or 1), or undefined at the end of the list.
  const neighbour = (list, id, step) => {
    const i = (list || []).findIndex((w) => w.id === id);
    return list?.[i + step]?.id;
  };

  // The folder keeps an "Arc - " prefix it had when its space is renamed.
  const renamedFolder = (title, name) => (title.startsWith(ARC_PREFIX) ? ARC_PREFIX : "") + name;

  const removalLabel = (name, tabCount) =>
    `Delete \u201c${name}\u201d${tabCount ? ` and close its ${tabCount} ${tabCount === 1 ? "tab" : "tabs"}` : ""}`;

  // A space's folder is found by its name, so two spaces cannot share one (compared the way the folders are matched).
  const nameTaken = (list, id, name, defaultName) =>
    same(name, defaultName || "") || (list || []).some((w) => w.id !== id && same(w.name, name));

  // The preset a space is tinted with, from the saved map {spaceId: presetIndex}; undefined when it has none
  // (or the saved value is not a valid preset, for example after the palette changed).
  const tintOf = (tints, id, count) => {
    const v = tints?.[id];
    return Number.isInteger(v) && v >= 0 && v < count ? v : undefined;
  };

  window.__vm.workspaces = { of, tabsIn, activeId, scope, items, recentTab, label, assign, stamp, nameTaken, tintOf, findManager, findRemover, reorder, neighbour, renamedFolder, removalLabel, CREATE_HINT };
})();

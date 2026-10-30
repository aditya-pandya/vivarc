// Split view, the way Arc does it. Vivaldi keeps a tab's tile membership in its vivExtData JSON as
// {tiling: {id, layout: "row" | "column", type, index}}; tabs sharing an id are one tile group. This module owns
// every write of that data (the command bar and the sidebar's drag-to-split both go through it) and the pure helpers
// the sidebar uses to find the drop edge and to draw each group as one unit.
(() => {
  const BAND = 0.25; // how close to an edge of the page, as a share of its size, a drop counts for that edge

  const tilingOf = (tab) => {
    try {
      const tiling = JSON.parse(tab?.vivExtData || "{}")?.tiling;
      return tiling && typeof tiling.id === "string" && tiling.id ? tiling : undefined;
    } catch (_) { return undefined; }
  };

  // The edge of rect the point is nearest to, or null in the middle. A corner goes to the left/right edge.
  const edgeOf = (x, y, rect) => {
    const w = rect.width, h = rect.height;
    if (!(w > 0 && h > 0)) return null;
    const fx = (x - rect.left) / w, fy = (y - rect.top) / h;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    const near = [["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]];
    let best = near[0];
    for (const n of near) if (n[1] < best[1]) best = n;
    return best[1] <= BAND ? best[0] : null;
  };

  // Dropping on an edge: which way the tiles run, and whether the dragged tab goes first.
  const placement = (edge) => ({
    layout: edge === "left" || edge === "right" ? "row" : "column",
    first: edge === "left" || edge === "top",
  });

  // tabs in display order -> [{ tab }] for a loose tab, [{ group: id, tabs }] for two or more members of a tile group.
  // A group sits where its first visible member is, members in tile order. Members that are not shown (another
  // space, a bound pin) simply are not in `tabs`, so a group with one member shown is a loose tab.
  const groupTabs = (tabs) => {
    const members = new Map();
    for (const tab of tabs) {
      const id = tilingOf(tab)?.id;
      if (id) members.set(id, [...(members.get(id) || []), tab]);
    }
    const out = [];
    const placed = new Set();
    for (const tab of tabs) {
      const id = tilingOf(tab)?.id;
      if (!id || members.get(id).length < 2) { out.push({ tab }); continue; }
      if (placed.has(id)) continue;
      placed.add(id);
      out.push({ group: id, tabs: [...members.get(id)].sort((a, b) => (tilingOf(a).index ?? 0) - (tilingOf(b).index ?? 0)) });
    }
    return out;
  };

  window.__vm.split = { BAND, tilingOf, edgeOf, placement, groupTabs };
  if (typeof chrome === "undefined" || !chrome.tabs) return;

  // Writes are queued so two splits never interleave their read-modify-write of a tab's vivExtData.
  let queue = Promise.resolve();
  const serial = (job) => (queue = queue.then(job, job));

  const patchExt = async (tab, patch) => {
    const fresh = await chrome.tabs.get(tab.id);
    let ext = {};
    try { ext = JSON.parse(fresh.vivExtData || "{}") || {}; } catch (_) {}
    await chrome.tabs.update(tab.id, { vivExtData: JSON.stringify({ ...ext, ...patch }) });
  };

  const windowTabs = () => chrome.tabs.query({ currentWindow: true });
  const peersOf = (all, id, except) => all.filter((t) => !except.includes(t.id) && tilingOf(t)?.id === id);

  // After tabs leave a group: one left means no group, more keep their layout with their order closed up.
  const repair = async (peers) => {
    if (peers.length === 1) return patchExt(peers[0], { tiling: undefined });
    const ordered = [...peers].sort((a, b) => (tilingOf(a).index ?? 0) - (tilingOf(b).index ?? 0));
    await Promise.all(ordered.map((t, index) => patchExt(t, { tiling: { ...tilingOf(t), index } })));
  };

  // Vivaldi only honours the layout when every tile gets its data at once, so both tabs are written together and once
  // more shortly after, unless the tabs are no longer in that split.
  const writePair = async (pair, layout) => {
    const id = crypto.randomUUID();
    const write = () => Promise.all(pair.map((t, index) => patchExt(t, { tiling: { id, layout, type: "selection", index } })));
    await write();
    setTimeout(() => {
      serial(async () => {
        const now = await windowTabs();
        if (pair.every((p) => tilingOf(now.find((t) => t.id === p.id))?.id === id)) await write();
      }).catch(() => {});
    }, 400);
  };

  // The tab behind the bar plus a new tab form a fresh group (the command bar's Split View).
  const splitWithNew = (tab, layout) => serial(async () => {
    const fresh = await chrome.tabs.get(tab.id);
    const previous = tilingOf(fresh);
    const others = previous ? peersOf(await windowTabs(), previous.id, [fresh.id]) : [];
    const created = await chrome.tabs.create({ active: true, index: fresh.index + 1 });
    await writePair([fresh, created], layout);
    if (others.length) await repair(others);
    return created;
  });

  // Drag a tab onto an edge of the page: it joins the page's tab as a two-tile group.
  const join = (targetId, draggedId, edge) => serial(async () => {
    if (!edge || targetId === draggedId) return false;
    let target, dragged;
    try { [target, dragged] = await Promise.all([chrome.tabs.get(targetId), chrome.tabs.get(draggedId)]); } catch (_) { return false; }
    const space = window.__vm.workspaces?.of;
    if (target.windowId !== dragged.windowId || (space && space(target) !== space(dragged))) return false;
    const { layout, first } = placement(edge);
    const all = await windowTabs();
    const leaving = [target, dragged].map((t) => tilingOf(t)?.id).filter(Boolean);
    const rest = [...new Set(leaving)].map((id) => peersOf(all, id, [target.id, dragged.id]));
    await writePair(first ? [dragged, target] : [target, dragged], layout);
    for (const peers of rest) if (peers.length) await repair(peers);
    return true;
  });

  // Leaves the split; every member stays open.
  const unsplit = (tab) => serial(async () => {
    const id = tilingOf(tab)?.id;
    if (!id) return;
    const members = (await windowTabs()).filter((t) => tilingOf(t)?.id === id);
    await Promise.all(members.map((t) => patchExt(t, { tiling: undefined })));
  });

  // Dragging one member of a group onto another swaps their places in the layout (the list shows them in layout order).
  const swap = (a, b) => serial(async () => {
    const [x, y] = await Promise.all([chrome.tabs.get(a.id), chrome.tabs.get(b.id)]);
    const tx = tilingOf(x), ty = tilingOf(y);
    if (!tx || !ty || tx.id !== ty.id || x.id === y.id) return false;
    await Promise.all([patchExt(x, { tiling: { ...tx, index: ty.index } }), patchExt(y, { tiling: { ...ty, index: tx.index } })]);
    return true;
  });

  Object.assign(window.__vm.split, { splitWithNew, join, unsplit, swap });
})();

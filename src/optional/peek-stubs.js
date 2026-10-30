// Peek's AI summary feature is not used by Vivarc; these stubs keep the mod from throwing.
window.VividAI = {
  loadConfig: () => Promise.resolve({}),
  applyConfig: () => {},
  streamChat: () => Promise.reject(new Error("AI disabled")),
};
window.VividMarkdown = { render: (text) => text };

// Peek's triggers are set from `"peek": {...}` in ~/.vivarc/config.json, for example {"clickOpenModifiers": ["shift"]}
// for Arc's Shift+click, or {"autoOpenList": []} to stop it opening links by itself. Peek reads its settings from a
// shared file in the browser's private storage, so they are written there (merged into what is already in it).
(async () => {
  const KEYS = ["clickOpenModifiers", "longPressButtons", "longPressHoldTime", "longPressHoldDelay", "autoOpenList", "scaleBackgroundPage"];
  const given = window.__vmConfig?.peek;
  if (!given || typeof given !== "object") return;
  const wanted = Object.fromEntries(KEYS.filter((k) => k in given).map((k) => [k, given[k]]));
  if (!Object.keys(wanted).length) return;
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(".askonpage", { create: true });
    let current = {};
    try { current = JSON.parse(await (await (await dir.getFileHandle("config.json")).getFile()).text()) || {}; } catch (_) {}
    const next = { ...current, mods: { ...(current.mods || {}), arcPeek: { ...(current.mods?.arcPeek || {}), ...wanted } } };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    const out = await (await dir.getFileHandle("config.json", { create: true })).createWritable();
    await out.write(JSON.stringify(next, null, 2));
    await out.close();
  } catch (e) {
    console.warn("[vivarc] could not write Peek's settings:", e);
  }
})();

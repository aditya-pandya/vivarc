// Little windows, after Arc's Little Arc: a tab in a small popup window that stays out of the main window's sidebar.
// "Open in Little Window" moves a tab there; "Keep in Main Window" moves it back. Optionally (a setting, off by default)
// a link opened from another app, which Vivaldi opens as a new tab with no opener, goes straight to a little window.
(() => {
  const SIZE = { width: 520, height: 760 };

  const isWeb = (url) => /^https?:\/\//i.test(url || "");

  // A tab Vivaldi opened for a link from another app: a web address, no opener tab, brought to the front, and Vivaldi
  // was not the focused app when it appeared. A tab opened from a page has an opener, one from Cmd+T starts on the new
  // tab page, and one opened quietly in the background (an extension, a restored session) is not active.
  const isExternalLink = (tab, appFocused) =>
    !appFocused && !!tab && tab.active !== false && tab.openerTabId === undefined && isWeb(tab.pendingUrl || tab.url);

  window.__vm.little = { SIZE, isExternalLink };
  if (typeof chrome === "undefined" || !chrome.windows) return;

  const isLittle = (win) => win?.type === "popup";

  // Where each little window's tab came from, so Keep can put it back there (kept in memory only).
  const origins = new Map();

  // The window a kept tab goes back to: the one it came from if that is still open, else the focused or first normal one.
  const mainWindow = async (excludeId, tab) => {
    const all = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const mine = all.filter((w) => w.id !== excludeId && !w.incognito);
    return mine.find((w) => w.id === origins.get(tab?.id)) || mine.find((w) => w.focused) || mine[0] || null;
  };

  const open = async (tab) => {
    if (!tab) return false;
    const current = await chrome.windows.get(tab.windowId);
    if (isLittle(current)) return false;
    origins.set(tab.id, tab.windowId);
    await chrome.windows.create({ tabId: tab.id, type: "popup", focused: true, ...SIZE });
    return true;
  };

  const keep = async (tab) => {
    if (!tab) return false;
    const current = await chrome.windows.get(tab.windowId);
    if (!isLittle(current)) return false;
    const main = await mainWindow(current.id, tab);
    origins.delete(tab.id);
    // With no normal window left, the tab becomes the first tab of a new one.
    if (!main) { await chrome.windows.create({ tabId: tab.id, type: "normal", focused: true }); return true; }
    await chrome.tabs.move(tab.id, { windowId: main.id, index: -1 });
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(main.id, { focused: true });
    return true;
  };

  window.__vm.little.open = open;
  window.__vm.little.keep = keep;
  window.__vm.little.isLittle = async (tab) => isLittle(await chrome.windows.get(tab.windowId));

  // Only one browser window should act on a new tab, so only the one the tab appeared in does.
  chrome.tabs.onCreated.addListener(async (tab) => {
    if (!window.__vm.settings?.get("littleLinks") || !isExternalLink(tab, document.hasFocus())) return;
    try {
      const win = await chrome.windows.getCurrent();
      if (tab.windowId !== win.id || isLittle(win)) return;
      await open(tab);
    } catch (e) {
      console.warn("[vivarc] little window unavailable:", e);
    }
  });
})();

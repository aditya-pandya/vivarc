// Smart tab titles: ask a model for a short, readable name for a tab, on demand only ("Suggest Title" in a tab's menu or
// the command bar). Only the page title and its address without any query or fragment are sent, never page content.
// The key is `anthropicKey` in ~/.vivarc/config.json, so it ends up in the installed vivarc.js like the rest of the config.
(() => {
  const MAX = 32;
  const ENDPOINT = "https://api.anthropic.com/v1/messages";
  const DEFAULT_MODEL = "claude-haiku-5-5";

  const isWeb = (url) => /^https?:\/\//i.test(url || "");

  // The address without a query or fragment: those can hold tokens, and they say nothing useful about the page.
  const safeUrl = (url) => {
    try {
      const u = new URL(url);
      return u.origin + u.pathname;
    } catch (_) { return ""; }
  };

  const PROMPT = "You name browser tabs. Given a page title and address, reply with a short, readable name of 2 to 4 words " +
    `(at most ${MAX} characters) that says what the page is. Drop site names, taglines, separators and counts. ` +
    "Reply with the name only: no quotes, no punctuation at the end, no explanation.";

  const userText = (tab) => `Title: ${String(tab.title || "").slice(0, 200)}\nAddress: ${safeUrl(tab.url)}`;

  // What the model said, made safe to show as a name: first line, no quotes or trailing punctuation, not too long.
  const cleanTitle = (text) => {
    if (typeof text !== "string") return "";
    let t = text.split("\n").map((l) => l.trim()).find(Boolean) || "";
    t = t.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").replace(/\s+/g, " ").replace(/[.:;,!\-–—\s]+$/g, "").trim();
    if (t.length > MAX) t = t.slice(0, MAX).replace(/\s+\S*$/, "").trim() || t.slice(0, MAX);
    return t;
  };

  const request = (key, model, tab) => ({
    url: ENDPOINT,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: 40, system: PROMPT, messages: [{ role: "user", content: userText(tab) }] }),
    },
  });

  const answerOf = (json) => cleanTitle((json?.content || []).filter((b) => b?.type === "text").map((b) => b.text).join("\n"));

  window.__vm.titles = { MAX, isWeb, safeUrl, userText, cleanTitle, request, answerOf, PROMPT };
  if (typeof document === "undefined") return;

  const toast = (detail) => window.dispatchEvent(new CustomEvent("vm-toast", { detail }));

  // Asks the model and names the tab, with an Undo that puts the previous name back.
  const suggest = async (tab) => {
    const key = window.__vm.config?.anthropicKey;
    if (!key) {
      toast('Add "anthropicKey" to ~/.vivarc/config.json, then run Update Vivarc');
      return false;
    }
    if (window.__vm.pins?.pinOf(tab) !== undefined) {
      toast("A pinned tab keeps its pin's name: double-click the pin to rename it");
      return false;
    }
    if (tab.incognito || !isWeb(tab.url)) {
      toast("Only web pages in normal windows can be named");
      return false;
    }
    try {
      const { url, init } = request(key, window.__vm.config.titleModel || DEFAULT_MODEL, tab);
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const title = answerOf(await response.json());
      if (!title) throw new Error("empty answer");
      // The answer is for the page that was asked about: drop it if the tab moved on or was renamed meanwhile.
      const now = await chrome.tabs.get(tab.id);
      const previous = window.__vm.pins?.titleOf(now);
      if (safeUrl(now.url) !== safeUrl(tab.url) || previous !== window.__vm.pins?.titleOf(tab) || window.__vm.pins?.pinOf(now) !== undefined) return false;
      await window.__vm.nameTab(now, title);
      toast({ message: `Named “${title}”`, action: { label: "Undo", run: () => window.__vm.nameTab(now, previous) } });
      return true;
    } catch (e) {
      console.warn("[vivarc] could not suggest a title:", e);
      toast("Could not get a title suggestion");
      return false;
    }
  };

  window.__vm.titles.suggest = suggest;
})();

// An emoji for a pinned folder, shown instead of the folder glyph. Bookmarks have no field for it, so the choice is
// kept per profile in Vivarc's store, keyed by the folder's bookmark id (it does not sync to other devices).
(() => {
  const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u; // pictographs, flags, keycaps
  const GRID = ["📁", "⭐", "💼", "🏠", "📚", "🎓", "💡", "🧪", "🛒", "✈️", "🎧", "🎮", "🎬", "📷", "🍳", "💰", "🏋️", "🔧", "🧰", "🗂️", "📝", "📌", "🔖", "🔥", "🌱", "🌍", "❤️", "🎨", "🧠", "🚀"];

  // What was typed or pasted, as a single emoji (a family or flag is one grapheme), or "" when it is not one.
  const cleanEmoji = (text) => {
    const raw = String(text ?? "").trim();
    if (!raw) return "";
    const first = typeof Intl !== "undefined" && Intl.Segmenter
      ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(raw)][0]?.segment || ""
      : [...raw][0] || "";
    return EMOJI.test(first) && first.length <= 40 ? first : "";
  };

  // The saved map {folderId: emoji} with anything that is not an emoji dropped.
  const sanitize = (saved) => {
    if (!saved || typeof saved !== "object") return {};
    return Object.fromEntries(Object.entries(saved).filter(([, v]) => typeof v === "string" && cleanEmoji(v) === v));
  };

  window.__vm.folderIcons = { GRID, cleanEmoji, sanitize };
  if (!window.__vm.store || typeof document === "undefined") return;

  const { store } = window.__vm;
  let icons = {};
  const listeners = new Set();
  let channel = null;
  try {
    channel = new BroadcastChannel("vivarc-folder-icons");
    channel.onmessage = (e) => { icons = sanitize(e.data); listeners.forEach((fn) => fn()); };
  } catch (_) {}

  store.get("folderIcons", {}).then((saved) => { icons = sanitize(saved); listeners.forEach((fn) => fn()); });

  const set = async (id, emoji) => {
    icons = await store.update("folderIcons", {}, (saved) => {
      const next = sanitize(saved);
      if (emoji) next[id] = emoji; else delete next[id];
      return next;
    });
    channel?.postMessage(icons);
    listeners.forEach((fn) => fn());
  };

  let pop = null;
  const close = () => { pop?.remove(); pop = null; };
  const choose = (id, name, at) => {
    close();
    if (!window.__vm.cssLoaded) return;
    pop = document.createElement("div");
    pop.className = "vm-theme-pop vm-folder-icons";
    const title = document.createElement("div");
    title.className = "vm-space-color-title";
    title.textContent = `Icon for ${name || "folder"}`;
    const grid = document.createElement("div");
    grid.className = "vm-emoji-grid";
    const pick = (emoji) => { close(); set(id, emoji); };
    for (const emoji of GRID) {
      const b = document.createElement("button");
      b.textContent = emoji;
      b.className = icons[id] === emoji ? "on" : "";
      b.addEventListener("click", () => pick(emoji));
      grid.append(b);
    }
    const field = document.createElement("input");
    field.className = "vm-emoji-input";
    field.placeholder = "Or type or paste an emoji";
    field.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") close();
      if (e.key === "Enter") { const emoji = cleanEmoji(field.value); if (emoji) pick(emoji); else field.classList.add("bad"); }
    });
    field.addEventListener("input", () => field.classList.remove("bad"));
    const reset = document.createElement("button");
    reset.className = "vm-theme-reset";
    reset.textContent = "Use the folder icon";
    reset.addEventListener("click", () => pick(""));
    pop.append(title, grid, field, reset);
    (document.querySelector("#browser") || document.body).append(pop);
    const { width, height } = pop.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(at.x, window.innerWidth - width - 8))}px`;
    pop.style.top = `${Math.max(8, Math.min(at.y, window.innerHeight - height - 8))}px`;
    pop.style.bottom = "auto";
    field.focus();
  };
  document.addEventListener("mousedown", (e) => { if (pop && !pop.contains(e.target)) close(); }, true);
  window.__vm.onShortcut?.((key) => { if (key === "esc") close(); });

  Object.assign(window.__vm.folderIcons, { get: (id) => icons[id], set, choose, onChange: (fn) => listeners.add(fn) });
})();

/* Restore the palette before the stylesheet paints; never refresh player data. */
(function () {
  const key = "nextshift-theme";
  const root = document.documentElement;
  const valid = (value) => value === "light" || value === "dark";
  function apply(value) {
    const theme = valid(value) ? value : "dark";
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#1b1c1e" : "#ffffff";
    for (const image of document.querySelectorAll(
      'img[src^="https://assets.nhle.com/logos/nhl/svg/"]',
    )) {
      const src = image.getAttribute("src");
      const next = src.replace(
        /_(?:light|dark)\.svg$/,
        image.closest(".game-side") || theme === "dark" ? "_dark.svg" : "_light.svg",
      );
      if (src !== next) image.setAttribute("src", next);
    }
    const button = document.getElementById("theme-toggle");
    if (button) {
      button.setAttribute(
        "aria-label",
        theme === "light" ? "Switch to dark theme" : "Switch to light theme",
      );
      button.title = button.getAttribute("aria-label");
    }
  }
  let stored;
  try {
    stored = localStorage.getItem(key);
  } catch {}
  if (stored === "vintage") {
    stored = "dark";
    try {
      localStorage.setItem(key, stored);
    } catch {}
  }
  apply(stored);
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      apply(root.dataset.theme);
      document.getElementById("theme-toggle")?.addEventListener("click", () => {
        const next = root.dataset.theme === "dark" ? "light" : "dark";
        apply(next);
        try {
          localStorage.setItem(key, next);
        } catch {}
      });
    },
    { once: true },
  );
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();

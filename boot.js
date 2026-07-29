/* Bootstrap: load config (+ optional private override), apply branding,
   load the configured data file, then the app. Keeps index.html generic. */
(function () {
  function load(src) {
    return new Promise(function (res) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = function () { res(); };   // optional files (e.g. config.local.js) may 404
      document.head.appendChild(s);
    });
  }

  function darken(hex, pct) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return hex;
    var n = parseInt(m[1], 16), f = 1 - pct / 100;
    var r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
    return "#" + [r, g, b].map(function (v) { return ("0" + Math.max(0, v).toString(16)).slice(-2); }).join("");
  }

  function applyBranding(cfg) {
    var root = document.documentElement;
    if (cfg.colors) {
      root.style.setProperty("--brand", cfg.colors.brand);
      root.style.setProperty("--accent", cfg.colors.accent);
      root.style.setProperty("--brand-dark", darken(cfg.colors.brand, 14));
      root.style.setProperty("--brand-darker", darken(cfg.colors.brand, 24));
    }
    if (cfg.appName) { document.title = cfg.appName; }
    var logo = document.querySelector(".logo-img");
    if (logo && cfg.logo) { logo.src = cfg.logo; logo.alt = cfg.appName || "logo"; }
    var fav = document.querySelector("link[rel=icon]");
    if (fav && cfg.logo) { fav.href = cfg.logo; }
    var h1 = document.querySelector(".topbar h1");
    if (h1 && cfg.appName) { h1.textContent = cfg.appName; }
    var tag = document.querySelector(".tagline");
    if (tag && cfg.tagline) { tag.textContent = cfg.tagline; }
  }

  async function main() {
    await load("config.js");
    await load("config.local.js");                 // optional private override
    var cfg = window.APP_CONFIG || {};
    applyBranding(cfg);
    // Hosted mode: pull in the Supabase JS SDK before the persistence adapter.
    if (cfg.storage === "supabase" && cfg.supabase && cfg.supabase.url) {
      await load("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
    }
    await load(cfg.dataFile || "data/sample/data.js");   // data files define window.APP_DATA
    await load("persistence.js");                  // defines window.Store (local or supabase)
    await load("app.js");
  }
  main();
})();

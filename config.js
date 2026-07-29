/* Default (public) configuration. Neutral branding + synthetic sample data.
   To run a real deployment, add a gitignored `config.local.js` that overrides
   these values (see config.local.example.js). */
window.APP_CONFIG = {
  appName: "Sub Scheduler",
  tagline: "Coverage & schedule builder",
  logo: "assets/logo.svg",
  colors: { brand: "#2f5bd0", accent: "#f0a127" },
  dataFile: "data/sample/data.js",
  defaultSet: { name: "2025–26 School Year", start: "2025-08-25", end: "2026-06-12" },
};

/* Template for a private deployment override.
   Copy to `config.local.js` (which is gitignored) and fill in your own school's
   branding + data file. `config.local.js` is loaded after config.js and overrides it. */
Object.assign(window.APP_CONFIG, {
  appName: "Your School Sub Scheduler",
  tagline: "Coverage & schedule builder",
  logo: "assets/your-logo.png",            // put your logo in assets/ (gitignore it)
  colors: { brand: "#2f5bd0", accent: "#f0a127" },
  dataFile: "data/real/your_data.js",       // your data, in the window.APP_DATA shape
  defaultSet: { name: "2025–26 School Year", start: "2025-08-25", end: "2026-06-12" },

  // Optional hosted backend (Supabase). Omit this block to use localStorage.
  // The publishable/anon key is safe in client code; never put the service_role
  // / secret key here. Row-Level Security is what protects the data.
  // storage: "supabase",
  // supabase: {
  //   url: "https://YOUR-PROJECT-REF.supabase.co",
  //   anonKey: "YOUR_PUBLISHABLE_ANON_KEY",
  //   mode: "tables",   // "tables" = normalized schema; "blob" = single-row JSON
  // },
});

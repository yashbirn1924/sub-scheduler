/* Schema-only seed for hosted deployments.
   Defines just the grid shape (weekdays + time step) and an EMPTY roster.
   Real data is loaded from the backend (Supabase) after login, so no roster
   is ever shipped as a static file. Point config.local.js `dataFile` here for
   any public/hosted build. */
window.APP_DATA = { days: ["Mon", "Tue", "Wed", "Thu", "Fri"], step: 15, people: [] };

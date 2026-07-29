/* Persistence adapter — decouples the app from its storage backend.
   The app calls Store.load() / Store.save(snapshot) with a plain JSON object;
   the serialization (state <-> snapshot) stays in app.js.

   Two backends:
     - local:    localStorage (the original behaviour; public / sample deploys)
     - supabase: Postgres row behind auth + RLS (real, hosted deploy)

   Backend is chosen from config: set  storage:"supabase"  + supabase:{url,anonKey}
   in config.local.js to turn on the hosted mode. Anything else -> local. */
(function () {
  var CFG = window.APP_CONFIG || {};
  var DEPLOY = CFG.dataFile || "sample";          // same scoping the old LS_KEY used
  var wantSupabase = CFG.storage === "supabase" && CFG.supabase && CFG.supabase.url;
  var hasSDK = wantSupabase && window.supabase && typeof window.supabase.createClient === "function";

  // ---------------------------------------------------------------- local ----
  var LocalStore = (function () {
    var KEY = "subscheduler_v1:" + DEPLOY;
    return {
      mode: "local",
      requireAuth: function () { return Promise.resolve(); },
      load: function () {
        try {
          var raw = localStorage.getItem(KEY);
          return Promise.resolve(raw ? JSON.parse(raw) : null);
        } catch (e) { return Promise.resolve(null); }
      },
      save: function (obj) {
        try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) { /* quota / private mode */ }
      },
      flush: function () { return Promise.resolve(); },
      clear: function () { try { localStorage.removeItem(KEY); } catch (e) {} return Promise.resolve(); },
      signOut: function () { return Promise.resolve(); },
      userEmail: function () { return null; },
    };
  })();

  // ------------------------------------------------------------- supabase ----
  function makeSupabaseStore() {
    var client = window.supabase.createClient(CFG.supabase.url, CFG.supabase.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    var user = null;                 // current auth user (set after sign-in)
    var saveTimer = null, pending = null, inFlight = false;
    var isTables = !!(CFG.supabase && CFG.supabase.mode === "tables");  // blob (default) vs normalized tables
    var lastSaved = null, lastSavedRows = null;                          // baseline for diff-based table saves
    var DAYS_L = (window.APP_DATA && window.APP_DATA.days) || ["Mon", "Tue", "Wed", "Thu", "Fri"];
    var PREFS_KEY = "subscheduler_prefs:" + DEPLOY;   // view prefs (weekStart/day/view) live client-side in tables mode
    function hhmm(t) { return (t || "").slice(0, 5); }                   // "08:00:00" -> "08:00"
    function emptyWk() { var w = {}; DAYS_L.forEach(function (d) { w[d] = []; }); return w; }
    function readPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; } }
    function writePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) {} }

    function setStatus(text, kind) {
      var el = document.getElementById("syncStatus");
      if (!el) return;
      el.textContent = text;
      el.className = "sync-status" + (kind ? " " + kind : "");
    }

    // ---- auth gate: resolve once a session exists (showing login if needed) --
    function requireAuth() {
      return client.auth.getSession().then(function (res) {
        var session = res && res.data ? res.data.session : null;
        if (session && session.user) { user = session.user; mountAuthUI(); return; }
        return showLogin();
      });
    }

    function showLogin() {
      return new Promise(function (resolve) {
        var back = document.createElement("div");
        back.className = "auth-back";
        back.innerHTML =
          '<form class="auth-card" autocomplete="on">' +
            '<div class="auth-brand">' +
              '<img class="auth-logo" src="' + (CFG.logo || "assets/logo.svg") + '" alt="" />' +
              '<div>' +
                '<h2>' + (CFG.appName || "Sub Scheduler") + '</h2>' +
                '<p class="auth-tag">Admin sign-in</p>' +
              '</div>' +
            '</div>' +
            '<label class="auth-field"><span>Email</span>' +
              '<input type="email" name="email" autocomplete="username" required /></label>' +
            '<label class="auth-field"><span>Password</span>' +
              '<input type="password" name="password" autocomplete="current-password" required /></label>' +
            '<p class="auth-error" hidden></p>' +
            '<button type="submit" class="btn primary auth-submit">Sign in</button>' +
          '</form>';
        document.body.appendChild(back);

        var form = back.querySelector("form");
        var errEl = back.querySelector(".auth-error");
        var btn = back.querySelector(".auth-submit");
        form.querySelector('input[name="email"]').focus();

        form.addEventListener("submit", function (ev) {
          ev.preventDefault();
          errEl.hidden = true;
          btn.disabled = true; btn.textContent = "Signing in…";
          var email = form.email.value.trim();
          var password = form.password.value;
          client.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
            if (r.error) {
              console.error("[Store] sign-in error:", r.error);
              var code = r.error.code || (r.error.status ? "status " + r.error.status : "");
              errEl.textContent = (r.error.message || "Sign-in failed.") + (code ? " (" + code + ")" : "");
              errEl.hidden = false;
              btn.disabled = false; btn.textContent = "Sign in";
              return;
            }
            user = r.data.user;
            back.remove();
            mountAuthUI();
            resolve();
          });
        });
      });
    }

    // ---- signed-in chrome: sync status + sign-out button in the header -------
    function mountAuthUI() {
      var controls = document.querySelector(".topbar .controls");
      if (!controls || document.getElementById("syncStatus")) return;
      var status = document.createElement("span");
      status.id = "syncStatus";
      status.className = "sync-status";
      var out = document.createElement("button");
      out.className = "btn ghost";
      out.id = "signOutBtn";
      out.title = (user && user.email ? user.email + " — " : "") + "Sign out";
      out.textContent = "Sign out";
      out.onclick = function () {
        flush().then(function () { return client.auth.signOut(); }).then(function () { location.reload(); });
      };
      controls.appendChild(status);
      controls.appendChild(out);
      setStatus("Saved", "ok");
    }

    // ---- save queue (shared by both modes) ----------------------------------
    function save(obj) {
      pending = obj;
      setStatus("Saving…", "");
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 800);
    }
    function load()  { return isTables ? tablesLoad()  : blobLoad(); }
    function flush() { return isTables ? tablesFlush() : blobFlush(); }
    function clear() { return isTables ? tablesClear() : blobClear(); }

    // Best-effort flush when the tab is hidden or closed.
    window.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", function () { flush(); });

    // ==== blob mode (Stage 1): whole state as one JSON row ====================
    function blobLoad() {
      setStatus("Loading…", "");
      return client.from("app_state").select("data").eq("deployment", DEPLOY).maybeSingle()
        .then(function (r) {
          if (r.error) { setStatus("Load error", "err"); console.error("[Store] load:", r.error); return null; }
          setStatus("Saved", "ok");
          return r.data ? r.data.data : null;
        });
    }
    function blobFlush() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (pending == null || inFlight) return Promise.resolve();
      var payload = { deployment: DEPLOY, data: pending, updated_at: new Date().toISOString(), updated_by: user ? user.id : null };
      pending = null; inFlight = true;
      return client.from("app_state").upsert(payload, { onConflict: "deployment" })
        .then(function (r) {
          inFlight = false;
          if (r.error) { setStatus("Save error", "err"); console.error("[Store] save:", r.error); }
          else { setStatus("Saved", "ok"); }
          if (pending != null) return blobFlush();
        })
        .catch(function (e) { inFlight = false; setStatus("Save error", "err"); console.error(e); });
    }
    function blobClear() {
      return client.from("app_state").delete().eq("deployment", DEPLOY).then(function () {});
    }

    // ==== tables mode (Stage 2): normalized tables, diff-based writes =========
    // Turn a snapshot into the per-table row sets (identical shape both sides
    // of a diff, so JSON comparison of a row means "unchanged").
    function buildRows(snap) {
      snap = snap || { people: [], sets: [], callouts: [], overrides: {} };
      var staff = (snap.people || []).map(function (p) {
        return { id: p.id, name: p.name, role: p.role, subject: p.subject || null, room: p.room || null, email: p.email != null ? p.email : null };
      });
      var sets = (snap.sets || []).map(function (s, i) {
        return { id: s.id, name: s.name, start_date: s.start, end_date: s.end, sort_order: i };
      });
      var membership = [], blocks = [];
      (snap.people || []).forEach(function (p) {
        (p.activeSets || []).forEach(function (setId) { membership.push({ staff_id: p.id, set_id: setId }); });
        Object.keys(p.sets || {}).forEach(function (setId) {
          var wk = p.sets[setId] || {};
          DAYS_L.forEach(function (day) {
            (wk[day] || []).forEach(function (b) {
              blocks.push({ staff_id: p.id, set_id: setId, weekday: day, t0: b.t0, t1: b.t1,
                status: b.s, label: b.l || null, priority: (b.c === "hi" || b.c === "lo") ? b.c : null });
            });
          });
        });
      });
      var absences = (snap.callouts || []).map(function (k) { return { staff_id: k.slice(11), absent_on: k.slice(0, 10) }; });
      var overrides = Object.keys(snap.overrides || {}).map(function (k) {
        return { on_date: k.slice(0, 10), slot_key: k.slice(11), assigned_staff_id: snap.overrides[k] === "" ? null : snap.overrides[k] };
      });
      return { staff: staff, schedule_sets: sets, staff_set_membership: membership,
               schedule_blocks: blocks, absences: absences, coverage_overrides: overrides };
    }

    // PostgREST caps a single select at ~1000 rows; page through with a stable
    // order so large tables (schedule_blocks) come back complete.
    function selectAll(table, orderCol) {
      var PAGE = 1000, acc = [], from = 0;
      function next() {
        return client.from(table).select("*").order(orderCol).range(from, from + PAGE - 1).then(function (r) {
          if (r.error) return { error: r.error };
          var rows = r.data || [];
          acc = acc.concat(rows);
          if (rows.length < PAGE) return { data: acc };
          from += PAGE;
          return next();
        });
      }
      return next();
    }

    function tablesLoad() {
      setStatus("Loading…", "");
      return Promise.all([
        selectAll("staff", "id"),
        selectAll("schedule_sets", "sort_order"),
        selectAll("staff_set_membership", "staff_id"),
        selectAll("schedule_blocks", "id"),
        selectAll("absences", "absent_on"),
        selectAll("coverage_overrides", "on_date"),
      ]).then(function (res) {
        for (var i = 0; i < res.length; i++) {
          if (res[i].error) { setStatus("Load error", "err"); console.error("[Store] tables load:", res[i].error); return null; }
        }
        var staff = res[0].data, sets = res[1].data, mem = res[2].data,
            blocks = res[3].data, abs = res[4].data, ov = res[5].data;
        if (!staff || !staff.length) { setStatus("Saved", "ok"); lastSaved = null; lastSavedRows = null; return null; }  // empty -> seed

        var memByStaff = {};
        mem.forEach(function (m) { (memByStaff[m.staff_id] = memByStaff[m.staff_id] || []).push(m.set_id); });
        var blkByStaff = {};
        blocks.forEach(function (b) {
          var byset = blkByStaff[b.staff_id] || (blkByStaff[b.staff_id] = {});
          var wk = byset[b.set_id] || (byset[b.set_id] = emptyWk());
          (wk[b.weekday] || (wk[b.weekday] = [])).push({ t0: hhmm(b.t0), t1: hhmm(b.t1), s: b.status, l: b.label || "", c: b.priority || "" });
        });
        Object.keys(blkByStaff).forEach(function (sid) {
          Object.keys(blkByStaff[sid]).forEach(function (setId) {
            var wk = blkByStaff[sid][setId];
            DAYS_L.forEach(function (d) { (wk[d] || []).sort(function (a, b) { return a.t0 < b.t0 ? -1 : a.t0 > b.t0 ? 1 : 0; }); });
          });
        });

        var people = staff.map(function (p) {
          return { id: p.id, name: p.name, role: p.role, subject: p.subject || "", room: p.room || "",
                   email: p.email || null, activeSets: memByStaff[p.id] || [], sets: blkByStaff[p.id] || {} };
        });
        var setsOut = sets.map(function (s) { return { id: s.id, name: s.name, start: s.start_date, end: s.end_date }; });
        var callouts = abs.map(function (a) { return a.absent_on + ":" + a.staff_id; });
        var overrides = {};
        ov.forEach(function (o) { overrides[o.on_date + ":" + o.slot_key] = o.assigned_staff_id == null ? "" : o.assigned_staff_id; });

        var prefs = readPrefs();
        var d = { people: people, sets: setsOut, callouts: callouts, overrides: overrides,
                  weekStart: prefs.weekStart || null, selectedDay: prefs.selectedDay || "Mon", view: prefs.view || "master" };
        lastSaved = d; lastSavedRows = buildRows(d);   // baseline so the first post-load save is a no-op
        setStatus("Saved", "ok");
        return d;
      });
    }

    function chk(what) { return function (r) { if (r && r.error) { console.error("[Store] " + what, r.error); throw r.error; } }; }
    // Write only the difference between newRows and oldRows for one table.
    function syncTable(table, newRows, keyCols, oldRows, onConflict) {
      var keyOf = function (r) { return keyCols.map(function (k) { return r[k]; }).join(""); };
      var oldMap = {}; (oldRows || []).forEach(function (r) { oldMap[keyOf(r)] = r; });
      var newMap = {}; newRows.forEach(function (r) { newMap[keyOf(r)] = r; });
      var ups = newRows.filter(function (r) { var o = oldMap[keyOf(r)]; return !o || JSON.stringify(r) !== JSON.stringify(o); });
      var dels = (oldRows || []).filter(function (r) { return !newMap[keyOf(r)]; });
      var chain = Promise.resolve();
      for (var i = 0; i < ups.length; i += 500) {
        (function (chunk) {
          chain = chain.then(function () { return client.from(table).upsert(chunk, onConflict ? { onConflict: onConflict } : undefined).then(chk(table + " upsert")); });
        })(ups.slice(i, i + 500));
      }
      dels.forEach(function (r) {
        chain = chain.then(function () { var q = client.from(table).delete(); keyCols.forEach(function (k) { q = q.eq(k, r[k]); }); return q.then(chk(table + " delete")); });
      });
      return chain;
    }

    function tablesFlush() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (pending == null || inFlight) return Promise.resolve();
      var snap = pending; pending = null; inFlight = true;
      var newR = buildRows(snap);
      var oldR = lastSavedRows || buildRows(null);
      return Promise.resolve()
        .then(function () { return syncTable("staff", newR.staff, ["id"], oldR.staff, "id"); })
        .then(function () { return syncTable("schedule_sets", newR.schedule_sets, ["id"], oldR.schedule_sets, "id"); })
        .then(function () { return syncTable("staff_set_membership", newR.staff_set_membership, ["staff_id", "set_id"], oldR.staff_set_membership, "staff_id,set_id"); })
        .then(function () { return syncTable("schedule_blocks", newR.schedule_blocks, ["staff_id", "set_id", "weekday", "t0"], oldR.schedule_blocks, "staff_id,set_id,weekday,t0"); })
        .then(function () { return syncTable("absences", newR.absences, ["staff_id", "absent_on"], oldR.absences, "staff_id,absent_on"); })
        .then(function () { return syncTable("coverage_overrides", newR.coverage_overrides, ["on_date", "slot_key"], oldR.coverage_overrides, "on_date,slot_key"); })
        .then(function () {
          writePrefs({ weekStart: snap.weekStart, selectedDay: snap.selectedDay, view: snap.view });
          lastSaved = snap; lastSavedRows = newR; inFlight = false; setStatus("Saved", "ok");
          if (pending != null) return tablesFlush();
        })
        .catch(function (e) { inFlight = false; setStatus("Save error", "err"); console.error("[Store] tables save:", e); });
    }

    function tablesClear() {
      // child-first delete; ".not(col,is,null)" matches all rows
      var order = [["coverage_overrides", "on_date"], ["absences", "staff_id"], ["schedule_blocks", "staff_id"],
                   ["staff_set_membership", "staff_id"], ["schedule_sets", "id"], ["staff", "id"]];
      var chain = Promise.resolve();
      order.forEach(function (t) { chain = chain.then(function () { return client.from(t[0]).delete().not(t[1], "is", null).then(chk(t[0] + " clear")); }); });
      return chain.then(function () { lastSaved = null; lastSavedRows = null; writePrefs({}); });
    }

    return {
      mode: "supabase",
      schema: isTables ? "tables" : "blob",
      client: client,                 // raw Supabase client (for the one-off table migration)
      buildRows: buildRows,           // exposed for the Stage 2 verification helper
      loadTables: tablesLoad,         // reassemble a snapshot from the tables (works in either mode)
      requireAuth: requireAuth,
      load: load,
      save: save,
      flush: flush,
      clear: clear,
      signOut: function () { return client.auth.signOut(); },
      userEmail: function () { return user ? user.email : null; },
    };
  }

  // ------------------------------------------------------------- selection ---
  if (wantSupabase && !hasSDK) {
    console.error("[Store] storage:'supabase' requested but the Supabase JS SDK failed to load — falling back to localStorage.");
  }
  window.Store = hasSDK ? makeSupabaseStore() : LocalStore;
  console.info("[Store] backend:", window.Store.mode, "| schema:", window.Store.schema || "n/a", "| deployment:", DEPLOY);
})();

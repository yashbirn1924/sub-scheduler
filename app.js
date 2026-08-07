/* Sub Scheduler — 15-minute availability model, 5 roles, editable schedules,
   role-aware coverage, date/week-aware, schedule sets, roster management.
   Data (window.APP_DATA) and branding (window.APP_CONFIG) are injected by boot.js. */

const CFG = window.APP_CONFIG || {};
const DATA = window.APP_DATA;
const DAYS = DATA.days;                      // ["Mon".."Fri"]
const STEP = DATA.step || 15;
const GRID_START = 8 * 60;                    // grid starts 08:00 (end is dynamic, see gridEnd)

// Roles: ranking order for coverage (lower = picked first) + display.
const ROLE = {
  Sub:        { rank: 1, label: "Substitute", cls: "sub",   group: "Substitutes" },
  Specialist: { rank: 2, label: "Specialist", cls: "spec",  group: "Specialists" },
  Lead:       { rank: 3, label: "Lead Teacher", cls: "lead", group: "Lead Teachers" },
  Assistant:  { rank: 4, label: "Assistant", cls: "asst",   group: "Assistant Teachers" },
  Staff:      { rank: 5, label: "Staff",     cls: "staff",  group: "Staff" },
};
const GROUP_ORDER = ["Lead Teachers", "Assistant Teachers", "Specialists", "Staff", "Substitutes"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ---------- date helpers ----------
function parseISO(s) { const [y, m, d] = (s || "").split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function isoDate(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`; }
function addDays(dt, n) { const d = new Date(dt); d.setDate(d.getDate() + n); return d; }
function mondayOf(dt) { const d = new Date(dt); const wd = (d.getDay() + 6) % 7; return addDays(d, -wd); }  // 0=Mon
function fmtDayDate(dt) { return `${dt.getMonth() + 1}/${dt.getDate()}`; }
function fmtWeek(dt) { return `Week of ${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`; }

// ---------- state ----------
const DEFAULT_SET = "primary";
const DEFAULT_SET_META = CFG.defaultSet || { name: "School Year", start: "2025-08-25", end: "2026-06-12" };
const state = {
  selectedDay: "Mon",
  view: "master",                 // "master" | "roster" | personId
  callouts: new Set(),            // "isoDate:personId"
  overrides: {},                  // "isoDate:slotKey" -> personId ("" = force unfilled)
  sets: [{ id: DEFAULT_SET, name: DEFAULT_SET_META.name, start: DEFAULT_SET_META.start, end: DEFAULT_SET_META.end }],
  activeSet: DEFAULT_SET,         // derived from weekStart each render (see setForDate)
  weekStart: null,                // Monday (Date) of the viewed week; initialised at boot
  clipboard: null,                // { s, l } copied block for paste
  people: DATA.people.map(clonePerson),
  byId: {},
};
state.people.forEach(p => { state.byId[p.id] = p; });

function clonePerson(p) {
  const week = Object.fromEntries(DAYS.map(d => [d, (p.blocks[d] || []).map(b => ({ ...b }))]));
  return {
    id: p.id, name: p.name, role: p.role, subject: p.subject || "", room: p.room || "",
    email: p.email || null,
    // membership is PER schedule set; name/role/subject are global (see openEditPersonModal)
    activeSets: new Set([DEFAULT_SET]),
    sets: { [DEFAULT_SET]: week },     // imported data seeds the default set
  };
}
function emptyWeek() { return Object.fromEntries(DAYS.map(d => [d, []])); }
// is this person on the roster for the currently-viewed schedule set?
function isActive(p) { return !!(p.activeSets && p.activeSets.has(state.activeSet)); }

// ---------- schedule sets ----------
function setForDate(dt) {
  const key = isoDate(dt);
  const hit = state.sets.find(s => s.start && s.end && key >= s.start && key <= s.end);
  return hit || state.byIdSet(DEFAULT_SET) || state.sets[0];
}
state.byIdSet = id => state.sets.find(s => s.id === id);

function weekOf(person) {
  if (!person.sets[state.activeSet]) person.sets[state.activeSet] = emptyWeek();
  return person.sets[state.activeSet];
}
function blocksOf(person, day) { return weekOf(person)[day] || []; }

// weekday -> real date / iso key in the currently-viewed week
function dayDate(day) { return addDays(state.weekStart, DAYS.indexOf(day)); }
function dateKey(day) { return isoDate(dayDate(day)); }

// dynamic grid end: fit the latest block across the active set (min 4pm, cap ~7pm)
function gridEnd() {
  let mx = 16 * 60;
  state.people.forEach(p => { if (!isActive(p)) return; DAYS.forEach(d => (weekOf(p)[d] || []).forEach(b => { mx = Math.max(mx, t2m(b.t1)); })); });
  return Math.min(mx, 19 * 60);
}

// ---------- time helpers ----------
function t2m(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function m2t(m) { return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }
function m2disp(m) {
  let h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? "p" : "a";
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(mm).padStart(2, "0")}${ap}`;
}

function blockAt(person, day, minute) {
  for (const b of blocksOf(person, day)) if (minute >= t2m(b.t0) && minute < t2m(b.t1)) return b;
  return null;
}
function statusAt(person, day, minute) { const b = blockAt(person, day, minute); return b ? b.s : "none"; }
function isCalledOut(pid, day) { return state.callouts.has(dateKey(day) + ":" + pid); }
function presentThisDay(person, day) { return blocksOf(person, day).length > 0; }

function isFreeInterval(person, day, m0, m1, tentative) {
  if (!isActive(person)) return false;
  if (isCalledOut(person.id, day)) return false;
  if (calBusyAt(person, day, m0, m1)) return false;      // Google calendar says busy -> not eligible
  for (let m = m0; m < m1; m += STEP) {
    if (statusAt(person, day, m) !== "free") return false;
    if (tentative && tentative.has(person.id + "@" + m)) return false;
  }
  return true;
}

function isECE(person) { return /ECE/i.test(person.subject) || /ECE/i.test(person.room); }

// ---------- coverage engine ----------
function slotKey(ownerId, b) { return ownerId + "|" + b.t0 + "|" + b.t1; }

function computeCoverage(day) {
  const open = [];
  state.people.forEach(p => {
    if (!isCalledOut(p.id, day) || !isActive(p)) return;
    blocksOf(p, day).forEach(b => { if (b.s === "busy") open.push({ owner: p, block: b }); });
  });
  open.sort((x, y) => t2m(x.block.t0) - t2m(y.block.t0) || x.owner.name.localeCompare(y.owner.name));

  const tentative = new Set();
  const reserve = (pid, m0, m1) => { for (let m = m0; m < m1; m += STEP) tentative.add(pid + "@" + m); };
  const dk = dateKey(day);

  const results = open.map(item => {
    const { owner, block } = item;
    const m0 = t2m(block.t0), m1 = t2m(block.t1);
    const key = dk + ":" + slotKey(owner.id, block);

    const eligible = state.people
      .filter(p => p.id !== owner.id && isFreeInterval(p, day, m0, m1, tentative))
      .map(p => ({ p, rank: ROLE[p.role] ? ROLE[p.role].rank : 9 }))
      .sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name));

    let chosen = null;
    const ov = state.overrides[key];
    if (ov !== undefined) {
      if (ov === "") chosen = null;
      else { const f = eligible.find(e => e.p.id === ov); if (f) chosen = f.p; }
    } else if (eligible.length) chosen = eligible[0].p;
    if (chosen) reserve(chosen.id, m0, m1);

    return { owner, block, key, eligible, chosen, ece: isECE(owner) };
  });

  return { results, open: results.length, filled: results.filter(r => r.chosen).length, unfilled: results.filter(r => !r.chosen) };
}

let _covCache = null;
function coverage(day) { if (!_covCache) _covCache = {}; return _covCache[day] || (_covCache[day] = computeCoverage(day)); }
function coverageFor(pid, day) { return coverage(day).results.filter(r => r.chosen && r.chosen.id === pid); }

// ---------- Google Calendar free/busy (Stage 3) ----------
// Applies ONLY to the "Staff" role. Reason: Lead/Assistant/Specialist/Sub have
// fixed weekly schedules (the entered UI schedule is authoritative), and
// free/busy is context-blind — a "free"/prep-hold event still reads as busy, so
// trusting it would wrongly exclude them. Only Staff have week-varying schedules
// where the live calendar is the real signal. Layered on top of the entered
// schedule: a Staff member whose calendar is busy during an open block is
// excluded from the eligible list. Active only in Supabase mode; a missing
// email or any failure falls back silently to the entered schedule.
const CAL_ROLE = "Staff";
const CAL_ON = !!(window.Store && Store.mode === "supabase" && Store.client && CFG.calendar !== false);
state.calBusy = {};      // isoDate -> { email -> [{ s:Date, e:Date }] }
state.calStatus = {};    // isoDate -> "pending" | "done" | "error"
state.calErrors = {};    // isoDate -> [email, ...] Google could not resolve (typo, ex-employee, external)
state.calCount = {};     // isoDate -> emails requested (for the "N of M" badge)

function calEmails() {
  // isActive gate matches every other state.people consumer: don't ship stale
  // out-of-set Staff (state.people never shrinks) — wastes quota and can trip the cap.
  return [...new Set(state.people.filter(p => isActive(p) && p.role === CAL_ROLE && p.email).map(p => p.email))];
}
// Drop cached free/busy so the next render re-fetches (after roster / email edits).
function invalidateCal() { state.calBusy = {}; state.calStatus = {}; state.calErrors = {}; state.calCount = {}; }

async function ensureCalBusy(iso) {
  if (!CAL_ON || state.calStatus[iso]) return;              // disabled, or already fetched/pending
  const emails = calEmails();
  if (!emails.length) { state.calStatus[iso] = "done"; return; }
  state.calStatus[iso] = "pending";
  state.calCount[iso] = emails.length;
  setTimeout(() => { if (state.calStatus[iso] === "pending") render(); }, 150);  // surface "Checking…" on slow cold starts
  const [y, m, d] = iso.split("-").map(Number);
  const timeMin = new Date(y, m - 1, d).toISOString();      // local midnight -> next local midnight
  const timeMax = new Date(y, m - 1, d + 1).toISOString();
  try {
    const { data, error } = await Store.client.functions.invoke("freebusy", { body: { emails, timeMin, timeMax } });
    if (error) throw error;
    const byEmail = {}, errored = [], cals = (data && data.calendars) || {};
    Object.keys(cals).forEach(addr => {
      if ((cals[addr].errors || []).length) {              // Google couldn't read this calendar — treat as no signal, and flag it
        errored.push(addr);
        console.warn("[calendar] could not resolve " + addr, cals[addr].errors);
      }
      byEmail[addr] = (cals[addr].busy || []).map(b => ({ s: new Date(b.start), e: new Date(b.end) }));
    });
    state.calBusy[iso] = byEmail;
    state.calErrors[iso] = errored;
    state.calStatus[iso] = "done";
  } catch (err) {
    console.warn("[calendar] free/busy fetch failed for " + iso, err);
    state.calStatus[iso] = "error";
    setTimeout(() => { if (state.calStatus[iso] === "error") { delete state.calStatus[iso]; render(); } }, 20000);  // retry after a transient failure
  }
  render();                                                 // refresh coverage with the calendar layer applied
}

// does this person's Google calendar show them busy overlapping [m0,m1) on `day`?
function calBusyAt(person, day, m0, m1) {
  if (!CAL_ON || person.role !== CAL_ROLE || !person.email) return false;  // Staff role only
  const iso = dateKey(day);
  const busy = state.calBusy[iso] && state.calBusy[iso][person.email];
  if (!busy || !busy.length) return false;
  const [y, mo, d] = iso.split("-").map(Number);
  const bStart = new Date(y, mo - 1, d, Math.floor(m0 / 60), m0 % 60);
  const bEnd = new Date(y, mo - 1, d, Math.floor(m1 / 60), m1 % 60);
  return busy.some(iv => iv.s < bEnd && iv.e > bStart);      // interval overlap
}

function calBadge(day) {
  if (!CAL_ON) return "";
  const iso = dateKey(day);
  const st = state.calStatus[iso];
  if (st === "pending") return `<span class="cal-badge pending">Checking calendars…</span>`;
  if (st === "error")   return `<span class="cal-badge err">Calendar check unavailable</span>`;
  if (st === "done") {
    const bad = (state.calErrors[iso] || []).length;
    if (bad) {
      const total = state.calCount[iso] || 0;
      return `<span class="cal-badge warn" title="${bad} calendar(s) couldn't be read — those staff fall back to their entered schedule (see console)">Calendar-aware (${total - bad} of ${total})</span>`;
    }
    return `<span class="cal-badge ok">Calendar-aware</span>`;
  }
  return "";
}

// ---------- DOM helpers ----------
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
function roleCls(role) { return ROLE[role] ? ROLE[role].cls : "staff"; }
function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }

// ---------- sidebar ----------
function renderSidebar() {
  const nav = document.getElementById("sidebar");
  nav.innerHTML = "";
  const day = state.selectedDay;
  const cov = coverage(day);

  const master = el("button", "nav-item nav-master" + (state.view === "master" ? " active" : ""));
  master.innerHTML = `<span>📋 Coverage — ${day}</span>` +
    (cov.open ? `<span class="badge${cov.unfilled.length ? " bad" : ""}">${cov.open}</span>` : "");
  master.onclick = () => { state.view = "master"; render(); };
  nav.appendChild(master);

  const roster = el("button", "nav-item nav-master" + (state.view === "roster" ? " active" : ""),
    `<span>👥 Manage roster</span>`);
  roster.onclick = () => { state.view = "roster"; render(); };
  nav.appendChild(roster);

  const groups = {};
  state.people.filter(isActive).forEach(p => {
    const g = ROLE[p.role] ? ROLE[p.role].group : "Staff";
    (groups[g] ||= []).push(p);
  });
  GROUP_ORDER.forEach(g => {
    const people = groups[g];
    if (!people || !people.length) return;
    nav.appendChild(el("div", "nav-group-title", g));
    people.sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
      const item = el("button", "nav-item" + (state.view === p.id ? " active" : ""));
      const out = isCalledOut(p.id, day);
      item.innerHTML =
        `<span class="role-dot dot-${roleCls(p.role)}"></span>` +
        `<span class="nm">${esc(p.name)}</span>` +
        (out ? `<span class="out-flag">OUT</span>` : "");
      item.onclick = () => { state.view = p.id; render(); };
      nav.appendChild(item);
    });
  });
}

// ---------- content ----------
function renderContent() {
  const c = document.getElementById("content");
  c.innerHTML = "";
  if (state.view === "master") c.appendChild(renderMaster());
  else if (state.view === "roster") c.appendChild(renderRoster());
  else if (state.byId[state.view]) c.appendChild(renderPerson(state.byId[state.view]));
  else { state.view = "master"; c.appendChild(renderMaster()); }
}

function renderPerson(p) {
  const day = state.selectedDay;
  const wrap = el("div");
  const out = isCalledOut(p.id, day);
  const dLabel = `${day}, ${MONTHS[dayDate(day).getMonth()]} ${dayDate(day).getDate()}`;

  const head = el("div", "page-head");
  head.appendChild(el("div", "", `
    <h2>${esc(p.name)} <span class="pill ${roleCls(p.role)}">${ROLE[p.role] ? ROLE[p.role].label : p.role}</span></h2>
    <div class="sub-line">${[p.subject, p.room].filter(Boolean).map(esc).join(" · ") || "—"}</div>
  `));
  wrap.appendChild(head);

  const bar = el("div", "callout-bar" + (out ? " is-out" : ""));
  const busyCount = blocksOf(p, day).filter(b => b.s === "busy").length;
  bar.appendChild(el("div", "status", out
    ? `🚫 <b>${esc(p.name)}</b> is out <b>${dLabel}</b> — their classes are open for coverage (see Coverage tab).`
    : `Mark <b>${esc(p.name)}</b> out for <b>${dLabel}</b> to open their ${busyCount} block(s) for coverage.`));
  const btn = el("button", "btn danger" + (out ? " on" : ""), out ? "Cancel call-out" : `Call out for ${day}`);
  btn.onclick = () => {
    const k = dateKey(day) + ":" + p.id;
    if (state.callouts.has(k)) state.callouts.delete(k); else state.callouts.add(k);
    const pre = dateKey(day) + ":";
    Object.keys(state.overrides).forEach(kk => { if (kk.startsWith(pre)) delete state.overrides[kk]; });
    render();
  };
  bar.appendChild(btn);
  wrap.appendChild(bar);

  wrap.appendChild(el("div", "edit-hint", "✏️ Click any block to edit (status · activity · apply to other days), or an empty slot to add one." +
    (state.clipboard ? ` <b>Clipboard:</b> ${esc(state.clipboard.l || state.clipboard.s)} — click an empty slot to paste.` : "")));
  wrap.appendChild(renderWeekGrid(p));
  return wrap;
}

function renderWeekGrid(p) {
  const wrap = el("div", "grid-wrap");
  const table = el("table", "cal");
  const today = state.selectedDay;
  const END = gridEnd();

  const thead = el("thead");
  const hr = el("tr");
  hr.appendChild(el("th", "time-col", "Time"));
  DAYS.forEach(d => hr.appendChild(el("th", d === today ? "today" : "", `${d} <span class="col-date">${fmtDayDate(dayDate(d))}</span>`)));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el("tbody");
  for (let m = GRID_START; m < END; m += STEP) {
    const tr = el("tr", m % 60 === 0 ? "hour" : "");
    const tc = el("td", "time-cell");
    tc.innerHTML = m % 30 === 0 ? `<span class="tl">${m2disp(m)}</span>` : "";
    tr.appendChild(tc);
    DAYS.forEach(d => {
      const b = blockAt(p, d, m);
      const td = el("td", "cell " + (d === today ? "today-col " : "") + (b ? "s-" + b.s : "s-none"));
      if (b) {
        if (t2m(b.t0) === m) {
          td.rowSpan = Math.max(1, (t2m(b.t1) - t2m(b.t0)) / STEP);
          const cov = (d === today && b.s === "free") ? coverAssignmentAt(p, d, m) : null;
          td.innerHTML = cellHTML(b, cov);
          td.onclick = () => openEditor(p, d, b);
        } else return;
      } else {
        td.onclick = () => openEditor(p, d, pasteOrNew(m));
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function pasteOrNew(m) {
  const c = state.clipboard;
  if (c) return { t0: m2t(m), t1: m2t(m + STEP), s: c.s, l: c.l, c: "hi", _new: true };
  return { t0: m2t(m), t1: m2t(m + STEP), s: "busy", l: "", c: "hi", _new: true };
}

function cellHTML(b, cov) {
  if (cov) {
    return `<div class="ci cover"><div class="c-t">Covering ${esc(cov.owner.name)}</div>` +
      `<div class="c-m">${esc(cov.block.l) || "class"}</div></div>`;
  }
  const label = esc(b.l) || (b.s === "free" ? "Available" : b.s === "off" ? "Off" : "—");
  const lo = b.c === "lo" ? " lo" : "";
  const title = b.c === "lo" ? ' title="Imported — please verify"' : "";
  return `<div class="ci ${b.s}${lo}"${title}><div class="c-t">${label}</div>` +
    `<div class="c-m">${m2disp(t2m(b.t0))}–${m2disp(t2m(b.t1))}</div></div>`;
}

function coverAssignmentAt(person, day, minute) {
  return coverageFor(person.id, day).find(r => t2m(r.block.t0) <= minute && minute < t2m(r.block.t1)) || null;
}

// ---------- block editor (with apply-to-days + copy/paste) ----------
function openEditor(person, day, block) {
  const dayChecks = DAYS.map(d =>
    `<label class="daychk"><input type="checkbox" value="${d}" ${d === day ? "checked" : ""}> ${d}</label>`).join("");

  modal(`${esc(person.name)} · ${day} ${fmtDayDate(dayDate(day))}`, box => {
    const times = el("div", "ed-row");
    times.innerHTML = `<label>Start <input id="edStart" type="time" step="900" value="${block.t0}"></label>
                       <label>End <input id="edEnd" type="time" step="900" value="${block.t1}"></label>`;
    box.appendChild(times);
    box.appendChild(field("Status", `<select id="edStatus">
        <option value="busy">Busy (with class / teaching)</option>
        <option value="free">Free (available to cover)</option>
        <option value="off">Off (break / not on site)</option></select>`));
    box.appendChild(field("Activity", `<input id="edLabel" type="text" placeholder="e.g. Math, PE, Planning" value="${esc(block.l)}">`));
    const ad = el("div", "ed-row");
    ad.innerHTML = `<label>Apply to days <div class="daychks">${dayChecks}</div></label>`;
    box.appendChild(ad);
    box.querySelector("#edStatus").value = block.s;
  }, box => {
    const t0 = box.querySelector("#edStart").value, t1 = box.querySelector("#edEnd").value;
    const s = box.querySelector("#edStatus").value, l = box.querySelector("#edLabel").value.trim();
    if (t2m(t1) <= t2m(t0)) { alert("End must be after start."); return false; }
    const days = [...box.querySelectorAll(".daychks input:checked")].map(c => c.value);
    days.forEach(d => upsertBlock(person, d, d === day ? block : null, { t0, t1, s, l, c: "hi" }));
    return true;
  }, "Save", (box, actions) => {
    // extra buttons: Copy + Delete
    const copy = el("button", "btn ghost", "Copy");
    copy.onclick = () => {
      state.clipboard = { s: box.querySelector("#edStatus").value, l: box.querySelector("#edLabel").value.trim() };
      copy.textContent = "Copied ✓";
    };
    actions.insertBefore(copy, actions.firstChild.nextSibling);
    if (!block._new) {
      const del = el("button", "btn danger", "Delete");
      del.onclick = () => { removeBlock(person, day, block); document.getElementById("editorLayer").innerHTML = ""; render(); };
      actions.appendChild(del);
    }
  });
}

function upsertBlock(person, day, orig, next) {
  const m0 = t2m(next.t0), m1 = t2m(next.t1);
  let bl = blocksOf(person, day).filter(b => b !== orig);
  bl = bl.filter(b => t2m(b.t1) <= m0 || t2m(b.t0) >= m1);   // drop overlaps
  bl.push({ ...next });
  bl.sort((a, b) => t2m(a.t0) - t2m(b.t0));
  weekOf(person)[day] = bl;
}
function removeBlock(person, day, block) { weekOf(person)[day] = blocksOf(person, day).filter(b => b !== block); }

// ---------- roster management ----------
// Email is optional; when present it must look valid (it becomes the person's
// Google Calendar id in Stage 3).
function validEmail(e) { return !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

function addPerson(fields) {
  const base = (fields.name || "person").replace(/\W+/g, "") || "person";
  let id = base, i = 1; while (state.byId[id]) id = base + (++i);
  const person = {
    id, name: fields.name.trim(), role: fields.role, subject: fields.subject.trim(),
    room: fields.room.trim(), email: (fields.email || "").trim() || null,
    activeSets: new Set([state.activeSet]),          // added to the currently-viewed set
    sets: Object.fromEntries(state.sets.map(s => [s.id, emptyWeek()])),
  };
  state.people.push(person); state.byId[id] = person;
  invalidateCal();                                   // new Staff email may change the free/busy set
  return person;
}
// membership is per set: remove/add only affects the currently-viewed set
function removeFromSet(pid) { const p = state.byId[pid]; if (p) p.activeSets.delete(state.activeSet); }
function addToSet(pid) { const p = state.byId[pid]; if (p) p.activeSets.add(state.activeSet); }

function openAddPersonModal() {
  modal(`Add staff member`, box => {
    box.appendChild(field("Name", `<input id="apName" type="text" placeholder="Full name">`));
    const roleOpts = Object.keys(ROLE).map(r => `<option value="${r}">${ROLE[r].label}</option>`).join("");
    box.appendChild(field("Role", `<select id="apRole">${roleOpts}</select>`));
    box.appendChild(field("Subject / grade", `<input id="apSubj" type="text" placeholder="e.g. 3/4, PE, ECE">`));
    box.appendChild(field("Room", `<input id="apRoom" type="text" placeholder="optional">`));
    box.appendChild(field("Email", `<input id="apEmail" type="email" placeholder="name@school.org — links to Google Calendar">`));
  }, box => {
    const name = box.querySelector("#apName").value.trim();
    if (!name) { alert("Name is required."); return false; }
    const email = box.querySelector("#apEmail").value.trim();
    if (!validEmail(email)) { alert("Please enter a valid email address (or leave it blank)."); return false; }
    const p = addPerson({
      name, role: box.querySelector("#apRole").value,
      subject: box.querySelector("#apSubj").value, room: box.querySelector("#apRoom").value, email,
    });
    state.view = p.id;
    return true;
  }, "Add");
}

function openEditPersonModal(person) {
  const roleOpts = Object.keys(ROLE).map(r =>
    `<option value="${r}" ${r === person.role ? "selected" : ""}>${ROLE[r].label}</option>`).join("");
  modal(`Edit ${esc(person.name)}`, box => {
    box.appendChild(field("Name", `<input id="epName" type="text" value="${esc(person.name)}">`));
    box.appendChild(field("Role", `<select id="epRole">${roleOpts}</select>`));
    box.appendChild(field("Subject / grade", `<input id="epSubj" type="text" value="${esc(person.subject)}">`));
    box.appendChild(field("Room", `<input id="epRoom" type="text" value="${esc(person.room)}">`));
    box.appendChild(field("Email", `<input id="epEmail" type="email" placeholder="name@school.org — links to Google Calendar" value="${esc(person.email || "")}">`));
  }, box => {
    const name = box.querySelector("#epName").value.trim();
    if (!name) { alert("Name is required."); return false; }
    const email = box.querySelector("#epEmail").value.trim();
    if (!validEmail(email)) { alert("Please enter a valid email address (or leave it blank)."); return false; }
    const calDirty = person.role !== box.querySelector("#epRole").value || (person.email || null) !== (email || null);
    person.name = name;
    person.role = box.querySelector("#epRole").value;
    person.subject = box.querySelector("#epSubj").value.trim();
    person.room = box.querySelector("#epRoom").value.trim();
    person.email = email || null;
    if (calDirty) invalidateCal();                   // role/email change alters the free/busy set
    return true;
  }, "Save");
}

function renderRoster() {
  const wrap = el("div");
  const setName = (state.byIdSet(state.activeSet) || { name: "" }).name;
  const head = el("div", "page-head");
  head.appendChild(el("div", "", `<h2>Roster</h2>
    <div class="sub-line">Membership is per schedule set — showing <b>${esc(setName)}</b>.
    Name / role / subject edits apply across <i>all</i> sets.</div>`));
  const add = el("button", "btn primary small", "＋ Add staff member");
  add.onclick = openAddPersonModal;
  head.appendChild(add);
  wrap.appendChild(head);

  const inSet = state.people.filter(isActive).sort(sortByRoleName);
  const notInSet = state.people.filter(p => !isActive(p)).sort((a, b) => a.name.localeCompare(b.name));

  const table = el("table", "roster");
  table.innerHTML = `<thead><tr><th>Name</th><th>Role</th><th>Subject / room</th><th>In this set</th><th></th></tr></thead>`;
  const tb = el("tbody");
  const row = (p, inThisSet) => {
    const tr = el("tr", inThisSet ? "" : "inactive-row");
    tr.innerHTML =
      `<td><span class="role-dot dot-${roleCls(p.role)}"></span> <b>${esc(p.name)}</b></td>` +
      `<td><span class="tag ${roleCls(p.role)}">${ROLE[p.role] ? ROLE[p.role].label : p.role}</span></td>` +
      `<td>${[p.subject, p.room].filter(Boolean).map(esc).join(" · ") || "—"}</td>` +
      `<td>${inThisSet ? '<span class="stat-ok">Yes</span>' : '<span class="stat-off">No</span>'}</td>`;
    const td = el("td", "roster-actions");
    const edit = el("button", "btn ghost small", "Edit");
    edit.onclick = () => openEditPersonModal(p);
    td.appendChild(edit);
    if (inThisSet) {
      const open = el("button", "btn ghost small", "Schedule");
      open.onclick = () => { state.view = p.id; render(); };
      const rm = el("button", "btn ghost small danger-text", "Remove");
      rm.title = `Remove from ${setName} only — stays in other sets`;
      rm.onclick = () => { removeFromSet(p.id); render(); };
      td.appendChild(open); td.appendChild(rm);
    } else {
      const addb = el("button", "btn ghost small", "＋ Add to set");
      addb.title = `Add to ${setName}`;
      addb.onclick = () => { addToSet(p.id); render(); };
      td.appendChild(addb);
    }
    tr.appendChild(td);
    return tr;
  };
  inSet.forEach(p => tb.appendChild(row(p, true)));
  if (notInSet.length) {
    const sep = el("tr", "roster-sep");
    sep.innerHTML = `<td colspan="5">Not in ${esc(setName)} (${notInSet.length})</td>`;
    tb.appendChild(sep);
    notInSet.forEach(p => tb.appendChild(row(p, false)));
  }
  table.appendChild(tb);
  wrap.appendChild(table);

  const footer = el("div", "roster-footer");
  const reset = el("button", "btn ghost small danger-text", "Reset all data to imported baseline");
  reset.title = "Discards all edits, roster changes, and schedule sets";
  reset.onclick = () => {
    if (confirm("Discard ALL edits, roster changes, and schedule sets, and reload the original imported data?")) resetAllData();
  };
  footer.appendChild(el("span", "footer-note", "Changes are saved automatically in this browser. "));
  footer.appendChild(reset);
  wrap.appendChild(footer);
  return wrap;
}
function sortByRoleName(a, b) {
  const ra = ROLE[a.role] ? ROLE[a.role].rank : 9, rb = ROLE[b.role] ? ROLE[b.role].rank : 9;
  return ra - rb || a.name.localeCompare(b.name);
}

// ---------- schedule sets ----------
function createSet(name, start, end, copyFromId) {
  const base = (name || "set").replace(/\W+/g, "").toLowerCase() || "set";
  let id = base, i = 1; while (state.sets.some(s => s.id === id)) id = base + (++i);
  state.sets.push({ id, name: name.trim(), start, end });
  const baseSet = copyFromId || state.activeSet;   // membership carries from source (or current) set
  state.people.forEach(p => {
    p.sets[id] = copyFromId && p.sets[copyFromId] ? deepWeek(p.sets[copyFromId]) : emptyWeek();
    if (p.activeSets.has(baseSet)) p.activeSets.add(id);
  });
  if (start) state.weekStart = mondayOf(parseISO(start));   // jump to the new set's first week
  return id;
}
function deepWeek(w) { return Object.fromEntries(DAYS.map(d => [d, (w[d] || []).map(b => ({ ...b }))])); }

function openNewSetModal() {
  modal(`New schedule set`, box => {
    box.appendChild(field("Name", `<input id="nsName" type="text" placeholder="e.g. Summer 2026">`));
    const r = el("div", "ed-row");
    r.innerHTML = `<label>Applies from <input id="nsStart" type="date"></label>
                   <label>to <input id="nsEnd" type="date"></label>`;
    box.appendChild(r);
    const copyOpts = state.sets.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
    box.appendChild(field("Start from", `<select id="nsCopy"><option value="">Blank schedules</option>${copyOpts}</select>`));
  }, box => {
    const name = box.querySelector("#nsName").value.trim();
    if (!name) { alert("Name is required."); return false; }
    createSet(name, box.querySelector("#nsStart").value, box.querySelector("#nsEnd").value, box.querySelector("#nsCopy").value || null);
    return true;
  }, "Create set");
}

// ---------- generic modal ----------
function field(label, innerHTML) { const r = el("div", "ed-row"); r.innerHTML = `<label>${label} ${innerHTML}</label>`; return r; }
function modal(title, build, onSave, saveLabel, extra) {
  const layer = document.getElementById("editorLayer");
  layer.innerHTML = "";
  const back = el("div", "editor-back");
  const box = el("div", "editor");
  box.appendChild(el("h3", "", title));
  build(box);
  const actions = el("div", "ed-actions");
  const save = el("button", "btn primary", saveLabel || "Save");
  const cancel = el("button", "btn ghost", "Cancel");
  actions.appendChild(save); actions.appendChild(cancel);
  box.appendChild(actions);
  if (extra) extra(box, actions);
  back.appendChild(box); layer.appendChild(back);
  const close = () => { layer.innerHTML = ""; };
  back.onclick = e => { if (e.target === back) close(); };
  cancel.onclick = close;
  save.onclick = () => { if (onSave(box) !== false) { close(); render(); } };
}

// ---------- master coverage ----------
function renderMaster() {
  const day = state.selectedDay;
  const wrap = el("div");
  const cov = coverage(day);
  const dLabel = `${day}, ${MONTHS[dayDate(day).getMonth()]} ${dayDate(day).getDate()}`;

  wrap.appendChild(el("div", "page-head", `<div>
      <h2>Coverage — ${dLabel}</h2>
      <div class="sub-line">Call out any staff member; their classes and suggested coverage appear here.</div>
    </div>${calBadge(day)}`));

  const outPeople = state.people.filter(p => isCalledOut(p.id, day) && isActive(p));
  const stats = el("div", "stat-row");
  stats.appendChild(statBox(outPeople.length, "Staff out"));
  stats.appendChild(statBox(cov.open, "Blocks to cover"));
  stats.appendChild(statBox(cov.filled, "Covered", "good"));
  stats.appendChild(statBox(cov.unfilled.length, "Unfilled", cov.unfilled.length ? "alert" : "good"));
  wrap.appendChild(stats);

  if (cov.open === 0) {
    const e = el("div", "empty");
    e.innerHTML = `<div class="big">No call-outs for ${dLabel}. 🎉</div>
      <div>Open a staff member's page and use <b>Call out</b> to simulate an absence.</div>`;
    wrap.appendChild(e);
    return wrap;
  }

  const table = el("table", "cover");
  table.innerHTML = `<thead><tr><th>Time</th><th>Class / activity</th><th>Coverage</th><th>Assign</th></tr></thead>`;
  const tbody = el("tbody");
  const byOwner = {};
  cov.results.forEach(r => { (byOwner[r.owner.id] ||= []).push(r); });
  Object.keys(byOwner).forEach(oid => {
    const owner = state.byId[oid];
    const gh = el("tr", "group-head");
    gh.innerHTML = `<td colspan="4">🚫 ${esc(owner.name)} — ${ROLE[owner.role] ? ROLE[owner.role].label : owner.role}` +
      `${owner.subject ? " · " + esc(owner.subject) : ""}${isECE(owner) ? ' <span class="ece-tag">ECE · needs 2 adults</span>' : ""}</td>`;
    tbody.appendChild(gh);

    byOwner[oid].forEach(r => {
      const tr = el("tr", (!r.chosen ? "row-unfilled" : ""));
      const who = r.chosen
        ? `<span class="who">${esc(r.chosen.name)}</span> <span class="tag ${roleCls(r.chosen.role)}">${ROLE[r.chosen.role].label}</span>`
        : `<span class="tag none">${r.ece ? "UNFILLED · RATIO RISK" : "UNFILLED"}</span>`;
      tr.innerHTML =
        `<td class="tcell"><b>${m2disp(t2m(r.block.t0))}–${m2disp(t2m(r.block.t1))}</b></td>` +
        `<td>${esc(r.block.l) || "class"}${r.block.c === "lo" ? ' <span class="lo-dot" title="imported — verify"></span>' : ""}</td>` +
        `<td>${who}</td>`;
      const td = el("td");
      const sel = el("select", "assign" + (r.chosen ? "" : " unfilled"));
      const auto = el("option", "", "Auto: " + (r.chosen ? r.chosen.name : "— none available —"));
      auto.value = "__auto__"; sel.appendChild(auto);
      r.eligible.forEach(e => {
        const o = el("option", "", `${e.p.name} (${ROLE[e.p.role] ? ROLE[e.p.role].label : e.p.role})`);
        o.value = e.p.id; sel.appendChild(o);
      });
      const none = el("option", "", "Leave unfilled"); none.value = "__none__"; sel.appendChild(none);
      const ov = state.overrides[r.key];
      sel.value = ov === undefined ? "__auto__" : ov === "" ? "__none__" : ov;
      sel.onchange = () => {
        if (sel.value === "__auto__") delete state.overrides[r.key];
        else if (sel.value === "__none__") state.overrides[r.key] = "";
        else state.overrides[r.key] = sel.value;
        render();
      };
      td.appendChild(sel); tr.appendChild(td);
      tbody.appendChild(tr);
    });
  });
  table.appendChild(tbody);
  wrap.appendChild(table);

  const legend = el("div", "legend");
  legend.innerHTML = `<span><i class="dot-sub"></i> Sub</span><span><i class="dot-spec"></i> Specialist</span>` +
    `<span><i class="dot-lead"></i> Lead</span><span><i class="dot-asst"></i> Assistant</span><span><i class="dot-staff"></i> Staff</span>`;
  wrap.appendChild(legend);
  return wrap;
}

function statBox(n, label, kind) {
  const s = el("div", "stat" + (kind ? " " + kind : ""));
  s.innerHTML = `<div class="n">${n}</div><div class="l">${label}</div>`;
  return s;
}

// ---------- top controls ----------
function renderDaySelect() {
  const sel = document.getElementById("daySelect");
  sel.innerHTML = "";
  DAYS.forEach(d => {
    const o = el("option", "", `${d} ${fmtDayDate(dayDate(d))}`); o.value = d;
    if (d === state.selectedDay) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => { state.selectedDay = sel.value; render(); };
}
function renderSetSelect() {
  const sel = document.getElementById("setSelect");
  sel.innerHTML = "";
  state.sets.forEach(s => {
    const range = s.start || s.end ? `  (${s.start || "…"} → ${s.end || "…"})` : "";
    const o = el("option", "", s.name + range); o.value = s.id;
    if (s.id === state.activeSet) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => { const s = state.byIdSet(sel.value); if (s && s.start) state.weekStart = mondayOf(parseISO(s.start)); render(); };
}
function renderWeekNav() {
  document.getElementById("weekLabel").textContent = fmtWeek(state.weekStart);
}

function render() {
  _covCache = null;
  state.activeSet = setForDate(state.weekStart).id;   // set is derived from the viewed week
  renderWeekNav();
  renderSetSelect();
  renderDaySelect();
  renderSidebar();
  renderContent();
  persist();                                          // save after every change
  if (CAL_ON && state.weekStart) ensureCalBusy(dateKey(state.selectedDay));  // async; re-renders when it lands
}

// ---------- persistence ----------
// Storage backend (localStorage or Supabase) is provided by persistence.js as
// window.Store; this file only serializes state <-> a plain snapshot object.
function snapshot() {
  return {
    people: state.people.map(p => ({
      id: p.id, name: p.name, role: p.role, subject: p.subject, room: p.room,
      email: p.email != null ? p.email : null,
      activeSets: [...p.activeSets], sets: p.sets,
    })),
    sets: state.sets,
    callouts: [...state.callouts],
    overrides: state.overrides,
    weekStart: state.weekStart ? isoDate(state.weekStart) : null,
    selectedDay: state.selectedDay,
    view: state.view,
  };
}
function persist() { try { Store.save(snapshot()); } catch (e) { /* ignore */ } }
async function loadPersisted() {
  try {
    const d = await Store.load();
    if (!d || !d.people || !d.sets) return false;
    state.people = d.people.map(p => ({ ...p, activeSets: new Set(p.activeSets || []) }));
    state.byId = {}; state.people.forEach(p => { state.byId[p.id] = p; });
    state.sets = d.sets;
    state.callouts = new Set(d.callouts || []);
    state.overrides = d.overrides || {};
    state.selectedDay = d.selectedDay || "Mon";
    state.view = d.view || "master";
    state.weekStart = d.weekStart ? parseISO(d.weekStart) : null;
    return true;
  } catch (e) { return false; }
}
function resetAllData() { Store.clear().then(() => location.reload()); }

// ---------- one-off migration: JSON blob -> normalized Stage 2 tables ----------
// Run once from the browser console while signed in:  await migrateToTables()
// Idempotent (upserts by natural key); does NOT touch the app_state blob, which
// stays as a rollback. Does not write staff.email, so a later email backfill is
// preserved if this is ever re-run.
async function migrateToTables() {
  const c = Store && Store.client;
  if (!c) { console.error("[migrate] Supabase mode required (Store.client missing)."); return; }
  const snap = snapshot();
  const now = new Date().toISOString();

  const staff = snap.people.map(p => ({
    id: p.id, name: p.name, role: p.role,
    subject: p.subject || null, room: p.room || null, updated_at: now,
  }));
  const sets = snap.sets.map((s, i) => ({
    id: s.id, name: s.name, start_date: s.start, end_date: s.end, sort_order: i, updated_at: now,
  }));
  const membership = [];
  const blocks = [];
  snap.people.forEach(p => {
    (p.activeSets || []).forEach(setId => membership.push({ staff_id: p.id, set_id: setId }));
    Object.entries(p.sets || {}).forEach(([setId, week]) => {
      DAYS.forEach(day => (week[day] || []).forEach(b => blocks.push({
        staff_id: p.id, set_id: setId, weekday: day,
        t0: b.t0, t1: b.t1, status: b.s,
        label: b.l || null,
        priority: (b.c === "hi" || b.c === "lo") ? b.c : null,
      })));
    });
  });
  const absences = (snap.callouts || []).map(k => ({
    staff_id: k.slice(11), absent_on: k.slice(0, 10),   // "isoDate:personId" (date is fixed 10 chars)
  }));
  const overrides = Object.entries(snap.overrides || {}).map(([k, v]) => ({
    on_date: k.slice(0, 10), slot_key: k.slice(11),      // "isoDate:slotKey"; slotKey may contain colons
    assigned_staff_id: v === "" ? null : v,              // "" = forced unfilled -> null row
    updated_at: now,
  }));

  async function push(table, rows, conflict) {
    if (!rows.length) { console.log(`[migrate] ${table}: 0 rows`); return; }
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const q = conflict ? c.from(table).upsert(chunk, { onConflict: conflict }) : c.from(table).upsert(chunk);
      const { error } = await q;
      if (error) { console.error(`[migrate] ${table} chunk @${i} FAILED:`, error); throw error; }
    }
    console.log(`[migrate] ${table}: ${rows.length} rows ✓`);
  }

  console.log("[migrate] starting…");
  await push("staff", staff);                                       // conflict on pk id
  await push("schedule_sets", sets);                                // conflict on pk id
  await push("staff_set_membership", membership, "staff_id,set_id");
  await push("schedule_blocks", blocks, "staff_id,set_id,weekday,t0");
  await push("absences", absences, "staff_id,absent_on");
  await push("coverage_overrides", overrides, "on_date,slot_key");
  const summary = { staff: staff.length, sets: sets.length, membership: membership.length,
                    blocks: blocks.length, absences: absences.length, overrides: overrides.length };
  console.log("[migrate] DONE ✓", summary);
  return summary;
}
window.migrateToTables = migrateToTables;

// ---------- Stage 2 verification: do the tables reassemble to the same state? ----------
// Run from the console while signed in (works in blob mode too):  await verifyStage2()
// Compares the current in-memory state against a fresh reassembly from the tables,
// row-for-row per table. All onlyIn* counts should be 0.
async function verifyStage2() {
  if (!Store.buildRows || !Store.loadTables) { console.error("[verify] Supabase Store required."); return; }
  const fromState = Store.buildRows(snapshot());
  const fromTables = Store.buildRows(await Store.loadTables());
  const report = {};
  let clean = true;
  Object.keys(fromState).forEach(t => {
    const norm = rows => rows.map(r => JSON.stringify(r)).sort();
    const a = norm(fromState[t]), b = norm(fromTables[t]);
    const setA = new Set(a), setB = new Set(b);
    const onlyInState = a.filter(x => !setB.has(x)).length;
    const onlyInTables = b.filter(x => !setA.has(x)).length;
    if (onlyInState || onlyInTables) clean = false;
    report[t] = { state: a.length, tables: b.length, onlyInState, onlyInTables };
  });
  console.table(report);
  console.log(clean ? "[verify] ✓ tables match current state exactly" : "[verify] ✗ differences found (see onlyIn* columns)");
  return report;
}
window.verifyStage2 = verifyStage2;

document.getElementById("resetBtn").onclick = () => { state.callouts.clear(); state.overrides = {}; render(); };
document.getElementById("newSetBtn").onclick = openNewSetModal;
document.getElementById("weekPrev").onclick = () => { state.weekStart = addDays(state.weekStart, -7); render(); };
document.getElementById("weekNext").onclick = () => { state.weekStart = addDays(state.weekStart, 7); render(); };

// boot: gate on auth (hosted mode), hydrate saved state if present, else start
// on a week that has real data
(async function boot() {
  await Store.requireAuth();          // shows admin login in Supabase mode; no-op for local
  await loadPersisted();
  if (!state.weekStart) {
    const today = new Date();
    state.weekStart = (isoDate(today) >= state.sets[0].start && isoDate(today) <= state.sets[0].end)
      ? mondayOf(today) : mondayOf(parseISO(state.sets[0].start));
  }
  render();
})();

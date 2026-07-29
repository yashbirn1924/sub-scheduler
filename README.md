# Sub Scheduler

A lightweight tool for **elementary-school substitute coverage**. Load each staff
member's weekly schedule, mark someone out for a day, and it proposes who should cover
each open class from everyone else's real availability — ranked by role, never
double-booked.

Runs as a plain static site (vanilla HTML/CSS/JS, no build step). Ships with synthetic
sample data so you can try it immediately.

## Run it

```bash
python3 -m http.server 4599
```

Then open http://localhost:4599.

## What it does

- **Roster grouped by role** — Lead, Assistant, Specialist, Staff, Substitute.
- **15-minute schedules** — each person's week on a fine-grained grid. Click any block to
  edit status / activity, apply it to multiple days, or copy-paste. Green = available,
  gray = busy.
- **Coverage** — mark someone out for a day and get a suggested coverer for each open
  block, ranked **Sub → Specialist → Lead → Assistant → Staff**. Override any pick.
- **Two-adult classes** — early-childhood rooms are flagged when an absence risks the
  ratio.
- **Date / week aware** — real weeks and dates; call-outs are per date.
- **Schedule sets** — run different schedules for different parts of the year (e.g. a
  summer schedule vs. the school year), each with its own date range and roster membership.
- **Roster management** — add, edit, and remove staff.
- **Persists locally** — edits are saved in your browser (`localStorage`).

## Configuring / theming

Branding and the data source are driven by [`config.js`](config.js). To run your own
deployment without touching the code, copy [`config.local.example.js`](config.local.example.js)
to `config.local.js` (gitignored) and set your app name, colors, logo, and data file:

```js
Object.assign(window.APP_CONFIG, {
  appName: "Your School Sub Scheduler",
  colors: { brand: "#2f5bd0", accent: "#f0a127" },
  logo: "assets/your-logo.png",
  dataFile: "data/real/your_data.js",
});
```

`config.local.js` is loaded after `config.js` and overrides it — so your branding and
real data stay out of the public repo.

## Data format

A data file assigns `window.APP_DATA`:

```js
window.APP_DATA = {
  people: [
    { id, name, role, subject, room,
      blocks: { Mon: [ { t0: "08:00", t1: "08:30", s: "busy", l: "Reading", c: "hi" } ], /* … */ } }
  ],
  days: ["Mon","Tue","Wed","Thu","Fri"], step: 15
};
```

- `s` — `busy` (with class / teaching), `free` (available to cover), or `off` (break / not on site).
- `c` — confidence: `hi`, or `lo` to flag a cell as unverified after an import.

Regenerate the bundled synthetic sample with:

```bash
python3 data/sample/generate_sample.py
```

## License

MIT — see [LICENSE](LICENSE).

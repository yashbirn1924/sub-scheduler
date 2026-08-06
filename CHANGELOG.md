# Changelog

All notable changes to Sub Scheduler are recorded here. This file is the
human-readable history; git commits hold the line-level detail.

Format follows [Keep a Changelog](https://keepachangelog.com/), and the project
aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased] — planned

- **Google Calendar free/busy** — read staff busy/free windows (free/busy only,
  no event contents) via a backend function using a service account, to make
  coverage suggestions calendar-aware.
- **Staff email backfill** — populate every staff record's email (the calendar
  key) from a source list via a one-off, id-keyed import.

## [0.3.0] — 2026-07-29 — Hosting

### Added
- Public deploy: static frontend published to a static host, separate from the
  source repository so private config never enters version control.
- `data/hosted/seed.js` — schema-only seed (weekdays + step, empty roster) so no
  real roster is ever shipped as a static file; hosted data loads from the
  backend after login.
- `build-deploy.sh` — rebuilds the deploy artifact from source while preserving
  the private hosted config.

### Security
- Repository anonymized and audited: no keys, real data, or private branding in
  tracked files; a pre-commit hook blocks the private layer from being committed.

## [0.2.0] — 2026-07 — Normalized data model

### Added
- Relational schema behind Row-Level Security: `staff`, `schedule_sets`,
  `staff_set_membership`, `schedule_blocks`, `absences`, `coverage_overrides`.
- Diff-based saves — each edit writes only what changed, per table.
- `email` field on staff (Add/Edit forms) — the future calendar identifier.
- One-off migration from the single-document store into the tables, with a
  verification step confirming an exact round-trip.

### Changed
- Storage switched from a single JSON document to the normalized tables
  (selectable via config; the document store remains as a fallback).

## [0.1.0] — 2026-07 — Hosted backend

### Added
- Admin authentication gate before the app loads.
- Durable, access-controlled state stored in a hosted Postgres backend
  (Supabase) behind Row-Level Security, replacing browser-only storage.
- Save/sync status indicator and sign-out.

## [0.0.1] — Initial

### Added
- Static single-admin scheduling tool: 15-minute availability model, five roles,
  editable schedules, role-aware coverage suggestions, date/week awareness,
  schedule sets, and roster management. State persisted in the browser
  (localStorage).

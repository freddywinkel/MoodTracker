# Release verification

## Initial production candidate — 2026-10-12

Version 1.0.0. Standalone manual daily journal hosted at https://freddywinkel.github.io/MoodTracker/.

Executed locally with Node 24:

- Typecheck and production build passed.
- 58 unit/storage/report tests passed, including additive database migration, null/zero distinctions, invalid draft preservation, atomic restore rollback, stale-window conflicts and deletion protection.
- 13 Chromium browser tests passed. They cover daily entries, reload, history and insights, JSON merge/replace/invalid restore, offline operation, Amsterdam date boundaries, keyboard use, theme persistence, storage failure recovery and a waiting old-shell/new-shell update.
- Ten automated WCAG A/AA scans across five screens in light/dark themes reported zero violations. Responsive checks at 320, 390, 768, 1024 and 1440 pixels passed without page overflow.
- The same-origin browser update preserved the latest pending note, entry ID, mood, sleep, support settings and theme, removed only the obsolete app cache, and supported subsequent offline editing.
- Stable manifest ID/start URL/scope, icon assets, base path and scoped worker verification passed. All browser tests reported no uncaught page errors or third-party application requests.
- npm audit reported zero dependency vulnerabilities. Phone and desktop screenshots were visually reviewed.

The CI workflow repeats release gates before deploying. Local checks alone do not establish that the public app is working.

## Public deployment and actual update — 2026-10-12

Current app version: **1.0.1**. The maintenance update makes the backup's unencrypted format explicit in Settings. All 58 unit/storage/report tests and 13 browser tests passed again for this version, locally and in GitHub Actions.

- Initial release: commit `078f7b3a1e53836a5bbf930d5fb191429633623b`, successful [Pages run 38250430654](https://github.com/freddywinkel/MoodTracker/actions/runs/38250430654).
- Maintenance release: commit `a4342311780a2b176242b2668037dc9ecaed791b`, successful [Pages run 38250835566](https://github.com/freddywinkel/MoodTracker/actions/runs/38250835566).
- The actual public HTTPS URL returned 200 and loaded the working journal. Its manifest retained `/MoodTracker/` for ID, start URL and scope; the deployed worker returned 200.
- A synthetic day with mood Good, main sleep 7h 30m and explicit zero additional sleep survived reload and full JSON export.
- A Chromium context kept the live **1.0.0** shell open while **1.0.1** deployed. The new worker waited. A note was entered immediately before Update now, without waiting for the debounce. After activation and reload, the entry ID, latest note, sleep, mood and dark theme remained intact and Settings displayed 1.0.1.
- The updated live-installed shell then reopened offline; editing mood, viewing History and downloading a full backup worked. No uncaught page errors occurred.

This was a real same-origin public release-to-release update, in addition to the automated local update fixture. Synthetic QA artifacts stay outside Git. The live verification runner is `scripts/live-verify.mjs`; its `--watch-upgrade` mode intentionally holds the old live shell while the next deployment runs.

## Evidence boundaries

Browser evidence uses synthetic entries in temporary Chromium contexts, including an 820 × 1180 viewport. It does not establish physical iPhone/iPad installation, Safari storage behavior, native sharing or VoiceOver behavior. Ordinary app updates preserve the stable IndexedDB journal; device/browser deletion and storage failures still require external JSON backups.

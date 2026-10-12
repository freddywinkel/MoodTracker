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

The CI workflow repeats release gates before deploying. Actual public deployment and update evidence will be recorded below after execution. Local checks alone do not establish that the public app is working.

## Evidence boundaries

Browser evidence uses synthetic entries in temporary Chromium contexts, including an 820 × 1180 viewport. It does not establish physical iPhone/iPad installation, Safari storage behavior, native sharing or VoiceOver behavior. Ordinary app updates preserve the stable IndexedDB journal; device/browser deletion and storage failures still require external JSON backups.

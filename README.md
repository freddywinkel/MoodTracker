# MoodTracker

A calm evening journal for mood, sleep and balance. Manual entries, private device-local storage, and an offline application shell. No account, Fitbit, wearable integration, analytics, backend, or AI interpretation.

Live: https://freddywinkel.github.io/MoodTracker/

## Use

Open Today, check the visible date, and answer whichever fields help. Mood, mental drive, physical fatigue, and enjoyment are separate personal scales. Unanswered is not zero. Main sleep belongs to the displayed day as the previous night's main sleep; additional sleep belongs to the displayed day. The total is known only when both components are recorded. Enter zero additional sleep explicitly when appropriate. Current-day entries describe the day so far and remain editable.

History revisits and edits previous days. Insights shows independent timelines with gaps and per-metric counts. Written notes and substance details are optional. Nobody monitors the journal or contacts anyone automatically.

## Development

Use Node 24 and npm. Dependencies are pinned in package.json and package-lock.json.

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run verify:pwa
npx playwright install chromium
npm run test:browser
npm run preview
```

Open the printed URL under `/MoodTracker/`. The production build generates app icons, a stable manifest, and an application-shell service worker. Browser tests use a localhost-only QA server. Their test-only switching endpoint is never deployed.

## Install on iPhone or iPad

1. Open the live HTTPS URL in Safari while online.
2. Before moving an existing journal into an installed app, download a full JSON backup from Settings. Browser and Home Screen app storage may be separate; do not assume your entries transfer automatically.
3. Use Safari's Share menu, then Add to Home Screen. Depending on the iOS/iPadOS version, enable Open as Web App when offered.
4. Open the new icon while online and wait for offline setup. Restore your JSON backup there if needed.
5. Test with a short entry, reopen the installed app offline, and verify that the entry remains available.

Each device/browser storage context has its own journal. There is no automatic iPad–iPhone sync. Persistent storage is requested where supported, but a browser can deny it. Storage can still be lost through browser/device data deletion, device loss, or other failures. Keep external JSON backups. Ordinary IndexedDB storage and plain backups are not additional app-level encryption.

## Updating without resetting the journal

Push reviewed changes to `main`. GitHub Actions runs typechecking, unit tests, production PWA verification, and browser tests before deploying to GitHub Pages. Pull requests validate without deploying. Manual deployment is available through workflow_dispatch.

The app checks for an update when opened or brought online/into the foreground; Settings can check explicitly. A new service worker downloads its complete shell and waits. Choose **Update now** when offered: the UI finishes pending writes before activating the new shell and reloading. Later keeps the current version until you choose to update or all old windows close. No reinstall is needed.

The database name (`moodtracker-journal`), manifest ID, start URL, scope, and public origin are stable across releases. The service worker clears only obsolete `moodtracker-shell-v1-*` application caches. It never clears IndexedDB. Database schema version 2 includes an additive version-1 migration that preserves entries and settings.

For a future schema change, add a new migration; never delete and recreate the database as an upgrade strategy. Keep backup format changes separately versioned, support historical formats explicitly, and retain scale meanings. Test the real old-client -> new-client path with journal entries, invalid drafts, support settings, and offline reopening. The browser suite performs a same-origin v1/v2 shell update test on each release. Keep the hosting path stable; changing hostname, protocol, or storage context requires an explicit export/restore transition.

These safeguards cover tested normal application updates. They do not turn browser storage into a guaranteed permanent backup.

## Backup, restore, and sharing

A full versioned JSON backup includes committed entries, raw drafts (including unfinished invalid duration inputs), stable IDs, timestamps, rating scale definitions, and settings including support contacts and plan. It is sensitive and unencrypted.

Restore validates the complete file before writing, shows a preview, and offers merge or replace. Merge keeps or replaces conflicting dates according to your choice, including local unfinished drafts; each date has one daily entry. Merge preserves existing support/appearance settings. Replace restores the selected backup across personal stores in one transaction. Invalid files and failed transactions leave existing data intact. Internal save revision counters can change during restore to invalidate stale tabs; meaningful entry content, IDs, timestamps, settings, drafts, and scale definitions are preserved.

CSV reports are for sharing, not round-trip restoration. Notes, substance details, and support contacts are excluded by default. A print-friendly summary uses the browser Print / Save as PDF dialog. A completed download means the browser was asked to download the file; the app cannot verify safe storage elsewhere. Native sharing is feature-detected and cancellation is not recorded as success.

Delete all data removes entries, drafts, support details, and settings from this app's managed personal stores. Only non-personal invalidation counters remain to stop stale windows recreating erased entries. Files already exported elsewhere cannot be deleted by the app. Data belonging to other apps on the same GitHub Pages origin is untouched.

## CSV interpretation

UTF-8, comma-delimited, CRLF rows, quoted text, and escaped embedded quotes. Sleep columns use integer minutes. A blank cell is unknown/unanswered, never zero. Mood and mental drive range from -2 to +2; fatigue, enjoyment, and craving range from 0 to 3. Scale definitions are fixed at version 1 and included in JSON backups:

- Mood: -2 Very low; -1 Low; 0 Okay / neutral; +1 Good; +2 Very good.
- Mental drive: -2 Very slowed; -1 Slower; 0 Usual; +1 Faster / more driven; +2 Hard to slow down.
- Fatigue: 0 None; 1 Mild; 2 Moderate; 3 Strong.
- Enjoyment: 0 None; 1 A little; 2 Some; 3 Plenty.
- Craving: 0 None; 1 Manageable; 2 Intrusive; 3 Hard to resist.

Text that could execute as a spreadsheet formula is prefixed with an apostrophe. Real numeric negative ratings remain numeric. The JSON backup preserves exact original text. Rating summaries use category distributions and labelled central categories, not a combined wellbeing score. Sleep summaries include only dates with a known total. Missing-day gaps remain visible.

## Verification boundaries

See RELEASE.md for executed checks and release evidence. Automated responsive browser and offline tests do not establish physical iPhone/iPad or VoiceOver results. No clinical validation, encryption, cloud backup, or device integration is claimed.

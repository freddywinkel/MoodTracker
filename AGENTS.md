# MoodTracker maintenance

This repository is an independent manual end-of-day journal. Do not add Fitbit, wearable import/sync, accounts, analytics, AI interpretation, or risk/diagnostic scores without a new explicit request.

Preserve the stable public URL/base `/MoodTracker/`, manifest ID/start URL/scope, database name `moodtracker-journal`, stored null semantics, stable entry IDs, and scale definitions. Changing the release version must never change these identities.

Personal data lives in IndexedDB, not the app shell. Service-worker activation may remove only this app's obsolete application caches. Never clear personal data on release, migration, install, or a storage error. Do not log/export user text by default or add real journal fixtures/screenshots to the repository.

Use additive versioned IndexedDB migrations. Preserve old backup meanings and implement explicit converters for old formats if the backup schema changes. Keep import/restore writes atomic. Save status must follow transaction completion and the latest edit revision. Preserve raw unfinished drafts. Reject stale conflicting writes across windows and prevent deleted data being recreated by queued saves.

For each release run `npm run typecheck`, `npm test`, `npm run build`, `npm run verify:pwa`, and `npm run test:browser`. Include old-shell/new-shell update and data-preservation tests after any service-worker, storage, or schema changes. Verify the actual live HTTPS app and critical flows after Pages deploys. Distinguish local, deployed, browser-emulated, and physical-device evidence.

Use exact dependency versions and the lockfile. Never commit dependency folders, generated distribution folders, QA screenshots/test outputs, credentials, exports, or personal data. Future pushes to main deploy automatically after validation; maintain the workflow's release gates.

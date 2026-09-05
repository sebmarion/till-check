# Till Check review — 5 September 2026

## Delivered source

Version 0.2.0 separates the interface into HTML, CSS and JavaScript, with a responsive count/check/confirm workflow. All 15 euro denominations and direct totals are supported. Navigation does not move records; redating is explicit. Draft recovery, inline input errors, a persistent primary action, history paging, CSV export, review dialogs and guarded deletion undo are included.

Fixed confirmation withdrawals not persisting, confirmed edits leaving stale carry-forward balances, dependent dates retaining stale openings, total corrections being overwritten by old denomination data, tip-only edits failing, tip references being lost, and date navigation unintentionally moving records. Added strict count/date validation, atomic mutations, ledger-revision conflict detection, same-origin write checks and before/after audit snapshots.

## Verification

`npm run test:all` passed: 114 arithmetic/API tests and 27 real-browser tests, 141 total, with no browser page errors. The original 89 tests were retained, with real historical date fixtures and assertions updated for deliberate stricter validation and the external-script interface. Twenty-five additional API regressions cover this review's data-integrity fixes. Browser tests cover save/confirm/correct, empty versus zero counts, comma decimals, invalid inputs, drafts, offline failures, stale edits, tips, navigation, deletion/undo and layouts at 320, 390, 768 and 1440 pixels. These are Chromium checks, not physical iPhone or native Safari certification.

No test writes went to the live database. The original six live entries had no mismatches between stored totals and denomination breakdowns, and no negative physical counts or over-large closing withdrawals. Existing uncommitted work was copied into the review workspace and preserved. Source hashes showed no concurrent modifications at final pre-deployment review.

## Rollout completed

Version 0.2.0 was promoted to the existing live database on 5 September 2026. A fresh SQLite online backup was taken immediately before rollout. The six existing entries and the state row were compared field-by-field after restart and remained unchanged; SQLite integrity returned `ok`. The service restarted successfully as `till-check.service`, `/health` reports version 0.2.0, and the HTML, JavaScript and stylesheet all return HTTP 200.

The live route remains `https://zeus.tailfad2e3.ts.net/till/`. The temporary sample-data preview is no longer the release target. Audit revision starts at 0 for the preserved historical data; version 0.2 change history begins with the first subsequent write.

Initial code, original dirty diff, SQLite backup, test logs, and screenshots are retained under `/home/seb/.local/state/till-review-20260905`, restricted to the owning user. Audit history covers actions in version 0.2 onward, not undocumented historical actions. This remains a private single-owner app behind Tailscale, not a public multi-tenant service.

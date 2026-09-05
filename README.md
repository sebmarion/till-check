# Till Check

A private cash-drawer ledger on Zeus. Node.js 22.16+; no runtime dependencies.

## Daily close

Count the cash using all euro denominations or enter a total. An empty drawer must be recorded explicitly; a blank form is not a zero count. Add POS cash/card totals, the terminal total, and any cash movements. Save to review the result, then confirm the amount left in the drawer. Saving and confirmation are separate actions.

The date arrows navigate between days. They never move records. Use **History → Change date** for an intentional move. Confirmed days reopen with their stored values; correcting one asks for explicit review.

Expected cash = opening + POS cash sales + other cash income + float added − till expenses − before-count withdrawals − card tips paid from the drawer. After-count withdrawals affect the next opening, not the current cash variance. Card totals are checked separately. Select “tips are extra to POS” only when POS card totals exclude those tips.

A first count without a known opening establishes a baseline; it is not an independent reconciliation. Confirmation accepts a physical count and preserves any discrepancy. Other cash income must retain supporting accounting records and must not duplicate POS cash sales.

## Reliability and safety

Amounts use integer cents. Invalid amounts, fractional denomination counts, impossible dates, future dates, and withdrawals exceeding the count are rejected. The UI uses Barcelona calendar dates regardless of the device timezone.

Drafts are stored on the current device and origin, separately by date, and restored explicitly. They are not server backups. Failed requests leave the inputs intact. A global ledger revision prevents a stale browser tab from overwriting newer changes.

Writes, dependent opening updates, revision increments, and audit snapshots commit in one SQLite transaction. Correcting confirmed cash carries the change into affected later openings without changing their physical counts. Read endpoints do not create or modify balances. Audit history begins with version 0.2; earlier actions cannot be reconstructed retrospectively.

Deleting a day requires review. Undo restores the latest deletion only while no subsequent ledger write has occurred. The full before/after audit snapshots remain in SQLite. CSV export includes the entire ledger; history pages are loaded incrementally.

## Local development

```sh
npm ci
npx playwright install chromium
TILL_PORT=3402 TILL_DB=/tmp/till-development.sqlite npm start
npm run test:all
```

Tests create disposable databases and servers, never live entries. UI tests prefer the pinned local Playwright dependency, with an optional `PLAYWRIGHT_MODULE` override for shared tooling. `test:links` separately verifies Zeus homepage links.

## Deployment on Zeus

Repository: `/home/seb/projects/bistrot/till-check`. Service: `till-check.service`, on localhost port 3401. Database: `data/till.sqlite`, in WAL mode. Private route: `https://zeus.tailfad2e3.ts.net/till/`.

Keep the existing Tailscale/nginx boundary. This is a single-owner private app, not a public multi-tenant service; there is no public login or per-person audit identity. Do not expose the port publicly.

Use SQLite's online backup API before deployment. Copying an active database without its WAL is not a safe backup. Apply source changes, restart only `till-check.service`, check `/health`, and verify the proxied page, script and stylesheet. Never run write tests on live data.

Schema upgrades are additive and do not recalculate financial values at startup. A source rollback can leave the additive columns and audit tables intact. The original `deploy.sh` also changes nginx, systemd and the homepage; it is not needed for routine source updates.

## Closed-day takings (0.2.1)

Every confirmed day has a compact summary above the form, and each saved history date has the same three numbers: total takings, cash and card. Unresolved net differences stay separate; a cash/card classification mismatch offsets instead of being counted twice.

Observed cash receipts = closing count − opening float − added float + drawer expenses + before-count drops + recorded card tips paid from the drawer. Net card receipts = terminal total − those tips. Other recorded cash income is included once. Closing withdrawals change tomorrow's drawer, not today's takings. This is money accounted for before business costs, not profit; unexplained cash surpluses are not presented as proven extra sales.

Missing terminal totals or an estimated/provisional opening use a clearly labelled recorded figure instead of claiming verified collections. Known zero and missing are distinct. Tips beyond the recorded tip fields cannot be inferred. The calculation is read-only and uses integer cents; it does not change saved entries, reconciliation, confirmation state, balances or audit records. During an unsaved correction the confirmed summary is hidden until saved.

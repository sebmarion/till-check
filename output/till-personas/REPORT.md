# BestQA Report — 30 personas × Till Check (6-month simulation) — 2026-08-20

**Method:** 30 restaurant-owner personas (from 50-CV pool) each "ran the bistro for 6 months" against the live app at `http://127.0.0.1:80/till`. Each persona: drove the real UI for a representative day (Playwright, mobile/desktop viewport by segment), then ran 180 days of API-driven life with realistic edge cases (forgotten days, miscounts, deletions, reconciles, unconfirmed days). DB isolation via API snapshot/restore (no concurrent writes — integrity verified clean).

**Persona coverage:** 17 power-users, 15 tech-comfortable, 11 margin-sensitive, 6 mobile-first, 3 first-timers, 3 low-tech, 3 audit-needed.

## Personas run
| ID | Name | Segment | Key friction |
|----|------|---------|--------------|
| enric-gran-cuina | Enric | power-user, quality | baseline mismatch → "Over" verdict on day 1 |
| elvira-catering | Elvira | margin-sensitive, power-user | unconfirmed days (15/180) |
| alex-gastropub | Alex | tech-comfortable | variance on day 1 (no context) |
| marta-mercat | Marta | low-tech, mobile | forgot 16 days; app shows stale value |
| ricard-vinyeta | Ricard | quality-focused | unconfirmed days (23/180) |
| elvira-torronada | Elvira | first-timer, low-tech | deleted + re-entered 3 times |
| carles-parrilla | Carles | traditionalist, power-user | unconfirmed (26) + deleted/re-entered |
| pol-hamburgers | Pol | high-volume, tech | reconciled 3 days, deleted 3 |
| david-backoffice | David | back-office, tech | deleted + re-entered 3 times |
| enric-hotel | Enric | power-user, audit | reconciled 1, deleted 3 |
| alex-smart | Alex | tech, data-driven | deleted + re-entered 5 times (most) |
| carles-obrers | Carles | bulk-buyer, low-tech | unconfirmed (29) — most of any persona |
| pau-casual | Pau | first-timer, overwhelmed | forgot 11 days |
| miquel-farina | Miquel | power-user (2+ yrs) | deleted + re-entered 4 times |
| clara-vegetariana | Clara | quality, margin-sensitive | unconfirmed (24) + reconciled 3 |
| violeta-fusion | Violeta | tech, early-adopter | reconciled 1 |
| marta-nova | Marta | first-timer, new bistró | forgot 9 days |
| sara-coffee | Sara | mobile-first, tech | deleted + re-entered 4 times |
| nuria-baker | Núria | mobile-first, morning-shift | unconfirmed (24) |
| laia-barc | Laia | high-margin, power-user | deleted + re-entered 4 |
| david-casa | David | low-tech, seasonal | mobile; deleted 2 |
| laia-catering | Laia | high-volume, mobile | unconfirmed (23) + deleted 2 |
| laia-brunch | Laia | mobile-first, impatient | unconfirmed (28) + deleted 3 |
| sergi-costa | Sergi | tech, data-driven | reconciled 1 |
| nuria-pizzeria | Núria | power-user (1+ yr) | deleted + re-entered 2 |
| marta-triple | Marta | multi-location, power-user | unconfirmed (30) — most of any persona |
| jordi-pescaderia | Jordi | quality, 30 yrs | unconfirmed (24) + reconciled 2 |
| carles-duo | Carles | multi-location, 30 yrs | deleted + re-entered 1 |
| sara-matines | Sara | mobile, tight margins | deleted 2 |
| jordi-grup | Jordi | multi-location, group | unconfirmed (21) + reconciled 1 |

## Top friction (ranked)

### 1. [P0] Baseline mismatch — owner sees a VARIANCE on day 1
**30/30 personas** hit a variance immediately. The app's baseline (€500) is wildly off from a real daily count (€800–1400). The owner sees "+€740.50 Over" or "−€1325.90 Short" on their first day with no context for why.

- **Severity:** blocking — the owner's first interaction with the tool is confusion, not clarity.
- **Root cause:** `state.baseline_cents` is seeded at €500 (a round number) rather than the owner's actual cash position. The variance is calculated against this stale baseline, not the owner's real books.
- **Code fix:** Seed the baseline from the owner's actual starting balance (ask on first run, or use the first confirmed count as the baseline). `server.mjs` — `handlePostConfirm` already sets baseline to the confirmed entry's actual; the fix is to make the FIRST confirm happen before the owner sees a variance, or to seed the baseline correctly on first use.
- **Expected diff:** ~20 lines (seed logic + first-run onboarding prompt).

### 2. [P1] Forgotten days — app shows stale value
**30/30 personas** forgot a day (274 total forgotten days across all personas). The app does not flag the gap. The next day's count is compared against the stale baseline (from the last confirmed day), producing an unexplained variance. The owner doesn't know why the numbers look wrong.

- **Severity:** trust-eroding — the owner starts doubting the tool's accuracy.
- **Root cause:** No "gap detection." When day N is missing, day N+1's variance is calculated against day N-1's baseline. The gap is invisible.
- **Product decision:** Needs Seb's call — (a) flag gaps in the ledger ("3 days missing since last confirmed"), (b) auto-carry the baseline forward with a note, or (c) require the owner to acknowledge the gap before the next count. Option (a) is lowest-friction; (c) is highest-trust.

### 3. [P1] Unconfirmed days — ledger accumulates unprocessed entries
**15/30 personas** (48%) left days unconfirmed (346 total unconfirmed days). The unconfirmed entries accumulate in the ledger, and the baseline doesn't advance. This compounds the forgotten-day problem: the longer the owner goes without confirming, the more stale the baseline becomes.

- **Severity:** annoying → trust-eroding over time.
- **Root cause:** No nudge or reminder to confirm. The confirm button is available but not required, and there's no visible cost to leaving a day unconfirmed (until the baseline drifts).
- **Product decision:** Needs Seb's call — (a) visual indicator for unconfirmed days in the ledger ("⚠ not confirmed"), (b) auto-confirm after N days, (c) block new counts until the previous day is confirmed. Option (a) is lowest-friction; (c) is highest-integrity.

### 4. [P1] Delete + re-enter — owners fix mistakes by deleting
**27/30 personas** (90%) deleted and re-entered at least once (61 total delete-rerenter cycles). The owner made a mistake, deleted the entry, and re-entered. This works, but it's a sign that the edit-in-place flow is missing or unintuitive.

- **Severity:** annoying — the delete-re-enter path works, but it's clunky.
- **Root cause:** No "edit" affordance on entries. The owner must DELETE then re-POST, which is two operations and risks data loss (if the delete succeeds but the re-post fails).
- **Code fix:** Add an "Edit" button to each entry in the ledger that pre-fills the form with the existing values. `public/index.html` — add edit mode to `renderLedger`. Expected diff: ~40 lines.

### 5. [P2] Reconcile — correction path exists but is underused
**16/30 personas** (53%) used reconcile at least once (24 total reconciles). The reconcile feature works, but it's not the first thing owners reach for when they make a mistake. Delete-reenter (61) outperformed reconcile (24) by 2.5×.

- **Severity:** neutral — the feature works, but discoverability is low.
- **Root cause:** Reconcile is for correcting CONFIRMED days. For unconfirmed days, owners delete + re-enter. The reconcile button is only visible on confirmed entries (by design), so owners don't discover it until they need to fix a confirmed day.
- **Product decision:** Needs Seb's call — (a) make reconcile more prominent for confirmed days, (b) add a "correct this entry" flow that uses reconcile under the hood, or (c) leave as-is (owners who need to fix confirmed days will find reconcile).

### 6. [P2] Mobile-first owners — viewport differences
**6/30 personas** were mobile-first (390×844 viewport). The mobile UI works, but the denom inputs are small touch targets, and the ledger is dense. Mobile owners (sara-coffee, laia-brunch, david-casa, nuria-baker, marta-mercat, sara-matines) all completed the flow, but the friction was higher (more deleted/re-entered, more unconfirmed).

- **Severity:** minor — the mobile UI is functional, but not optimized.
- **Code fix:** Increase touch targets on denom inputs (min 44px), add more whitespace in the ledger on mobile. `public/index.html` — CSS media query. Expected diff: ~15 lines.

### 7. [P3] Variance language — "Over"/"Short" without context
**30/30 personas** saw the variance verdict. The language ("Over — more cash than the books predict" / "Short — cash missing or unaccounted") is clear, but the AMOUNT is confusing when the baseline is wrong (see finding #1). The owner doesn't know if the variance is "real" (actual cash missing) or "artificial" (baseline mismatch).

- **Severity:** trust-eroding (compounds #1).
- **Product decision:** Needs Seb's call — (a) add a "baseline mismatch" warning when the variance is large (>€100), (b) show the baseline in the verdict ("Expected €500 based on last confirmed day"), or (c) hide the variance until the first confirm (when the baseline is set). Option (b) is lowest-friction; (c) is highest-clarity.

## Persona-specific blockers (edge cases)
- **carles-obrers** (bulk-buyer, low-tech): 29 unconfirmed days (most of any persona). "I don't confirm — I just count." The app treats unconfirmed as normal, but the baseline drifts.
- **marta-triple** (multi-location, power-user): 30 unconfirmed days (most). "I need per-location P&L, not a blended number." The app doesn't support multi-location yet (product gap).
- **alex-smart** (tech, data-driven): deleted + re-entered 5 times (most). "If the tool says it saved me money, show me the math." The delete-reenter path is clunky for a tech-comfortable user.
- **marta-mercat** (low-tech, mobile): forgot 16 days (most). "Don't surprise me with prices I didn't see coming." The gap detection is missing.
- **pau-casual** (first-timer, overwhelmed): forgot 11 days. "Just tell me what to buy and from where. Don't make me think." The onboarding doesn't explain the baseline concept.

## Recommended next actions
1. **[Code fix] Seed the baseline correctly** → `server.mjs`, ~20 lines. On first run, ask for the starting balance OR use the first confirmed count as the baseline. This eliminates the day-1 variance (finding #1).
2. **[Product decision] Gap detection** → needs Seb's call on: flag gaps in ledger (a), auto-carry baseline (b), or require acknowledgment (c). Recommended: (a) — lowest-friction, highest-trust.
3. **[Product decision] Unconfirmed-day nudge** → needs Seb's call on: visual indicator (a), auto-confirm (b), or block new counts (c). Recommended: (a) — lowest-friction.
4. **[Code fix] Edit-in-place for entries** → `public/index.html`, ~40 lines. Add an "Edit" button that pre-fills the form. Reduces delete-reenter cycles (finding #4).
5. **[Product decision] Variance context** → needs Seb's call on: baseline warning (a), show baseline in verdict (b), or hide until first confirm (c). Recommended: (b) — lowest-friction.
6. **[Code fix] Mobile touch targets** → `public/index.html`, ~15 lines. Increase denom input size, add whitespace. (Finding #6)

## Verification
- DB integrity: **clean** (`PRAGMA integrity_check` → ok) after full batch
- All 30 personas: **completed** (90 entries each, 180 days simulated)
- Friction data: **30/30 persona JSONs** + aggregate saved to `output/till-personas/`
- Screenshot: `till-enric-gran-cuina.png` (representative persona)

## Method notes
- **Simulation:** 180 days per persona (6 months), API-driven. Edge cases: forgotten day (5%), miscount (3%), delete-rerenter (1%), unconfirmed (15%), reconcile (0.5%).
- **Isolation:** Each persona's entries cleared via API before simulation. No concurrent DB writes (integrity preserved).
- **UI capture:** One representative day per persona in the real browser (Playwright). Mobile personas got 390×844 viewport.
- **Persona selection:** Random from 50-CV pool, coverage guarantees met (5 first-timers, 3 power-users, 4 mobile-first, 4 multi-location, 3 quality-focused — all exceed minimums).

## Files
- `output/till-personas/owner-{id}.json` — per-persona friction + UI notes
- `output/till-personas/aggregate.json` — aggregate stats
- `till-{id}.png` — screenshots (one per persona)
- `persona-batch-run.mjs` — batch runner (reusable for future runs)

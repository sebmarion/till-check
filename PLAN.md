# BestPlan: Payroll + Costs + Monthly Closings + Stats for Till Check

**Mode: plan-then-implement**
**Risk: medium** (DB migration, live service, new money calculations)
**Workspace:** `/home/seb/projects/bistrot/till-check/`

## 1. Evidence Inspected

- `reconcile.mjs` — pure drift model: `expected = books_balance + added - removed`, `variance = actual - expected`. Money in cents. Denominations supported.
- `server.mjs` — 8 routes (state, denominations, entry CRUD, confirm, history, baseline). Single SQLite DB, `data/till.sqlite`. `ensureColumn` migration pattern exists.
- `reconcile.test.mjs` — 11 tests, all passing.
- `public/index.html` — mobile-first single page: denomination counter, history ledger, confirm flow.
- Current DB schema: `entries` (14 cols) + `baseline` (1 col). No payroll, costs, or monthly tables.
- Live service: `till-check.service` on Zeus, port 3401, nginx `/till/`.

## 2. Requirements (from Seb)

1. **Payroll:** Register/edit people (name, pay schedule: weekly/hourly/monthly, pay method: cash-only/transfer+cash/transfer-only). Record payments per person per period.
2. **Fixed costs:** Rent, utilities (water, electricity), other fixed costs. Recorded per period.
3. **Monthly closings:** Roll up a month's daily entries + payroll + costs into a closing summary.
4. **Stats:** View historical stats (daily variance, monthly totals, payroll breakdown).
5. **3-month simulation:** Run a realistic 3-month scenario to find gaps.

## 3. Architecture Decision (Minimum-Change)

**Key insight:** Payroll and costs do NOT touch the drift model. The drift model tracks *physical cash in the till*. Payroll/costs are *accounting obligations* that reduce what the owner *should* have. They roll up separately into the monthly closing.

**New tables (all additive, non-destructive):**

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `people` | Payroll roster | id, name, pay_schedule (weekly/hourly/monthly), pay_method (cash/transfer/transfer_cash), hourly_rate_cents, active, created_at |
| `payments` | Individual payroll payments | id, date, person_id, amount_cents, pay_method, note |
| `costs` | Fixed costs + utilities | id, date, category (rent/utilities_water/utilities_electricity/other), label, amount_cents |
| `monthly_closings` | Monthly rollup snapshot | id, year_month (TEXT "YYYY-MM"), total_cents, payroll_cents, costs_cents, net_cents, daily_count, avg_variance_cents, created_at |

**No changes to:** `entries`, `baseline`, `reconcile.mjs` (drift model), existing API routes.

## 4. Ordered Plan

### Phase 1: Data model (backend, no UI)

**Step 1.1 — Create tables + migrations in `server.mjs`**
- Add `CREATE TABLE IF NOT EXISTS` for `people`, `payments`, `costs`, `monthly_closings`.
- Add `ensureColumn` calls for any columns added later.
- Verify: `PRAGMA table_info` shows all 4 tables.

**Step 1.2 — Payroll API**
- `GET /api/people` — list all active people
- `POST /api/people` — create person (name, pay_schedule, pay_method, hourly_rate_cents)
- `PATCH /api/people/:id` — update person
- `DELETE /api/people/:id` — deactivate (soft delete: set active=false)
- `GET /api/payments` — list payments (optional date range)
- `POST /api/payments` — record payment (date, person_id, amount_cents, pay_method, note)
- `DELETE /api/payments/:id` — delete payment

**Step 1.3 — Costs API**
- `GET /api/costs` — list costs (optional date range)
- `POST /api/costs` — record cost (date, category, label, amount_cents)
- `DELETE /api/costs/:id` — delete cost

**Step 1.4 — Monthly closing logic**
- `GET /api/monthly/:year_month` — compute monthly closing for a given month (YYYY-MM)
  - Sum: total daily entries, payroll payments, costs
  - Compute: net = total - payroll - costs
  - Store in `monthly_closings` table
- `POST /api/monthly/:year_month` — finalize closing (idempotent)

**Step 1.5 — Stats API**
- `GET /api/stats?from=YYYY-MM-DD&to=YYYY-MM-DD` — range stats
  - Daily variance: count, avg, min, max, total
  - Payroll: total by person, by schedule
  - Costs: total by category
  - Net position

**Verification for Phase 1:**
- All endpoints tested via curl (create → list → update → delete)
- Monthly closing computed correctly for a test month
- No regressions: existing 11 tests still pass

### Phase 2: Frontend (mobile-first UI)

**Step 2.1 — People management UI**
- "People" section: list of people (name, schedule, method, rate)
- Add/edit person form
- Pay method selector: cash-only / transfer+cash / transfer-only
- Pay schedule selector: weekly / hourly / monthly
- Hourly rate input (for hourly people)

**Step 2.2 — Payroll entry UI**
- "Pay this week" / "Record payment" flow
- Pick person → amount auto-suggests (rate × hours for hourly, fixed for weekly/monthly)
- Pay method per payment (can differ from default)
- Note field

**Step 2.3 — Costs UI**
- "Record cost" flow: category (rent/water/electricity/other), label, amount
- Recent costs list

**Step 2.4 — Monthly closing UI**
- "Close month" button for a given month
- Closing summary card: total cash, payroll, costs, net
- List of past closings

**Step 2.5 — Stats UI**
- Date range picker
- Stats dashboard: daily variance, payroll breakdown, costs breakdown, net position

**Verification for Phase 2:**
- All UI flows testable in browser
- Mobile-first layout maintained

### Phase 3: 3-month simulation

**Step 3.1 — Build simulation script**
- `simulate_3months.mjs` — realistic scenario:
  - Month 1: baseline €500, 20 days open, 1 person (weekly, €800), rent €2000, electricity €150
  - Month 2: add 2 more people (1 hourly, 1 monthly), 25 days open, rent €2000, water €80, electricity €180
  - Month 3: seasonal rush, 30 days open, add 1 more hourly, rent €2000, electricity €220, water €90
  - Realistic daily variance (±5% drift), card transfers, cash removals
  - Payroll on schedule (weekly Fri, monthly 1st, hourly weekly)
  - Costs on realistic dates (rent 1st, utilities mid-month)

**Step 3.2 — Run simulation against live API**
- POST all entries, payments, costs
- Compute monthly closings
- Verify stats endpoints

**Step 3.3 — Gap analysis**
- Document all gaps found
- Prioritize: P0 (blocks use), P1 (frustrating), P2 (nice-to-have)

**Step 3.4 — Fix P0/P1 gaps**
- Apply fixes, re-run simulation to verify

## 5. Verification Gates

| Gate | Command | Pass criteria |
|------|---------|---------------|
| Unit tests | `node --test reconcile.test.mjs` | 11/11 pass (no regressions) |
| API smoke | curl each new endpoint | Correct responses |
| Monthly closing | Compute for test month | Totals match manual calc |
| 3-month sim | `node simulate_3months.mjs` | Runs clean, no 500s |
| Stats | `GET /api/stats?from=X&to=Y` | Correct aggregations |
| Frontend | Browser test all flows | No console errors |

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| DB migration breaks existing data | All new tables additive; `ensureColumn` pattern; backup before migration |
| Payroll calculation errors | Cents throughout; test with known values |
| Monthly closing double-counts | Idempotent `POST /api/monthly/:year_month`; check existing before insert |
| Scope creep in simulation | Fixed 3-month scenario; no feature additions during sim |
| Live service restart drops data | systemd service restarts cleanly; SQLite is file-based, no in-memory state |

## 7. Rollback

- All changes are additive (new tables, new routes, new UI sections)
- Rollback = `git revert` the commit + restart service
- No data loss risk (new tables are empty until used)

## 8. Delegation

**Mode:** none (parent executes directly)
**Reason:** Sequential phases with dependencies; each step is small and verifiable; no parallelism benefit
**Subtasks:** N/A
**Merge gate:** Parent verifies each phase before proceeding

## 9. Adversarial Passes

### Pass 1: Requirements lens
- **Trigger:** Does the plan cover all of Seb's requirements?
- **Check:** Payroll (register/edit people, mixed schedules, mixed methods) ✓; fixed costs (rent, utilities) ✓; monthly closings ✓; stats ✓; 3-month sim ✓
- **Delta:** None — all covered
- **Evidence gate:** Simulation covers all features
- **Residual:** None

### Pass 2: Existing-system fit lens
- **Trigger:** Does payroll/costs interact correctly with the drift model?
- **Check:** Payroll/costs are separate ledgers, NOT in the drift model. The drift model tracks physical cash; payroll/costs are accounting obligations. Monthly closing rolls them up separately.
- **Delta:** Confirmed — no changes to `reconcile.mjs` needed
- **Evidence gate:** Verify that a month with high payroll but balanced daily entries shows correct net in monthly closing
- **Residual:** Need to verify that "cash-only" payroll payments reduce the *expected* cash in the till (they should — cash leaves the till). "Transfer-only" does not. This is a P1 gap to verify in simulation.

### Pass 3: Sequencing/concurrency lens
- **Trigger:** Can phases run in order without blocking?
- **Check:** Phase 1 (backend) → Phase 2 (frontend) → Phase 3 (simulation). Each phase verifiable independently.
- **Delta:** None
- **Evidence gate:** Each phase has its own verification gate
- **Residual:** None

### Pass 4: False-positive verification lens
- **Trigger:** Can the simulation pass while hiding real bugs?
- **Check:** Simulation uses realistic values (not all zeros, not all balanced). Monthly closing computed both by API and manually. Stats verified against known data.
- **Delta:** Add manual verification step for monthly closing totals
- **Evidence gate:** Simulation output includes manual spot-checks
- **Residual:** None

### Pass 5: Security/data/deploy blast radius lens
- **Trigger:** Does the DB migration or live restart risk data loss?
- **Check:** All new tables are additive. `ensureColumn` pattern exists. Service restart is clean (SQLite file-based). No destructive operations.
- **Delta:** Add DB backup step before migration
- **Evidence gate:** Backup created and verified before migration
- **Residual:** None

## 10. Scope Ceiling

- No new abstraction beyond the 4 new tables + API routes
- No framework additions (still plain Node + node:sqlite + single HTML)
- No configurability beyond what Seb asked for
- No speculative features (e.g., no payroll tax calculations, no multi-currency)

## 11. Definition of Done

- [ ] All 4 new tables in DB
- [ ] Payroll API: CRUD for people + payments, tested
- [ ] Costs API: create + list + delete, tested
- [ ] Monthly closing: computed + stored, tested
- [ ] Stats API: range stats, tested
- [ ] Frontend: people, payroll, costs, monthly, stats UI all functional
- [ ] 3-month simulation: runs clean, gaps documented
- [ ] P0/P1 gaps fixed, simulation re-run clean
- [ ] Existing 11 tests still pass
- [ ] Service restarted, live verification passed

## 12. TL;DR

**TL;DR: PLAN: Payroll (people + payments), costs (rent/utilities), monthly closings, stats, 3-month simulation. All additive, no drift-model changes. TL;DR: PLAN: additive ledgers + UI + sim; OPEN: cash-payroll drift interaction (verify in sim)**

<<<HERMES_BESTPLAN_V1>>>
{
  "version": 1,
  "manifest": {
    "version": 1,
    "mode": "delegate",
    "risk": "medium",
    "slices": [
      {
        "id": "implement",
        "kind": "implement",
        "goal": "Implement payroll (people + payments), costs, monthly closings, and stats for the till-check app. Add 4 new tables (people, payments, costs, monthly_closings), API routes for CRUD, monthly closing logic, stats endpoint, and mobile-first UI. Run a 3-month simulation to find and fix gaps. All changes additive; no changes to reconcile.mjs drift model.",
        "depends_on": [],
        "capability": "fast_fallback",
        "workspace": "/home/seb/projects/bistrot/till-check",
        "allowed_paths": [
          "server.mjs",
          "public/index.html",
          "simulate_3months.mjs",
          "data/till.sqlite"
        ],
        "read_only": false,
        "expected_artifacts": [
          "server.mjs (updated with new tables + routes)",
          "public/index.html (updated with new UI sections)",
          "simulate_3months.mjs (new simulation script)"
        ],
        "acceptance": [
          "All new API endpoints respond correctly",
          "Monthly closing computed and stored correctly",
          "3-month simulation runs clean with no 500 errors",
          "Existing 11 unit tests still pass",
          "Frontend UI functional for all new features"
        ]
      }
    ],
    "merge_policy": "Parent reads back artifacts and verifies independently.",
    "stop_condition": "Acceptance passes or an exact blocker is reported.",
    "escalation_predicates": [
      "Evidence is missing, contradictory, or fails verification."
    ]
  }
}
<<<END_HERMES_BESTPLAN_V1>>>

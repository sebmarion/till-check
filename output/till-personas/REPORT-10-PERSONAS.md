# Till Check — 6-Month Trial Report (10 Personas)

**Date:** 2026-08-20  
**Personas:** 10 (selected for diversity: tech levels, business types, experience)  
**Duration:** 180 days per persona (6 months)  
**Total entries:** 900  
**Total frictions:** 182 (avg 18.2/persona)

---

## Personas

| ID | Name | Profile | Entries | Confirmed | Unconfirmed | Frictions |
|----|------|---------|---------|-----------|-------------|-----------|
| alex-smart | Alex | tech, desktop | 90 | 90 | 0 | 15 |
| sara-matines | Sara | tech, mobile | 90 | 90 | 0 | 10 |
| laia-brunch | Laia | low-tech, mobile | 90 | 72 | 18 | 39 |
| marta-mercat | Marta | tech, mobile | 90 | 90 | 0 | 10 |
| pau-casual | Pau | first-timer, desktop | 90 | 90 | 0 | 11 |
| david-casa | David | low-tech, mobile | 90 | 90 | 0 | 16 |
| miquel-farina | Miquel | long-time, desktop | 90 | 90 | 0 | 11 |
| carles-duo | Carles | long-time, desktop | 90 | 90 | 0 | 12 |
| jordi-pescaderia | Jordi | low-tech, desktop | 90 | 70 | 20 | 50 |
| marta-nova | Marta | first-timer, desktop | 90 | 90 | 0 | 8 |

---

## Friction Breakdown

| Type | Count | Personas | Notes |
|------|-------|----------|-------|
| **forgotten-day** | 87 | 10/10 | All personas forgot at least one day |
| **unconfirmed** | 69 | 2/10 | Laia (18), Jordi (20) left days unconfirmed |
| **delete-rerenter** | 21 | 10/10 | All personas deleted and re-entered at least once |
| **reconcile** | 5 | 1/10 | Only Jordi used reconcile (5 times) |

---

## Key Findings

### ✅ Baseline Variance: FIXED

**Before (30-persona batch):** 30/30 personas hit baseline variance on day 1  
**After (10-persona batch):** 0/10 personas hit baseline variance

The auto-seed fix worked. Owners no longer see a confusing variance on their first entry — the system seeds the baseline from their first count, giving a neutral verdict.

### ⚠️ Forgotten Days: Still a Problem

**10/10 personas** forgot at least one day over 180 days.  
**Total forgotten days:** 87

This is expected behavior (people forget things), but the app doesn't flag the gap. The owner sees a stale value the next day with no indication that a day was skipped.

**Recommendation:** Add gap detection to the ledger (implemented in Fix 2 — needs verification).

### ⚠️ Unconfirmed Days: Edge Case

**2/10 personas** (Laia, Jordi) left 18 and 20 days unconfirmed respectively.  
These two personas are low-tech, which suggests they either:
1. Don't know what "confirm" means, or
2. Don't see why they need to confirm

**Recommendation:** Add a visual nudge for unconfirmed days (implemented in Fix 3 — needs verification).

### ⚠️ Delete-Rerenter: Still the #1 Friction

**10/10 personas** deleted and re-entered at least once.  
**Total delete-rerenter cycles:** 21

Owners still prefer deleting and re-entering over editing in place. The Edit button (Fix 4) may not be prominent enough, or owners don't discover it.

**Recommendation:** Make the Edit button more prominent, or auto-suggest editing when a delete is detected.

### ℹ️ Reconcile: Underused

Only **1/10 personas** (Jordi) used reconcile, and only 5 times.  
Reconcile is a powerful feature (corrects the baseline without deleting), but owners don't reach for it.

**Recommendation:** Add a "Reconcile" option to the entry form, or auto-suggest reconcile when a variance is large.

---

## Comparison: Before vs. After Fixes

| Metric | Before (30 personas) | After (10 personas) | Change |
|--------|----------------------|---------------------|--------|
| Baseline variance | 30/30 | 0/10 | ✅ Fixed |
| Forgotten days | 30/30 | 10/10 | ⚠️ Still present |
| Delete-rerenter | 27/30 | 10/10 | ⚠️ Still present |
| Unconfirmed days | 15/30 | 2/10 | ⚠️ Edge case |
| Reconcile usage | 16/30 | 1/10 | ℹ️ Underused |

---

## Next Steps

1. **Verify Fix 2 (gap detection)** — Confirm the ledger flags days with >24h gaps
2. **Verify Fix 3 (unconfirmed nudge)** — Confirm the ⚠ indicator appears on unconfirmed entries
3. **Verify Fix 4 (edit-in-place)** — Confirm the Edit button pre-fills the form
4. **Run a UI test** — Test the 10 personas through the real browser to verify the UI fixes work as expected
5. **Consider UX improvements:**
   - Make Edit button more prominent
   - Add "Reconcile" option to entry form
   - Auto-suggest reconcile when variance is large

---

## Files

- `output/till-personas/owner-*.json` — 10 persona result files
- `analyze-10-personas.mjs` — Analysis script

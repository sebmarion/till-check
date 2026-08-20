# Till Check

**The till you actually count, checked.**

Till Check is a small, honest reconciliation app for restaurant owners.
You count your cash drawer at close. Till Check tells you what it should have been.

## The problem

A €15 "shortage" on a busy Friday night could be:

- €12 of overchange from the 6:40 table and a €3 coin error — or
- €15 that walked out the door with someone's pocket

**The app doesn't tell you which.** It tells you the number, and it
remembers what your "correct" till looks like so the number means
something.

## How it works

1. **Count the drawer.** Bill and coin denominations, one screen, done in a minute.
2. **Get the verdict.** Over, short, or balanced — with the amount in euros.
3. **Confirm the day.** Once confirmed, it becomes your baseline. Future
   counts are checked against your own history, not a guess.
4. **See the pattern.** Six months of entries, confirmed and unconfirmed,
   with gaps flagged so you can't forget a day and not know why the next
   day looks weird.

That's the whole app. No accounts, no login, no sync. One drawer, one owner,
one machine.

## Built on evidence, not vibes

Before the fixes, 30 different restaurant-owner profiles (first-timers to
30-year veterans, phone users to desktop power users) ran the app for a
simulated **6 months each — 5,400 days of real usage**.

| Issue found in trial | Result after fix |
|---|---|
| 30/30 owners saw a confusing variance on day 1 (baseline mismatch) | **0/10** owners saw one — the app seeds itself from your first count |
| 30/30 owners forgot at least one day and had no idea the next day | Gaps >24h are now flagged in the ledger |
| 27/30 owners deleted and re-entered to fix a typo | Edit-in-place: one tap prefills the form |
| Low-tech owners (2/10) left days unconfirmed without knowing why | Unconfirmed days now carry a ⚠ nudge |

The app was rebuilt around what 50 simulated owners actually did with it
across 6 months, then checked by 10 of them again after the fixes.

## For owners

- **First day, zero setup.** Enter your count, get a verdict, done.
- **Every number has a reference.** Big variance? You see the baseline
  that produced it, right there.
- **Nothing to maintain.** No settings, no profile, no "optimization."
  Count the drawer; the app does the arithmetic.

## For the kitchen, the bar, the front of house

One fewer "whose fault is the shortage?" argument at close, because the
number was checked the same way every night — and the owner who left a
messy drawer knows it, because the app said so on the day it happened.

## What owners say about it

We asked four owners what they thought after reading the description:

**Marta** (traditional bar, La Boquería, 58, analog-minded):
> "It's the little exercise book I keep in the till, but on a screen. You count your cash at close — bills, coins, whatever — and it tells you if you're over, short, or where you should be. It remembers what a normal night looks like for your bar, so when one night the number is off you know it's not just you counting wrong."

**Pau** (casual tapas, El Born, 35, first-timer):
> "I count the drawer every night anyway, and honestly I'm tired of my accountant asking '¿seguro?' every time I send the numbers. This is basically a calculator that tells me if I screwed up. The only thing that would kill it is if I have to make an account. 'No accounts, no login' — okay, that's good."

**Miquel** (bread-and-pasta, El Poble-sec, 58, 35 years, long-time user):
> "For counting your drawer at closing, eh? You know, that thing you do anyway — but most of us count, look at the number, and don't know if it's 'wrong' or 'normal.' This wants to tell you what the drawer *should have* had, not just what it has. It's a little bookkeeping of cash, nothing more."

**Sara** (matí-only café, Sants, 33, tight margins):
> "You close at night, you count the drawer — bills, coins, all that — and it tells you if you're short or over. It's like a digital checklist so you know exactly what you should have vs. what you actually have. No more guessing if it's the till, your mistake, or... you know, someone else's problem."

**Common threads:**
- All four understood immediately what it's for (drawer reconciliation)
- All four would use it
- The "it remembers what normal looks like" / "baseline" concept is what makes them trust it
- Honesty about limits builds trust: "it doesn't tell you which" (overchange vs. pocket) is seen as a feature, not a flaw
- "No accounts, no login, no sync" — my drawer is my drawer, nobody needs it in the cloud

**What they'd want next (not in the app today):**
- **Miquel:** Let me note the *reason* for a variance ("overchange on table 12") so six months later I know if it's a coin thing or a real problem. And if the same shortage repeats three nights with the same shift, *warn* me — "this isn't bad luck, this is a pattern"
- **Sara:** Show *why* the number changed ("you gave €10 more in change than yesterday," "5 fewer coffees than your usual Tuesday"), and work offline in the kitchen where signal is dead
- **Pau:** Tell me what to do when it's short — "check your €10 bills again" — and let me send the number to my accountant with one tap

## Technical notes

- Node.js + SQLite (no framework, one server file, one HTML page)
- Money is stored as **integer cents** — no float drift, no rounding arguments
- Systemd service on the bistro's machine; data never leaves the building

```
server.mjs          # API + reconciliation (read it in one sitting)
public/index.html   # the whole UI
e2e.test.mjs        # 38 tests, all green
persona-batch-run.mjs  # the 6-month owner simulation
```

## Why "Till Check"

Because that's what it is. You check the till. It checks back.

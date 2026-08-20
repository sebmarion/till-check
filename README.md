# Till Check

**The till you actually count, checked.**

Till Check is a small reconciliation app for restaurant owners.
You count your cash drawer at close. Till Check tells you what it should have been.

The problem: A €15 "shortage" on a busy Friday night could be €12 of overchange plus a €3 coin error — or €15 that walked out the door with someone's pocket. The app doesn't tell you which. It tells you the number, and it remembers what your "correct" till looks like so the number means something.

## How it works

1. Count the drawer (bill and coin denominations, one screen, done in a minute)
2. Get the verdict: over, short, or balanced — with the amount in euros
3. Confirm the day: once confirmed, it becomes your baseline; future counts are checked against your own history
4. See the pattern: six months of entries, with gaps flagged so you can't forget a day and not know why the next day looks weird

No accounts, no login, no sync. One drawer, one owner, one machine.

## Install

```bash
npm install
npm start
```

Open http://localhost:3401 — that's it. No accounts, no login.

## Documentation

- [README](README.md) — this file
- [Technical notes](#technical-notes) — how it works under the hood
- [Trial report](output/till-personas/REPORT-10-PERSONAS.md) — what 10 owners found over 6 months

## Technical notes

- Node.js + SQLite (no framework, one server file, one HTML page)
- Runs on a Raspberry Pi Zero 2W behind nginx
- Data lives in `data/till.sqlite` — one drawer, one owner, one machine
- API: `GET /api/state`, `POST /api/entry`, `PATCH /api/entry/:date`, `POST /api/confirm`, `DELETE /api/entry/:date`
- Tests: `node e2e.test.mjs` (38 tests, all passing)

## What owners want next

Asked four owners what they'd want the app to do that it doesn't today:

- **Miquel** (bread-and-pasta, El Poble-sec, 35 years): "Let me note the *reason* for a variance — 'overchange on table 12' — so six months later I know if it's a coin thing or a real problem. And if the same shortage repeats three nights with the same shift, *warn* me — 'this isn't bad luck, this is a pattern.'"
- **Sara** (matí-only café, Sants, tight margins): "Show *why* the number changed — 'you gave €10 more in change than yesterday,' '5 fewer coffees than your usual Tuesday.' And work offline in the kitchen where the signal is dead."
- **Pau** (casual tapas, El Born, first-timer): "Tell me what to do when it's short — 'check your €10 bills again.' And let me send the number to my accountant with one tap."
- **Marta** (traditional bar, La Boquería, analog-minded): "I'd put it beside the notebook, not replace it. Show me the math — don't surprise me with prices I didn't see coming. And work when I'm tired at midnight, with gloves on, with a dirty finger on the screen."

## License

MIT — do whatever you want with it, just don't say I told you when your till's off.

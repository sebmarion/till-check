# Till Check

Daily bistro cash reconciliation. Every day you count the till; the app checks
that you didn't lose money and that the accounts match, against a running
baseline you enter **once**.

## Model
- **Books balance** = the running baseline. Set once from your starting count;
  after each day you *confirm*, it becomes that day's actual count (never
  re-entered).
- **Each day** you enter: the till count, cash removed/added, card transfer
  (logged, doesn't touch till cash), and a *declared* note for cash the books
  don't know about (e.g. "lost €10").
- **Verdict:** `expected = books + added − removed`; `variance = actual − expected`
  → **balanced / short / over**, shown front and center.

Money is stored as integer cents.

## Run
```
node server.mjs          # http://127.0.0.1:3401
TILL_PORT=3401 TILL_BIND=127.0.0.1 node server.mjs
```

## Test
```
node --test               # deterministic reconciliation acceptance sequence
```

## Deploy (Zeus, house pattern)
```
sudo cp till-check.service /etc/systemd/system/
sudo systemctl enable --now till-check
```
nginx `/till/` → `127.0.0.1:3401`. Mobile page served at `/`.

## Stack
Zero-dependency: Node v22 stdlib (`node:http`, `node:sqlite` WAL, `node:fs`).
No framework, no `node_modules`. Single-file SQLite at `data/till.sqlite`.

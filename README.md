# Till Check

**Know what the till should contain.**

Till Check helps restaurant owners count the cash drawer at closing and see whether the actual balance matches the expected balance.

<p align="center">
  <img src="docs-verdict.png" alt="Till Check showing a short cash-drawer verdict" width="380">
</p>

## Why

A drawer can be €15 short because of a counting mistake, a cash movement, or money that is genuinely missing. Till Check shows the difference clearly and keeps a running baseline for the next count.

It does not pretend to know *why* money is missing. It gives you a reliable number so you can decide what to check next.

## How it works

<p align="center">
  <img src="docs-count.png" alt="Counting notes and coins in Till Check" width="380">
</p>

1. **Count the drawer** — enter the notes and coins.
2. **Check the till** — see balanced, over, or short in euros.
3. **Confirm the day** — accept the count as the next running balance.
4. **Review history** — see previous counts and skipped days.

<p align="center">
  <img src="docs-history.png" alt="Till Check history showing daily variance" width="380">
</p>

No account. No cloud. No setup ceremony.

## Run it

Requires Node.js 22.5 or newer.

```bash
npm install
npm start
```

Open <http://localhost:3401>.

## Test it

```bash
npm test
```

## Technology

Node.js, SQLite, and a single mobile-first web page.

- Money is stored as integer cents.
- The database stays on the machine running Till Check.
- The server binds to `127.0.0.1` by default.
- The API supports the web page and can sit behind nginx.

## License

MIT

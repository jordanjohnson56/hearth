# Hearth

Hearth is a dashboard for the kitchen wall. It shows the family calendar,
the chores that are due, and who is ahead this week, on an iPad in
fullscreen Safari. It also works on phones and laptops.

It runs on a home server in Docker, on the home LAN only. There are no
accounts and no TLS: physical access to the kitchen is the trust boundary. A
PIN protects admin actions. Calendars are read only, from Google Calendar
secret-address iCal URLs that the server polls.

> **Status:** M1, the calendar. Hearth runs and deploys, shows the clock,
> today's events in the Day at a glance tile and the month grid on the
> Calendar page, reads Google Calendar secret addresses that an
> administrator adds behind a PIN (see [Calendars](#calendars)), and
> switches between light and dark at configurable times. Chores arrive in
> M2. See [docs/DESIGN.md](docs/DESIGN.md) for the plan.

![Hearth home screen, M1 (screenshot placeholder; the real screenshot arrives in M3)](docs/screenshot-placeholder.svg)

## Quick start (Docker)

You need git and Docker with the Compose plugin. This runs the demo with the
fictional family Ada, Linus, Marie and Grace.

```sh
git clone https://github.com/jordanjohnson56/hearth.git
cd hearth
git config core.hooksPath .githooks

mkdir -p data
export HEARTH_DATA_HOST="$PWD/data"

docker compose up -d --build
docker compose run --rm hearth npm run seed
```

Open <http://localhost:4400>, or `http://<server>:4400` from another device on
the LAN.

- `./data` is gitignored, which makes it safe for the demo. A real
  deployment points `HEARTH_DATA_HOST` at a directory outside the repository,
  such as `/srv/hearth`. See [Privacy](#privacy).
- The container runs as the unprivileged user `node`, uid 1000, gid 1000. On
  Linux, the `HEARTH_DATA_HOST` directory must be writable by uid 1000. That is
  usually your own user (check with `id -u`). If it is not, run
  `sudo chown 1000:1000 "$HEARTH_DATA_HOST"`. Create the directory before the
  first `docker compose up`. If it is missing, Docker creates it owned by root.
  Hearth then exits with `DATA_DIR must be a directory Hearth can create and
  write to: /data is not writable (EACCES)`, and Docker keeps restarting it
  until you fix the owner.
- `HEARTH_DATA_HOST` is required by every `docker compose` command in this
  directory, including `logs`, `run` and `down`. Without it, Compose refuses
  to start and prints
  `set HEARTH_DATA_HOST to an absolute path outside the repo`. To avoid
  exporting it in every new shell, put `HEARTH_DATA_HOST=/absolute/path` in a
  `.env` file next to `docker-compose.yml`. Compose reads that file, and git
  ignores it.
- The seed applies any pending migrations first, then adds the four people.
  It upserts by display name, so it is safe to run again.
- `docker compose logs -f` follows the logs (JSON lines), and
  `docker compose down` stops Hearth. The container restarts on its own unless
  you stop it.

## Configuration

Hearth reads four environment variables at startup. It checks them all and
refuses to start with a list of every problem. [.env.example](.env.example)
holds the defaults. Everything a person sets up, such as people, calendars,
the PIN, the theme times and chores, lives in the database under
`DATA_DIR`, not here.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4400` | Port the server listens on (1 to 65535). Under Docker the container always listens on 4400; to publish a different host port, change `ports` in `docker-compose.yml`. |
| `DATA_DIR` | `./data` | Directory for the SQLite database (`hearth.db`). Relative paths resolve against the working directory. Hearth creates it if it is missing, and it must be writable. Under Docker this is always `/data` inside the container; set `HEARTH_DATA_HOST` instead. |
| `TZ` | `America/Chicago` | IANA time zone name, such as `Europe/Paris`. All date math uses it: which day an event falls on, when the theme switches, what is due today, Monday to Sunday weeks, and season boundaries. Fixed offsets such as `-06:00` are rejected. |
| `LOG_LEVEL` | `info` | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |
| `HEARTH_DATA_HOST` | none, required | Docker Compose only: the absolute host directory mounted at `/data`. Keep it outside the repository. |

An empty value counts as unset and falls back to the default. Under Docker,
`TZ` and `LOG_LEVEL` come only from the optional `.env` file next to
`docker-compose.yml`, never from the shell that runs `docker compose`: a
host's own `TZ` (often `UTC`) would otherwise become the household's zone
without anyone noticing. Without a `.env`, or with a variable left out of
it, Hearth uses the default. `PORT` and `DATA_DIR` in `.env` have no effect
under Docker. Outside Docker, Hearth reads only the process environment, so
set the variables in your shell, for example `TZ=Europe/Paris npm start`.

## Calendars

Hearth shows Google Calendar calendars that it reads through their secret
addresses. An administrator sets them up from the wall or from any device
on the LAN. Nothing in this section touches the repository: the PIN, the
addresses and the events live in the database under `DATA_DIR`.

### Unlock admin

1. Tap **Admin** in the header.
2. On first use there is no PIN and no default PIN exists. The page says
   **Set a PIN**: choose four digits and enter them twice. Hearth saves the
   PIN and unlocks.
3. From then on the Admin page asks for the PIN. After five wrong PINs in a
   row the pad refuses for 30 seconds, doubling with every further wrong
   PIN up to 15 minutes; a correct PIN resets the count. The PIN keeps a
   child out, not an attacker (see [docs/DESIGN.md](docs/DESIGN.md),
   section 3).
4. An unlocked session lasts 10 minutes from its last use and 60 minutes at
   most. **Lock now**, a page reload and a server restart all lock it at
   once. Unlocked, the page shows **Change PIN**, **Theme** and
   **Calendar**.

### Add a calendar

In Google Calendar on the web, open Settings, pick the calendar under
"Settings for my calendars", scroll to "Integrate calendar" and copy
**Secret address in iCal format**. It has this shape (this example is
fake):

```
https://calendar.google.com/calendar/ical/EXAMPLE/private-EXAMPLE0000000000/basic.ics
```

A `webcal` address is accepted and read over https. An `http://` address
is refused: the address is a secret and must not travel in the clear.

Under **Calendar**, type a label (a name such as Ada, or "School"), pick a
color, paste the address and tap **Add**. Hearth saves the source and
fetches it once right away, and the new row says whether that worked. A
failed first fetch keeps the row, so you can fix the cause and tap
**Refresh now** rather than paste the address again.

### What the status row shows

- **Address**: the host plus a short hash of the address, such as
  `calendar.google.com#1a2b3c4d`. It tells two sources apart without
  repeating the secret. The address itself is never shown again, anywhere:
  not in admin, not in `/api/calendar/sources`, not in the logs. To change
  it, tap **Edit** and paste a new one.
- **Last success** and **Last attempt**: when the feed was last read
  successfully and when Hearth last tried, in the household's zone.
- **Status**: `OK`, or why the last attempt failed. Hearth stores only a
  classification, never a message that could quote the address:
  - `timeout`, shown as "Timed out": no answer within 30 seconds.
  - `http <status>`, shown as "Server answered 404" and so on. A 404 from
    Google usually means the secret address was reset: copy the new one
    and paste it with **Edit**.
  - `not-ics`, shown as "Not a calendar feed": the address answered with
    something other than a calendar, often a sign-in page because a
    public link was pasted instead of the secret address.
  - `too-large`, shown as "Feed is too large": over 5 MB.
  - `network`, shown as "Could not connect".
- **Skipped**: "N events could not be read" appears when the last fetch
  contained events Hearth could not parse. The rest are shown as usual.

**Refresh now** fetches at once. **Edit** changes the label, the color or
the address; a new address drops the old events and fetches the new feed.
**Delete** asks for confirmation, then removes the source and its events.

Hearth polls every source every 10 minutes, starting right after the
server is listening. A failed poll keeps the last good events: a Wi-Fi
blip or a Google outage never empties the calendar. When the newest
successful fetch is more than an hour old, the Day at a glance tile adds a
line such as "Calendar updated 3 hours ago". The tile and the Calendar page
update on their own when a fetch changes anything.

### Theme times

Under **Theme**, **Light from** and **Dark from** are the two times of day
at which the display switches, in 24-hour `HH:MM`. The defaults are 07:00
and 19:30. Either order works, so the dark period (or the light one) may
wrap midnight; the two times must differ. They are evaluated in the
household's `TZ`, not the device's zone. A save applies at once on the
device that made it, and the wall follows within five minutes. There is no
manual toggle.

### Where the data lives

Everything above is in the SQLite database `hearth.db` under `DATA_DIR`
(`HEARTH_DATA_HOST` under Docker). The secret addresses are in a table of
their own that only the fetcher reads. They never leave the server: the
API, the logs and the browser see the host-plus-hash form only. If an
address does leak elsewhere, reset it in Google Calendar and paste the new
one with **Edit**.

## Development

You need Node 22, which is the version in `.nvmrc` and the Docker image.
Another major version fails at runtime in `better-sqlite3`'s native module.

```sh
git config core.hooksPath .githooks   # required in every clone, see below
npm ci

npm run dev          # server (port 4400) plus Vite with hot reload; open http://localhost:5173
npm run build        # client to dist/client, server to dist/server
npm start            # run the build on http://localhost:4400
npm run seed         # seed the fictional family into DATA_DIR (uses the build; run npm run build first)
npm run seed:dev     # the same, straight from the TypeScript sources

npm run typecheck
npm run lint
npm test             # add -- --coverage for a coverage report
./scripts/privacy-check.sh   # before every push
```

`git config core.hooksPath .githooks` is a required step for every clone.
Git does not clone hooks. This setting turns on the pre-commit hook, which
scans each commit for secrets with [gitleaks](https://github.com/gitleaks/gitleaks).
The hook fails when gitleaks is not installed. Install the version that CI
pins in `.github/workflows/ci.yml` (8.30.1).

## Privacy

This repository is public, and the data Hearth handles is not. The family's
calendar URLs, names and photos must never enter git history, because a
commit cannot be taken back once it is pushed.

- Everything personal lives in the SQLite database under `DATA_DIR`, never in
  the repository or in `.env`. A secret-address iCal URL gives full read
  access to a calendar, so Hearth keeps it only in the database. It never
  logs one or sends one to the browser; admin shows a host-plus-hash
  fingerprint instead (see [Calendars](#calendars)).
- `DATA_DIR=./data` is only the demo default for running outside Docker. `data/`
  is gitignored, so a clone that runs the demo commits nothing.
- Under Docker the database lives in `HEARTH_DATA_HOST`. Compose requires the
  variable, so a deployment can never fall back to a directory inside the
  repository. For a real household, use an absolute path outside the
  repository.
- The only names in this repository, in code, tests, seed data, screenshots
  and docs, are those of the fictional family: Ada, Linus, Marie and Grace.
- Run `./scripts/privacy-check.sh` before every push. Never commit `.env`,
  database files, `.ics` files or avatars.

## License

[MIT](LICENSE)

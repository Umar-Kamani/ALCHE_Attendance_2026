# ALCHE Campus Post

A self-hosted attendance, guest and parking system for the ALCHE gate and HR office in Pamplemousses, Mauritius.

It replaces three paper processes:

- the staff entry/exit logbook, with an immutable attendance event stream;
- hand-written visitor slips, with a guest register and one-tap check-in/out;
- the parking notebook, with typed bays, live occupancy and auditable allocation.

Everything runs on the campus LAN. There are no cloud services, telemetry calls, runtime CDNs or external font requests.

---

## 1. Start on a clean machine

Prerequisites: Docker Engine with Compose v2, and about 2 GB of free disk.

```bash
cp .env.example .env
docker compose up -d
```

Open <http://localhost:8000>.

The first boot runs the database migrations and creates the HR administrator from `.env`. No manual migration or seed step is required.

The example file deliberately uses `NODE_ENV=development` so the first-run command works with the sample secret. Before real use:

```bash
# edit .env:
NODE_ENV=production
SECRET_KEY=<output of: openssl rand -hex 32>
ADMIN_USERNAME=admin
ADMIN_INITIAL_PASSWORD=<a strong initial password>
```

The API refuses to boot in production while `SECRET_KEY` is still the documented default.

### First sign-in

Use `ADMIN_USERNAME` / `ADMIN_INITIAL_PASSWORD`. The first login must change the password. From **Users**, create a `SECURITY` account for each gate officer and a `DEAN` account for the read-only dashboard. Temporary passwords are shown once.

### Demo data

With the stack running:

```bash
make seed-demo
```

This is idempotent and creates approximately 15 staff, 8 students, 6 guests, 14 vehicles, 2 demonstration areas with 40 typed bays, 30+ days of events, 12 active parking sessions, one approved amendment and one open ticket. It prints the one-time passwords for the demo security and dean accounts. Re-running it does not duplicate data and does not reset existing demo passwords.

To run the automated browser checks against the demo database:

```bash
pnpm exec playwright install chromium   # first time on this host only
make e2e
```

This starts the stack, seeds the demo data, installs the isolated E2E fixtures and runs Playwright. The HTML report is written to `playwright-report/`.

---

## 2. What each role sees

| Role | Main work |
|---|---|
| **SECURITY** | Kiosk in/out with inline parking, today’s attendance, guests, vehicles, live parking board, bay inventory, parking history, raise/view own amendment tickets |
| **HR** | Everything operational plus the employee/student directories, imports, full attendance history, employee detail and corrections, exports, user accounts, audit log; parking is read-only |
| **DEAN** | Read-only aggregate dashboard: today’s snapshot, current-month totals, guest flow, parking occupancy and a 30-day attendance trend. No names, guest PII, exports or mutations |

The server enforces the role matrix on every `/api/v1` route. Hiding a button is never the authorisation.

---

## 3. Daily operation

### Gate kiosk

1. Search by name, employee code or number plate.
2. Select the person. The current state and vehicles appear.
3. One primary action is inferred: **Mark IN** or **Mark OUT**. A text toggle handles exceptions.
4. If checking in and a vehicle is registered, a matching free bay is offered in the same flow. “No parking” never blocks attendance.
5. On checkout, the toast offers **Release bay A-03**. Releasing is never silent.
6. A double tap cannot double-log: the request is disabled while in flight, and the server rejects the same direction within 120 seconds.
7. Undo is available only for the event the signed-in officer created, for five minutes, and is audited as `gate_undo`.
8. If the staff member has no vehicle, **Add vehicle** registers one at the gate.

The kiosk also shows today’s activity and the current on-campus count.

### Guests

- **Today** shows expected, on-site, overdue and departed visits.
- **Check in walk-in** creates a guest and visit and checks them in immediately.
- **Pre-register visit** records a future expected window.
- Guest check-out can release the parking bay in the same action.
- The **Register** tab filters by date, host and status and exports a filtered CSV.
- The **Guest directory** keeps one guest record across repeat visits. Deactivating a guest never deletes their visits.

### Parking

- **Parking board** groups bays by area. Every bay shows its code and a type chip (`S`, `St`, `G`, `Gen`, `Acc`, `M`); occupancy is also written in words/plates, never colour alone.
- Auto-assign chooses the lowest-numbered free matching bay, then falls back to `GENERAL`. It never falls into a reserved type.
- A mismatched allocation is refused with `422` until a typed reason is entered; the session is badged as an override and the action is audited.
- A bay and a vehicle each have at most one active session, enforced by PostgreSQL partial unique indexes. A holder also has only one active parking session across all their vehicles.
- Relocation ends the old session and opens the new one in one transaction.
- **Parking history** reports daily peak occupancy and average dwell by area and type.

### Attendance and corrections

- Attendance is derived, never stored: first-in, last-out, span, net hours and completed visits.
- An overnight IN→OUT pair belongs to the entry date with the `OVERNIGHT` flag.
- Security cannot edit history. They raise an amendment ticket.
- HR approves/rejects and then explicitly **applies** the approved ticket. Application writes a new `amendment` event and supersedes the old one; both remain in the audit log.
- HR can also add, void or re-time events directly. Those create `hr_edit` events with identical audit detail.

### Attendance exports

Use **Attendance → Export report** or **Raw events CSV**. The export is UTF-8 with BOM and CRLF, opens cleanly in Excel with accented names, uses local `HH:MM:SS` times, hours to two decimals, and is capped at 366 inclusive days. Every export is audited.

---

## 4. LAN deployment with a hostname and internal TLS

The default Compose stack publishes port `8000`. For HTTPS on the LAN:

1. Point a DNS record or the gate PCs’ hosts file at the server, for example:

   ```text
   192.168.1.20   alche.lan
   ```

2. Set the certificate hostname in `deploy/Caddyfile` if it is not `alche.lan`.
3. Start the TLS profile:

   ```bash
   docker compose --profile tls up -d
   ```

4. Open `https://alche.lan`.

Caddy uses its internal CA. Export its root certificate to managed workstations:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

Install `caddy-root.crt` in the trust store of each gate PC/tablet, or deploy it through your device management.

The app container is not published directly in the TLS profile scenario if you remove the `8000` mapping; keep it on the private Compose network and let Caddy proxy `app:8000`.

---

## 5. Backups and restore

### Backup

```bash
make backup
```

or:

```bash
./scripts/backup.sh
```

The script writes `backups/alche_YYYYMMDD_HHMMSS.sql.gz` and keeps the 30 most recent files. Store the `backups/` directory on a separate disk or network share.

Suggested cron entry on the Docker host (daily at 02:15):

```cron
15 2 * * * cd /opt/alche-attendance && ./scripts/backup.sh >> /var/log/alche-backup.log 2>&1
```

### Restore

Stop the app while restoring:

```bash
docker compose stop app
gunzip -c backups/alche_20261019_021500.sql.gz \
  | docker compose exec -T db psql -U alche -d alche
docker compose start app
```

The Compose database volume survives `docker compose down` and `docker compose up -d`. Only `docker compose down -v` destroys it.

---

## 6. What to do when the gate PC dies

The application and database are **not** on the gate PC. Any browser can be the kiosk.

1. Move a spare PC/tablet to the gate and open `http://<server>:8000` (or `https://alche.lan`).
2. Sign in with the shared gate officer account, or ask HR to issue a new one.
3. Nothing is lost: the event stream, guests and parking sessions are in PostgreSQL on the server.

If the **server** dies:

1. Install Docker on the replacement host.
2. Clone/copy this repository and the latest `.env` and backup.
3. Run `docker compose up -d`.
4. Restore the latest backup using the command in section 5.
5. Point the LAN hostname at the new server.

---

## 7. Tests

### API tests

The API suite uses a real PostgreSQL `alche_test` database. It is created and migrated by the test global setup; it does not use SQLite or mocks.

With the Compose database running:

```bash
docker compose up -d db
pnpm install
pnpm test:api
```

The default test URL is `postgresql://alche:alche@127.0.0.1:5432/alche_test?schema=public`. Override it with `TEST_DATABASE_URL` if needed.

### Web tests

```bash
pnpm test:web
```

Uses Vitest + React Testing Library with happy-dom. The suite checks kiosk direction inference and in-flight blocking, parking-board free/occupied rendering, the ineligible-bay override guard, and the raw-colour design restriction.

### Everything

```bash
make test
```

This runs both suites in the build/test containers.

### Browser and visual tests

```bash
make e2e
```

or, against an already-running stack with fixtures:

```bash
pnpm e2e
```

Playwright covers the full acceptance flows and takes screenshot baselines of the kiosk, parking board and attendance table at **1366×768** and **1024×768**. Baselines are committed under `e2e/visual.spec.ts-snapshots/`. The report is in `playwright-report/`.

Screenshots are taken after the visual fixtures are installed, and intentionally hide dynamic kiosk activity and open-ticket counters so the layout baseline is stable.

---

## 8. Useful commands

```bash
make up                 # build + start
make down               # stop (volume persists)
make logs               # follow app logs
make migrate            # apply migrations in the running app
make test               # API + web tests
make test-api
make test-web
make e2e
make seed-demo
make reset-password USER=gate.officer
make backup
make build
make psql
```

`make reset-password` prints a fresh temporary password once and revokes the user’s sessions. There is no email flow.

---

## 9. Architecture

- **API:** Fastify 5, Zod type provider, Prisma 6, PostgreSQL 16, `pg_trgm`, `citext`.
- **Web:** React 19, Vite, TypeScript strict, React Router, TanStack Query, Tailwind CSS v4 with the `DESIGN.md` tokens.
- **Shared:** Zod schemas and inferred types in `packages/shared`; runtime validation is used on both sides.
- **Auth:** opaque server-side sessions in PostgreSQL, SHA-256 token digests, argon2id passwords, HttpOnly SameSite=Lax cookie, CSRF double-submit token.
- **Time:** all storage in UTC; every grouping/display uses the real IANA zone `Indian/Mauritius` (UTC+4).
- **Packaging:** one Node 22 container serves `/api/v1` and the built SPA with history fallback.

```
apps/api      Fastify API, Prisma schema/migrations, seed and CLI
apps/web      Vite React SPA
packages/shared  Zod request/response contracts and shared types
docs          sample CSVs
deploy        Caddyfile
scripts       backup and entrypoint helpers
e2e           Playwright functional and visual tests
```

The attendance derivation lives in `apps/api/src/attendance.ts` and is intentionally a pure function with table-driven tests.

---

## 10. Troubleshooting

**I forgot the admin password.** Run:

```bash
make reset-password USER=admin
```

**Login says the account is locked.** Wait 15 minutes, or ask HR to reset the password; the five-failure lockout is per username.

**The browser shows a 403 page.** The account is valid but lacks that capability. Security cannot see full attendance, employee directories, exports of attendance, users or audit. HR can approve tickets, but parking allocation and bay changes are security-only.

**Visitors cannot sign in.** Guests never receive accounts. Security checks them in from the Guests screen.

**No suitable bay is free.** Auto-assign only considers matching and `GENERAL` bays. Allocate a reserved bay only with a typed reason; the session will be badged as an override.

**Do I need an internet connection?** No after the image and dependencies are built. Poppins is bundled in the app assets. There is no runtime font/CDN/telemetry request.

**How long is data kept?** The deployment keeps attendance, guest and parking history for at least seven years; there is no automatic purge. Keep the 30 daily backups and archive them according to ALCHE’s retention policy.

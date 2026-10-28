# Decisions

Every judgement call that changes behaviour, schema, access, deployment or design is recorded here. `DESIGN.md` is unchanged.

## Product and access

- **Final scope:** the application records employee attendance and maintains employee vehicle records. Guest management, student tracking and parking management are removed.
- **Dean access:** `DEAN` gets a read-only aggregate employee-attendance dashboard. It cannot view names, attendance detail, exports, audit records or mutation routes.
- **Dean scope:** today’s snapshot, current-month totals, a 30-day trend and a read-only date-range selector.
- **Scale:** sized for about 250 employees and one gate. Pagination remains 50 rows.
- **Shifts:** security covers nights; no separate Shift entity. Overnight attendance follows the entry-date rule below.
- **Devices:** one gate desktop plus a tablet, responsive at both.
- **Identity:** employee codes are 2–32 alphanumeric.
- **Vehicles:** every vehicle belongs to exactly one employee. An employee may have zero, one or many vehicles.
- **Retention:** attendance and vehicle records are retained for at least seven years; no automatic purge in v1; 30 daily backups retained.
- **No third access role beyond `DEAN`:** facilities, finance and the registrar use HR exports.

## Attendance

- **Overnight attribution:** an IN→OUT pair that crosses midnight belongs to the local date of the IN. The closing OUT is not reported as `MISSING_IN` on the next day. `OVERNIGHT` is set on the entry-date row.
- **Derivation source of truth:** one pure function computes status, span, net hours, visits, amended state and flags. No derived attendance values are stored.
- **Time zone identifier:** the brief’s `Africa/Mauritius` is not a valid IANA zone. The app uses the real zone, `Indian/Mauritius` (UTC+4).
- **Kiosk direction:** the UI resolves and sends the inferred direction so a second tap cannot turn a double-submit into the opposite event. The server still infers direction when omitted and applies the 120-second duplicate guard.
- **Kiosk time override:** security may choose a Mauritius-local event time. Times before the employee’s latest effective event are refused.
- **Undo:** only the current user’s own gate event, within five minutes. Undo is a soft void, audited as `gate_undo`.
- **Day flags:** `NO_EXIT` is added to historical `ON_SITE` rows; the current day is simply on site.
- **Kiosk employee dropdown:** the kiosk loads all active employees through a dedicated endpoint and exposes a searchable dropdown in addition to name/plate search.

## Amendment tickets

- **Separate apply action:** `POST /tickets/:id/apply` is added because the lifecycle requires `approved → applied`, HR-adjusted values, and refusal of double-apply. Approval alone does not write an event.
- **Old events:** superseded and voided events remain in the database and audit view but are excluded from derivation and exports of effective data.
- **Retiming:** HR retiming creates a new `hr_edit` event and supersedes the old one; it does not mutate the old row.
- **Security view:** security can read a short recent event list for an employee solely to choose a ticket target.

## Vehicles

- **Plate normalisation:** uppercase with spaces and dashes removed. Active plates are unique; inactive plates are retained for history.
- **Multiple vehicles:** no unique constraint on employee ownership. The UI lists all vehicles and allows adding another vehicle to the same employee.
- **Ownership:** vehicle ownership cannot be moved after creation through the ordinary edit form.
- **Deactivation:** vehicles are deactivated rather than deleted, preserving historical references.

## API, auth and data

- **Sessions:** random opaque tokens, SHA-256 digest stored in Postgres, HttpOnly SameSite=Lax cookie, eight-hour idle and twelve-hour absolute timeout.
- **CSRF:** `@fastify/csrf-protection` double-submit secret cookie plus `X-CSRF-Token`, enforced on every mutating `/api/v1` request including login.
- **Forced password change:** enforced server-side. `mustChangePassword` blocks every protected route except session inspection, logout and password change.
- **Last HR admin:** deactivation and demotion are refused when it would leave no active `HR` account.
- **Audit immutability:** a database trigger rejects UPDATE and DELETE on `AuditLog`.
- **Prisma cursor pagination for exports:** exports stream through Prisma cursor pages of 500 rows, keeping memory bounded while preserving the “raw SQL only in migrations” rule.
- **CSV parsing:** `csv-parse` handles BOM, CRLF and quoted commas. Header validation reads the first CSV record before streaming data.
- **CSV exports:** `csv-stringify` adds a UTF-8 BOM and CRLF records. Ranges are capped at 366 inclusive days. Only HR may export attendance and raw events.
- **`/healthz`:** unauthenticated, outside `/api/v1`.
- **`/auth/change-password`:** added as a necessary supporting route not enumerated in the API shape.

## Design

- **Error colours:** `#fde8e7` background and `#a3271f` text are the single palette addition, used only for error/status text, badge fills and inline validation. They are appended in a second `@theme` block after the verbatim DESIGN block.
- **Semantic aliases:** status colours reuse existing DESIGN tokens (`mint`, `forest`, `aqua`, `ink`, `shadow-dust`, `slate`, `periwinkle-wash`). No new radii or shadows are introduced.
- **Tablet navigation:** below 1200px the 240px sidebar becomes bottom tabs plus a “More” sheet.
- **Kiosk density:** the employee dropdown and search use the same 48px touch targets as other kiosk controls.
- **Focus:** global 2px Monday Violet focus ring at 2px offset.
- **No external assets:** Poppins is bundled from `@fontsource/poppins`; there is no runtime font request or CDN.
- **No marketing page:** the app shell and operational layouts only.
- **Design-system self-test:** `apps/web/tests/design.test.ts` walks all of `apps/web/src` and fails if any raw hex/rgb/hsl appears outside `styles/theme.css`; Playwright additionally checks computed component values.

## Additional implementation decisions

- **Full removals:** parking and guest data were deleted, not archived. Students were not reintroduced as vehicle holders.
- **HR direct events:** `POST /events` accepts `hrEdit=true` and a mandatory reason for HR. It writes `source='hr_edit'`; the kiosk path writes `source='gate'`.
- **Login throttling:** the per-IP limit is 100 attempts per 15 minutes. The precise anti-brute-force control remains the per-username DB counter that locks after five failures.
- **Demo accounts:** `seed-demo` creates `gate.demo` and `dean.demo` with randomly generated one-time passwords printed to the terminal. The E2E accounts are created only by the explicit E2E fixture command.
- **E2E isolation:** visual fixtures use dedicated `VISUAL` employees so their events do not affect operational seed data. Visual snapshots hide live activity/count regions that change between runs.
- **Web test environment:** Vitest + React Testing Library use `happy-dom`.
- **Test database default:** API tests create and migrate `alche_test` at `postgresql://alche:alche@127.0.0.1:5432/alche_test`; `TEST_DATABASE_URL` overrides it.
- **Seed future-time guard:** demo events are filtered to “not later than now” so the seeded day never contains future OUT events.
- **Production packaging:** the image uses a Prisma deploy bundle with the generated client and the Prisma CLI retained in production dependencies.
- **No application raw SQL:** raw SQL is confined to migrations and test setup.
- **Font subsets:** `@fontsource/poppins` bundles all its available subsets; browsers fetch only the subset they need.

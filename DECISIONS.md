# Decisions

Every judgement call that changes behaviour, schema, access, deployment or design is recorded here. `DESIGN.md` is unchanged.

## Product and access

- **Dean access (answered):** a third role, `DEAN`, gets a read-only aggregate dashboard. It cannot view names, guest personal data, attendance detail, exports, audit records, or any mutation route.
- **Dean scope (answered):** the dashboard shows today’s snapshot, current-month totals, a 30-day trend and a read-only date-range selector. It is aggregate-only and `DEAN`-only.
- **Scale (default):** sized for about 250 staff, 600 students, 100–150 guest visits/week, 60 bays and one gate. Pagination remains 50 rows; the bay board is not virtualised.
- **Shifts (default):** security covers nights; no separate Shift entity. Overnight attendance follows the entry-date rule below.
- **Bay sharing (default):** bay types are permanent; `GENERAL` is the flexible pool. No time-window reservation model.
- **Permits (default):** no numbered permit/sticker database field in v1; vehicle notes can hold an informal reference.
- **Devices (default):** one gate desktop plus a tablet, responsive at both. No label printer; badge numbers are free text.
- **Identity (default):** employee codes are 2–32 alphanumeric and student IDs occupy a separate namespace. Matching strings across the two tables do not conflict.
- **Retention (default):** attendance, guest and parking history retained for at least seven years; no automatic purge in v1; 30 daily backups retained.
- **Parking inventory writes:** the capability table is authoritative. `SECURITY` may manage areas/bays; `HR` has read-only inventory access.
- **Contractors:** both `staff` and `contractor` employees are eligible for `STAFF` bays. Parking categories are employee/student/guest, not employment subtype.
- **`ACCESSIBLE` eligibility:** no accessibility permit exists in the specified model, so allocating any vehicle to an `ACCESSIBLE` bay requires an audited typed override. The app does not invent a permit field.
- **No third access role beyond `DEAN`:** facilities, finance and the registrar use HR exports.

## Attendance

- **Overnight attribution:** an IN→OUT pair that crosses midnight belongs to the local date of the IN. The closing OUT is not reported as `MISSING_IN` on the next day. `OVERNIGHT` is set on the entry-date row.
- **Derivation source of truth:** one pure function computes status, span, net hours, visits, amended state and flags. No derived attendance values are stored.
- **Kiosk direction:** the UI resolves and sends the inferred direction so a second tap cannot turn a double-submit into the opposite event. The server still infers direction when omitted and applies the 120-second duplicate guard.
- **Undo:** only the current user’s own gate event, within five minutes. Undo is a soft void, audited as `gate_undo`.
- **Day flags:** `NO_EXIT` is added to historical `ON_SITE` rows; the current day is simply on site. `DUPLICATE_SUSPECT` requires an amended/day-edited context per the brief.
- **No student attendance:** students appear in kiosk search only for parking identity.

## Amendment tickets

- **Separate apply action:** `POST /tickets/:id/apply` is added because the lifecycle requires `approved → applied`, HR-adjusted values, and refusal of double-apply. Approval alone does not write an event.
- **Old events:** superseded and voided events remain in the database and audit view but are excluded from derivation and exports of effective data.
- **Retiming:** HR retiming creates a new `hr_edit` event and supersedes the old one; it does not mutate the old row.
- **Security view:** security can read a short recent event list for an employee solely to choose a ticket target. It is not the full attendance-history capability.

## Guests and vehicles

- **Guest visit vehicle:** `guest_visits.vehicle_id` is added. The brief requires an optional visit vehicle and parking release, which cannot be represented reliably by the guest’s vehicle collection alone.
- **Guest status:** stored values are `EXPECTED`, `ON_SITE`, `DEPARTED`, `CANCELLED`; `OVERDUE` is computed when `expected_to` has passed while still on site. This keeps time-based state truthful without a scheduler.
- **Guest deactivation:** guests are deactivated, never deleted. Visits remain permanent.
- **Plate normalisation:** uppercase with spaces and dashes removed. Active plates are unique; inactive plates are retained for history.
- **Exactly one holder:** a database CHECK enforces exactly one of employee/student/guest.

## Parking

- **Active-session uniqueness:** partial unique indexes on bay and vehicle, plus friendly pre-checks and `409` responses.
- **Relocation:** release of the old session and creation of the new one occur in one database transaction; both audit facts are recorded.
- **Auto-assign:** lowest natural-sorted bay code of the matching type, then `GENERAL`. It never falls back to a mismatched typed bay.
- **Occupied bay deactivation:** refused with `409`.
- **Bulk create:** existing codes are skipped, not treated as failures.

## API, auth and data

- **Sessions:** random opaque tokens, SHA-256 digest stored in Postgres, HttpOnly SameSite=Lax cookie, eight-hour idle and twelve-hour absolute timeout.
- **CSRF:** `@fastify/csrf-protection` double-submit secret cookie plus `X-CSRF-Token`, enforced on every mutating `/api/v1` request including login.
- **Forced password change:** enforced server-side, not only by routing. `mustChangePassword` blocks every protected route except session inspection, logout and password change.
- **Last HR admin:** deactivation and demotion are refused when it would leave no active `HR` account.
- **Audit immutability:** a database trigger rejects UPDATE and DELETE on `AuditLog`, not just the absence of application routes.
- **Audit PII:** guest identity details are not written to application logs. Audit snapshots contain operational identifiers and fields needed to explain changes.
- **Prisma cursor pagination for exports:** Prisma 6 cannot stream a database cursor without raw application SQL. Exports stream through Prisma cursor pages of 500 rows, keeping memory bounded while preserving the “raw SQL only in migrations” rule.
- **CSV parsing:** `csv-parse` handles BOM, CRLF and quoted commas. Header validation reads the first CSV record with the same parser before streaming the data.
- **CSV exports:** `csv-stringify` adds a UTF-8 BOM and CRLF records. Ranges are capped at 366 inclusive days.
- **`/healthz`:** unauthenticated, outside `/api/v1`.
- **`/auth/change-password` and student PATCH:** added as necessary supporting routes not enumerated in the API shape.
- **Guest and parking exports:** allowed for both `SECURITY` and `HR`; attendance and raw-event exports remain HR-only.

## Design

- **Error colours:** `#fde8e7` background and `#a3271f` text are the single palette addition, used only for error/status text, badge fills and inline validation. They are appended in a second `@theme` block after the verbatim DESIGN block.
- **Semantic aliases:** status colours reuse existing DESIGN tokens (`mint`, `forest`, `aqua`, `ink`, `shadow-dust`, `slate`, `periwinkle-wash`). No new radii or shadows are introduced.
- **Parking density deviation:** the parking board uses 8px grid gaps, 12px bay padding and 13px labels so 40 bays fit a 1366×768 gate PC. This is the sole density exception; all other screens use 24px card padding.
- **Tablet navigation:** below 1200px the 240px sidebar becomes bottom tabs plus a “More” sheet. This preserves touch targets without reducing the board to a horizontally scrolling page.
- **Kiosk density:** 20px search, 56px primary action, 24px card padding.
- **Focus:** global 2px Monday Violet focus ring at 2px offset.
- **No external assets:** Poppins is bundled from `@fontsource/poppins`; there is no runtime font request or CDN.
- **No marketing page:** the app shell and operational layouts only.

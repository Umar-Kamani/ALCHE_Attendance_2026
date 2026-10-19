-- ALCHE attendance initial schema.
-- Extensions must exist before CITEXT columns and trigram indexes are created.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" CITEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailedAt" TIMESTAMPTZ(3),
    "lockedUntil" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" UUID NOT NULL,
    "code" CITEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" CITEXT,
    "phone" TEXT,
    "department" TEXT NOT NULL,
    "jobTitle" TEXT,
    "category" TEXT NOT NULL DEFAULT 'staff',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "importBatchId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" UUID NOT NULL,
    "studentId" CITEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" CITEXT,
    "programme" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "idNumber" TEXT,
    "company" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestVisit" (
    "id" UUID NOT NULL,
    "guestId" UUID NOT NULL,
    "hostEmployeeId" UUID NOT NULL,
    "vehicleId" UUID,
    "purpose" TEXT NOT NULL,
    "expectedFrom" TIMESTAMPTZ(3) NOT NULL,
    "expectedTo" TIMESTAMPTZ(3) NOT NULL,
    "badgeNo" TEXT,
    "checkedInAt" TIMESTAMPTZ(3),
    "checkedInBy" UUID,
    "checkedOutAt" TIMESTAMPTZ(3),
    "checkedOutBy" UUID,
    "status" TEXT NOT NULL DEFAULT 'EXPECTED',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GuestVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "plateNorm" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "colour" TEXT,
    "vehicleType" TEXT NOT NULL DEFAULT 'car',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "employeeId" UUID,
    "studentId" UUID,
    "guestId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingArea" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" CITEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParkingArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingBay" (
    "id" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "bayType" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParkingBay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingSession" (
    "id" UUID NOT NULL,
    "bayId" UUID NOT NULL,
    "vehicleId" UUID,
    "plateSnapshot" TEXT NOT NULL,
    "holderNameSnapshot" TEXT NOT NULL,
    "holderCategory" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "allocatedBy" UUID NOT NULL,
    "endedBy" UUID,
    "endReason" TEXT,
    "overrideReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ParkingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "direction" TEXT NOT NULL,
    "recordedBy" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "supersededById" UUID,
    "ticketId" UUID,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedBy" UUID,
    "voidReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "targetEventId" UUID,
    "proposedDirection" TEXT NOT NULL,
    "proposedOccurredAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "raisedBy" UUID NOT NULL,
    "raisedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "hrDirection" TEXT,
    "hrOccurredAt" TIMESTAMPTZ(3),
    "appliedAt" TIMESTAMPTZ(3),
    "appliedEventId" UUID,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "skipInvalid" BOOLEAN NOT NULL DEFAULT false,
    "actorUserId" UUID NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "invalid" INTEGER NOT NULL,
    "errors" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_absoluteExpiresAt_idx" ON "Session"("absoluteExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_code_key" ON "Employee"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE INDEX "Employee_department_idx" ON "Employee"("department");

-- CreateIndex
CREATE INDEX "Employee_active_idx" ON "Employee"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Student_studentId_key" ON "Student"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_email_key" ON "Student"("email");

-- CreateIndex
CREATE INDEX "Student_active_idx" ON "Student"("active");

-- CreateIndex
CREATE INDEX "Guest_active_idx" ON "Guest"("active");

-- CreateIndex
CREATE INDEX "GuestVisit_status_expectedFrom_idx" ON "GuestVisit"("status", "expectedFrom");

-- CreateIndex
CREATE INDEX "GuestVisit_guestId_idx" ON "GuestVisit"("guestId");

-- CreateIndex
CREATE INDEX "GuestVisit_hostEmployeeId_idx" ON "GuestVisit"("hostEmployeeId");

-- CreateIndex
CREATE INDEX "Vehicle_plateNorm_idx" ON "Vehicle"("plateNorm");

-- CreateIndex
CREATE INDEX "Vehicle_employeeId_idx" ON "Vehicle"("employeeId");

-- CreateIndex
CREATE INDEX "Vehicle_studentId_idx" ON "Vehicle"("studentId");

-- CreateIndex
CREATE INDEX "Vehicle_guestId_idx" ON "Vehicle"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingArea_code_key" ON "ParkingArea"("code");

-- CreateIndex
CREATE INDEX "ParkingBay_areaId_bayType_idx" ON "ParkingBay"("areaId", "bayType");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingBay_areaId_code_key" ON "ParkingBay"("areaId", "code");

-- CreateIndex
CREATE INDEX "ParkingSession_bayId_endedAt_idx" ON "ParkingSession"("bayId", "endedAt");

-- CreateIndex
CREATE INDEX "ParkingSession_vehicleId_endedAt_idx" ON "ParkingSession"("vehicleId", "endedAt");

-- CreateIndex
CREATE INDEX "ParkingSession_startedAt_endedAt_idx" ON "ParkingSession"("startedAt", "endedAt");

-- CreateIndex
CREATE INDEX "Event_employeeId_occurredAt_idx" ON "Event"("employeeId", "occurredAt");

-- CreateIndex
CREATE INDEX "Event_occurredAt_idx" ON "Event"("occurredAt");

-- CreateIndex
CREATE INDEX "Event_supersededById_idx" ON "Event"("supersededById");

-- CreateIndex
CREATE INDEX "Ticket_status_raisedAt_idx" ON "Ticket"("status", "raisedAt");

-- CreateIndex
CREATE INDEX "Ticket_raisedBy_status_idx" ON "Ticket"("raisedBy", "status");

-- CreateIndex
CREATE INDEX "ImportBatch_createdAt_idx" ON "ImportBatch"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestVisit" ADD CONSTRAINT "GuestVisit_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestVisit" ADD CONSTRAINT "GuestVisit_hostEmployeeId_fkey" FOREIGN KEY ("hostEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestVisit" ADD CONSTRAINT "GuestVisit_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestVisit" ADD CONSTRAINT "GuestVisit_checkedInBy_fkey" FOREIGN KEY ("checkedInBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestVisit" ADD CONSTRAINT "GuestVisit_checkedOutBy_fkey" FOREIGN KEY ("checkedOutBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingBay" ADD CONSTRAINT "ParkingBay_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "ParkingArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingSession" ADD CONSTRAINT "ParkingSession_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES "ParkingBay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingSession" ADD CONSTRAINT "ParkingSession_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingSession" ADD CONSTRAINT "ParkingSession_allocatedBy_fkey" FOREIGN KEY ("allocatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingSession" ADD CONSTRAINT "ParkingSession_endedBy_fkey" FOREIGN KEY ("endedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_voidedBy_fkey" FOREIGN KEY ("voidedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_raisedBy_fkey" FOREIGN KEY ("raisedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Domain checks (Prisma cannot express CHECK constraints).
-- ---------------------------------------------------------------------------
ALTER TABLE "User" ADD CONSTRAINT "user_role_check" CHECK ("role" IN ('SECURITY','HR','DEAN'));
ALTER TABLE "Employee" ADD CONSTRAINT "employee_category_check" CHECK ("category" IN ('staff','contractor'));
ALTER TABLE "Vehicle" ADD CONSTRAINT "vehicle_type_check" CHECK ("vehicleType" IN ('car','motorbike','van','other'));
ALTER TABLE "Vehicle" ADD CONSTRAINT "vehicle_one_holder_check" CHECK (
  (CASE WHEN "employeeId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "studentId" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "guestId" IS NOT NULL THEN 1 ELSE 0 END) = 1
);
ALTER TABLE "ParkingBay" ADD CONSTRAINT "bay_type_check" CHECK ("bayType" IN ('STAFF','STUDENT','GUEST','GENERAL','ACCESSIBLE','MOTORBIKE'));
ALTER TABLE "ParkingSession" ADD CONSTRAINT "session_holder_category_check" CHECK ("holderCategory" IN ('employee','student','guest'));
ALTER TABLE "ParkingSession" ADD CONSTRAINT "session_end_reason_check" CHECK ("endReason" IS NULL OR "endReason" IN ('gate_release','relocated','guest_checkout','hr'));
ALTER TABLE "Event" ADD CONSTRAINT "event_direction_check" CHECK ("direction" IN ('IN','OUT'));
ALTER TABLE "Event" ADD CONSTRAINT "event_source_check" CHECK ("source" IN ('gate','amendment','hr_edit'));
ALTER TABLE "GuestVisit" ADD CONSTRAINT "guest_visit_status_check" CHECK ("status" IN ('EXPECTED','ON_SITE','DEPARTED','CANCELLED'));
ALTER TABLE "Ticket" ADD CONSTRAINT "ticket_status_check" CHECK ("status" IN ('open','approved','applied','rejected','withdrawn'));
ALTER TABLE "Ticket" ADD CONSTRAINT "ticket_proposed_direction_check" CHECK ("proposedDirection" IN ('IN','OUT'));
ALTER TABLE "Ticket" ADD CONSTRAINT "ticket_hr_direction_check" CHECK ("hrDirection" IS NULL OR "hrDirection" IN ('IN','OUT'));
ALTER TABLE "ImportBatch" ADD CONSTRAINT "import_batch_kind_check" CHECK ("kind" IN ('employees','students'));

-- ---------------------------------------------------------------------------
-- Partial unique indexes: an active session is the only row that can contend.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "parking_sessions_active_bay_uq"
  ON "ParkingSession" ("bayId") WHERE "endedAt" IS NULL;
CREATE UNIQUE INDEX "parking_sessions_active_vehicle_uq"
  ON "ParkingSession" ("vehicleId") WHERE "endedAt" IS NULL AND "vehicleId" IS NOT NULL;
CREATE UNIQUE INDEX "vehicles_active_plate_norm_uq"
  ON "Vehicle" ("plateNorm") WHERE "active" = true;

-- ---------------------------------------------------------------------------
-- Trigram indexes for the one global search.
-- ---------------------------------------------------------------------------
CREATE INDEX "employees_name_trgm_idx"
  ON "Employee" USING GIN ((("firstName" || ' ' || "lastName")) gin_trgm_ops);
CREATE INDEX "employees_department_trgm_idx"
  ON "Employee" USING GIN ("department" gin_trgm_ops);
CREATE INDEX "guests_name_trgm_idx"
  ON "Guest" USING GIN ("fullName" gin_trgm_ops);
CREATE INDEX "vehicles_plate_trgm_idx"
  ON "Vehicle" USING GIN ("plateNorm" gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- The audit log is append-only at the database boundary, not only in the app.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

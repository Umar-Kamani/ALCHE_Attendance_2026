-- Student bays become general-purpose bays.
UPDATE "ParkingBay"
SET "bayType" = 'GENERAL',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "bayType" = 'STUDENT';

-- Close any live student parking so those bays are immediately available.
UPDATE "ParkingSession"
SET "endedAt" = CURRENT_TIMESTAMP,
    "endedBy" = NULL,
    "endReason" = 'gate_release',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "holderCategory" = 'student'
  AND "endedAt" IS NULL;

-- Keep historical parking snapshots, but detach them from vehicles that are leaving.
UPDATE "GuestVisit" gv
SET "vehicleId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "Vehicle" v
WHERE gv."vehicleId" = v."id"
  AND v."studentId" IS NOT NULL;

UPDATE "ParkingSession" ps
SET "vehicleId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "Vehicle" v
WHERE ps."vehicleId" = v."id"
  AND v."studentId" IS NOT NULL;

DELETE FROM "Vehicle" WHERE "studentId" IS NOT NULL;
DELETE FROM "ImportBatch" WHERE "kind" = 'students';

ALTER TABLE "ImportBatch" DROP CONSTRAINT "import_batch_kind_check";
ALTER TABLE "ImportBatch"
  ADD CONSTRAINT "import_batch_kind_check" CHECK ("kind" IN ('employees'));

DROP INDEX "Vehicle_studentId_idx";
ALTER TABLE "Vehicle" DROP CONSTRAINT "Vehicle_studentId_fkey";
ALTER TABLE "Vehicle" DROP COLUMN "studentId";
DROP TABLE "Student";

DROP TABLE "ParkingSession";
DROP TABLE "ParkingBay";
DROP TABLE "ParkingArea";

DROP TABLE "GuestVisit";

DELETE FROM "Vehicle" WHERE "guestId" IS NOT NULL;

ALTER TABLE "Vehicle" DROP CONSTRAINT IF EXISTS "vehicle_one_holder_check";
DROP INDEX "Vehicle_guestId_idx";
ALTER TABLE "Vehicle" DROP CONSTRAINT "Vehicle_guestId_fkey";
ALTER TABLE "Vehicle" DROP COLUMN "guestId";
ALTER TABLE "Vehicle" ALTER COLUMN "employeeId" SET NOT NULL;

DROP TABLE "Guest";

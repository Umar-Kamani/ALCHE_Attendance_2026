ALTER TABLE "Vehicle" DROP CONSTRAINT IF EXISTS "vehicle_one_holder_check";
ALTER TABLE "Vehicle"
  ADD CONSTRAINT "vehicle_one_holder_check" CHECK (
    (CASE WHEN "employeeId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "guestId" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

ALTER TABLE "ParkingBay" DROP CONSTRAINT "bay_type_check";
ALTER TABLE "ParkingBay"
  ADD CONSTRAINT "bay_type_check" CHECK (
    "bayType" IN ('STAFF', 'GUEST', 'GENERAL', 'ACCESSIBLE', 'MOTORBIKE')
  );

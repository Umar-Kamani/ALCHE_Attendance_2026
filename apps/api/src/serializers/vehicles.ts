import type { Prisma } from '@prisma/client';
import type { Vehicle } from '@alche/shared';
import { isoRequired } from '../time.js';

export const VEHICLE_INCLUDE = {
  employee: { select: { id: true, firstName: true, lastName: true, code: true } },
} satisfies Prisma.VehicleInclude;

export type VehicleRecord = Prisma.VehicleGetPayload<{ include: typeof VEHICLE_INCLUDE }>;

export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[\s-]/g, '');
}

export function holderOf(vehicle: VehicleRecord) {
  return {
    kind: 'employee' as const,
    id: vehicle.employee.id,
    name: `${vehicle.employee.firstName} ${vehicle.employee.lastName}`,
  };
}

export function serializeVehicle(vehicle: VehicleRecord): Vehicle {
  return {
    id: vehicle.id,
    plate: vehicle.plate,
    plateNorm: vehicle.plateNorm,
    make: vehicle.make,
    model: vehicle.model,
    colour: vehicle.colour,
    vehicleType: vehicle.vehicleType as Vehicle['vehicleType'],
    active: vehicle.active,
    notes: vehicle.notes,
    holder: holderOf(vehicle),
    createdAt: isoRequired(vehicle.createdAt),
    updatedAt: isoRequired(vehicle.updatedAt),
  };
}

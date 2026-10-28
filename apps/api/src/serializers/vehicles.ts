import type { Prisma } from '@prisma/client';
import type { Vehicle } from '@alche/shared';
import { iso, isoRequired } from '../time.js';

export const VEHICLE_INCLUDE = {
  employee: { select: { id: true, firstName: true, lastName: true, code: true } },
  guest: { select: { id: true, fullName: true } },
  sessions: {
    orderBy: { startedAt: 'desc' as const },
    take: 30,
    include: { bay: { include: { area: true } } },
  },
} satisfies Prisma.VehicleInclude;

export type VehicleRecord = Prisma.VehicleGetPayload<{ include: typeof VEHICLE_INCLUDE }>;

export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[\s-]/g, '');
}

export function holderOf(vehicle: VehicleRecord): {
  kind: 'employee' | 'guest';
  id: string;
  name: string;
} {
  if (vehicle.employee) {
    return {
      kind: 'employee',
      id: vehicle.employee.id,
      name: `${vehicle.employee.firstName} ${vehicle.employee.lastName}`,
    };
  }
  return { kind: 'guest', id: vehicle.guest!.id, name: vehicle.guest!.fullName };
}

export function serializeVehicle(vehicle: VehicleRecord): Vehicle {
  const active = vehicle.sessions.find((session) => session.endedAt === null);
  const ended = vehicle.sessions.filter((session) => session.endedAt !== null);
  const lastSeen = ended[0]?.endedAt ?? active?.startedAt ?? null;
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
    activeParking: active
      ? {
          sessionId: active.id,
          bayId: active.bayId,
          bayCode: active.bay.code,
          areaName: active.bay.area.name,
          startedAt: isoRequired(active.startedAt),
        }
      : null,
    lastSeenAt: iso(lastSeen),
    createdAt: isoRequired(vehicle.createdAt),
    updatedAt: isoRequired(vehicle.updatedAt),
  };
}

export function sessionHistory(vehicle: VehicleRecord) {
  return vehicle.sessions.map((session) => ({
    sessionId: session.id,
    bayCode: session.bay.code,
    areaName: session.bay.area.name,
    startedAt: isoRequired(session.startedAt),
    endedAt: iso(session.endedAt),
    minutes: session.endedAt
      ? Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 60_000)
      : null,
    overrideReason: session.overrideReason,
  }));
}

import { Prisma } from '@prisma/client';
import type { ActiveParkingSession, BayChipType, BayType } from '@alche/shared';
import { prisma } from './db.js';
import { conflict, unprocessable } from './errors.js';
import { isoRequired } from './time.js';

export const SESSION_INCLUDE = {
  bay: { include: { area: true } },
  allocatedUser: { select: { displayName: true } },
  vehicle: { select: { vehicleType: true } },
} satisfies Prisma.ParkingSessionInclude;

export type SessionRecord = Prisma.ParkingSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

export const CHIP: Record<BayType, BayChipType> = {
  STAFF: 'S',
  STUDENT: 'St',
  GUEST: 'G',
  GENERAL: 'Gen',
  ACCESSIBLE: 'Acc',
  MOTORBIKE: 'M',
};

export const BAY_LABEL: Record<BayType, string> = {
  STAFF: 'Staff',
  STUDENT: 'Student',
  GUEST: 'Guest',
  GENERAL: 'General',
  ACCESSIBLE: 'Accessible',
  MOTORBIKE: 'Motorbike',
};

export function serializeSession(session: SessionRecord): ActiveParkingSession {
  return {
    id: session.id,
    bayId: session.bayId,
    bayCode: session.bay.code,
    areaId: session.bay.areaId,
    areaName: session.bay.area.name,
    vehicleId: session.vehicleId,
    plate: session.plateSnapshot,
    holderName: session.holderNameSnapshot,
    holderCategory: session.holderCategory as 'employee' | 'student' | 'guest',
    vehicleType: session.vehicle?.vehicleType ?? 'other',
    startedAt: isoRequired(session.startedAt),
    allocatedBy: session.allocatedUser.displayName,
    overrideReason: session.overrideReason,
    isOverride: Boolean(session.overrideReason),
    note: session.note,
  };
}

export interface Eligibility {
  requiresOverride: boolean;
  reason: string | null;
}

export function checkEligibility(
  holderCategory: 'employee' | 'student' | 'guest',
  bayType: BayType,
  vehicleType: string,
): Eligibility {
  if (bayType === 'GENERAL') return { requiresOverride: false, reason: null };
  if (bayType === 'ACCESSIBLE') {
    return {
      requiresOverride: true,
      reason: 'Accessible bays require an explicit audited reason because no permit field exists.',
    };
  }
  if (bayType === 'MOTORBIKE') {
    return vehicleType === 'motorbike'
      ? { requiresOverride: false, reason: null }
      : { requiresOverride: true, reason: 'This bay is reserved for motorbikes.' };
  }
  const expected =
    bayType === 'STAFF' ? 'employee' : bayType === 'STUDENT' ? 'student' : 'guest';
  if (holderCategory !== expected) {
    return {
      requiresOverride: true,
      reason: `${BAY_LABEL[bayType]} bays are reserved for ${expected}s.`,
    };
  }
  return { requiresOverride: false, reason: null };
}

export function bayNumber(code: string): number {
  const match = code.match(/(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function vehicleHolder(vehicle: {
  employee: { id: string; firstName: string; lastName: string; active: boolean } | null;
  student: { id: string; firstName: string; lastName: string; active: boolean } | null;
  guest: { id: string; fullName: string; active: boolean } | null;
}): { category: 'employee' | 'student' | 'guest'; id: string; name: string; active: boolean } {
  if (vehicle.employee) {
    return {
      category: 'employee',
      id: vehicle.employee.id,
      name: `${vehicle.employee.firstName} ${vehicle.employee.lastName}`,
      active: vehicle.employee.active,
    };
  }
  if (vehicle.student) {
    return {
      category: 'student',
      id: vehicle.student.id,
      name: `${vehicle.student.firstName} ${vehicle.student.lastName}`,
      active: vehicle.student.active,
    };
  }
  return {
    category: 'guest',
    id: vehicle.guest!.id,
    name: vehicle.guest!.fullName,
    active: vehicle.guest!.active,
  };
}

export async function vehicleForAllocation(vehicleId: string) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, active: true } },
      student: { select: { id: true, firstName: true, lastName: true, active: true } },
      guest: { select: { id: true, fullName: true, active: true } },
    },
  });
  if (!vehicle) throw unprocessable('Vehicle not found.');
  if (!vehicle.active) throw unprocessable('That vehicle is inactive.');
  const holder = vehicleHolder(vehicle);
  if (!holder.active) throw unprocessable('That vehicle holder is inactive.');
  return { vehicle, holder };
}

export async function assertHolderNotParked(
  holderCategory: 'employee' | 'student' | 'guest',
  holderId: string,
  excludeSessionId?: string,
): Promise<void> {
  const active = await prisma.parkingSession.findFirst({
    where: {
      endedAt: null,
      ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
      vehicle:
        holderCategory === 'employee'
          ? { employeeId: holderId }
          : holderCategory === 'student'
            ? { studentId: holderId }
            : { guestId: holderId },
    },
    include: { bay: { include: { area: true } } },
  });
  if (active) {
    throw conflict(
      'HOLDER_ALREADY_PARKED',
      `${active.holderNameSnapshot} already has a vehicle parked in ${active.bay.code}, ${active.bay.area.name}. One holder may have only one active parking session.`,
      { sessionId: active.id, bayCode: active.bay.code },
    );
  }
}

export async function assertVehicleNotParked(vehicleId: string): Promise<void> {
  const active = await prisma.parkingSession.findFirst({
    where: { vehicleId, endedAt: null },
    include: { bay: { include: { area: true } } },
  });
  if (active) {
    throw conflict(
      'VEHICLE_ALREADY_PARKED',
      `That vehicle is already parked in ${active.bay.code}, ${active.bay.area.name}. Release that bay first.`,
      { sessionId: active.id, bayId: active.bayId, bayCode: active.bay.code },
    );
  }
}

export async function assertBayFree(bayId: string): Promise<void> {
  const active = await prisma.parkingSession.findFirst({
    where: { bayId, endedAt: null },
  });
  if (active) {
    throw conflict('BAY_OCCUPIED', 'That bay is already occupied.', {
      sessionId: active.id,
    });
  }
}

export async function findAutoBay(
  holderCategory: 'employee' | 'student' | 'guest',
  vehicleType: string,
): Promise<{ id: string; code: string; bayType: BayType; areaName: string } | null> {
  const preferred: BayType =
    vehicleType === 'motorbike'
      ? 'MOTORBIKE'
      : holderCategory === 'employee'
        ? 'STAFF'
        : holderCategory === 'student'
          ? 'STUDENT'
          : 'GUEST';

  const candidates = await prisma.parkingBay.findMany({
    where: {
      active: true,
      area: { active: true },
      bayType: { in: [preferred, 'GENERAL'] },
      sessions: { none: { endedAt: null } },
    },
    include: { area: { select: { name: true } } },
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.bayType === preferred && b.bayType !== preferred) return -1;
    if (b.bayType === preferred && a.bayType !== preferred) return 1;
    const difference = bayNumber(a.code) - bayNumber(b.code);
    return difference !== 0 ? difference : a.code.localeCompare(b.code);
  });
  const best = candidates[0]!;
  return {
    id: best.id,
    code: best.code,
    bayType: best.bayType as BayType,
    areaName: best.area.name,
  };
}

export function prismaConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = String(error.meta?.target ?? '');
    if (target.includes('vehicle')) {
      throw conflict('VEHICLE_ALREADY_PARKED', 'That vehicle already has an active parking session.');
    }
    throw conflict('BAY_OCCUPIED', 'That bay was occupied by another officer a moment ago.');
  }
  throw error;
}


import type { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import type { GuestVisit } from '@alche/shared';
import { APP_ZONE, iso, isoRequired, nowUtc } from '../time.js';

export const VISIT_INCLUDE = {
  guest: true,
  hostEmployee: { select: { id: true, firstName: true, lastName: true, department: true } },
  vehicle: {
    include: {
      sessions: {
        where: { endedAt: null },
        take: 1,
        include: { bay: { include: { area: true } } },
      },
    },
  },
  checkedInUser: { select: { displayName: true } },
  checkedOutUser: { select: { displayName: true } },
} satisfies Prisma.GuestVisitInclude;

export type VisitRecord = Prisma.GuestVisitGetPayload<{ include: typeof VISIT_INCLUDE }>;

export function visitStatus(visit: VisitRecord): GuestVisit['status'] {
  if (visit.status === 'ON_SITE') {
    return visit.expectedTo && visit.expectedTo < nowUtc().toJSDate() ? 'OVERDUE' : 'ON_SITE';
  }
  return visit.status as GuestVisit['status'];
}

export function serializeVisit(visit: VisitRecord): GuestVisit {
  const activeSession = visit.vehicle?.sessions[0];
  return {
    id: visit.id,
    guest: {
      id: visit.guest.id,
      fullName: visit.guest.fullName,
      company: visit.guest.company,
      phone: visit.guest.phone,
      idNumber: visit.guest.idNumber,
    },
    host: {
      id: visit.hostEmployee.id,
      fullName: `${visit.hostEmployee.firstName} ${visit.hostEmployee.lastName}`,
      department: visit.hostEmployee.department,
    },
    purpose: visit.purpose,
    expectedFrom: isoRequired(visit.expectedFrom),
    expectedTo: isoRequired(visit.expectedTo),
    badgeNo: visit.badgeNo,
    checkedInAt: iso(visit.checkedInAt),
    checkedInBy: visit.checkedInUser?.displayName ?? null,
    checkedOutAt: iso(visit.checkedOutAt),
    checkedOutBy: visit.checkedOutUser?.displayName ?? null,
    status: visitStatus(visit),
    storedStatus: visit.status as GuestVisit['storedStatus'],
    overdue: visitStatus(visit) === 'OVERDUE',
    vehicle: visit.vehicle
      ? {
          id: visit.vehicle.id,
          plate: visit.vehicle.plate,
          make: visit.vehicle.make,
          model: visit.vehicle.model,
          colour: visit.vehicle.colour,
          vehicleType: visit.vehicle.vehicleType,
        }
      : null,
    activeParking: activeSession
      ? {
          sessionId: activeSession.id,
          bayCode: activeSession.bay.code,
          areaName: activeSession.bay.area.name,
        }
      : null,
    note: visit.note,
    createdAt: isoRequired(visit.createdAt),
    updatedAt: isoRequired(visit.updatedAt),
  };
}

export function visitLocalDate(visit: Pick<VisitRecord, 'expectedFrom'>): string {
  return (
    DateTime.fromJSDate(visit.expectedFrom, { zone: 'utc' }).setZone(APP_ZONE).toISODate() ?? ''
  );
}

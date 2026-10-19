import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  KioskSearchQuerySchema,
  KioskSearchResponseSchema,
} from '@alche/shared';
import { prisma } from '../db.js';
import { isoRequired } from '../time.js';

function searchTerms(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
}

function normalizedPlate(query: string): string {
  return query.toUpperCase().replace(/[\s-]/g, '');
}

const VEHICLE_INCLUDE = {
  where: { active: true },
  include: {
    sessions: {
      where: { endedAt: null },
      take: 1,
      include: { bay: { include: { area: true } } },
    },
  },
  orderBy: { plate: 'asc' as const },
} as const;

type VehicleWithSessions = {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  colour: string | null;
  vehicleType: string;
  sessions: Array<{
    id: string;
    bayId: string;
    startedAt: Date;
    bay: { code: string; area: { name: string } };
  }>;
};

function serializeVehicle(vehicle: VehicleWithSessions) {
  const session = vehicle.sessions[0];
  return {
    id: vehicle.id,
    plate: vehicle.plate,
    make: vehicle.make,
    model: vehicle.model,
    colour: vehicle.colour,
    vehicleType: vehicle.vehicleType,
    activeParking: session
      ? {
          sessionId: session.id,
          bayId: session.bayId,
          bayCode: session.bay.code,
          areaName: session.bay.area.name,
          startedAt: isoRequired(session.startedAt),
        }
      : null,
  };
}

export async function kioskRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/kiosk/search',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        querystring: KioskSearchQuerySchema,
        response: { 200: KioskSearchResponseSchema },
      },
    },
    async (request) => {
      const q = request.query.q.trim();
      const terms = searchTerms(q);
      const plate = normalizedPlate(q);

      const plateVehicles = await prisma.vehicle.findMany({
        where: {
          active: true,
          OR: [
            ...(plate ? [{ plateNorm: { contains: plate } }] : []),
            { plate: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { employeeId: true, studentId: true, guestId: true },
        take: 100,
      });
      const employeeIds = plateVehicles
        .map((vehicle) => vehicle.employeeId)
        .filter((id): id is string => Boolean(id));
      const studentIds = plateVehicles
        .map((vehicle) => vehicle.studentId)
        .filter((id): id is string => Boolean(id));
      const guestIds = plateVehicles
        .map((vehicle) => vehicle.guestId)
        .filter((id): id is string => Boolean(id));

      const tokenWhere = terms.map((term) => ({
        OR: [
          { firstName: { contains: term, mode: 'insensitive' as const } },
          { lastName: { contains: term, mode: 'insensitive' as const } },
          { code: { contains: term, mode: 'insensitive' as const } },
        ],
      }));
      const studentTokenWhere = terms.map((term) => ({
        OR: [
          { firstName: { contains: term, mode: 'insensitive' as const } },
          { lastName: { contains: term, mode: 'insensitive' as const } },
          { studentId: { contains: term, mode: 'insensitive' as const } },
        ],
      }));

      const [employees, students, guests] = await Promise.all([
        prisma.employee.findMany({
          where: {
            OR: [
              ...(tokenWhere.length ? [{ AND: tokenWhere }] : []),
              ...(employeeIds.length ? [{ id: { in: employeeIds } }] : []),
            ],
          },
          include: {
            events: {
              where: { voidedAt: null, supersededById: null },
              orderBy: { occurredAt: 'desc' },
              take: 1,
              select: { direction: true, occurredAt: true },
            },
            vehicles: VEHICLE_INCLUDE,
          },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          take: 8,
        }),
        prisma.student.findMany({
          where: {
            OR: [
              ...(studentTokenWhere.length ? [{ AND: studentTokenWhere }] : []),
              ...(studentIds.length ? [{ id: { in: studentIds } }] : []),
            ],
          },
          include: { vehicles: VEHICLE_INCLUDE },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          take: 8,
        }),
        prisma.guest.findMany({
          where: {
            OR: [
              { fullName: { contains: q, mode: 'insensitive' } },
              ...(guestIds.length ? [{ id: { in: guestIds } }] : []),
            ],
          },
          include: { vehicles: VEHICLE_INCLUDE },
          orderBy: { fullName: 'asc' },
          take: 8,
        }),
      ]);

      return {
        employees: employees.map((employee) => {
          const latest = employee.events[0];
          return {
            kind: 'employee' as const,
            id: employee.id,
            code: employee.code,
            fullName: `${employee.firstName} ${employee.lastName}`,
            department: employee.department,
            category: employee.category as 'staff' | 'contractor',
            active: employee.active,
            currentState: {
              onCampus: latest?.direction === 'IN',
              since:
                latest?.direction === 'IN' ? isoRequired(latest.occurredAt) : null,
              lastDirection: (latest?.direction as 'IN' | 'OUT' | undefined) ?? null,
              lastOccurredAt: latest ? isoRequired(latest.occurredAt) : null,
            },
            vehicles: employee.vehicles.map(serializeVehicle),
          };
        }),
        students: students.map((student) => ({
          kind: 'student' as const,
          id: student.id,
          studentId: student.studentId,
          fullName: `${student.firstName} ${student.lastName}`,
          programme: student.programme,
          active: student.active,
          vehicles: student.vehicles.map(serializeVehicle),
        })),
        guests: guests.map((guest) => ({
          kind: 'guest' as const,
          id: guest.id,
          fullName: guest.fullName,
          company: guest.company,
          active: guest.active,
          vehicles: guest.vehicles.map(serializeVehicle),
        })),
      };
    },
  );
}

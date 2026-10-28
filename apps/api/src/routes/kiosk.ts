import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import {
  KioskEmployeeOptionsResponseSchema,
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
  orderBy: { plate: 'asc' as const },
} as const;

const EMPLOYEE_INCLUDE = {
  events: {
    where: { voidedAt: null, supersededById: null },
    orderBy: { occurredAt: 'desc' as const },
    take: 1,
    select: { direction: true, occurredAt: true },
  },
  vehicles: VEHICLE_INCLUDE,
} as const;

type EmployeeRecord = Prisma.EmployeeGetPayload<{ include: typeof EMPLOYEE_INCLUDE }>;

function serializeEmployee(employee: EmployeeRecord) {
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
      since: latest?.direction === 'IN' ? isoRequired(latest.occurredAt) : null,
      lastDirection: (latest?.direction as 'IN' | 'OUT' | undefined) ?? null,
      lastOccurredAt: latest ? isoRequired(latest.occurredAt) : null,
    },
    vehicles: employee.vehicles.map((vehicle) => ({
      id: vehicle.id,
      plate: vehicle.plate,
      make: vehicle.make,
      model: vehicle.model,
      colour: vehicle.colour,
      vehicleType: vehicle.vehicleType,
    })),
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
        select: { employeeId: true },
        take: 100,
      });
      const employeeIds = plateVehicles.map((vehicle) => vehicle.employeeId);
      const tokenWhere = terms.map((term) => ({
        OR: [
          { firstName: { contains: term, mode: 'insensitive' as const } },
          { lastName: { contains: term, mode: 'insensitive' as const } },
          { code: { contains: term, mode: 'insensitive' as const } },
        ],
      }));

      const employees = await prisma.employee.findMany({
        where: {
          active: true,
          OR: [
            ...(tokenWhere.length ? [{ AND: tokenWhere }] : []),
            ...(employeeIds.length ? [{ id: { in: employeeIds } }] : []),
          ],
        },
        include: EMPLOYEE_INCLUDE,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: 8,
      });

      return { employees: employees.map(serializeEmployee) };
    },
  );

  typed.get(
    '/kiosk/employees',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: { response: { 200: KioskEmployeeOptionsResponseSchema } },
    },
    async () => {
      const employees = await prisma.employee.findMany({
        where: { active: true },
        include: EMPLOYEE_INCLUDE,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: 1000,
      });
      return { employees: employees.map(serializeEmployee) };
    },
  );
}

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CreateVehicleBodySchema,
  IdParamSchema,
  UpdateVehicleBodySchema,
  VehicleDetailSchema,
  VehicleListQuerySchema,
  VehicleListResponseSchema,
  VehicleSchema,
} from '@alche/shared';
import { prisma } from '../db.js';
import { conflict, notFound, unprocessable } from '../errors.js';
import { audit } from '../audit.js';
import { pageArgs, pageMeta } from '../pagination.js';
import {
  VEHICLE_INCLUDE,
  normalizePlate,
  serializeVehicle,
} from '../serializers/vehicles.js';

async function resolveEmployee(id: string) {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) throw notFound('That employee does not exist.');
  if (!employee.active) throw unprocessable('That employee is inactive.');
  return employee;
}

async function plateConflict(plateNorm: string, excludeId?: string) {
  const existing = await prisma.vehicle.findFirst({
    where: {
      plateNorm,
      active: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    include: { employee: true },
  });
  if (existing) {
    const holder = `${existing.employee.firstName} ${existing.employee.lastName}`;
    throw conflict(
      'PLATE_TAKEN',
      `${existing.plate} is registered to ${holder}.`,
      { vehicleId: existing.id, holder },
    );
  }
}

export async function vehicleRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/vehicles',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        querystring: VehicleListQuerySchema,
        response: { 200: VehicleListResponseSchema },
      },
    },
    async (request) => {
      const q = request.query.q?.trim();
      const where = {
        ...(q
          ? {
              OR: [
                { plateNorm: { contains: q.toUpperCase().replace(/[\s-]/g, '') } },
                { plate: { contains: q, mode: 'insensitive' as const } },
                { employee: { firstName: { contains: q, mode: 'insensitive' as const } } },
                { employee: { lastName: { contains: q, mode: 'insensitive' as const } } },
                { employee: { code: { contains: q, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      };
      const [vehicles, total] = await Promise.all([
        prisma.vehicle.findMany({
          where,
          include: VEHICLE_INCLUDE,
          orderBy: { plate: 'asc' },
          ...pageArgs(request.query.page),
        }),
        prisma.vehicle.count({ where }),
      ]);
      return {
        items: vehicles.map(serializeVehicle),
        meta: pageMeta(request.query.page, total),
      };
    },
  );

  typed.get(
    '/vehicles/:id',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: { params: IdParamSchema, response: { 200: VehicleDetailSchema } },
    },
    async (request) => {
      const vehicle = await prisma.vehicle.findUnique({
        where: { id: request.params.id },
        include: VEHICLE_INCLUDE,
      });
      if (!vehicle) throw notFound('Vehicle not found.');
      return serializeVehicle(vehicle);
    },
  );

  typed.post(
    '/vehicles',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: { body: CreateVehicleBodySchema, response: { 201: VehicleSchema } },
    },
    async (request, reply) => {
      await resolveEmployee(request.body.employeeId);
      const plateNorm = normalizePlate(request.body.plate);
      if (plateNorm.length < 2) throw unprocessable('Enter a valid number plate.');
      if (request.body.active) await plateConflict(plateNorm);

      const vehicle = await prisma.vehicle.create({
        data: {
          plate: request.body.plate.trim().toUpperCase(),
          plateNorm,
          make: request.body.make ?? null,
          model: request.body.model ?? null,
          colour: request.body.colour ?? null,
          vehicleType: request.body.vehicleType,
          active: request.body.active,
          notes: request.body.notes ?? null,
          employeeId: request.body.employeeId,
        },
        include: VEHICLE_INCLUDE,
      });
      await audit(request, {
        action: 'vehicle.create',
        entityType: 'vehicle',
        entityId: vehicle.id,
        after: serializeVehicle(vehicle),
      });
      reply.status(201);
      return serializeVehicle(vehicle);
    },
  );

  typed.patch(
    '/vehicles/:id',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: {
        params: IdParamSchema,
        body: UpdateVehicleBodySchema,
        response: { 200: VehicleSchema },
      },
    },
    async (request) => {
      const current = await prisma.vehicle.findUnique({
        where: { id: request.params.id },
        include: VEHICLE_INCLUDE,
      });
      if (!current) throw notFound('Vehicle not found.');

      const plateNorm = request.body.plate ? normalizePlate(request.body.plate) : current.plateNorm;
      const becomesActive = request.body.active ?? current.active;
      if (request.body.plate || request.body.active) {
        if (plateNorm.length < 2) throw unprocessable('Enter a valid number plate.');
        if (becomesActive) await plateConflict(plateNorm, current.id);
      }

      const vehicle = await prisma.vehicle.update({
        where: { id: current.id },
        data: {
          ...(request.body.plate ? { plate: request.body.plate.trim().toUpperCase() } : {}),
          ...(request.body.plate ? { plateNorm } : {}),
          ...(request.body.make === undefined ? {} : { make: request.body.make }),
          ...(request.body.model === undefined ? {} : { model: request.body.model }),
          ...(request.body.colour === undefined ? {} : { colour: request.body.colour }),
          ...(request.body.vehicleType === undefined
            ? {}
            : { vehicleType: request.body.vehicleType }),
          ...(request.body.active === undefined ? {} : { active: request.body.active }),
          ...(request.body.notes === undefined ? {} : { notes: request.body.notes }),
        },
        include: VEHICLE_INCLUDE,
      });
      await audit(request, {
        action: vehicle.active ? 'vehicle.update' : 'vehicle.deactivate',
        entityType: 'vehicle',
        entityId: vehicle.id,
        before: serializeVehicle(current),
        after: serializeVehicle(vehicle),
      });
      return serializeVehicle(vehicle);
    },
  );
}

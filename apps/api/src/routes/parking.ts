import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import {
  AllocateSessionBodySchema,
  BayListQuerySchema,
  BayListResponseSchema,
  BaySchema,
  BulkBayBodySchema,
  BulkBayResponseSchema,
  CreateBayBodySchema,
  CreateParkingAreaBodySchema,
  IdParamSchema,
  ParkingAreaListResponseSchema,
  ParkingAreaSchema,
  ParkingBoardQuerySchema,
  ParkingBoardResponseSchema,
  ParkingExportQuerySchema,
  ParkingHistoryQuerySchema,
  ParkingHistoryResponseSchema,
  ReleaseSessionBodySchema,
  RelocateSessionBodySchema,
  SessionMutationResponseSchema,
  UpdateBayBodySchema,
  UpdateParkingAreaBodySchema,
  daysInclusive,
  type BayType,
} from '@alche/shared';
import { prisma } from '../db.js';
import { conflict, notFound, unprocessable } from '../errors.js';
import { audit } from '../audit.js';
import { sendCsv } from '../csv.js';
import {
  APP_ZONE,
  localTimeOf,
  nowUtc,
  rangeEndUtc,
  rangeStartUtc,
} from '../time.js';
import {
  BAY_LABEL,
  CHIP,
  SESSION_INCLUDE,
  assertBayFree,
  assertHolderNotParked,
  assertVehicleNotParked,
  checkEligibility,
  findAutoBay,
  prismaConflict,
  serializeSession,
  vehicleForAllocation,
  type SessionRecord,
} from '../parking-service.js';

function chip(bayType: string) {
  return CHIP[bayType as keyof typeof CHIP];
}

function capacity(total: number, occupied: number) {
  return { total, occupied, free: total - occupied };
}

function capacityByType(
  bays: Array<{ bayType: string; session: unknown }>,
): Record<string, { total: number; occupied: number; free: number }> {
  const map: Record<string, { total: number; occupied: number; free: number }> = {};
  for (const bay of bays) {
    const group = (map[bay.bayType] ??= { total: 0, occupied: 0, free: 0 });
    group.total += 1;
    if (bay.session) group.occupied += 1;
  }
  for (const group of Object.values(map)) group.free = group.total - group.occupied;
  return map;
}

export async function parkingRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/parking/areas',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: { response: { 200: ParkingAreaListResponseSchema } },
    },
    async () => {
      const areas = await prisma.parkingArea.findMany({
        include: {
          bays: {
            include: {
              sessions: { where: { endedAt: null }, select: { id: true } },
            },
          },
        },
        orderBy: { name: 'asc' },
      });
      return {
        items: areas.map((area) => {
          const activeBays = area.bays.filter((bay) => bay.active);
          const occupied = activeBays.filter((bay) => bay.sessions.length > 0).length;
          return {
            id: area.id,
            name: area.name,
            code: area.code,
            active: area.active,
            notes: area.notes,
            bayCount: area.bays.length,
            live: capacity(activeBays.length, occupied),
          };
        }),
      };
    },
  );

  typed.post(
    '/parking/areas',
    {
      preHandler: [app.authenticate, app.requireRole('SECURITY')],
      schema: { body: CreateParkingAreaBodySchema, response: { 201: ParkingAreaSchema } },
    },
    async (request, reply) => {
      const existing = await prisma.parkingArea.findUnique({ where: { code: request.body.code } });
      if (existing) throw conflict('AREA_CODE_TAKEN', `Area code ${request.body.code} is already in use.`);
      const area = await prisma.parkingArea.create({
        data: {
          name: request.body.name,
          code: request.body.code.toUpperCase(),
          notes: request.body.notes ?? null,
          active: request.body.active,
        },
      });
      await audit(request, {
        action: 'parking_area.create',
        entityType: 'parking_area',
        entityId: area.id,
        after: area,
      });
      reply.status(201);
      return {
        id: area.id,
        name: area.name,
        code: area.code,
        active: area.active,
        notes: area.notes,
        bayCount: 0,
        live: capacity(0, 0),
      };
    },
  );

  typed.patch(
    '/parking/areas/:id',
    {
      preHandler: [app.authenticate, app.requireRole('SECURITY')],
      schema: {
        params: IdParamSchema,
        body: UpdateParkingAreaBodySchema,
        response: { 200: ParkingAreaSchema },
      },
    },
    async (request) => {
      const id = request.params.id;
      const current = await prisma.parkingArea.findUnique({
        where: { id },
        include: { bays: { include: { sessions: { where: { endedAt: null }, select: { id: true } } } } },
      });
      if (!current) throw notFound('Parking area not found.');
      if (request.body.active === false) {
        const occupied = current.bays.some((bay) => bay.sessions.length > 0);
        if (occupied) throw conflict('AREA_OCCUPIED', 'Release all active parking sessions before deactivating this area.');
      }
      if (request.body.code) {
        const duplicate = await prisma.parkingArea.findFirst({
          where: { code: request.body.code, id: { not: current.id } },
        });
        if (duplicate) throw conflict('AREA_CODE_TAKEN', `Area code ${request.body.code} is already in use.`);
      }
      const area = await prisma.parkingArea.update({
        where: { id: current.id },
        data: {
          ...(request.body.name === undefined ? {} : { name: request.body.name }),
          ...(request.body.code === undefined ? {} : { code: request.body.code.toUpperCase() }),
          ...(request.body.notes === undefined ? {} : { notes: request.body.notes }),
          ...(request.body.active === undefined ? {} : { active: request.body.active }),
        },
      });
      const activeBays = current.bays.filter((bay) => bay.active);
      const occupied = activeBays.filter((bay) => bay.sessions.length > 0).length;
      await audit(request, {
        action: 'parking_area.update',
        entityType: 'parking_area',
        entityId: area.id,
        before: current,
        after: area,
      });
      return {
        id: area.id,
        name: area.name,
        code: area.code,
        active: area.active,
        notes: area.notes,
        bayCount: current.bays.length,
        live: capacity(activeBays.length, occupied),
      };
    },
  );

  typed.get(
    '/parking/bays',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: { querystring: BayListQuerySchema, response: { 200: BayListResponseSchema } },
    },
    async (request) => {
      const bays = await prisma.parkingBay.findMany({
        where: {
          ...(request.query.areaId ? { areaId: request.query.areaId } : {}),
          ...(request.query.includeInactive ? {} : { active: true }),
        },
        include: {
          area: true,
          sessions: { where: { endedAt: null }, select: { id: true } },
        },
        orderBy: [{ area: { name: 'asc' } }, { code: 'asc' }],
      });
      return {
        items: bays.map((bay) => ({
          id: bay.id,
          areaId: bay.areaId,
          areaName: bay.area.name,
          code: bay.code,
          bayType: bay.bayType as never,
          chip: chip(bay.bayType) as never,
          active: bay.active,
          notes: bay.notes,
          occupied: bay.sessions.length > 0,
        })),
      };
    },
  );

  typed.post(
    '/parking/bays',
    {
      preHandler: [app.authenticate, app.requireRole('SECURITY')],
      schema: { body: CreateBayBodySchema, response: { 201: BaySchema } },
    },
    async (request, reply) => {
      const area = await prisma.parkingArea.findUnique({ where: { id: request.body.areaId } });
      if (!area || !area.active) throw notFound('Active parking area not found.');
      const code = request.body.code.trim().toUpperCase();
      const duplicate = await prisma.parkingBay.findFirst({
        where: { areaId: area.id, code },
      });
      if (duplicate) throw conflict('BAY_CODE_TAKEN', `Bay ${code} already exists in ${area.name}.`);
      const bay = await prisma.parkingBay.create({
        data: {
          areaId: area.id,
          code,
          bayType: request.body.bayType,
          notes: request.body.notes ?? null,
          active: request.body.active,
        },
      });
      await audit(request, {
        action: 'parking_bay.create',
        entityType: 'parking_bay',
        entityId: bay.id,
        after: bay,
      });
      reply.status(201);
      return {
        id: bay.id,
        areaId: area.id,
        areaName: area.name,
        code: bay.code,
        bayType: bay.bayType as never,
        chip: chip(bay.bayType) as never,
        active: bay.active,
        notes: bay.notes,
        occupied: false,
      };
    },
  );

  typed.patch(
    '/parking/bays/:id',
    {
      preHandler: [app.authenticate, app.requireRole('SECURITY')],
      schema: {
        params: IdParamSchema,
        body: UpdateBayBodySchema,
        response: { 200: BaySchema },
      },
    },
    async (request) => {
      const id = request.params.id;
      const current = await prisma.parkingBay.findUnique({
        where: { id },
        include: {
          area: true,
          sessions: { where: { endedAt: null }, select: { id: true } },
        },
      });
      if (!current) throw notFound('Parking bay not found.');
      const occupied = current.sessions.length > 0;
      if (occupied && (request.body.active === false || request.body.bayType !== undefined)) {
        throw conflict(
          'BAY_OCCUPIED',
          'Release the active parking session before deactivating or retyping this bay.',
        );
      }
      const code = request.body.code?.trim().toUpperCase();
      if (code) {
        const duplicate = await prisma.parkingBay.findFirst({
          where: { areaId: current.areaId, code, id: { not: current.id } },
        });
        if (duplicate) throw conflict('BAY_CODE_TAKEN', `Bay ${code} already exists in this area.`);
      }
      const bay = await prisma.parkingBay.update({
        where: { id: current.id },
        data: {
          ...(code === undefined ? {} : { code }),
          ...(request.body.bayType === undefined ? {} : { bayType: request.body.bayType }),
          ...(request.body.notes === undefined ? {} : { notes: request.body.notes }),
          ...(request.body.active === undefined ? {} : { active: request.body.active }),
        },
      });
      await audit(request, {
        action: 'parking_bay.update',
        entityType: 'parking_bay',
        entityId: bay.id,
        before: current,
        after: bay,
      });
      return {
        id: bay.id,
        areaId: current.areaId,
        areaName: current.area.name,
        code: bay.code,
        bayType: bay.bayType as never,
        chip: chip(bay.bayType) as never,
        active: bay.active,
        notes: bay.notes,
        occupied,
      };
    },
  );

  typed.post(
    '/parking/bays/bulk',
    {
      preHandler: [app.authenticate, app.requireRole('SECURITY')],
      schema: { body: BulkBayBodySchema, response: { 200: BulkBayResponseSchema } },
    },
    async (request) => {
      const area = await prisma.parkingArea.findUnique({ where: { id: request.body.areaId } });
      if (!area || !area.active) throw notFound('Active parking area not found.');
      if (request.body.from > request.body.to) {
        throw unprocessable('The starting number must be on or before the ending number.');
      }
      if (request.body.to - request.body.from > 499) {
        throw unprocessable('Create at most 500 bays at once.');
      }
      const codes: string[] = [];
      for (let number = request.body.from; number <= request.body.to; number += 1) {
        codes.push(
          `${request.body.prefix}${String(number).padStart(request.body.padding, '0')}`.toUpperCase(),
        );
      }
      const existing = await prisma.parkingBay.findMany({
        where: { areaId: area.id, code: { in: codes } },
        select: { code: true },
      });
      const existingCodes = new Set(existing.map((bay) => bay.code));
      const toCreate = codes.filter((code) => !existingCodes.has(code));
      const skipped = codes.filter((code) => existingCodes.has(code));

      if (!request.body.dryRun && toCreate.length > 0) {
        await prisma.parkingBay.createMany({
          data: toCreate.map((code) => ({
            areaId: area.id,
            code,
            bayType: request.body.bayType,
            notes: request.body.notes ?? null,
            active: true,
          })),
        });
        await audit(request, {
          action: 'parking_bay.bulk_create',
          entityType: 'parking_area',
          entityId: area.id,
          after: { codes: toCreate, bayType: request.body.bayType },
        });
      }
      const createdBays =
        request.body.dryRun || toCreate.length === 0
          ? []
          : await prisma.parkingBay.findMany({
              where: { areaId: area.id, code: { in: toCreate } },
              orderBy: { code: 'asc' },
            });
      return {
        dryRun: request.body.dryRun,
        created: createdBays.map((bay) => ({
          id: bay.id,
          areaId: area.id,
          areaName: area.name,
          code: bay.code,
          bayType: bay.bayType as never,
          chip: chip(bay.bayType) as never,
          active: bay.active,
          notes: bay.notes,
          occupied: false,
        })),
        skipped,
        preview: codes,
      };
    },
  );

  typed.get(
    '/parking/board',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        querystring: ParkingBoardQuerySchema,
        response: { 200: ParkingBoardResponseSchema },
      },
    },
    async (request) => {
      const areas = await prisma.parkingArea.findMany({
        where: {
          active: true,
          ...(request.query.areaId ? { id: request.query.areaId } : {}),
        },
        include: {
          bays: {
            where: {
              ...(request.query.bayType ? { bayType: request.query.bayType } : {}),
            },
            include: {
              sessions: {
                where: { endedAt: null },
                include: {
                  allocatedUser: { select: { displayName: true } },
                  vehicle: { select: { vehicleType: true } },
                },
              },
            },
            orderBy: { code: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      });

      const allBays = areas.flatMap((area) =>
        area.bays.map((bay) => ({ bay, session: bay.sessions[0] ?? null })),
      );
      const activeBays = allBays.filter((row) => row.bay.active);
      const byType = capacityByType(
        activeBays.map((row) => ({ bayType: row.bay.bayType, session: row.session })),
      );

      return {
        counts: {
          overall: capacity(
            activeBays.length,
            activeBays.filter((row) => row.session).length,
          ),
          byType,
        },
        legend: (Object.keys(BAY_LABEL) as Array<keyof typeof BAY_LABEL>).map((type) => ({
          type,
          label: BAY_LABEL[type],
          chip: CHIP[type],
        })),
        areas: areas.map((area) => {
          const areaActive = area.bays.filter((bay) => bay.active);
          const areaByType = capacityByType(
            areaActive.map((bay) => ({
              bayType: bay.bayType,
              session: bay.sessions[0] ?? null,
            })),
          );
          return {
            id: area.id,
            name: area.name,
            code: area.code,
            counts: {
              overall: capacity(areaActive.length, areaActive.filter((bay) => bay.sessions.length > 0).length),
              byType: areaByType,
            },
            bays: area.bays.map((bay) => {
              const session = bay.sessions[0];
              return {
                id: bay.id,
                code: bay.code,
                bayType: bay.bayType as never,
                chip: chip(bay.bayType) as never,
                active: bay.active,
                notes: bay.notes,
                session: session
                  ? serializeSession({
                      ...session,
                      bay: { ...bay, area: { ...area, bays: [] } },
                    } as unknown as SessionRecord)
                  : null,
              };
            }),
          };
        }),
      };
    },
  );

  typed.post(
    '/parking/sessions',
    {
      preHandler: [app.authenticate, app.requireRole('SECURITY')],
      schema: {
        body: AllocateSessionBodySchema,
        response: { 201: SessionMutationResponseSchema },
      },
    },
    async (request, reply) => {
      const { vehicle, holder } = await vehicleForAllocation(request.body.vehicleId);
      await assertVehicleNotParked(vehicle.id);
      await assertHolderNotParked(holder.category, holder.id);

      const bay = request.body.autoAssign
        ? await findAutoBay(holder.category, vehicle.vehicleType)
        : await prisma.parkingBay.findUnique({
            where: { id: request.body.bayId! },
            include: { area: true },
          });
      if (!bay) {
        if (request.body.autoAssign) {
          throw conflict(
            'NO_SUITABLE_BAY',
            'No suitable bay is free. All matching and general bays are occupied.',
          );
        }
        throw notFound('Parking bay not found.');
      }
      if ('active' in bay && (!bay.active || !bay.area.active)) {
        throw unprocessable('That parking bay is inactive.');
      }
      if (!request.body.autoAssign) await assertBayFree(bay.id);

      const eligibility = checkEligibility(
        holder.category,
        bay.bayType as never,
        vehicle.vehicleType,
      );
      const overrideReason = request.body.overrideReason?.trim() || null;
      if (eligibility.requiresOverride && !overrideReason) {
        throw unprocessable(
          `${eligibility.reason} Add a typed reason to override this allocation.`,
          { overrideReason: [eligibility.reason ?? 'This allocation needs an override reason.'] },
        );
      }

      let session: SessionRecord;
      try {
        session = await prisma.parkingSession.create({
          data: {
            bayId: bay.id,
            vehicleId: vehicle.id,
            plateSnapshot: vehicle.plate,
            holderNameSnapshot: holder.name,
            holderCategory: holder.category,
            startedAt: nowUtc().toJSDate(),
            allocatedBy: request.authUser!.id,
            overrideReason: eligibility.requiresOverride ? overrideReason : null,
            note: request.body.note ?? null,
          },
          include: SESSION_INCLUDE,
        });
      } catch (error) {
        prismaConflict(error);
      }

      await audit(request, {
        action: 'parking.allocate',
        entityType: 'parking_session',
        entityId: session.id,
        after: serializeSession(session),
        reason: overrideReason,
      });
      if (session.overrideReason) {
        await audit(request, {
          action: 'parking.override',
          entityType: 'parking_session',
          entityId: session.id,
          after: {
            bayCode: session.bay.code,
            holderCategory: holder.category,
            overrideReason: session.overrideReason,
          },
          reason: session.overrideReason,
        });
      }
      reply.status(201);
      return { session: serializeSession(session), releasedSessionId: null, success: true as const };
    },
  );

  typed.post(
    '/parking/sessions/:id/release',
    {
      preHandler: [app.authenticate, app.requireRole('SECURITY')],
      schema: {
        params: IdParamSchema,
        body: ReleaseSessionBodySchema,
        response: { 200: SessionMutationResponseSchema },
      },
    },
    async (request) => {
      const id = request.params.id;
      const current = await prisma.parkingSession.findUnique({
        where: { id },
        include: SESSION_INCLUDE,
      });
      if (!current) throw notFound('Parking session not found.');
      if (current.endedAt) throw conflict('SESSION_ENDED', 'That parking session has already ended.');
      const updated = await prisma.parkingSession.update({
        where: { id: current.id },
        data: {
          endedAt: nowUtc().toJSDate(),
          endedBy: request.authUser!.id,
          endReason: request.authUser!.role === 'HR' ? 'hr' : 'gate_release',
          note: request.body.reason ?? current.note,
        },
        include: SESSION_INCLUDE,
      });
      await audit(request, {
        action: 'parking.release',
        entityType: 'parking_session',
        entityId: current.id,
        before: serializeSession(current),
        after: { endedAt: updated.endedAt?.toISOString(), endReason: updated.endReason },
        reason: request.body.reason ?? null,
      });
      return {
        session: serializeSession(current),
        releasedSessionId: current.id,
        success: true as const,
      };
    },
  );

  typed.post(
    '/parking/sessions/:id/relocate',
    {
      preHandler: [app.authenticate, app.requireRole('SECURITY')],
      schema: {
        params: IdParamSchema,
        body: RelocateSessionBodySchema,
        response: { 200: SessionMutationResponseSchema },
      },
    },
    async (request) => {
      const id = request.params.id;
      const current = await prisma.parkingSession.findUnique({
        where: { id },
        include: SESSION_INCLUDE,
      });
      if (!current) throw notFound('Parking session not found.');
      if (current.endedAt) throw conflict('SESSION_ENDED', 'That parking session has already ended.');
      if (!current.vehicleId) throw unprocessable('This session has no vehicle to relocate.');
      const { vehicle, holder } = await vehicleForAllocation(current.vehicleId);
      await assertHolderNotParked(holder.category, holder.id, current.id);
      const bay = request.body.autoAssign
        ? await findAutoBay(holder.category, vehicle.vehicleType)
        : await prisma.parkingBay.findUnique({
            where: { id: request.body.bayId! },
            include: { area: true },
          });
      if (!bay) {
        if (request.body.autoAssign) {
          throw conflict(
            'NO_SUITABLE_BAY',
            'No suitable free bay is available for relocation.',
          );
        }
        throw notFound('Parking bay not found.');
      }
      if (bay.id === current.bayId) throw conflict('SAME_BAY', 'That vehicle is already in that bay.');
      if ('active' in bay && (!bay.active || !bay.area.active)) {
        throw unprocessable('That parking bay is inactive.');
      }
      await assertBayFree(bay.id);
      const eligibility = checkEligibility(
        holder.category,
        bay.bayType as never,
        vehicle.vehicleType,
      );
      const overrideReason = request.body.overrideReason?.trim() || null;
      if (eligibility.requiresOverride && !overrideReason) {
        throw unprocessable(
          `${eligibility.reason} Add a typed reason to override this allocation.`,
          { overrideReason: [eligibility.reason ?? 'This allocation needs an override reason.'] },
        );
      }

      let created: SessionRecord;
      try {
        created = await prisma.$transaction(async (tx) => {
          await tx.parkingSession.update({
            where: { id: current.id },
            data: {
              endedAt: nowUtc().toJSDate(),
              endedBy: request.authUser!.id,
              endReason: 'relocated',
            },
          });
          return tx.parkingSession.create({
            data: {
              bayId: bay.id,
              vehicleId: vehicle.id,
              plateSnapshot: vehicle.plate,
              holderNameSnapshot: holder.name,
              holderCategory: holder.category,
              startedAt: nowUtc().toJSDate(),
              allocatedBy: request.authUser!.id,
              overrideReason: eligibility.requiresOverride ? overrideReason : null,
            },
            include: SESSION_INCLUDE,
          });
        });
      } catch (error) {
        prismaConflict(error);
      }

      await audit(request, {
        action: 'parking.relocate',
        entityType: 'parking_session',
        entityId: created.id,
        before: serializeSession(current),
        after: serializeSession(created),
        reason: request.body.overrideReason ?? null,
      });
      return {
        session: serializeSession(created),
        releasedSessionId: current.id,
        success: true as const,
      };
    },
  );

  typed.get(
    '/parking/history',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        querystring: ParkingHistoryQuerySchema,
        response: { 200: ParkingHistoryResponseSchema },
      },
    },
    async (request) => {
      if (request.query.from > request.query.to) {
        throw unprocessable('The start date must be on or before the end date.');
      }
      if (daysInclusive(request.query.from, request.query.to) > 366) {
        throw unprocessable('Parking history is limited to 366 days.');
      }
      const sessions = await prisma.parkingSession.findMany({
        where: {
          startedAt: { lt: rangeEndUtc(request.query.to) },
          OR: [{ endedAt: null }, { endedAt: { gt: rangeStartUtc(request.query.from) } }],
          ...(request.query.areaId || request.query.bayType
            ? {
                bay: {
                  ...(request.query.areaId ? { areaId: request.query.areaId } : {}),
                  ...(request.query.bayType ? { bayType: request.query.bayType } : {}),
                },
              }
            : {}),
        },
        include: { bay: { include: { area: true } } },
      });

      const days = new Map<
        string,
        {
          date: string;
          areaId: string;
          areaName: string;
          bayType: string;
          peakOccupancy: number;
          sessions: number;
          dwellTotal: number;
          dwellCount: number;
        }
      >();
      let totalSessionsAll = 0;
      let dwellTotalAll = 0;
      let dwellCountAll = 0;

      for (const session of sessions) {
        const start = DateTime.fromJSDate(session.startedAt, { zone: 'utc' }).setZone(APP_ZONE);
        const end = session.endedAt
          ? DateTime.fromJSDate(session.endedAt, { zone: 'utc' }).setZone(APP_ZONE)
          : DateTime.now().setZone(APP_ZONE);
        const rangeStart = DateTime.fromISO(request.query.from, { zone: APP_ZONE }).startOf('day');
        const rangeEnd = DateTime.fromISO(request.query.to, { zone: APP_ZONE }).endOf('day');
        const overlapStart = start < rangeStart ? rangeStart : start;
        const overlapEnd = end > rangeEnd ? rangeEnd : end;
        if (overlapEnd < overlapStart) continue;

        let cursor = overlapStart.startOf('day');
        const last = overlapEnd.startOf('day');
        while (cursor <= last) {
          const date = cursor.toISODate()!;
          const key = `${date}|${session.bay.areaId}|${session.bay.bayType}`;
          let row = days.get(key);
          if (!row) {
            row = {
              date,
              areaId: session.bay.areaId,
              areaName: session.bay.area.name,
              bayType: session.bay.bayType,
              peakOccupancy: 0,
              sessions: 0,
              dwellTotal: 0,
              dwellCount: 0,
            };
            days.set(key, row);
          }
          row.peakOccupancy += 1;
          cursor = cursor.plus({ days: 1 });
        }

        const startedOn = start.toISODate();
        if (startedOn && startedOn >= request.query.from && startedOn <= request.query.to) {
          const key = `${startedOn}|${session.bay.areaId}|${session.bay.bayType}`;
          const row = days.get(key)!;
          row.sessions += 1;
          totalSessionsAll += 1;
          if (session.endedAt) {
            const minutes = Math.max(
              0,
              (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000,
            );
            row.dwellTotal += minutes;
            row.dwellCount += 1;
            dwellTotalAll += minutes;
            dwellCountAll += 1;
          }
        }
      }

      const rows = [...days.values()]
        .map((row) => ({
          date: row.date,
          areaId: row.areaId,
          areaName: row.areaName,
          bayType: row.bayType as BayType,
          peakOccupancy: row.peakOccupancy,
          sessions: row.sessions,
          averageDwellMinutes:
            row.dwellCount === 0 ? null : Math.round((row.dwellTotal / row.dwellCount) * 10) / 10,
        }))
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            a.areaName.localeCompare(b.areaName) ||
            a.bayType.localeCompare(b.bayType),
        );

      return {
        rows,
        totals: {
          sessions: totalSessionsAll,
          averageDwellMinutes:
            dwellCountAll === 0 ? null : Math.round((dwellTotalAll / dwellCountAll) * 10) / 10,
        },
      };
    },
  );

  typed.get(
    '/parking/export.csv',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: { querystring: ParkingExportQuerySchema },
    },
    async (request, reply) => {
      if (request.query.from > request.query.to) {
        throw unprocessable('The start date must be on or before the end date.');
      }
      if (daysInclusive(request.query.from, request.query.to) > 366) {
        throw unprocessable('Exports are limited to 366 days.');
      }
      await audit(request, {
        action: 'export.parking',
        entityType: 'parking_export',
        entityId: null,
        after: { from: request.query.from, to: request.query.to },
      });
      return sendCsv(
        reply,
        `parking_${request.query.from}_${request.query.to}.csv`,
        [
          'date',
          'bay',
          'area',
          'bay_type',
          'plate',
          'holder_name',
          'holder_category',
          'started_at',
          'ended_at',
          'minutes',
          'allocated_by',
          'override',
        ],
        parkingExportRows(request.query.from, request.query.to),
      );
    },
  );

  async function* parkingExportRows(from: string, to: string) {
    const start = rangeStartUtc(from);
    const end = rangeEndUtc(to);
    let cursor: string | undefined;
    while (true) {
      const sessions = await prisma.parkingSession.findMany({
        where: { startedAt: { gte: start, lt: end } },
        include: {
          bay: { include: { area: true } },
          allocatedUser: { select: { displayName: true } },
        },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (sessions.length === 0) break;
      cursor = sessions[sessions.length - 1]!.id;
      for (const session of sessions) {
        const started = DateTime.fromJSDate(session.startedAt, { zone: 'utc' }).setZone(APP_ZONE);
        yield {
          date: started.toISODate() ?? '',
          bay: session.bay.code,
          area: session.bay.area.name,
          bay_type: session.bay.bayType,
          plate: session.plateSnapshot,
          holder_name: session.holderNameSnapshot,
          holder_category: session.holderCategory,
          started_at: localTimeOf(session.startedAt),
          ended_at: session.endedAt ? localTimeOf(session.endedAt) : '',
          minutes: session.endedAt
            ? Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 60_000)
            : '',
          allocated_by: session.allocatedUser.displayName,
          override: session.overrideReason ?? '',
        };
      }
      if (sessions.length < 500) break;
    }
  }
}

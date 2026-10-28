import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import {
  CheckInGuestVisitBodySchema,
  CheckOutGuestVisitBodySchema,
  CreateGuestBodySchema,
  CreateGuestVisitBodySchema,
  GuestDetailResponseSchema,
  GuestExportQuerySchema,
  GuestListQuerySchema,
  GuestListResponseSchema,
  GuestSchema,
  GuestVisitListQuerySchema,
  GuestVisitListResponseSchema,
  GuestVisitResponseWrapperSchema,
  IdParamSchema,
  UpdateGuestBodySchema,
  daysInclusive,
} from '@alche/shared';
import { prisma } from '../db.js';
import { AppError, conflict, notFound, unprocessable } from '../errors.js';
import { audit } from '../audit.js';
import { pageArgs, pageMeta } from '../pagination.js';
import { iso, isoRequired, localTimeOf, nowUtc, rangeEndUtc, rangeStartUtc } from '../time.js';
import { normalizePlate } from '../serializers/vehicles.js';
import { VISIT_INCLUDE, serializeVisit, type VisitRecord } from '../serializers/guests.js';
import { sendCsv } from '../csv.js';
import { DateTime } from 'luxon';
import { APP_ZONE } from '../time.js';

function guestDateWindow(query: { date?: string | undefined; from?: string | undefined; to?: string | undefined }) {
  const today = DateTime.now().setZone(APP_ZONE).toISODate()!;
  const from = query.date ?? query.from ?? today;
  const to = query.date ?? query.to ?? today;
  return { from, to, start: rangeStartUtc(from), end: rangeEndUtc(to) };
}

function windowWhere(from: Date, to: Date): Prisma.GuestVisitWhereInput {
  return {
    OR: [
      { expectedFrom: { gte: from, lt: to } },
      { checkedInAt: { gte: from, lt: to } },
      { checkedOutAt: { gte: from, lt: to } },
      { status: 'ON_SITE' },
    ],
  };
}

function statusWhere(status: string | undefined): Prisma.GuestVisitWhereInput {
  if (!status) return {};
  const now = nowUtc().toJSDate();
  if (status === 'OVERDUE') return { status: 'ON_SITE', expectedTo: { lt: now } };
  if (status === 'ON_SITE') return { status: 'ON_SITE', expectedTo: { gte: now } };
  return { status };
}

function serializeGuest(
  guest: Prisma.GuestGetPayload<{
    include: { _count: { select: { visits: true } }; visits: { take: 1; orderBy: { expectedFrom: 'desc' } } };
  }>,
) {
  return {
    id: guest.id,
    fullName: guest.fullName,
    phone: guest.phone,
    idNumber: guest.idNumber,
    company: guest.company,
    email: guest.email,
    active: guest.active,
    visitCount: guest._count.visits,
    lastVisitAt: guest.visits[0] ? isoRequired(guest.visits[0].expectedFrom) : null,
    createdAt: isoRequired(guest.createdAt),
    updatedAt: isoRequired(guest.updatedAt),
  };
}

const GUEST_LIST_INCLUDE = {
  _count: { select: { visits: true } },
  visits: { take: 1, orderBy: { expectedFrom: 'desc' as const } },
} as const;

async function createGuestVehicle(
  tx: Prisma.TransactionClient,
  guestId: string,
  vehicle: {
    plate: string;
    make?: string | null | undefined;
    model?: string | null | undefined;
    colour?: string | null | undefined;
    vehicleType: 'car' | 'motorbike' | 'van' | 'other';
  },
) {
  const plateNorm = normalizePlate(vehicle.plate);
  const existing = await tx.vehicle.findFirst({
    where: { plateNorm, active: true },
    include: { employee: true, guest: true },
  });
  if (existing) {
    const holder = existing.employee
      ? `${existing.employee.firstName} ${existing.employee.lastName}`
      : (existing.guest?.fullName ?? 'another guest');
    throw conflict(
      'PLATE_TAKEN',
      `${existing.plate} is registered to ${holder}.`,
    );
  }
  return tx.vehicle.create({
    data: {
      plate: vehicle.plate.trim().toUpperCase(),
      plateNorm,
      make: vehicle.make ?? null,
      model: vehicle.model ?? null,
      colour: vehicle.colour ?? null,
      vehicleType: vehicle.vehicleType,
      guestId,
      active: true,
    },
  });
}

export async function guestRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/guests',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: { querystring: GuestListQuerySchema, response: { 200: GuestListResponseSchema } },
    },
    async (request) => {
      const q = request.query.q?.trim();
      const where: Prisma.GuestWhereInput = {
        ...(request.query.includeInactive ? {} : { active: true }),
        ...(q
          ? {
              OR: [
                { fullName: { contains: q, mode: 'insensitive' } },
                { company: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q, mode: 'insensitive' } },
                { idNumber: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [guests, total] = await Promise.all([
        prisma.guest.findMany({
          where,
          include: GUEST_LIST_INCLUDE,
          orderBy: { fullName: 'asc' },
          ...pageArgs(request.query.page),
        }),
        prisma.guest.count({ where }),
      ]);
      return {
        items: guests.map(serializeGuest),
        meta: pageMeta(request.query.page, total),
      };
    },
  );

  typed.post(
    '/guests',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: { body: CreateGuestBodySchema, response: { 201: GuestSchema } },
    },
    async (request, reply) => {
      const guest = await prisma.guest.create({
        data: {
          fullName: request.body.fullName,
          phone: request.body.phone ?? null,
          idNumber: request.body.idNumber ?? null,
          company: request.body.company ?? null,
          email: request.body.email ?? null,
        },
        include: GUEST_LIST_INCLUDE,
      });
      await audit(request, {
        action: 'guest.create',
        entityType: 'guest',
        entityId: guest.id,
        after: { fullName: guest.fullName, company: guest.company, active: guest.active },
      });
      reply.status(201);
      return serializeGuest(guest);
    },
  );

  typed.get(
    '/guests/:id',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: { params: IdParamSchema, response: { 200: GuestDetailResponseSchema } },
    },
    async (request) => {
      const guest = await prisma.guest.findUnique({
        where: { id: request.params.id },
        include: GUEST_LIST_INCLUDE,
      });
      if (!guest) throw notFound('Guest not found.');
      const visits = await prisma.guestVisit.findMany({
        where: { guestId: guest.id },
        include: VISIT_INCLUDE,
        orderBy: { expectedFrom: 'desc' },
        take: 50,
      });
      return {
        guest: serializeGuest(guest),
        visits: visits.map(serializeVisit),
      };
    },
  );

  typed.patch(
    '/guests/:id',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        params: IdParamSchema,
        body: UpdateGuestBodySchema,
        response: { 200: GuestSchema },
      },
    },
    async (request) => {
      const current = await prisma.guest.findUnique({
        where: { id: request.params.id },
        include: GUEST_LIST_INCLUDE,
      });
      if (!current) throw notFound('Guest not found.');
      const guest = await prisma.guest.update({
        where: { id: current.id },
        data: {
          ...(request.body.fullName === undefined ? {} : { fullName: request.body.fullName }),
          ...(request.body.phone === undefined ? {} : { phone: request.body.phone }),
          ...(request.body.idNumber === undefined ? {} : { idNumber: request.body.idNumber }),
          ...(request.body.company === undefined ? {} : { company: request.body.company }),
          ...(request.body.email === undefined ? {} : { email: request.body.email }),
          ...(request.body.active === undefined ? {} : { active: request.body.active }),
        },
        include: GUEST_LIST_INCLUDE,
      });
      await audit(request, {
        action: guest.active ? 'guest.update' : 'guest.deactivate',
        entityType: 'guest',
        entityId: guest.id,
        before: { fullName: current.fullName, company: current.company, active: current.active },
        after: { fullName: guest.fullName, company: guest.company, active: guest.active },
      });
      return serializeGuest(guest);
    },
  );

  typed.get(
    '/guest-visits',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        querystring: GuestVisitListQuerySchema,
        response: { 200: GuestVisitListResponseSchema },
      },
    },
    async (request) => {
      const window = guestDateWindow(request.query);
      if (window.from > window.to) throw unprocessable('The start date must precede the end date.');
      if (daysInclusive(window.from, window.to) > 366) {
        throw unprocessable('Guest register ranges are limited to 366 days.');
      }
      const baseWhere: Prisma.GuestVisitWhereInput = {
        AND: [
          windowWhere(window.start, window.end),
          ...(request.query.host ? [{ hostEmployeeId: request.query.host }] : []),
        ],
      };
      const where: Prisma.GuestVisitWhereInput = {
        AND: [baseWhere, statusWhere(request.query.status)],
      };
      const now = nowUtc().toJSDate();
      const todayStart = rangeStartUtc(DateTime.now().setZone(APP_ZONE).toISODate()!);
      const todayEnd = rangeEndUtc(DateTime.now().setZone(APP_ZONE).toISODate()!);
      const [visits, total, expected, onSite, overdue, departed] = await Promise.all([
        prisma.guestVisit.findMany({
          where,
          include: VISIT_INCLUDE,
          orderBy: [{ expectedFrom: 'asc' }],
          ...pageArgs(request.query.page),
        }),
        prisma.guestVisit.count({ where }),
        prisma.guestVisit.count({
          where: { AND: [baseWhere, { status: 'EXPECTED' }] },
        }),
        prisma.guestVisit.count({
          where: { AND: [baseWhere, { status: 'ON_SITE', expectedTo: { gte: now } }] },
        }),
        prisma.guestVisit.count({
          where: { AND: [baseWhere, { status: 'ON_SITE', expectedTo: { lt: now } }] },
        }),
        prisma.guestVisit.count({
          where: {
            AND: [
              windowWhere(todayStart, todayEnd),
              { status: 'DEPARTED', checkedOutAt: { gte: todayStart, lt: todayEnd } },
            ],
          },
        }),
      ]);
      return {
        items: visits.map(serializeVisit),
        meta: pageMeta(request.query.page, total),
        counts: { expected, onSite, departed, overdue },
      };
    },
  );

  typed.post(
    '/guest-visits',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        body: CreateGuestVisitBodySchema,
        response: { 201: GuestVisitResponseWrapperSchema },
      },
    },
    async (request, reply) => {
      const host = await prisma.employee.findUnique({
        where: { id: request.body.hostEmployeeId },
      });
      if (!host) throw notFound('Host employee not found.');
      if (!host.active) throw unprocessable('The host employee is inactive.');
      if (!request.body.guestId && !request.body.guest) {
        throw unprocessable('Choose an existing guest or enter a new guest.');
      }

      const visit = await prisma.$transaction(async (tx) => {
        const guest = request.body.guestId
          ? await tx.guest.findUnique({ where: { id: request.body.guestId } })
          : await tx.guest.create({
              data: {
                fullName: request.body.guest!.fullName,
                phone: request.body.guest!.phone ?? null,
                idNumber: request.body.guest!.idNumber ?? null,
                company: request.body.guest!.company ?? null,
                email: request.body.guest!.email ?? null,
              },
            });
        if (!guest) throw notFound('Guest not found.');
        if (!guest.active) throw unprocessable('That guest is inactive.');

        const vehicle = request.body.vehicle
          ? await createGuestVehicle(tx, guest.id, request.body.vehicle)
          : null;

        return tx.guestVisit.create({
          data: {
            guestId: guest.id,
            hostEmployeeId: host.id,
            vehicleId: vehicle?.id ?? null,
            purpose: request.body.purpose,
            expectedFrom: new Date(request.body.expectedFrom),
            expectedTo: new Date(request.body.expectedTo),
            badgeNo: request.body.badgeNo ?? null,
            status: 'EXPECTED',
            note: request.body.note ?? null,
          },
          include: VISIT_INCLUDE,
        });
      });

      await audit(request, {
        action: 'guest_visit.create',
        entityType: 'guest_visit',
        entityId: visit.id,
        after: serializeVisit(visit),
        reason: request.body.purpose,
      });
      reply.status(201);
      return { visit: serializeVisit(visit) };
    },
  );

  typed.post(
    '/guest-visits/:id/check-in',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        params: IdParamSchema,
        body: CheckInGuestVisitBodySchema,
        response: { 200: GuestVisitResponseWrapperSchema },
      },
    },
    async (request) => {
      const current = await prisma.guestVisit.findUnique({
        where: { id: request.params.id },
        include: VISIT_INCLUDE,
      });
      if (!current) throw notFound('Guest visit not found.');
      if (current.status !== 'EXPECTED') {
        throw conflict('VISIT_ALREADY_CHECKED_IN', 'That visit has already been checked in.');
      }

      const visit = await prisma.$transaction(async (tx) => {
        let vehicleId = current.vehicleId;
        if (request.body.vehicleId && request.body.vehicle) {
          throw unprocessable('Choose an existing vehicle or enter a new one, not both.');
        }
        if (request.body.vehicleId) {
          const vehicle = await tx.vehicle.findUnique({ where: { id: request.body.vehicleId } });
          if (!vehicle || vehicle.guestId !== current.guestId) {
            throw unprocessable('That vehicle does not belong to this guest.');
          }
          vehicleId = vehicle.id;
        } else if (request.body.vehicle) {
          const vehicle = await createGuestVehicle(tx, current.guestId, request.body.vehicle);
          vehicleId = vehicle.id;
        }

        return tx.guestVisit.update({
          where: { id: current.id },
          data: {
            status: 'ON_SITE',
            checkedInAt: nowUtc().toJSDate(),
            checkedInBy: request.authUser!.id,
            vehicleId,
            ...(request.body.badgeNo === undefined ? {} : { badgeNo: request.body.badgeNo }),
            ...(request.body.note === undefined ? {} : { note: request.body.note }),
          },
          include: VISIT_INCLUDE,
        });
      });

      await audit(request, {
        action: 'guest_visit.check_in',
        entityType: 'guest_visit',
        entityId: visit.id,
        before: serializeVisit(current),
        after: serializeVisit(visit),
      });
      return { visit: serializeVisit(visit) };
    },
  );

  typed.post(
    '/guest-visits/:id/check-out',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        params: IdParamSchema,
        body: CheckOutGuestVisitBodySchema,
        response: { 200: GuestVisitResponseWrapperSchema },
      },
    },
    async (request) => {
      const current = await prisma.guestVisit.findUnique({
        where: { id: request.params.id },
        include: VISIT_INCLUDE,
      });
      if (!current) throw notFound('Guest visit not found.');
      if (current.status !== 'ON_SITE') {
        throw conflict('VISIT_NOT_ON_SITE', 'Only a guest who is on site can be checked out.');
      }

      const result = await prisma.$transaction(async (tx) => {
        const released = request.body.releaseParking && current.vehicleId
          ? await tx.parkingSession.findFirst({
              where: { vehicleId: current.vehicleId, endedAt: null },
              include: { bay: { include: { area: true } } },
            })
          : null;
        if (released) {
          await tx.parkingSession.update({
            where: { id: released.id },
            data: {
              endedAt: nowUtc().toJSDate(),
              endedBy: request.authUser!.id,
              endReason: 'guest_checkout',
              note: request.body.note ?? released.note,
            },
          });
        }
        const visit = await tx.guestVisit.update({
          where: { id: current.id },
          data: {
            status: 'DEPARTED',
            checkedOutAt: nowUtc().toJSDate(),
            checkedOutBy: request.authUser!.id,
            ...(request.body.note === undefined ? {} : { note: request.body.note }),
          },
          include: VISIT_INCLUDE,
        });
        return { visit, released };
      });

      await audit(request, {
        action: 'guest_visit.check_out',
        entityType: 'guest_visit',
        entityId: result.visit.id,
        before: serializeVisit(current),
        after: serializeVisit(result.visit),
        reason: request.body.note ?? null,
      });
      if (result.released) {
        await audit(request, {
          action: 'parking.release',
          entityType: 'parking_session',
          entityId: result.released.id,
          before: {
            bayId: result.released.bayId,
            vehicleId: result.released.vehicleId,
            endedAt: null,
          },
          after: { endedAt: nowUtc().toISO(), endReason: 'guest_checkout' },
          reason: 'Guest checkout',
        });
      }
      return { visit: serializeVisit(result.visit) };
    },
  );

  typed.get(
    '/guest-visits/export.csv',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: { querystring: GuestExportQuerySchema },
    },
    async (request, reply) => {
      if (request.query.from > request.query.to) {
        throw unprocessable('The start date must be on or before the end date.');
      }
      if (daysInclusive(request.query.from, request.query.to) > 366) {
        throw unprocessable('Exports are limited to 366 days.');
      }
      await audit(request, {
        action: 'export.guests',
        entityType: 'guest_export',
        entityId: null,
        after: { from: request.query.from, to: request.query.to },
      });
      return sendCsv(
        reply,
        `guests_${request.query.from}_${request.query.to}.csv`,
        [
          'date_in',
          'time_in',
          'date_out',
          'time_out',
          'guest_name',
          'company',
          'phone',
          'id_number',
          'host_employee',
          'host_department',
          'purpose',
          'badge_no',
          'vehicle_plate',
          'status',
        ],
        guestExportRows(request.query),
      );
    },
  );
}

async function* guestExportRows(query: {
  from: string;
  to: string;
  host?: string | undefined;
  status?: string | undefined;
}) {
  const start = rangeStartUtc(query.from);
  const end = rangeEndUtc(query.to);
  let cursor: string | undefined;
  while (true) {
    const visits: VisitRecord[] = await prisma.guestVisit.findMany({
      where: {
        AND: [
          {
            OR: [
              { expectedFrom: { gte: start, lt: end } },
              { checkedInAt: { gte: start, lt: end } },
              { checkedOutAt: { gte: start, lt: end } },
            ],
          },
          ...(query.host ? [{ hostEmployeeId: query.host }] : []),
          statusWhere(query.status),
        ],
      },
      include: VISIT_INCLUDE,
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (visits.length === 0) break;
    cursor = visits[visits.length - 1]!.id;
    for (const visit of visits) {
      const serialized = serializeVisit(visit);
      const checkedIn = visit.checkedInAt
        ? DateTime.fromJSDate(visit.checkedInAt, { zone: 'utc' }).setZone(APP_ZONE)
        : null;
      const expected = DateTime.fromJSDate(visit.expectedFrom, { zone: 'utc' }).setZone(APP_ZONE);
      const checkedOut = visit.checkedOutAt
        ? DateTime.fromJSDate(visit.checkedOutAt, { zone: 'utc' }).setZone(APP_ZONE)
        : null;
      yield {
        date_in: (checkedIn ?? expected).toISODate() ?? '',
        time_in: checkedIn ? checkedIn.toFormat('HH:mm:ss') : '',
        date_out: checkedOut?.toISODate() ?? '',
        time_out: checkedOut?.toFormat('HH:mm:ss') ?? '',
        guest_name: serialized.guest.fullName,
        company: serialized.guest.company ?? '',
        phone: serialized.guest.phone ?? '',
        id_number: serialized.guest.idNumber ?? '',
        host_employee: serialized.host.fullName,
        host_department: serialized.host.department,
        purpose: serialized.purpose,
        badge_no: serialized.badgeNo ?? '',
        vehicle_plate: serialized.vehicle?.plate ?? '',
        status: serialized.status,
      };
    }
    if (visits.length < 200) break;
  }
}

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AttendanceExportQuerySchema,
  AttendanceQuerySchema,
  AttendanceResponseSchema,
  CreateEventBodySchema,
  CreateEventResponseSchema,
  EmployeeIdParamSchema,
  EmployeeRecentEventsResponseSchema,
  EventExportQuerySchema,
  EventMutationResponseSchema,
  HrAmendEventBodySchema,
  HrVoidEventBodySchema,
  IdParamSchema,
  KioskActivityResponseSchema,
  MonthAttendanceResponseSchema,
  MonthQuerySchema,
  RecentEventsQuerySchema,
  UndoResponseSchema,
  daysInclusive,
} from '@alche/shared';
import { prisma } from '../db.js';
import { AppError, conflict, notFound, unprocessable } from '../errors.js';
import { audit } from '../audit.js';
import { pageArgs, pageMeta } from '../pagination.js';
import { attendanceTotals, deriveRows, monthDetail } from '../attendance-service.js';
import { localDayWindow } from '../attendance.js';
import { serializeAttendanceRow, serializeEvent } from '../serializers/attendance.js';
import { currentLocalDate, isoRequired } from '../time.js';
import { sendCsv } from '../csv.js';
import {
  attendanceExportColumns,
  attendanceExportRows,
  eventExportColumns,
  eventExportRows,
} from '../export-service.js';

const EVENT_INCLUDE = {
  employee: { select: { firstName: true, lastName: true, code: true } },
  recorder: { select: { displayName: true } },
} as const;

export async function attendanceRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/attendance',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        querystring: AttendanceQuerySchema,
        response: { 200: AttendanceResponseSchema },
      },
    },
    async (request) => {
      const today = currentLocalDate();
      let { from, to, department, category, status, page } = request.query;
      if (request.authUser!.role === 'SECURITY') {
        if (from !== today || to !== today) {
          throw new AppError(
            403,
            'TODAY_ONLY',
            'Security accounts may view today’s attendance only.',
          );
        }
      }
      if (from > to) {
        throw unprocessable('The start date must be on or before the end date.', {
          to: ['The end date must be on or after the start date.'],
        });
      }
      if (daysInclusive(from, to) > 366) {
        throw unprocessable('Attendance reports are limited to 366 days.');
      }

      const allRows = await deriveRows({
        from,
        to,
        ...(department ? { department } : {}),
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
      });
      const totals = attendanceTotals(allRows);
      const offset = pageArgs(page).skip;
      const items = allRows
        .slice(offset, offset + pageArgs(page).take)
        .map((row) => serializeAttendanceRow(row.employee, row.derivation));

      return {
        items,
        totals,
        meta: pageMeta(page, allRows.length),
      };
    },
  );

  typed.get(
    '/attendance/export.csv',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: { querystring: AttendanceExportQuerySchema },
    },
    async (request, reply) => {
      if (request.query.from > request.query.to) {
        throw unprocessable('The start date must be on or before the end date.');
      }
      if (daysInclusive(request.query.from, request.query.to) > 366) {
        throw unprocessable('Exports are limited to 366 days.');
      }
      await audit(request, {
        action: 'export.attendance',
        entityType: 'attendance_export',
        entityId: null,
        after: {
          from: request.query.from,
          to: request.query.to,
          department: request.query.department ?? null,
          category: request.query.category ?? null,
          status: request.query.status ?? null,
        },
      });
      return sendCsv(
        reply,
        `attendance_${request.query.from}_${request.query.to}.csv`,
        attendanceExportColumns,
        attendanceExportRows(request.query),
      );
    },
  );

  typed.get(
    '/events/export.csv',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: { querystring: EventExportQuerySchema },
    },
    async (request, reply) => {
      if (request.query.from > request.query.to) {
        throw unprocessable('The start date must be on or before the end date.');
      }
      if (daysInclusive(request.query.from, request.query.to) > 366) {
        throw unprocessable('Exports are limited to 366 days.');
      }
      await audit(request, {
        action: 'export.events',
        entityType: 'event_export',
        entityId: null,
        after: {
          from: request.query.from,
          to: request.query.to,
          employeeId: request.query.employeeId ?? null,
        },
      });
      return sendCsv(
        reply,
        `events_${request.query.from}_${request.query.to}.csv`,
        eventExportColumns,
        eventExportRows(request.query),
      );
    },
  );

  typed.get(
    '/attendance/:employeeId/month',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: {
        params: EmployeeIdParamSchema,
        querystring: MonthQuerySchema,
        response: { 200: MonthAttendanceResponseSchema },
      },
    },
    async (request) => {
      const { month } = request.query;
      const detail = await monthDetail(request.params.employeeId, month);
      if (!detail) throw notFound('Employee not found.');
      return {
        employee: {
          id: detail.employee.id,
          code: detail.employee.code,
          firstName: detail.employee.firstName,
          lastName: detail.employee.lastName,
          department: detail.employee.department,
          category: detail.employee.category as 'staff' | 'contractor',
        },
        month,
        days: detail.days,
        events: detail.events.map(serializeEvent),
      };
    },
  );

  typed.get(
    '/employees/:employeeId/recent-events',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        params: EmployeeIdParamSchema,
        querystring: RecentEventsQuerySchema,
        response: { 200: EmployeeRecentEventsResponseSchema },
      },
    },
    async (request) => {
      const employee = await prisma.employee.findUnique({
        where: { id: request.params.employeeId },
      });
      if (!employee) throw notFound('Employee not found.');
      const events = await prisma.event.findMany({
        where: {
          employeeId: employee.id,
          voidedAt: null,
          supersededById: null,
        },
        include: EVENT_INCLUDE,
        orderBy: { occurredAt: 'desc' },
        take: request.query.limit,
      });
      return {
        employee: {
          id: employee.id,
          fullName: `${employee.firstName} ${employee.lastName}`,
          code: employee.code,
        },
        items: events.map(serializeEvent),
      };
    },
  );

  typed.post(
    '/events',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        body: CreateEventBodySchema,
        response: { 201: CreateEventResponseSchema },
      },
    },
    async (request, reply) => {
      const employee = await prisma.employee.findUnique({
        where: { id: request.body.employeeId },
      });
      if (!employee) throw notFound('Employee not found.');
      if (!employee.active) throw unprocessable('That employee is inactive and cannot be logged.');

      if (request.body.hrEdit && request.authUser!.role !== 'HR') {
        throw new AppError(403, 'FORBIDDEN', 'Only HR may create a direct hr_edit event.');
      }
      if (request.body.hrEdit && (!request.body.reason || request.body.reason.trim().length < 3)) {
        throw unprocessable('A reason is required for a direct HR event.');
      }

      const latest = await prisma.event.findFirst({
        where: {
          employeeId: employee.id,
          voidedAt: null,
          supersededById: null,
        },
        orderBy: { occurredAt: 'desc' },
      });
      const inferredDirection: 'IN' | 'OUT' = latest?.direction === 'IN' ? 'OUT' : 'IN';
      const direction: 'IN' | 'OUT' = request.body.direction ?? inferredDirection;
      const occurredAt = request.body.occurredAt
        ? new Date(request.body.occurredAt)
        : new Date();

      if (Number.isNaN(occurredAt.getTime())) {
        throw unprocessable('The event time is invalid.');
      }
      if (!request.body.hrEdit && latest && occurredAt < latest.occurredAt) {
        throw unprocessable(
          'The event time cannot be before the employee’s latest recorded event. Use an HR amendment for older corrections.',
        );
      }

      if (latest && latest.direction === direction) {
        const seconds = Math.round(
          Math.abs(occurredAt.getTime() - latest.occurredAt.getTime()) / 1000,
        );
        if (seconds <= 120) {
          const ago =
            seconds < 5 ? 'just now' : `${seconds} second${seconds === 1 ? '' : 's'} ago`;
          throw conflict(
            'DUPLICATE_EVENT',
            `${employee.firstName} ${employee.lastName} was already marked ${direction} ${ago}.`,
            { seconds, direction, lastEventId: latest.id },
          );
        }
      }

      const event = await prisma.event.create({
        data: {
          employeeId: employee.id,
          occurredAt,
          direction,
          recordedBy: request.authUser!.id,
          source: request.body.hrEdit ? 'hr_edit' : 'gate',
          note: request.body.note ?? null,
        },
        include: EVENT_INCLUDE,
      });

      await audit(request, {
        action: request.body.hrEdit ? 'event.hr_create' : 'event.create',
        entityType: 'event',
        entityId: event.id,
        after: serializeEvent(event),
        reason: request.body.reason ?? request.body.note ?? null,
      });

      const undoUntil = new Date(event.createdAt.getTime() + 5 * 60_000);
      reply.status(201);
      return {
        event: serializeEvent(event),
        inferredDirection,
        undoUntil: isoRequired(undoUntil),
        employeeState: {
          onCampus: direction === 'IN',
          since: direction === 'IN' ? isoRequired(event.occurredAt) : null,
        },
      };
    },
  );

  typed.delete(
    '/events/:id',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: { params: IdParamSchema, response: { 200: UndoResponseSchema } },
    },
    async (request) => {
      const cutoff = new Date(Date.now() - 5 * 60_000);
      const event = await prisma.event.findFirst({
        where: {
          id: request.params.id,
          recordedBy: request.authUser!.id,
          source: 'gate',
          voidedAt: null,
          supersededById: null,
          createdAt: { gte: cutoff },
        },
        include: EVENT_INCLUDE,
      });
      if (!event) {
        throw new AppError(
          422,
          'UNDO_NOT_ALLOWED',
          'Only an event you created in the last five minutes can be undone.',
        );
      }
      const updated = await prisma.event.update({
        where: { id: event.id },
        data: {
          voidedAt: new Date(),
          voidedBy: request.authUser!.id,
          voidReason: 'Gate undo within five minutes',
        },
      });
      await audit(request, {
        action: 'gate_undo',
        entityType: 'event',
        entityId: event.id,
        before: serializeEvent(event),
        after: { ...serializeEvent(event), voidedAt: updated.voidedAt?.toISOString() ?? null },
        reason: 'Gate undo within five minutes',
      });
      return {
        success: true as const,
        message: `${event.employee.firstName} ${event.employee.lastName}’s ${event.direction} was undone.`,
      };
    },
  );

  typed.post(
    '/events/:id/amend',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: {
        params: IdParamSchema,
        body: HrAmendEventBodySchema,
        response: { 200: EventMutationResponseSchema },
      },
    },
    async (request) => {
      const current = await prisma.event.findUnique({
        where: { id: request.params.id },
        include: EVENT_INCLUDE,
      });
      if (!current) throw notFound('Event not found.');
      if (current.voidedAt || current.supersededById) {
        throw conflict('EVENT_NOT_EFFECTIVE', 'That event is no longer effective.');
      }
      const occurredAt = new Date(request.body.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) throw unprocessable('The event time is invalid.');

      const result = await prisma.$transaction(async (tx) => {
        const event = await tx.event.create({
          data: {
            employeeId: current.employeeId,
            occurredAt,
            direction: request.body.direction,
            recordedBy: request.authUser!.id,
            source: 'hr_edit',
            note: request.body.note ?? request.body.reason,
          },
          include: EVENT_INCLUDE,
        });
        await tx.event.update({
          where: { id: current.id },
          data: { supersededById: event.id },
        });
        return event;
      });

      await audit(request, {
        action: 'event.hr_amend',
        entityType: 'event',
        entityId: result.id,
        before: serializeEvent(current),
        after: serializeEvent(result),
        reason: request.body.reason,
      });

      return {
        event: serializeEvent(result),
        supersededEventId: current.id,
        success: true as const,
      };
    },
  );

  typed.post(
    '/events/:id/void',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: {
        params: IdParamSchema,
        body: HrVoidEventBodySchema,
        response: { 200: EventMutationResponseSchema },
      },
    },
    async (request) => {
      const current = await prisma.event.findUnique({
        where: { id: request.params.id },
        include: EVENT_INCLUDE,
      });
      if (!current) throw notFound('Event not found.');
      if (current.voidedAt || current.supersededById) {
        throw conflict('EVENT_NOT_EFFECTIVE', 'That event is already voided or superseded.');
      }
      const updated = await prisma.event.update({
        where: { id: current.id },
        data: {
          voidedAt: new Date(),
          voidedBy: request.authUser!.id,
          voidReason: request.body.reason,
        },
        include: EVENT_INCLUDE,
      });
      await audit(request, {
        action: 'event.hr_void',
        entityType: 'event',
        entityId: current.id,
        before: serializeEvent(current),
        after: serializeEvent(updated),
        reason: request.body.reason,
      });
      return {
        event: serializeEvent(updated),
        supersededEventId: null,
        success: true as const,
      };
    },
  );

  typed.get(
    '/kiosk/activity',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        response: { 200: KioskActivityResponseSchema },
      },
    },
    async (request) => {
      const today = currentLocalDate();
      const window = localDayWindow(today);
      const events = await prisma.event.findMany({
        where: {
          voidedAt: null,
          supersededById: null,
          occurredAt: { gte: window.start, lt: window.end },
        },
        include: EVENT_INCLUDE,
        orderBy: { occurredAt: 'desc' },
        take: 50,
      });

      const latest = await prisma.event.findMany({
        where: { voidedAt: null, supersededById: null },
        select: { employeeId: true, direction: true },
        orderBy: { occurredAt: 'desc' },
      });
      const seen = new Set<string>();
      let onCampusCount = 0;
      for (const row of latest) {
        if (seen.has(row.employeeId)) continue;
        seen.add(row.employeeId);
        if (row.direction === 'IN') onCampusCount += 1;
      }

      const cutoff = Date.now() - 5 * 60_000;
      return {
        today,
        onCampusCount,
        items: events.map((event) => ({
          id: event.id,
          employeeId: event.employeeId,
          employeeName: `${event.employee.firstName} ${event.employee.lastName}`,
          direction: event.direction as 'IN' | 'OUT',
          occurredAt: isoRequired(event.occurredAt),
          source: event.source as 'gate' | 'amendment' | 'hr_edit',
          recordedByName: event.recorder?.displayName ?? null,
          canUndo:
            event.recordedBy === request.authUser!.id &&
            event.source === 'gate' &&
            event.createdAt.getTime() >= cutoff,
          undoUntil: isoRequired(new Date(event.createdAt.getTime() + 5 * 60_000)),
        })),
      };
    },
  );
}

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AuditListQuerySchema,
  AuditListResponseSchema,
  CreateUserBodySchema,
  CreateUserResponseSchema,
  DashboardQuerySchema,
  DashboardStatsSchema,
  IdParamSchema,
  OnCampusResponseSchema,
  ResetPasswordResponseSchema,
  UpdateUserRoleBodySchema,
  UserAdminListQuerySchema,
  UserAdminListResponseSchema,
  UserAdminSchema,
  daysInclusive,
  type UserAdmin,
} from '@alche/shared';
import { prisma } from '../db.js';
import { AppError, conflict, notFound, unprocessable } from '../errors.js';
import { audit } from '../audit.js';
import { generatePassword, hashPassword, revokeUserSessions } from '../auth.js';
import { pageArgs, pageMeta } from '../pagination.js';
import { attendanceTotals, deriveRows } from '../attendance-service.js';
import {
  currentLocalDate,
  iso,
  isoRequired,
  nowUtc,
  rangeEndUtc,
  rangeStartUtc,
} from '../time.js';
import { DateTime } from 'luxon';
import { APP_ZONE } from '../time.js';

function serializeUser(user: {
  id: string;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}): UserAdmin {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as UserAdmin['role'],
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: iso(user.lastLoginAt),
    createdAt: isoRequired(user.createdAt),
  };
}

async function ensureAnotherHr(excludeUserId: string): Promise<void> {
  const count = await prisma.user.count({
    where: { role: 'HR', active: true, id: { not: excludeUserId } },
  });
  if (count === 0) {
    throw conflict(
      'LAST_HR_ADMIN',
      'Refusing to leave the system without an active HR administrator.',
    );
  }
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/users',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: {
        querystring: UserAdminListQuerySchema,
        response: { 200: UserAdminListResponseSchema },
      },
    },
    async (request) => {
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          orderBy: [{ active: 'desc' }, { displayName: 'asc' }],
          ...pageArgs(request.query.page),
        }),
        prisma.user.count(),
      ]);
      return {
        items: users.map(serializeUser),
        meta: pageMeta(request.query.page, total),
      };
    },
  );

  typed.post(
    '/users',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: { body: CreateUserBodySchema, response: { 201: CreateUserResponseSchema } },
    },
    async (request, reply) => {
      const existing = await prisma.user.findUnique({ where: { username: request.body.username } });
      if (existing) throw conflict('USERNAME_TAKEN', 'That username is already in use.');
      const temporaryPassword = generatePassword(20);
      const user = await prisma.user.create({
        data: {
          username: request.body.username,
          displayName: request.body.displayName,
          role: request.body.role,
          passwordHash: await hashPassword(temporaryPassword),
          active: true,
          mustChangePassword: true,
        },
      });
      await audit(request, {
        action: 'user.create',
        entityType: 'user',
        entityId: user.id,
        after: { username: user.username, role: user.role, active: true },
      });
      reply.status(201);
      return { user: serializeUser(user), temporaryPassword };
    },
  );

  typed.patch(
    '/users/:id/role',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: {
        params: IdParamSchema,
        body: UpdateUserRoleBodySchema,
        response: { 200: UserAdminSchema },
      },
    },
    async (request) => {
      const current = await prisma.user.findUnique({ where: { id: request.params.id } });
      if (!current) throw notFound('User not found.');
      if (current.role === 'HR' && request.body.role !== 'HR' && current.active) {
        await ensureAnotherHr(current.id);
      }
      const user = await prisma.user.update({
        where: { id: current.id },
        data: { role: request.body.role },
      });
      await audit(request, {
        action: 'user.role_change',
        entityType: 'user',
        entityId: user.id,
        before: { role: current.role },
        after: { role: user.role },
      });
      return serializeUser(user);
    },
  );

  typed.post(
    '/users/:id/deactivate',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: { params: IdParamSchema, response: { 200: UserAdminSchema } },
    },
    async (request) => {
      const current = await prisma.user.findUnique({ where: { id: request.params.id } });
      if (!current) throw notFound('User not found.');
      if (current.active && current.role === 'HR') {
        await ensureAnotherHr(current.id);
      }
      if (current.id === request.authUser!.id) {
        throw unprocessable('You cannot deactivate your own account.');
      }
      const user = await prisma.user.update({
        where: { id: current.id },
        data: { active: false },
      });
      await revokeUserSessions(user.id);
      await audit(request, {
        action: 'user.deactivate',
        entityType: 'user',
        entityId: user.id,
        before: { active: current.active },
        after: { active: false, sessionsRevoked: true },
      });
      return serializeUser(user);
    },
  );

  typed.post(
    '/users/:id/reset-password',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: { params: IdParamSchema, response: { 200: ResetPasswordResponseSchema } },
    },
    async (request) => {
      const current = await prisma.user.findUnique({ where: { id: request.params.id } });
      if (!current) throw notFound('User not found.');
      const temporaryPassword = generatePassword(20);
      await prisma.user.update({
        where: { id: current.id },
        data: {
          passwordHash: await hashPassword(temporaryPassword),
          mustChangePassword: true,
          failedLoginCount: 0,
          lastFailedAt: null,
          lockedUntil: null,
        },
      });
      await revokeUserSessions(current.id);
      await audit(request, {
        action: 'user.password_reset',
        entityType: 'user',
        entityId: current.id,
        after: { mustChangePassword: true, sessionsRevoked: true },
      });
      return { temporaryPassword };
    },
  );

  typed.get(
    '/audit',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: {
        querystring: AuditListQuerySchema,
        response: { 200: AuditListResponseSchema },
      },
    },
    async (request) => {
      const where = {
        ...(request.query.entity
          ? { entityType: { contains: request.query.entity, mode: 'insensitive' as const } }
          : {}),
        ...(request.query.actor ? { actorUserId: request.query.actor } : {}),
        ...(request.query.from || request.query.to
          ? {
              createdAt: {
                ...(request.query.from ? { gte: rangeStartUtc(request.query.from) } : {}),
                ...(request.query.to ? { lt: rangeEndUtc(request.query.to) } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          include: {
            actor: { select: { id: true, username: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
          ...pageArgs(request.query.page),
        }),
        prisma.auditLog.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          actor: row.actor,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          before: row.before,
          after: row.after,
          reason: row.reason,
          ip: row.ip,
          createdAt: isoRequired(row.createdAt),
        })),
        meta: pageMeta(request.query.page, total),
      };
    },
  );

  typed.get(
    '/on-campus',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: { response: { 200: OnCampusResponseSchema } },
    },
    async () => {
      const employees = await prisma.employee.findMany({
        where: { active: true },
        include: {
          events: {
            where: { voidedAt: null, supersededById: null },
            orderBy: { occurredAt: 'desc' },
            take: 1,
            select: { direction: true, occurredAt: true },
          },
          vehicles: { where: { active: true }, select: { plate: true } },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      });
      const onSiteEmployees = employees.filter(
        (employee) => employee.events[0]?.direction === 'IN',
      );
      const now = nowUtc();
      return {
        employees: onSiteEmployees.map((employee) => {
          const since = employee.events[0]!.occurredAt;
          return {
            id: employee.id,
            code: employee.code,
            fullName: `${employee.firstName} ${employee.lastName}`,
            department: employee.department,
            since: isoRequired(since),
            elapsedMinutes: Math.max(0, Math.floor(now.diff(DateTime.fromJSDate(since), 'minutes').minutes)),
            vehicles: employee.vehicles.map((vehicle) => vehicle.plate),
          };
        }),
        generatedAt: now.toISO() ?? '',
      };
    },
  );

  typed.get(
    '/dashboard/stats',
    {
      preHandler: [app.authenticate, app.requireRole('DEAN')],
      schema: {
        querystring: DashboardQuerySchema,
        response: { 200: DashboardStatsSchema },
      },
    },
    async (request) => {
      const today = currentLocalDate();
      const defaultFrom =
        DateTime.fromISO(today, { zone: APP_ZONE }).minus({ days: 29 }).toISODate() ?? today;
      const from = request.query.from ?? defaultFrom;
      const to = request.query.to ?? today;
      if (from > to) throw unprocessable('The start date must be on or before the end date.');
      if (daysInclusive(from, to) > 366) throw unprocessable('Dashboard ranges are limited to 366 days.');
      const monthStart =
        DateTime.fromISO(today, { zone: APP_ZONE }).startOf('month').toISODate() ?? today;

      const [todayRows, monthRows, trendRows] = await Promise.all([
        deriveRows({ from: today, to: today }),
        deriveRows({ from: monthStart, to: today }),
        deriveRows({ from, to }),
      ]);
      const activeOnly = (rows: typeof todayRows) => rows.filter((row) => row.employee.active);
      const todayTotals = attendanceTotals(activeOnly(todayRows));
      const monthTotals = attendanceTotals(activeOnly(monthRows));
      const trend = new Map<
        string,
        { date: string; present: number; onSite: number; missingIn: number; absent: number }
      >();
      for (const row of activeOnly(trendRows)) {
        let entry = trend.get(row.derivation.date);
        if (!entry) {
          entry = {
            date: row.derivation.date,
            present: 0,
            onSite: 0,
            missingIn: 0,
            absent: 0,
          };
          trend.set(row.derivation.date, entry);
        }
        if (row.derivation.status === 'PRESENT') entry.present += 1;
        else if (row.derivation.status === 'ON_SITE') entry.onSite += 1;
        else if (row.derivation.status === 'MISSING_IN') entry.missingIn += 1;
        else entry.absent += 1;
      }

      const now = nowUtc();
      const latestAll = await prisma.event.findMany({
        where: { voidedAt: null, supersededById: null, employee: { active: true } },
        select: { employeeId: true, direction: true },
        orderBy: { occurredAt: 'desc' },
      });
      const seenEmployees = new Set<string>();
      let onCampusNow = 0;
      for (const event of latestAll) {
        if (seenEmployees.has(event.employeeId)) continue;
        seenEmployees.add(event.employeeId);
        if (event.direction === 'IN') onCampusNow += 1;
      }

      return {
        generatedAt: now.toISO() ?? '',
        today,
        attendance: {
          ...todayTotals,
          onCampusNow,
        },
        month: monthTotals,
        trend: [...trend.values()].sort((a, b) => a.date.localeCompare(b.date)),
        range: { from, to },
      };
    },
  );
}

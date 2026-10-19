import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ChangePasswordBodySchema,
  CsrfResponseSchema,
  LoginBodySchema,
  LoginResponseSchema,
  LogoutResponseSchema,
  MeResponseSchema,
  MessageSchema,
} from '@alche/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import {
  clearSessionCookie,
  createSession,
  hashPassword,
  revokeUserSessions,
  setSessionCookie,
  verifyPassword,
} from '../auth.js';
import { AppError, unauthorized } from '../errors.js';
import { audit } from '../audit.js';

const LOCK_WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/auth/csrf',
    {
      schema: { response: { 200: CsrfResponseSchema } },
    },
    async (_request, reply) => {
      const csrfToken = reply.generateCsrf();
      return { csrfToken };
    },
  );

  typed.post(
    '/auth/login',
    {
      schema: {
        body: LoginBodySchema,
        response: { 200: LoginResponseSchema },
      },
      config: {
        rateLimit: {
          max: config.isTest ? 1000 : 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const username = request.body.username.trim();
      const user = await prisma.user.findUnique({ where: { username } });
      const now = new Date();

      if (!user) {
        await audit(request, {
          action: 'auth.login_failed',
          entityType: 'user',
          entityId: null,
          after: { username, reason: 'unknown_user' },
        });
        throw unauthorized('Incorrect username or password.');
      }

      if (user.lockedUntil && user.lockedUntil > now) {
        await audit(request, {
          actorUserId: user.id,
          action: 'auth.login_blocked',
          entityType: 'user',
          entityId: user.id,
          reason: 'temporarily_locked',
        });
        const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000));
        throw new AppError(429, 'LOGIN_LOCKED', `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
      }

      if (!user.active) {
        await audit(request, {
          actorUserId: user.id,
          action: 'auth.login_failed',
          entityType: 'user',
          entityId: user.id,
          reason: 'inactive_user',
        });
        throw unauthorized('Incorrect username or password.');
      }

      const valid = await verifyPassword(user.passwordHash, request.body.password);
      if (!valid) {
        const lastFailed = user.lastFailedAt;
        const withinWindow = lastFailed ? now.getTime() - lastFailed.getTime() <= LOCK_WINDOW_MS : false;
        const failures = withinWindow ? user.failedLoginCount + 1 : 1;
        const lockedUntil = failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_WINDOW_MS) : null;

        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: failures,
            lastFailedAt: now,
            lockedUntil,
          },
        });

        await audit(request, {
          actorUserId: user.id,
          action: 'auth.login_failed',
          entityType: 'user',
          entityId: user.id,
          after: { failures, locked: Boolean(lockedUntil) },
        });

        if (lockedUntil) {
          throw new AppError(
            429,
            'LOGIN_LOCKED',
            'Too many failed attempts. This account is locked for 15 minutes.',
          );
        }
        throw unauthorized('Incorrect username or password.');
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lastFailedAt: null,
          lockedUntil: null,
          lastLoginAt: now,
        },
      });

      const { token } = await createSession(user.id, request.ip, request.headers['user-agent']);
      setSessionCookie(reply, token);
      const csrfToken = reply.generateCsrf();

      await audit(request, {
        actorUserId: user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
      });

      return {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role as 'SECURITY' | 'HR' | 'DEAN',
          active: user.active,
          mustChangePassword: user.mustChangePassword,
        },
        csrfToken,
      };
    },
  );

  typed.post(
    '/auth/logout',
    {
      preHandler: [app.authenticateBasic],
      schema: { response: { 200: LogoutResponseSchema } },
    },
    async (request, reply) => {
      if (request.authSessionId) {
        await prisma.session.deleteMany({ where: { id: request.authSessionId } });
      }
      await audit(request, {
        actorUserId: request.authUser?.id ?? null,
        action: 'auth.logout',
        entityType: 'user',
        entityId: request.authUser?.id ?? null,
      });
      clearSessionCookie(reply);
      return { success: true as const };
    },
  );

  typed.get(
    '/auth/me',
    {
      preHandler: [app.authenticateBasic],
      schema: { response: { 200: MeResponseSchema } },
    },
    async (request) => {
      return { user: request.authUser! };
    },
  );

  typed.post(
    '/auth/change-password',
    {
      preHandler: [app.authenticateBasic],
      schema: {
        body: ChangePasswordBodySchema,
        response: { 200: MessageSchema },
      },
    },
    async (request) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: request.authUser!.id },
        select: { id: true, passwordHash: true, mustChangePassword: true },
      });

      const valid = await verifyPassword(user.passwordHash, request.body.currentPassword);
      if (!valid) {
        throw new AppError(422, 'INVALID_PASSWORD', 'Your current password is incorrect.', {
          currentPassword: ['Your current password is incorrect.'],
        });
      }

      const passwordHash = await hashPassword(request.body.newPassword);
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { passwordHash, mustChangePassword: false },
        }),
        prisma.session.deleteMany({
          where: { userId: user.id, id: { not: request.authSessionId! } },
        }),
      ]);

      await audit(request, {
        actorUserId: user.id,
        action: 'auth.password_changed',
        entityType: 'user',
        entityId: user.id,
        after: { mustChangePassword: false },
      });

      return { message: 'Password changed.' };
    },
  );

  typed.post(
    '/auth/revoke-all-sessions',
    {
      preHandler: [app.authenticateBasic],
      schema: { response: { 200: MessageSchema } },
    },
    async (request, reply) => {
      const count = await revokeUserSessions(request.authUser!.id);
      clearSessionCookie(reply);
      await audit(request, {
        actorUserId: request.authUser!.id,
        action: 'auth.sessions_revoked',
        entityType: 'user',
        entityId: request.authUser!.id,
        after: { sessionsRevoked: count },
      });
      return { message: `${count} session${count === 1 ? '' : 's'} revoked.` };
    },
  );

}

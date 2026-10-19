import { Algorithm, hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { config } from './config.js';
import { prisma } from './db.js';
import { AppError, forbidden, unauthorized } from './errors.js';
import type { Role } from '@alche/shared';

export const SESSION_COOKIE = config.cookieName;
export const CSRF_COOKIE = config.csrfCookieName;

const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, ARGON_OPTIONS);
  } catch {
    return false;
  }
}

export function generatePassword(length = 20): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(length);
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += alphabet[bytes[index]! % alphabet.length];
  }
  return result;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
  active: boolean;
}

export interface SessionContext {
  id: string;
  user: SessionUser;
}

export async function createSession(
  userId: string,
  ip: string | undefined,
  userAgent: string | undefined,
): Promise<{ token: string; session: { id: string; absoluteExpiresAt: Date } }> {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const absoluteExpiresAt = new Date(now.getTime() + config.sessionAbsoluteMs);
  const session = await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
      lastSeenAt: now,
      absoluteExpiresAt,
    },
    select: { id: true, absoluteExpiresAt: true },
  });
  return { token, session };
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: Math.floor(config.sessionAbsoluteMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
  });
}

export async function revokeUserSessions(userId: string): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { userId } });
  return result.count;
}

async function resolveSession(request: FastifyRequest): Promise<SessionContext | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          mustChangePassword: true,
          active: true,
        },
      },
    },
  });

  if (!session) return null;

  const now = new Date();
  const idleExpired = new Date(session.lastSeenAt.getTime() + config.sessionIdleMs) < now;
  const absoluteExpired = session.absoluteExpiresAt < now;

  if (idleExpired || absoluteExpired || !session.user.active) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: now },
  });

  return {
    id: session.id,
    user: {
      ...session.user,
      role: session.user.role as Role,
    },
  };
}

export const authPlugin = fp(async (app) => {
  app.decorateRequest('authUser', null);
  app.decorateRequest('authSessionId', null);

  app.decorate('authenticateBasic', async (request: FastifyRequest, _reply: FastifyReply) => {
    const context = await resolveSession(request);
    if (!context) throw unauthorized();
    request.authUser = context.user;
    request.authSessionId = context.id;
  });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const context = await resolveSession(request);
    if (!context) throw unauthorized();
    request.authUser = context.user;
    request.authSessionId = context.id;
    if (context.user.mustChangePassword) {
      throw new AppError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Change your temporary password before continuing.',
      );
    }
  });

  app.decorate(
    'requireRole',
    (...roles: Role[]) =>
      async (request: FastifyRequest, _reply: FastifyReply) => {
        if (!request.authUser) throw unauthorized();
        if (!roles.includes(request.authUser.role)) {
          throw forbidden();
        }
      },
  );

  app.decorate(
    'requireAnyRole',
    (...roles: Role[]) =>
      async (request: FastifyRequest, _reply: FastifyReply) => {
        if (!request.authUser) throw unauthorized();
        if (!roles.includes(request.authUser.role)) {
          throw forbidden();
        }
      },
  );
});

declare module 'fastify' {
  interface FastifyRequest {
    authUser: SessionUser | null;
    authSessionId: string | null;
  }

  interface FastifyInstance {
    authenticateBasic: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAnyRole: (...roles: Role[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

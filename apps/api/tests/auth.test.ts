import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createUser, resetDatabase, TestClient } from './helpers.js';
import { hashPassword } from '../src/auth.js';

describe('P1 auth, sessions and roles', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('exposes an unauthenticated health check', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', db: true });
  });

  it('requires a CSRF token on login', async () => {
    await createUser({ username: 'admin', password: 'StrongPassword123!' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'StrongPassword123!' },
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.json().error.code).toBeTruthy();
  });

  it('signs in, returns the current user and logs out', async () => {
    await createUser({ username: 'admin', password: 'StrongPassword123!' });
    const client = new TestClient(app);
    await client.login('admin', 'StrongPassword123!');

    const me = await client.inject<{ user: { username: string } }>({ url: '/api/v1/auth/me' });
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('admin');

    const logout = await client.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(logout.status).toBe(200);
    const after = await client.inject({ url: '/api/v1/auth/me' });
    expect(after.status).toBe(401);
  });

  it('forces a password change before protected routes work', async () => {
    await createUser({
      username: 'admin',
      password: 'TemporaryPassword123!',
      mustChangePassword: true,
    });
    const client = new TestClient(app);
    await client.login('admin', 'TemporaryPassword123!');

    const blocked = await client.inject({ url: '/api/v1/employees' });
    expect(blocked.status).toBe(403);
    expect((blocked.body as { error: { code: string } }).error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await client.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      body: {
        currentPassword: 'TemporaryPassword123!',
        newPassword: 'A-Permanent-Password-456!',
      },
    });
    expect(changed.status).toBe(200);

    const allowed = await client.inject({ url: '/api/v1/employees' });
    expect(allowed.status).toBe(200);
  });

  it('enforces the role matrix on the server', async () => {
    await createUser({ username: 'officer', password: 'StrongPassword123!', role: 'SECURITY' });
    const client = new TestClient(app);
    await client.login('officer', 'StrongPassword123!');

    const response = await client.inject({ url: '/api/v1/employees' });
    expect(response.status).toBe(403);
    expect((response.body as { error: { message: string } }).error.message).toContain('permission');
  });

  it('locks an account after five failed attempts', async () => {
    await createUser({ username: 'admin', password: 'StrongPassword123!' });
    const client = new TestClient(app);
    await client.csrf();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await client.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        body: { username: 'admin', password: 'WrongPassword123!' },
      });
      expect(response.status).toBe(401);
    }
    const fifth = await client.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { username: 'admin', password: 'WrongPassword123!' },
    });
    expect(fifth.status).toBe(429);
    expect((fifth.body as { error: { code: string } }).error.code).toBe('LOGIN_LOCKED');

    const correct = await client.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { username: 'admin', password: 'StrongPassword123!' },
    });
    expect(correct.status).toBe(429);
  });

  it('expires an idle session and ejects a deactivated user', async () => {
    const user = await createUser({ username: 'admin', password: 'StrongPassword123!' });
    const client = new TestClient(app);
    await client.login('admin', 'StrongPassword123!');

    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { lastSeenAt: new Date(Date.now() - 9 * 60 * 60_000) },
    });
    const expired = await client.inject({ url: '/api/v1/auth/me' });
    expect(expired.status).toBe(401);

    await client.login('admin', 'StrongPassword123!');
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    const ejected = await client.inject({ url: '/api/v1/auth/me' });
    expect(ejected.status).toBe(401);
  });

  it('writes an audit row for login and failed login', async () => {
    const user = await createUser({ username: 'admin', password: 'StrongPassword123!' });
    const client = new TestClient(app);
    await client.login('admin', 'StrongPassword123!');
    await client.csrf();
    await client.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      body: { username: 'admin', password: 'WrongPassword123!' },
    });

    const rows = await prisma.auditLog.findMany({ where: { actorUserId: user.id } });
    expect(rows.some((row) => row.action === 'auth.login')).toBe(true);
    expect(rows.some((row) => row.action === 'auth.login_failed')).toBe(true);
  });

  it('hashes passwords with argon2id', async () => {
    const user = await prisma.user.create({
      data: {
        username: 'hashcheck',
        displayName: 'Hash Check',
        role: 'HR',
        passwordHash: await hashPassword('StrongPassword123!'),
      },
    });
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
  });
});

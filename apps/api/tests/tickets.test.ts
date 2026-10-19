import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { createUser, resetDatabase, TestClient } from './helpers.js';

const ZONE = 'Indian/Mauritius';

function todayAt(hour: number, minute: number): Date {
  return DateTime.now().setZone(ZONE).startOf('day').set({ hour, minute }).toUTC().toJSDate();
}

describe('P5 amendment ticket lifecycle', () => {
  let app: FastifyInstance;
  let employeeId: string;
  let security: TestClient;
  let hr: TestClient;

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
    const employee = await prisma.employee.create({
      data: {
        code: 'ALCHE001',
        firstName: 'Nadia',
        lastName: 'Bossy',
        department: 'Administration',
        category: 'staff',
        active: true,
      },
    });
    employeeId = employee.id;
    await createUser({ username: 'security', password: 'StrongPassword123!', role: 'SECURITY' });
    await createUser({ username: 'hr', password: 'StrongPassword123!', role: 'HR' });
    await createUser({ username: 'hr2', password: 'StrongPassword123!', role: 'HR' });
    security = new TestClient(app);
    await security.login('security', 'StrongPassword123!');
    hr = new TestClient(app);
    await hr.login('hr', 'StrongPassword123!');
  });

  async function createEvent(direction: 'IN' | 'OUT' = 'IN', when = todayAt(8, 0)) {
    const hrUser = await prisma.user.findUniqueOrThrow({ where: { username: 'hr' } });
    return prisma.event.create({
      data: {
        employeeId,
        occurredAt: when,
        direction,
        recordedBy: hrUser.id,
        source: 'gate',
      },
    });
  }

  async function raise(targetEventId?: string) {
    return security.inject<{ ticket: { id: string; status: string } }>({
      method: 'POST',
      url: '/api/v1/tickets',
      body: {
        employeeId,
        targetEventId: targetEventId ?? null,
        proposedDirection: 'IN',
        proposedOccurredAt: todayAt(7, 45).toISOString(),
        reason: 'Paper logbook showed 07:45, not 08:00',
      },
    });
  }

  it('runs approve → apply, supersedes the old event and marks attendance amended', async () => {
    const event = await createEvent();
    const created = await raise(event.id);
    expect(created.status).toBe(201);
    expect(created.body.ticket.status).toBe('open');

    const denied = await security.inject({
      method: 'POST',
      url: `/api/v1/tickets/${created.body.ticket.id}/approve`,
      body: {},
    });
    expect(denied.status).toBe(403);

    const approved = await hr.inject<{ ticket: { status: string; hrOccurredAt: string } }>({
      method: 'POST',
      url: `/api/v1/tickets/${created.body.ticket.id}/approve`,
      body: {
        occurredAt: todayAt(7, 30).toISOString(),
        direction: 'IN',
        reviewNote: 'Confirmed against signed logbook page',
      },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.ticket.status).toBe('approved');

    const applied = await hr.inject<{ ticket: { status: string }; appliedEventId: string }>({
      method: 'POST',
      url: `/api/v1/tickets/${created.body.ticket.id}/apply`,
    });
    expect(applied.status).toBe(200);
    expect(applied.body.ticket.status).toBe('applied');
    expect(applied.body.appliedEventId).toBeTruthy();

    const old = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(old.supersededById).toBe(applied.body.appliedEventId);
    const replacement = await prisma.event.findUniqueOrThrow({
      where: { id: applied.body.appliedEventId },
    });
    expect(replacement.source).toBe('amendment');
    expect(replacement.ticketId).toBe(created.body.ticket.id);
    expect(replacement.occurredAt.toISOString()).toBe(todayAt(7, 30).toISOString());

    const today = DateTime.now().setZone(ZONE).toISODate()!;
    const report = await hr.inject<{ items: Array<{ flags: string[]; amended: boolean; firstInLocal: string }> }>({
      url: `/api/v1/attendance?from=${today}&to=${today}`,
    });
    expect(report.body.items[0]?.amended).toBe(true);
    expect(report.body.items[0]?.flags).toContain('AMENDED');
    expect(report.body.items[0]?.firstInLocal).toBe('07:30:00');

    const doubleApply = await hr.inject({
      method: 'POST',
      url: `/api/v1/tickets/${created.body.ticket.id}/apply`,
    });
    expect(doubleApply.status).toBe(409);
    expect((doubleApply.body as { error: { code: string } }).error.code).toBe(
      'TICKET_ALREADY_APPLIED',
    );
  });

  it('applies a missing-event ticket without superseding anything', async () => {
    const created = await raise();
    await hr.inject({
      method: 'POST',
      url: `/api/v1/tickets/${created.body.ticket.id}/approve`,
      body: {},
    });
    const applied = await hr.inject<{ appliedEventId: string }>({
      method: 'POST',
      url: `/api/v1/tickets/${created.body.ticket.id}/apply`,
    });
    expect(applied.status).toBe(200);
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: applied.body.appliedEventId },
    });
    expect(event.supersededById).toBeNull();
    expect(event.source).toBe('amendment');
  });

  it('rejects without applying anything and withdraws only while open', async () => {
    const event = await createEvent();
    const rejectedTicket = await raise(event.id);
    const rejected = await hr.inject<{ ticket: { status: string } }>({
      method: 'POST',
      url: `/api/v1/tickets/${rejectedTicket.body.ticket.id}/reject`,
      body: { reviewNote: 'Timestamp was correct' },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.ticket.status).toBe('rejected');
    expect(await prisma.event.count()).toBe(1);

    const withdrawable = await raise(event.id);
    const withdrawn = await security.inject<{ ticket: { status: string } }>({
      method: 'POST',
      url: `/api/v1/tickets/${withdrawable.body.ticket.id}/withdraw`,
      body: { reason: 'Raised against the wrong event' },
    });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.ticket.status).toBe('withdrawn');

    const withdrawClosed = await security.inject({
      method: 'POST',
      url: `/api/v1/tickets/${rejectedTicket.body.ticket.id}/withdraw`,
      body: { reason: 'Too late' },
    });
    expect(withdrawClosed.status).toBe(409);
  });

  it('shows security only its own tickets and HR all tickets', async () => {
    const first = await raise();
    const hrUser = await prisma.user.findUniqueOrThrow({ where: { username: 'hr' } });
    const own = await prisma.ticket.create({
      data: {
        employeeId,
        proposedDirection: 'OUT',
        proposedOccurredAt: todayAt(17, 0),
        reason: 'HR own ticket',
        raisedBy: hrUser.id,
        status: 'open',
      },
    });

    const securityList = await security.inject<{ items: Array<{ id: string }> }>({
      url: '/api/v1/tickets',
    });
    expect(securityList.status).toBe(200);
    expect(securityList.body.items.map((ticket) => ticket.id)).toContain(first.body.ticket.id);
    expect(securityList.body.items.map((ticket) => ticket.id)).not.toContain(own.id);

    const hrList = await hr.inject<{ items: Array<{ id: string }>; openCount: number }>({
      url: '/api/v1/tickets',
    });
    expect(hrList.body.items).toHaveLength(2);
    expect(hrList.body.openCount).toBe(2);
  });

  it('audits each ticket transition', async () => {
    const event = await createEvent();
    const created = await raise(event.id);
    await hr.inject({
      method: 'POST',
      url: `/api/v1/tickets/${created.body.ticket.id}/approve`,
      body: {},
    });
    await hr.inject({ method: 'POST', url: `/api/v1/tickets/${created.body.ticket.id}/apply` });
    const actions = (
      await prisma.auditLog.findMany({
        where: { entityType: 'ticket' },
        orderBy: { createdAt: 'asc' },
      })
    ).map((row) => row.action);
    expect(actions).toEqual(['ticket.raise', 'ticket.approve', 'ticket.apply']);
  });

  it('refuses to withdraw somebody else’s ticket', async () => {
    const event = await createEvent();
    const created = await raise(event.id);
    const hr2 = new TestClient(app);
    await hr2.login('hr2', 'StrongPassword123!');
    const response = await hr2.inject({
      method: 'POST',
      url: `/api/v1/tickets/${created.body.ticket.id}/withdraw`,
      body: { reason: 'Not mine' },
    });
    expect(response.status).toBe(403);
  });
});

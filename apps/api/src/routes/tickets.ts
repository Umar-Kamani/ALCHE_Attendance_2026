import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import {
  CreateTicketBodySchema,
  IdParamSchema,
  TicketActionResponseSchema,
  TicketDecisionBodySchema,
  TicketListQuerySchema,
  TicketListResponseSchema,
  TicketReasonBodySchema,
  TicketResponseSchema,
  type Ticket,
} from '@alche/shared';
import { prisma } from '../db.js';
import { AppError, conflict, notFound, unprocessable } from '../errors.js';
import { audit } from '../audit.js';
import { pageArgs, pageMeta } from '../pagination.js';
import { iso, isoRequired } from '../time.js';

const TICKET_INCLUDE = {
  employee: { select: { id: true, code: true, firstName: true, lastName: true, department: true } },
  raiser: { select: { id: true, displayName: true } },
  reviewer: { select: { id: true, displayName: true } },
} as const;

type TicketRecord = Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

async function serializeTickets(records: TicketRecord[]): Promise<Ticket[]> {
  const targetIds = records
    .map((ticket) => ticket.targetEventId)
    .filter((id): id is string => Boolean(id));
  const targets = targetIds.length
    ? await prisma.event.findMany({
        where: { id: { in: targetIds } },
        select: { id: true, occurredAt: true, direction: true },
      })
    : [];
  const targetMap = new Map(targets.map((event) => [event.id, event]));

  return records.map((ticket) => {
    const target = ticket.targetEventId ? targetMap.get(ticket.targetEventId) : null;
    return {
      id: ticket.id,
      employee: {
        id: ticket.employee.id,
        code: ticket.employee.code,
        fullName: `${ticket.employee.firstName} ${ticket.employee.lastName}`,
        department: ticket.employee.department,
      },
      targetEvent: target
        ? {
            id: target.id,
            occurredAt: isoRequired(target.occurredAt),
            direction: target.direction as 'IN' | 'OUT',
          }
        : null,
      proposedDirection: ticket.proposedDirection as 'IN' | 'OUT',
      proposedOccurredAt: isoRequired(ticket.proposedOccurredAt),
      reason: ticket.reason,
      status: ticket.status as Ticket['status'],
      raisedBy: { id: ticket.raiser.id, displayName: ticket.raiser.displayName },
      raisedAt: isoRequired(ticket.raisedAt),
      reviewedBy: ticket.reviewer
        ? { id: ticket.reviewer.id, displayName: ticket.reviewer.displayName }
        : null,
      reviewedAt: iso(ticket.reviewedAt),
      hrDirection: (ticket.hrDirection as 'IN' | 'OUT' | null) ?? null,
      hrOccurredAt: iso(ticket.hrOccurredAt),
      appliedAt: iso(ticket.appliedAt),
      appliedEventId: ticket.appliedEventId,
      reviewNote: ticket.reviewNote,
      createdAt: isoRequired(ticket.createdAt),
      updatedAt: isoRequired(ticket.updatedAt),
    };
  });
}

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/tickets',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        querystring: TicketListQuerySchema,
        response: { 200: TicketListResponseSchema },
      },
    },
    async (request) => {
      const isHr = request.authUser!.role === 'HR';
      const where: Prisma.TicketWhereInput = {
        ...(isHr ? {} : { raisedBy: request.authUser!.id }),
        ...(request.query.status ? { status: request.query.status } : {}),
      };
      const [records, total, openCount] = await Promise.all([
        prisma.ticket.findMany({
          where,
          include: TICKET_INCLUDE,
          orderBy: { raisedAt: 'desc' },
          ...pageArgs(request.query.page),
        }),
        prisma.ticket.count({ where }),
        prisma.ticket.count({
          where: {
            ...(isHr ? {} : { raisedBy: request.authUser!.id }),
            status: 'open',
          },
        }),
      ]);
      return {
        items: await serializeTickets(records),
        meta: pageMeta(request.query.page, total),
        openCount,
      };
    },
  );

  typed.post(
    '/tickets',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: { body: CreateTicketBodySchema, response: { 201: TicketResponseSchema } },
    },
    async (request, reply) => {
      const employee = await prisma.employee.findUnique({
        where: { id: request.body.employeeId },
      });
      if (!employee) throw notFound('Employee not found.');

      if (request.body.targetEventId) {
        const target = await prisma.event.findUnique({
          where: { id: request.body.targetEventId },
        });
        if (!target) throw notFound('The target event could not be found.');
        if (target.employeeId !== employee.id) {
          throw unprocessable('The target event does not belong to that employee.');
        }
        if (target.voidedAt || target.supersededById) {
          throw conflict('EVENT_NOT_EFFECTIVE', 'That event is no longer effective.');
        }
      }

      const proposedOccurredAt = new Date(request.body.proposedOccurredAt);
      if (Number.isNaN(proposedOccurredAt.getTime())) {
        throw unprocessable('The proposed timestamp is invalid.');
      }

      const ticket = await prisma.ticket.create({
        data: {
          employeeId: employee.id,
          targetEventId: request.body.targetEventId ?? null,
          proposedDirection: request.body.proposedDirection,
          proposedOccurredAt,
          reason: request.body.reason,
          status: 'open',
          raisedBy: request.authUser!.id,
        },
        include: TICKET_INCLUDE,
      });

      const [serialized] = await serializeTickets([ticket]);
      await audit(request, {
        action: 'ticket.raise',
        entityType: 'ticket',
        entityId: ticket.id,
        after: serialized,
        reason: request.body.reason,
      });
      reply.status(201);
      return { ticket: serialized! };
    },
  );

  typed.post(
    '/tickets/:id/withdraw',
    {
      preHandler: [app.authenticate, app.requireAnyRole('HR', 'SECURITY')],
      schema: {
        params: IdParamSchema,
        body: TicketReasonBodySchema,
        response: { 200: TicketActionResponseSchema },
      },
    },
    async (request) => {
      const current = await prisma.ticket.findUnique({
        where: { id: request.params.id },
        include: TICKET_INCLUDE,
      });
      if (!current) throw notFound('Ticket not found.');
      if (current.raisedBy !== request.authUser!.id) {
        throw new AppError(403, 'FORBIDDEN', 'Only the officer who raised this ticket can withdraw it.');
      }
      if (current.status !== 'open') {
        throw conflict('TICKET_NOT_OPEN', 'Only an open ticket can be withdrawn.');
      }
      const ticket = await prisma.ticket.update({
        where: { id: current.id },
        data: {
          status: 'withdrawn',
          reviewedAt: new Date(),
          reviewNote: request.body.reason,
        },
        include: TICKET_INCLUDE,
      });
      const [serialized] = await serializeTickets([ticket]);
      await audit(request, {
        action: 'ticket.withdraw',
        entityType: 'ticket',
        entityId: ticket.id,
        before: (await serializeTickets([current]))[0],
        after: serialized,
        reason: request.body.reason,
      });
      return { ticket: serialized!, appliedEventId: null, success: true as const };
    },
  );

  typed.post(
    '/tickets/:id/approve',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: {
        params: IdParamSchema,
        body: TicketDecisionBodySchema,
        response: { 200: TicketActionResponseSchema },
      },
    },
    async (request) => {
      const current = await prisma.ticket.findUnique({
        where: { id: request.params.id },
        include: TICKET_INCLUDE,
      });
      if (!current) throw notFound('Ticket not found.');
      if (current.status !== 'open') {
        throw conflict('TICKET_NOT_OPEN', 'Only an open ticket can be approved.');
      }
      const ticket = await prisma.ticket.update({
        where: { id: current.id },
        data: {
          status: 'approved',
          reviewedBy: request.authUser!.id,
          reviewedAt: new Date(),
          hrDirection: request.body.direction ?? current.proposedDirection,
          hrOccurredAt: request.body.occurredAt
            ? new Date(request.body.occurredAt)
            : current.proposedOccurredAt,
          reviewNote: request.body.reviewNote ?? null,
        },
        include: TICKET_INCLUDE,
      });
      const [serialized, before] = await Promise.all([
        serializeTickets([ticket]),
        serializeTickets([current]),
      ]);
      await audit(request, {
        action: 'ticket.approve',
        entityType: 'ticket',
        entityId: ticket.id,
        before: before[0],
        after: serialized[0],
        reason: request.body.reviewNote ?? null,
      });
      return { ticket: serialized[0]!, appliedEventId: null, success: true as const };
    },
  );

  typed.post(
    '/tickets/:id/reject',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: {
        params: IdParamSchema,
        body: TicketDecisionBodySchema,
        response: { 200: TicketActionResponseSchema },
      },
    },
    async (request) => {
      const current = await prisma.ticket.findUnique({
        where: { id: request.params.id },
        include: TICKET_INCLUDE,
      });
      if (!current) throw notFound('Ticket not found.');
      if (current.status !== 'open') {
        throw conflict('TICKET_NOT_OPEN', 'Only an open ticket can be rejected.');
      }
      const ticket = await prisma.ticket.update({
        where: { id: current.id },
        data: {
          status: 'rejected',
          reviewedBy: request.authUser!.id,
          reviewedAt: new Date(),
          reviewNote: request.body.reviewNote ?? null,
        },
        include: TICKET_INCLUDE,
      });
      const [serialized, before] = await Promise.all([
        serializeTickets([ticket]),
        serializeTickets([current]),
      ]);
      await audit(request, {
        action: 'ticket.reject',
        entityType: 'ticket',
        entityId: ticket.id,
        before: before[0],
        after: serialized[0],
        reason: request.body.reviewNote ?? null,
      });
      return { ticket: serialized[0]!, appliedEventId: null, success: true as const };
    },
  );

  typed.post(
    '/tickets/:id/apply',
    {
      preHandler: [app.authenticate, app.requireRole('HR')],
      schema: {
        params: IdParamSchema,
        response: { 200: TicketActionResponseSchema },
      },
    },
    async (request) => {
      const current = await prisma.ticket.findUnique({
        where: { id: request.params.id },
        include: TICKET_INCLUDE,
      });
      if (!current) throw notFound('Ticket not found.');
      if (current.status === 'applied') {
        throw conflict('TICKET_ALREADY_APPLIED', 'This ticket has already been applied.');
      }
      if (current.status !== 'approved') {
        throw conflict('TICKET_NOT_APPROVED', 'Approve the ticket before applying it.');
      }
      if (current.targetEventId) {
        const target = await prisma.event.findUnique({ where: { id: current.targetEventId } });
        if (!target) throw notFound('The target event no longer exists.');
        if (target.voidedAt || target.supersededById) {
          throw conflict(
            'TARGET_EVENT_CHANGED',
            'The target event was already superseded or voided. Reject this ticket and raise a new one.',
          );
        }
      }

      const applied = await prisma.$transaction(async (tx) => {
        const event = await tx.event.create({
          data: {
            employeeId: current.employeeId,
            occurredAt: current.hrOccurredAt ?? current.proposedOccurredAt,
            direction: current.hrDirection ?? current.proposedDirection,
            recordedBy: request.authUser!.id,
            source: 'amendment',
            note: current.reason,
            ticketId: current.id,
          },
          include: {
            employee: { select: { firstName: true, lastName: true, code: true } },
            recorder: { select: { displayName: true } },
          },
        });
        if (current.targetEventId) {
          await tx.event.update({
            where: { id: current.targetEventId },
            data: { supersededById: event.id },
          });
        }
        const ticket = await tx.ticket.update({
          where: { id: current.id },
          data: {
            status: 'applied',
            appliedAt: new Date(),
            appliedEventId: event.id,
          },
          include: TICKET_INCLUDE,
        });
        return { event, ticket };
      });

      const [serialized, before] = await Promise.all([
        serializeTickets([applied.ticket]),
        serializeTickets([current]),
      ]);
      await audit(request, {
        action: 'ticket.apply',
        entityType: 'ticket',
        entityId: applied.ticket.id,
        before: before[0],
        after: { ...serialized[0], appliedEventId: applied.event.id },
        reason: current.reason,
      });
      await audit(request, {
        action: 'event.amendment_apply',
        entityType: 'event',
        entityId: applied.event.id,
        after: {
          employeeId: applied.event.employeeId,
          occurredAt: applied.event.occurredAt.toISOString(),
          direction: applied.event.direction,
          source: 'amendment',
          ticketId: applied.ticket.id,
          supersededEventId: current.targetEventId,
        },
        reason: current.reason,
      });

      return {
        ticket: serialized[0]!,
        appliedEventId: applied.event.id,
        success: true as const,
      };
    },
  );
}

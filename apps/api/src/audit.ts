import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import type { FastifyRequest } from 'fastify';

interface AuditInput {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

function requestIp(request: FastifyRequest): string | null {
  return request.ip || null;
}

export async function audit(
  request: FastifyRequest,
  input: Omit<AuditInput, 'ip'> & { ip?: string | null },
): Promise<void> {
  await auditDirect({
    ...input,
    ip: input.ip ?? requestIp(request),
  });
}

export async function auditDirect(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      ...(input.before === undefined
        ? {}
        : { before: input.before as Prisma.InputJsonValue }),
      ...(input.after === undefined ? {} : { after: input.after as Prisma.InputJsonValue }),
      reason: input.reason ?? null,
      ip: input.ip ?? null,
    },
  });
}

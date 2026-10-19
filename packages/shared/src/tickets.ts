import { z } from 'zod';
import { DirectionSchema, TicketStatusSchema } from './enums.js';
import { PaginationMetaSchema, SuccessSchema, UuidSchema } from './common.js';

export const TicketSchema = z.object({
  id: UuidSchema,
  employee: z.object({
    id: UuidSchema,
    code: z.string(),
    fullName: z.string(),
    department: z.string(),
  }),
  targetEvent: z
    .object({
      id: UuidSchema,
      occurredAt: z.string(),
      direction: DirectionSchema,
    })
    .nullable(),
  proposedDirection: DirectionSchema,
  proposedOccurredAt: z.string(),
  reason: z.string(),
  status: TicketStatusSchema,
  raisedBy: z.object({ id: UuidSchema, displayName: z.string() }),
  raisedAt: z.string(),
  reviewedBy: z.object({ id: UuidSchema, displayName: z.string() }).nullable(),
  reviewedAt: z.string().nullable(),
  hrDirection: DirectionSchema.nullable(),
  hrOccurredAt: z.string().nullable(),
  appliedAt: z.string().nullable(),
  appliedEventId: UuidSchema.nullable(),
  reviewNote: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Ticket = z.infer<typeof TicketSchema>;

export const TicketListQuerySchema = z.object({
  status: TicketStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const TicketListResponseSchema = z.object({
  items: z.array(TicketSchema),
  meta: PaginationMetaSchema,
  openCount: z.number().int(),
});

export const CreateTicketBodySchema = z.object({
  employeeId: UuidSchema,
  targetEventId: UuidSchema.optional().nullable(),
  proposedDirection: DirectionSchema,
  proposedOccurredAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(3).max(1000),
});

export const TicketDecisionBodySchema = z.object({
  direction: DirectionSchema.optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  reviewNote: z.string().trim().max(1000).optional().nullable(),
});

export const TicketReasonBodySchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});

export const TicketApplyBodySchema = z.object({
  direction: DirectionSchema.optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});

export const TicketResponseSchema = z.object({ ticket: TicketSchema });
export const TicketActionResponseSchema = z.object({
  ticket: TicketSchema,
  appliedEventId: UuidSchema.nullable(),
  success: z.literal(true),
});
export type TicketListResponse = z.infer<typeof TicketListResponseSchema>;
export type TicketActionResponse = z.infer<typeof TicketActionResponseSchema>;

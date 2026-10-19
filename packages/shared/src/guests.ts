import { z } from 'zod';
import { VisitStatusSchema } from './enums.js';
import {
  LocalDateSchema,
  PaginationMetaSchema,
  QueryBooleanSchema,
  SuccessSchema,
  UuidSchema,
} from './common.js';

const optionalEmail = z
  .union([z.string().trim().email('Enter a valid email'), z.literal(''), z.null()])
  .transform((value) => (value ? value : null));

export const GuestSchema = z.object({
  id: UuidSchema,
  fullName: z.string(),
  phone: z.string().nullable(),
  idNumber: z.string().nullable(),
  company: z.string().nullable(),
  email: z.string().nullable(),
  active: z.boolean(),
  visitCount: z.number().int().optional(),
  lastVisitAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Guest = z.infer<typeof GuestSchema>;

export const GuestListQuerySchema = z.object({
  q: z.string().trim().max(160).optional(),
  includeInactive: QueryBooleanSchema,
  page: z.coerce.number().int().min(1).default(1),
});

export const GuestListResponseSchema = z.object({
  items: z.array(GuestSchema),
  meta: PaginationMetaSchema,
});

export const CreateGuestBodySchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(40).optional().nullable(),
  idNumber: z.string().trim().max(80).optional().nullable(),
  company: z.string().trim().max(160).optional().nullable(),
  email: optionalEmail.optional(),
});

export const UpdateGuestBodySchema = CreateGuestBodySchema.partial().extend({
  active: z.boolean().optional(),
});

export const GuestVisitVehicleSchema = z.object({
  id: UuidSchema,
  plate: z.string(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  colour: z.string().nullable(),
  vehicleType: z.string(),
});

export const GuestVehicleInputSchema = z.object({
  plate: z.string().trim().min(2).max(20),
  make: z.string().trim().max(80).optional().nullable(),
  model: z.string().trim().max(80).optional().nullable(),
  colour: z.string().trim().max(80).optional().nullable(),
  vehicleType: z.enum(['car', 'motorbike', 'van', 'other']).default('car'),
});

export const GuestVisitSchema = z.object({
  id: UuidSchema,
  guest: z.object({
    id: UuidSchema,
    fullName: z.string(),
    company: z.string().nullable(),
    phone: z.string().nullable(),
    idNumber: z.string().nullable(),
  }),
  host: z.object({
    id: UuidSchema,
    fullName: z.string(),
    department: z.string(),
  }),
  purpose: z.string(),
  expectedFrom: z.string(),
  expectedTo: z.string(),
  badgeNo: z.string().nullable(),
  checkedInAt: z.string().nullable(),
  checkedInBy: z.string().nullable(),
  checkedOutAt: z.string().nullable(),
  checkedOutBy: z.string().nullable(),
  status: VisitStatusSchema,
  storedStatus: z.enum(['EXPECTED', 'ON_SITE', 'DEPARTED', 'CANCELLED']),
  overdue: z.boolean(),
  vehicle: GuestVisitVehicleSchema.nullable(),
  activeParking: z
    .object({
      sessionId: UuidSchema,
      bayCode: z.string(),
      areaName: z.string(),
    })
    .nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GuestVisit = z.infer<typeof GuestVisitSchema>;

export const GuestVisitListQuerySchema = z.object({
  date: LocalDateSchema.optional(),
  from: LocalDateSchema.optional(),
  to: LocalDateSchema.optional(),
  status: VisitStatusSchema.optional(),
  host: UuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const GuestVisitListResponseSchema = z.object({
  items: z.array(GuestVisitSchema),
  meta: PaginationMetaSchema,
  counts: z.object({
    expected: z.number().int(),
    onSite: z.number().int(),
    departed: z.number().int(),
    overdue: z.number().int(),
  }),
});

export const CreateGuestVisitBodySchema = z.object({
  guestId: UuidSchema.optional(),
  guest: CreateGuestBodySchema.optional(),
  hostEmployeeId: UuidSchema,
  purpose: z.string().trim().min(2).max(300),
  expectedFrom: z.string().datetime({ offset: true }),
  expectedTo: z.string().datetime({ offset: true }),
  badgeNo: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  vehicle: GuestVehicleInputSchema.optional().nullable(),
});

export const CheckInGuestVisitBodySchema = z.object({
  badgeNo: z.string().trim().max(40).optional().nullable(),
  vehicleId: UuidSchema.optional().nullable(),
  vehicle: GuestVehicleInputSchema.optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export const CheckOutGuestVisitBodySchema = z.object({
  releaseParking: z.boolean().default(false),
  note: z.string().trim().max(500).optional().nullable(),
});

export const GuestVisitResponseWrapperSchema = z.object({ visit: GuestVisitSchema });

export const GuestVisitRegisterRowSchema = GuestVisitSchema;

export const GuestExportQuerySchema = z.object({
  from: LocalDateSchema,
  to: LocalDateSchema,
});

export const GuestDeactivateResponseSchema = SuccessSchema;

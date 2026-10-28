import { z } from 'zod';
import {
  BayChipTypeSchema,
  BayTypeSchema,
  HolderCategorySchema,
  SessionEndReasonSchema,
  VehicleHolderKindSchema,
  VehicleTypeSchema,
} from './enums.js';
import { PaginationMetaSchema, QueryBooleanSchema, SuccessSchema, UuidSchema } from './common.js';

export const VehicleSchema = z.object({
  id: UuidSchema,
  plate: z.string(),
  plateNorm: z.string(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  colour: z.string().nullable(),
  vehicleType: VehicleTypeSchema,
  active: z.boolean(),
  notes: z.string().nullable(),
  holder: z.object({
    kind: HolderCategorySchema,
    id: UuidSchema,
    name: z.string(),
  }),
  activeParking: z
    .object({
      sessionId: UuidSchema,
      bayId: UuidSchema,
      bayCode: z.string(),
      areaName: z.string(),
      startedAt: z.string(),
    })
    .nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const VehicleHistorySchema = z.object({
  sessionId: UuidSchema,
  bayCode: z.string(),
  areaName: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  minutes: z.number().nullable(),
  overrideReason: z.string().nullable(),
});

export const VehicleDetailSchema = VehicleSchema.extend({
  history: z.array(VehicleHistorySchema),
  lastSeenAt: z.string().nullable(),
});
export type VehicleDetail = z.infer<typeof VehicleDetailSchema>;

export const VehicleListQuerySchema = z.object({
  q: z.string().trim().max(160).optional(),
  holderKind: VehicleHolderKindSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const VehicleListResponseSchema = z.object({
  items: z.array(VehicleSchema),
  meta: PaginationMetaSchema,
});

export type VehicleListResponse = z.infer<typeof VehicleListResponseSchema>;

export const CreateVehicleBodySchema = z.object({
  plate: z.string().trim().min(2).max(20),
  make: z.string().trim().max(80).optional().nullable(),
  model: z.string().trim().max(80).optional().nullable(),
  colour: z.string().trim().max(80).optional().nullable(),
  vehicleType: VehicleTypeSchema.default('car'),
  active: z.boolean().default(true),
  notes: z.string().trim().max(500).optional().nullable(),
  holderKind: VehicleHolderKindSchema,
  holderId: UuidSchema,
});

export const UpdateVehicleBodySchema = CreateVehicleBodySchema.omit({
  holderKind: true,
  holderId: true,
}).partial().extend({
  active: z.boolean().optional(),
});

export const ParkingAreaSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  code: z.string(),
  active: z.boolean(),
  notes: z.string().nullable(),
  bayCount: z.number().int().optional(),
  live: z
    .object({
      total: z.number().int(),
      occupied: z.number().int(),
      free: z.number().int(),
    })
    .optional(),
});
export type ParkingArea = z.infer<typeof ParkingAreaSchema>;

export const CreateParkingAreaBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers or hyphens'),
  notes: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().default(true),
});

export const UpdateParkingAreaBodySchema = CreateParkingAreaBodySchema.partial();

export const ParkingAreaListResponseSchema = z.object({ items: z.array(ParkingAreaSchema) });

export const BaySchema = z.object({
  id: UuidSchema,
  areaId: UuidSchema,
  areaName: z.string(),
  code: z.string(),
  bayType: BayTypeSchema,
  chip: BayChipTypeSchema,
  active: z.boolean(),
  notes: z.string().nullable(),
  occupied: z.boolean().optional(),
});
export type ParkingBay = z.infer<typeof BaySchema>;

export const BayListQuerySchema = z.object({
  areaId: UuidSchema.optional(),
  includeInactive: QueryBooleanSchema,
});

export const BayListResponseSchema = z.object({ items: z.array(BaySchema) });

export const CreateBayBodySchema = z.object({
  areaId: UuidSchema,
  code: z.string().trim().min(1).max(20),
  bayType: BayTypeSchema,
  notes: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().default(true),
});

export const UpdateBayBodySchema = CreateBayBodySchema.omit({ areaId: true }).partial();

export const BulkBayBodySchema = z.object({
  areaId: UuidSchema,
  prefix: z.string().trim().min(1).max(12),
  padding: z.coerce.number().int().min(1).max(4).default(2),
  from: z.coerce.number().int().min(1).max(9999),
  to: z.coerce.number().int().min(1).max(9999),
  bayType: BayTypeSchema,
  notes: z.string().trim().max(500).optional().nullable(),
  dryRun: z.boolean().default(false),
});

export const BulkBayResponseSchema = z.object({
  created: z.array(BaySchema),
  skipped: z.array(z.string()),
  preview: z.array(z.string()),
  dryRun: z.boolean(),
});

export const ActiveSessionSchema = z.object({
  id: UuidSchema,
  bayId: UuidSchema,
  bayCode: z.string(),
  areaId: UuidSchema,
  areaName: z.string(),
  vehicleId: UuidSchema.nullable(),
  plate: z.string(),
  holderName: z.string(),
  holderCategory: HolderCategorySchema,
  vehicleType: z.string(),
  startedAt: z.string(),
  allocatedBy: z.string(),
  overrideReason: z.string().nullable(),
  isOverride: z.boolean(),
  note: z.string().nullable(),
});
export type ActiveParkingSession = z.infer<typeof ActiveSessionSchema>;

export const ParkingBoardQuerySchema = z.object({
  areaId: UuidSchema.optional(),
  bayType: BayTypeSchema.optional(),
});

export const ParkingCapacitySchema = z.object({
  total: z.number().int(),
  occupied: z.number().int(),
  free: z.number().int(),
});

export const ParkingBoardResponseSchema = z.object({
  areas: z.array(
    z.object({
      id: UuidSchema,
      name: z.string(),
      code: z.string(),
      counts: z.object({
        overall: ParkingCapacitySchema,
        byType: z.record(z.string(), ParkingCapacitySchema),
      }),
      bays: z.array(
        z.object({
          id: UuidSchema,
          code: z.string(),
          bayType: BayTypeSchema,
          chip: BayChipTypeSchema,
          active: z.boolean(),
          notes: z.string().nullable(),
          session: ActiveSessionSchema.nullable(),
        }),
      ),
    }),
  ),
  counts: z.object({
    overall: ParkingCapacitySchema,
    byType: z.record(z.string(), ParkingCapacitySchema),
  }),
  legend: z.array(
    z.object({
      type: BayTypeSchema,
      label: z.string(),
      chip: BayChipTypeSchema,
    }),
  ),
});

export type ParkingBoardResponse = z.infer<typeof ParkingBoardResponseSchema>;

export const AllocateSessionBodySchema = z
  .object({
    bayId: UuidSchema.optional(),
    autoAssign: z.boolean().default(false),
    vehicleId: UuidSchema,
    startedAt: z.string().datetime({ offset: true }).optional(),
    overrideReason: z.string().trim().min(3).max(1000).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
  })
  .refine((value) => Boolean(value.bayId) !== value.autoAssign, {
    message: 'Provide either bayId or autoAssign=true',
  });

export const RelocateSessionBodySchema = z
  .object({
    bayId: UuidSchema.optional(),
    autoAssign: z.boolean().default(false),
    overrideReason: z.string().trim().min(3).max(1000).optional().nullable(),
  })
  .refine((value) => Boolean(value.bayId) !== value.autoAssign, {
    message: 'Provide either bayId or autoAssign=true',
  });

export const ReleaseSessionBodySchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});

export const SessionMutationResponseSchema = z.object({
  session: ActiveSessionSchema,
  releasedSessionId: UuidSchema.nullable(),
  success: z.literal(true),
});

export const ParkingHistoryQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  areaId: UuidSchema.optional(),
  bayType: BayTypeSchema.optional(),
});

export const ParkingHistoryRowSchema = z.object({
  date: z.string(),
  areaId: UuidSchema,
  areaName: z.string(),
  bayType: BayTypeSchema,
  peakOccupancy: z.number().int(),
  sessions: z.number().int(),
  averageDwellMinutes: z.number().nullable(),
});

export const ParkingHistoryResponseSchema = z.object({
  rows: z.array(ParkingHistoryRowSchema),
  totals: z.object({
    sessions: z.number().int(),
    averageDwellMinutes: z.number().nullable(),
  }),
});

export type ParkingHistoryResponse = z.infer<typeof ParkingHistoryResponseSchema>;
export type ParkingAreaListResponse = z.infer<typeof ParkingAreaListResponseSchema>;
export type BulkBayResponse = z.infer<typeof BulkBayResponseSchema>;
export type SessionMutationResponse = z.infer<typeof SessionMutationResponseSchema>;

export const ParkingExportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

import { z } from 'zod';
import { VehicleTypeSchema } from './enums.js';
import { PaginationMetaSchema, UuidSchema } from './common.js';

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
    kind: z.literal('employee'),
    id: UuidSchema,
    name: z.string(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const VehicleDetailSchema = VehicleSchema;
export type VehicleDetail = z.infer<typeof VehicleDetailSchema>;

export const VehicleListQuerySchema = z.object({
  q: z.string().trim().max(160).optional(),
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
  employeeId: UuidSchema,
});

export const UpdateVehicleBodySchema = CreateVehicleBodySchema.omit({
  employeeId: true,
})
  .partial()
  .extend({
    active: z.boolean().optional(),
  });

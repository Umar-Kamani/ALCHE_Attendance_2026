import { z } from 'zod';
import { EmployeeCategorySchema } from './enums.js';
import { PaginationMetaSchema, QueryBooleanSchema, SuccessSchema, UuidSchema } from './common.js';

const optionalEmail = z
  .union([z.string().trim().email('Enter a valid email'), z.literal(''), z.null()])
  .transform((value) => (value ? value : null));

export const EmployeeSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  department: z.string(),
  jobTitle: z.string().nullable(),
  category: EmployeeCategorySchema,
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Employee = z.infer<typeof EmployeeSchema>;

export const EmployeeListQuerySchema = z.object({
  q: z.string().trim().max(160).optional(),
  department: z.string().trim().max(160).optional(),
  includeInactive: QueryBooleanSchema,
  page: z.coerce.number().int().min(1).default(1),
});

export const EmployeeListResponseSchema = z.object({
  items: z.array(EmployeeSchema),
  meta: PaginationMetaSchema,
  departments: z.array(z.string()),
});

export const CreateEmployeeBodySchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9]+$/, 'Use 2–32 letters or numbers'),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  email: optionalEmail.optional(),
  phone: z.string().trim().max(40).optional().nullable(),
  department: z.string().trim().min(1).max(160),
  jobTitle: z.string().trim().max(160).optional().nullable(),
  category: EmployeeCategorySchema.default('staff'),
  active: z.boolean().default(true),
});

export const UpdateEmployeeBodySchema = CreateEmployeeBodySchema.partial();

export type EmployeeListResponse = z.infer<typeof EmployeeListResponseSchema>;
export type ImportBatchSummary = z.infer<typeof ImportBatchSummarySchema>;

export const ImportQuerySchema = z.object({
  dryRun: QueryBooleanSchema,
  skipInvalid: QueryBooleanSchema,
});

export const ImportRowErrorSchema = z.object({
  row: z.number().int(),
  code: z.string().optional(),
  message: z.string(),
});

export const ImportPreviewRowSchema = z.object({
  row: z.number().int(),
  code: z.string(),
  name: z.string(),
  action: z.enum(['create', 'update', 'invalid', 'skip']),
  reason: z.string().optional(),
});

export const ImportBatchSummarySchema = z.object({
  id: UuidSchema,
  kind: z.literal('employees'),
  filename: z.string(),
  dryRun: z.boolean(),
  skipInvalid: z.boolean(),
  totalRows: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  invalid: z.number().int(),
  errors: z.array(ImportRowErrorSchema),
  preview: z.array(ImportPreviewRowSchema),
  createdAt: z.string(),
});

export const DeactivateSchema = SuccessSchema;

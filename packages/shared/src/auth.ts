import { z } from 'zod';
import { RoleSchema } from './enums.js';
import { QueryBooleanSchema, SuccessSchema, UuidSchema } from './common.js';

export const UserSchema = z.object({
  id: UuidSchema,
  username: z.string(),
  displayName: z.string(),
  role: RoleSchema,
  active: z.boolean(),
  mustChangePassword: z.boolean(),
});
export type User = z.infer<typeof UserSchema>;

export const LoginBodySchema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(512),
});
export type LoginBody = z.infer<typeof LoginBodySchema>;

export const LoginResponseSchema = z.object({
  user: UserSchema,
  csrfToken: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const MeResponseSchema = z.object({ user: UserSchema });
export type MeResponse = z.infer<typeof MeResponseSchema>;
export const CsrfResponseSchema = z.object({ csrfToken: z.string() });

export const ChangePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: z.string().min(12, 'Use at least 12 characters').max(512),
});

export const UserListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  includeInactive: QueryBooleanSchema,
});

export const CreateUserBodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, underscores or hyphens'),
  displayName: z.string().trim().min(1).max(160),
  role: RoleSchema,
});

export const CreateUserResponseSchema = z.object({
  user: UserSchema,
  temporaryPassword: z.string(),
});

export const ResetPasswordResponseSchema = z.object({
  temporaryPassword: z.string(),
});

export const UpdateUserRoleBodySchema = z.object({ role: RoleSchema });

export const LogoutResponseSchema = SuccessSchema;

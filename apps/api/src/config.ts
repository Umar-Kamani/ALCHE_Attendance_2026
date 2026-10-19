import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(process.cwd(), '../../.env') });

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  SECRET_KEY: z.string().min(16, 'SECRET_KEY must be at least 16 characters'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ADMIN_USERNAME: z.string().trim().min(1).default('admin'),
  ADMIN_INITIAL_PASSWORD: z.string().min(1).default('ChangeMe-ALCHE-2026!'),
  ADMIN_DISPLAY_NAME: z.string().trim().min(1).default('HR Administrator'),
  SESSION_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(1440).default(480),
  TZ: z.string().default('Indian/Mauritius'),
  BUILD_VERSION: z.string().default('dev'),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
}

const env = parsed.data;

if (
  env.NODE_ENV === 'production' &&
  (env.SECRET_KEY.startsWith('replace-this-default-secret') || env.SECRET_KEY === 'change-me')
) {
  throw new Error('Refusing to boot: SECRET_KEY is still the documented default in production.');
}

process.env.TZ = env.TZ;

export const config = {
  ...env,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  sessionIdleMs: env.SESSION_TIMEOUT_MINUTES * 60_000,
  sessionAbsoluteMs: 12 * 60 * 60_000,
  cookieName: 'alche_session',
  csrfCookieName: 'alche_csrf',
  timezone: 'Africa/Mauritius',
  adminPasswordIsDefault: env.ADMIN_INITIAL_PASSWORD === 'ChangeMe-ALCHE-2026!',
  publicDir: resolve(process.cwd(), existsSync(resolve(process.cwd(), 'public')) ? 'public' : '../web/dist'),
  uploadLimitBytes: 4 * 1024 * 1024,
} as const;

export type AppConfig = typeof config;

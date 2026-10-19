import { defineConfig } from 'vitest/config';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/alche_test?schema=public';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 90_000,
    globalSetup: ['./tests/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
      SECRET_KEY: 'vitest-secret-key-0123456789abcdef',
      ADMIN_USERNAME: 'admin',
      ADMIN_INITIAL_PASSWORD: 'ChangeMe-ALCHE-2026!',
      APP_ENV: 'test',
      TZ: 'Indian/Mauritius',
      SESSION_TIMEOUT_MINUTES: '480',
    },
    include: ['tests/**/*.test.ts'],
  },
});

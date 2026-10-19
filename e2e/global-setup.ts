import { execFileSync } from 'node:child_process';

export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_SKIP_SETUP === '1') return;

  // The supported deployment path runs fixtures inside the app container, which
  // already has the production DATABASE_URL. A local developer run falls back to
  // the local Prisma setup with DATABASE_URL from the shell.
  try {
    execFileSync('docker', ['compose', 'exec', 'app', 'node', 'dist/e2e-setup.js'], {
      stdio: 'inherit',
      env: process.env,
    });
    return;
  } catch {
    // Docker is not available in this environment; fall through.
  }

  execFileSync('pnpm', ['--filter', '@alche/api', 'e2e:setup'], {
    stdio: 'inherit',
    env: process.env,
  });
}

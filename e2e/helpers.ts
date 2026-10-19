import type { Page } from '@playwright/test';

export const E2E_PASSWORD = 'E2E-Password-123!';

export async function login(page: Page, username: string, password = E2E_PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/Username/).fill(username);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

export async function chooseByLabel(
  page: Page,
  label: string,
  option: string,
): Promise<void> {
  await page.getByLabel(label, { exact: true }).selectOption({ label: option });
}

export async function readDownload(downloadPath: string | null): Promise<Buffer> {
  if (!downloadPath) throw new Error('Download did not produce a path');
  const { readFile } = await import('node:fs/promises');
  return readFile(downloadPath);
}

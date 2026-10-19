import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

async function hideDynamicChrome(page: Page): Promise<void> {
  await page
    .locator('[data-testid="ticket-badge"]')
    .evaluateAll((elements) =>
      elements.forEach((element) => {
        (element as HTMLElement).style.display = 'none';
      }),
    );
}

async function filterVisualAttendance(page: import('@playwright/test').Page) {
  await page.goto('/attendance');
  await page.getByLabel(/^From/).fill('2026-09-01');
  await page.getByLabel(/^To/).fill('2026-09-30');
  await page.getByLabel('Department').selectOption({ label: 'Visual Department' });
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByText('Vera Visual').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test.describe('visual and design fidelity', () => {
  test('renders the DESIGN system tokens and loads Poppins locally', async ({ page }) => {
    const externalFontRequests: string[] = [];
    page.on('request', (request) => {
      if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) {
        externalFontRequests.push(request.url());
      }
    });

    await login(page, 'e2e.hr');
    await filterVisualAttendance(page);

    const filled = page.getByRole('button', { name: 'Export report' });
    await expect(filled).toBeVisible();
    const filledStyles = await filled.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        color: style.color,
        radius: style.borderRadius,
        fontSize: style.fontSize,
      };
    });
    expect(filledStyles.background).toBe('rgb(97, 97, 255)');
    expect(filledStyles.color).toBe('rgb(255, 255, 255)');
    expect(filledStyles.radius).toBe('160px');
    expect(Number.parseFloat(filledStyles.fontSize)).toBeGreaterThanOrEqual(14);

    const outlined = page.getByRole('button', { name: 'Raw events CSV' });
    const outlinedStyles = await outlined.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        border: style.borderTopColor,
        color: style.color,
        radius: style.borderRadius,
      };
    });
    expect(outlinedStyles.border).toBe('rgb(83, 87, 104)');
    expect(outlinedStyles.color).toBe('rgb(51, 51, 51)');
    expect(outlinedStyles.radius).toBe('160px');

    const presentPill = page.locator('tbody [data-tone="PRESENT"]').first();
    await expect(presentPill).toBeVisible();
    const pillStyles = await presentPill.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        color: style.color,
        radius: style.borderRadius,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
      };
    });
    expect(pillStyles.background).toBe('rgb(188, 254, 144)');
    expect(pillStyles.color).toBe('rgb(42, 92, 78)');
    expect(pillStyles.radius).toBe('6px');
    expect(Number.parseFloat(pillStyles.fontSize)).toBeLessThanOrEqual(13);
    expect(Number(pillStyles.fontWeight)).toBeGreaterThanOrEqual(500);

    const card = page.locator('main .rounded-3xl').first();
    const cardStyles = await card.evaluate((element) => {
      const style = getComputedStyle(element);
      return { radius: style.borderRadius, shadow: style.boxShadow };
    });
    expect(cardStyles.radius).toBe('24px');
    expect(cardStyles.shadow).toContain('rgba(205, 208, 223, 0.4)');

    const poppinsLoaded = await page.evaluate(() => document.fonts.check('16px Poppins'));
    expect(poppinsLoaded).toBe(true);
    const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(bodyFont).toContain('Poppins');
    expect(externalFontRequests).toEqual([]);
  });

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
  ]) {
    test(`screenshots at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await login(page, 'e2e.hr');

      await page.goto('/kiosk');
      await page.getByRole('combobox').fill('Vera Visual');
      const result = page.getByRole('option', { name: /Vera Visual/ });
      await expect(result).toBeVisible();
      await result.click();
      await page.getByRole('combobox').fill('');
      await expect(page.getByText('Off campus, last left 17:12')).toBeVisible();
      await page.getByTestId('on-campus-count').evaluate((element) => {
        (element as HTMLElement).style.display = 'none';
      });
      await page.getByTestId('kiosk-activity').evaluate((element) => {
        (element as HTMLElement).style.display = 'none';
      });
      await hideDynamicChrome(page);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(`kiosk-${viewport.width}.png`);

      await page.goto('/parking');
      await page.getByLabel('Area').selectOption({ label: 'Visual Lot' });
      await expect(page.getByLabel('Z-01, Staff bay, occupied')).toBeVisible();
      await expect(page.getByLabel('Z-02, Staff bay, free')).toBeVisible();
      await page.getByLabel('Z-01, Staff bay, occupied').scrollIntoViewIfNeeded();
      await hideDynamicChrome(page);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot(`parking-${viewport.width}.png`);

      await filterVisualAttendance(page);
      await hideDynamicChrome(page);
      await expect(page).toHaveScreenshot(`attendance-${viewport.width}.png`);
    });
  }
});

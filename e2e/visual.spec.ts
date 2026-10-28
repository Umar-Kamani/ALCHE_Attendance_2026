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

  test('keeps mobile spacing and the user menu usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');

    const loginCard = page.locator('main .rounded-3xl').first();
    await expect(loginCard).toBeVisible();
    const loginPadding = await loginCard.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingLeft),
    );
    expect(loginPadding).toBeGreaterThanOrEqual(32);

    await login(page, 'e2e.hr');
    await page.getByRole('button', { name: 'Open user menu' }).click();

    const menu = page.getByRole('menu');
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.width).toBeGreaterThanOrEqual(300);
    expect(menuBox!.x).toBeGreaterThanOrEqual(8);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(382);

    const menuInset = await menu.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight) +
        Number.parseFloat(style.borderLeftWidth) +
        Number.parseFloat(style.borderRightWidth)
      );
    });
    const actionWidths = await menu.getByRole('menuitem').evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().width),
    );
    for (const actionWidth of actionWidths) {
      expect(actionWidth).toBeCloseTo(menuBox!.width - menuInset, 0);
    }

    const bottomBar = page.getByRole('navigation', { name: 'Tablet navigation' });
    const bottomBarMetrics = await bottomBar.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        paddingTop: Number.parseFloat(style.paddingTop),
        paddingRight: Number.parseFloat(style.paddingRight),
        paddingBottom: Number.parseFloat(style.paddingBottom),
        paddingLeft: Number.parseFloat(style.paddingLeft),
      };
    });
    expect(bottomBarMetrics.height).toBeGreaterThanOrEqual(74);
    expect(bottomBarMetrics.paddingTop).toBeGreaterThanOrEqual(4);
    expect(bottomBarMetrics.paddingRight).toBeGreaterThanOrEqual(8);
    expect(bottomBarMetrics.paddingBottom).toBeGreaterThanOrEqual(8);
    expect(bottomBarMetrics.paddingLeft).toBeGreaterThanOrEqual(8);
  });

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
  ]) {
    test(`screenshots at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await login(page, 'e2e.hr');

      await page.goto('/kiosk');
      const employeeSearch = page.getByRole('combobox', {
        name: 'Search employees and vehicles',
      });
      await employeeSearch.fill('Vera Visual');
      const result = page.getByRole('option', { name: /Vera Visual/ });
      await expect(result).toBeVisible();
      await result.click();
      await employeeSearch.fill('');
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

      await filterVisualAttendance(page);
      await hideDynamicChrome(page);
      await expect(page).toHaveScreenshot(`attendance-${viewport.width}.png`);
    });
  }
});

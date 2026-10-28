import { test, expect } from '@playwright/test';
import { login, readDownload } from './helpers';

test.describe.configure({ mode: 'serial' });

test('security marks IN, HR applies the amendment and exports attendance', async ({ page }) => {
  await login(page, 'e2e.security');

  await page.goto('/kiosk');
  await page.getByRole('combobox', { name: 'Search employees and vehicles' }).fill('Mohammad Sookun');
  await page.getByRole('option', { name: /Mohammad Sookun/ }).click();
  await page.getByRole('button', { name: 'Mark IN' }).click();
  await expect(page.getByText('Mohammad Sookun marked IN')).toBeVisible();
  await expect(page.getByText('On campus since')).toBeVisible();

  await page.goto('/tickets');
  await page.getByRole('button', { name: 'Raise ticket' }).first().click();
  const ticketDialog = page.getByRole('dialog');
  await ticketDialog.getByLabel(/Employee/).fill('Mohammad Sookun');
  await ticketDialog.getByRole('button', { name: /Mohammad Sookun/ }).first().click();
  await ticketDialog.getByLabel('Target').selectOption({ index: 1 });
  await ticketDialog.getByLabel(/Reason/).fill('E2E: gate time should be corrected');
  await ticketDialog.getByRole('button', { name: 'Raise ticket' }).click();
  await expect(ticketDialog).toBeHidden();
  await expect(page.locator('tbody tr', { hasText: 'Mohammad Sookun' }).first()).toBeVisible();

  await page.context().clearCookies();
  await login(page, 'e2e.hr');
  await page.goto('/tickets');
  const ticketRow = page.locator('tbody tr', { hasText: 'Mohammad Sookun' }).first();
  await expect(ticketRow).toBeVisible();
  await ticketRow.getByRole('button', { name: 'Approve' }).click();
  const approveDialog = page.getByRole('dialog');
  await approveDialog.getByLabel(/Review note/).fill('E2E approved against the gate logbook');
  await approveDialog.getByRole('button', { name: 'Approve' }).click();
  await expect(ticketRow.getByText('approved', { exact: true })).toBeVisible();
  await ticketRow.getByRole('button', { name: 'Apply' }).click();
  const applyDialog = page.getByRole('dialog');
  await applyDialog.getByRole('button', { name: 'Apply amendment' }).click();
  await expect(ticketRow.getByText('applied', { exact: true })).toBeVisible();

  await page.goto('/attendance');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export report' }).click();
  const download = await downloadPromise;
  const csv = await readDownload(await download.path());
  expect(csv.subarray(0, 3).toString('hex')).toBe('efbbbf');
  const header = csv.toString('utf8').replace(/^\uFEFF/, '').split('\r\n')[0];
  expect(header).toBe(
    'date,employee_code,first_name,last_name,department,category,status,first_in,last_out,span_hours,net_hours,visits,flags,amended,first_in_iso,last_out_iso',
  );
  expect(download.suggestedFilename()).toMatch(/^attendance_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
});

test('keeps focus in an add-record dialog while typing', async ({ page }) => {
  await login(page, 'e2e.hr');
  await page.goto('/employees');
  await page.getByRole('button', { name: 'Add employee' }).click();

  const dialog = page.getByRole('dialog');
  const firstName = dialog.getByLabel('First name');
  await firstName.click();
  await firstName.pressSequentially('Vera Visual', { delay: 10 });

  await expect(firstName).toHaveValue('Vera Visual');
  await expect(firstName).toBeFocused();
});

test('selects an employee from the dropdown, records custom time and marks OUT', async ({ page }) => {
  await login(page, 'e2e.security');
  await page.goto('/kiosk');

  await page.getByRole('combobox', { name: 'Select employee' }).click();
  await page.getByRole('option', { name: /Vera Visual/ }).first().click();

  await page.getByRole('button', { name: 'Change time' }).click();
  const localTime = await page.evaluate(() => {
    const value = new Date(Date.now() - 5 * 60_000);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Indian/Mauritius',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(value)
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  });
  await page.getByLabel('Time (Mauritius)').fill(localTime);

  await page.getByRole('button', { name: 'Mark IN' }).click();
  await expect(page.getByText('Vera Visual marked IN')).toBeVisible();
  await expect(page.getByText('On campus since')).toBeVisible();

  await page.getByRole('button', { name: 'Mark OUT' }).click();
  await expect(page.getByText('Vera Visual marked OUT')).toBeVisible();
  await expect(page.getByText('Off campus, last left')).toBeVisible();
});

test('assigns multiple vehicles to the same employee', async ({ page }) => {
  await login(page, 'e2e.security');
  await page.goto('/vehicles');

  const suffix = Date.now().toString().slice(-6);
  const plates = [`E2E ${suffix}A`, `E2E ${suffix}B`];

  for (const plate of plates) {
    await page.getByRole('button', { name: 'Add vehicle' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Find employee').fill('Vera Visual');
    await dialog.getByRole('button', { name: /Vera Visual/ }).first().click();
    await dialog.getByLabel('Plate').fill(plate);
    await dialog.getByRole('button', { name: 'Add vehicle' }).click();
    await expect(dialog).toBeHidden();
  }

  for (const plate of plates) {
    await page.getByLabel('Search').fill(plate);
    await expect(page.locator('tbody tr', { hasText: plate }).first()).toBeVisible();
  }
});

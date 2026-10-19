import { test, expect } from '@playwright/test';
import { login, readDownload } from './helpers';

test.describe.configure({ mode: 'serial' });

test('security marks IN with parking, HR applies the amendment and exports, security handles a guest vehicle', async ({
  page,
}) => {
  const guestName = `E2E Guest ${Date.now().toString().slice(-6)}`;
  const plate = `E2E ${Date.now().toString().slice(-4)}`;

  await login(page, 'e2e.security');

  // --- Gate: mark IN with inline parking -----------------------------------
  await page.goto('/kiosk');
  await page.getByRole('combobox').fill('Mohammad Sookun');
  const mohammad = page.getByRole('option', { name: /Mohammad Sookun/ });
  await expect(mohammad).toBeVisible();
  await mohammad.click();

  const markIn = page.getByRole('button', { name: /Mark IN & park/ });
  await expect(markIn).toBeVisible();
  const markInLabel = (await markIn.textContent()) ?? '';
  const bayCode = /park\s+([A-Z]-\d+)/.exec(markInLabel)?.[1];
  expect(bayCode).toBeTruthy();
  await markIn.click();

  await expect(page.getByText('Mohammad Sookun is on campus')).toBeVisible();
  await expect(page.getByRole('button', { name: /Mark OUT/ })).toBeVisible();
  await expect(page.getByText(`Parked in ${bayCode}`)).toBeVisible();

  // --- Raise amendment ticket ---------------------------------------------
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

  // --- HR approves and applies, then exports ------------------------------
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

  // --- Security: guest with a vehicle, parking, checkout ------------------
  await page.context().clearCookies();
  await login(page, 'e2e.security');
  await page.goto('/guests');
  await page.getByRole('button', { name: 'Check in walk-in' }).click();
  const visitDialog = page.getByRole('dialog');
  await visitDialog.getByRole('button', { name: 'New guest' }).click();
  await visitDialog.getByLabel(/Full name/).fill(guestName);
  await visitDialog.getByLabel('Company').fill('E2E Company');
  await visitDialog.getByLabel('Phone').fill('+230 5999 0000');
  await visitDialog.getByLabel('ID / passport').fill('E2E-ID-0001');
  await visitDialog.getByLabel(/Host employee/).fill('Nadia Bossy');
  await visitDialog.getByRole('button', { name: /Nadia Bossy/ }).first().click();
  await visitDialog.getByLabel(/Purpose/).fill('E2E supplier meeting');
  await visitDialog.getByLabel('Badge number').fill('E2E-B1');
  await visitDialog.getByLabel('Guest arrives with a vehicle').check();
  await visitDialog.getByLabel(/^Plate/).fill(plate);
  await visitDialog.getByLabel('Make').fill('Toyota');
  await visitDialog.getByLabel('Model').fill('Corolla');
  await visitDialog.getByLabel('Colour').fill('White');
  await visitDialog.getByRole('button', { name: 'Check in now' }).click();
  await expect(visitDialog).toBeHidden();
  const guestRow = page.locator('tbody tr', { hasText: guestName }).first();
  await expect(guestRow).toBeVisible();
  await expect(guestRow.getByText('ON SITE', { exact: true })).toBeVisible();

  await page.goto('/parking');
  await page.getByLabel('Area').selectOption({ label: 'Admin Front' });
  const guestBay = page.getByLabel('B-03, Guest bay, free');
  await expect(guestBay).toBeVisible();
  await guestBay.click();
  const allocationDialog = page.getByRole('dialog');
  await allocationDialog.getByLabel(/Find vehicle or holder/).fill(plate);
  await allocationDialog.getByRole('button', { name: new RegExp(plate) }).first().click();
  await allocationDialog.getByRole('button', { name: 'Allocate' }).click();
  await expect(page.getByText('Bay allocated')).toBeVisible();
  await expect(page.getByLabel('B-03, Guest bay, occupied')).toBeVisible();

  await page.goto('/guests');
  await page.reload();
  const checkedInRow = page.locator('tbody tr', { hasText: guestName }).first();
  await expect(checkedInRow.getByText('B-03')).toBeVisible();
  await checkedInRow.getByRole('button', { name: 'Check out' }).click();
  const checkoutDialog = page.getByRole('dialog');
  await expect(checkoutDialog.getByLabel(/Release bay B-03/)).toBeChecked();
  await checkoutDialog.getByRole('button', { name: 'Check out' }).click();
  await expect(page.getByText('Guest checked out')).toBeVisible();
  await expect(
    page.locator('tbody tr', { hasText: guestName }).first().getByText('DEPARTED', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Register', exact: true }).click();
  const guestExportPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const guestDownload = await guestExportPromise;
  const guestCsv = (await readDownload(await guestDownload.path())).toString('utf8');
  expect(guestCsv.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe(
    'date_in,time_in,date_out,time_out,guest_name,company,phone,id_number,host_employee,host_department,purpose,badge_no,vehicle_plate,status',
  );
  expect(guestCsv).toContain(guestName);
  expect(guestCsv).toContain(plate);
  expect(guestCsv).toContain('DEPARTED');
});

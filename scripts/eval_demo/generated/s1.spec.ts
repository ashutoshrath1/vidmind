import { test, expect } from '@playwright/test';

test('complete a task', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('What needs doing?').fill('Buy milk');
  await page.getByPlaceholder('What needs doing?').press('Enter');
  await page.getByPlaceholder('What needs doing?').fill('Call the bank');
  await page.getByPlaceholder('What needs doing?').press('Enter');
  await page.getByRole('checkbox', { name: 'Buy milk' }).check();
  await expect(page.getByRole('checkbox', { name: 'Buy milk' })).toBeChecked();
  await expect(page.getByText('1 task left')).toBeVisible();
});
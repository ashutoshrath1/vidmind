import { test, expect } from '@playwright/test';

test('clear completed tasks', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('What needs doing?').fill('Buy milk');
  await page.getByPlaceholder('What needs doing?').press('Enter');
  await page.getByPlaceholder('What needs doing?').fill('Call the bank');
  await page.getByPlaceholder('What needs doing?').press('Enter');
  await page.getByRole('checkbox', { name: 'Buy milk' }).check();
  await page.getByRole('button', { name: 'Clear completed' }).click();
  await expect(page.getByText('Buy milk')).toBeHidden();
  await expect(page.getByText('Call the bank')).toBeVisible();
  await expect(page.getByText('1 task left')).toBeVisible();
});
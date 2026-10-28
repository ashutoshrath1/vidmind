import { test, expect } from '@playwright/test';

test('add tasks', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('What needs doing?').fill('Buy milk');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Buy milk')).toBeVisible();
  await expect(page.getByText('1 task left')).toBeVisible();
  await page.getByPlaceholder('What needs doing?').fill('Call the bank');
  await page.getByPlaceholder('What needs doing?').press('Enter');
  await expect(page.getByText('Call the bank')).toBeVisible();
  await expect(page.getByText('2 tasks left')).toBeVisible();
});
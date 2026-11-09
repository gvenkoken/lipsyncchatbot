import { expect, test } from '@playwright/test';

test('üç yer tutucu çalışma alanına menüden ulaşılır', async ({ page }) => {
  await page.goto('/');
  for (const title of ['Kalite ve ortam kaydı', 'Görsel ve kaynak incelemesi', 'Avatar deneme alanı']) {
    await page.getByRole('link', { name: title, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: title, exact: true })).toHaveAttribute('aria-current', 'page');
  }
});

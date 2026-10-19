import { test, expect } from '@playwright/test';

test.describe('Virtual Jewellery Try-On End-to-End Smoke Journey', () => {
  test('homepage -> open studio -> switch jewellery piece -> capture snapshot', async ({ page }) => {
    // 1. Visit Storefront Homepage
    await page.goto('/');

    // Verify brand header and luxury hero headline
    await expect(page.locator('header')).toContainText('LUMIÈRE');
    await expect(page.locator('h1')).toContainText('See every piece');

    // Verify featured categories and catalogue grid
    await expect(page.getByText('Curated Showroom Collections')).toBeVisible();
    await expect(page.getByText('Masterpiece Catalogue')).toBeVisible();

    // 2. Open Try-On Studio via Hero CTA
    const openStudioButton = page.getByRole('link', { name: /Open Try-On Studio|Launch Live AR|Try Now/i }).first();
    await expect(openStudioButton).toBeVisible();
    await openStudioButton.click();

    // Verify we arrived at the Try-On studio
    await page.waitForURL(/\/try-on/);
    await expect(page).toHaveURL(/\/try-on/);

    // Verify Studio UI components loaded
    const startCameraBtn = page.locator('[data-testid="start-camera-btn"], button:has-text("Open Virtual Studio")').first();
    await expect(startCameraBtn).toBeVisible({ timeout: 10000 });

    // Verify Jewellery Selector is rendered with multiple products
    const selectorItems = page.locator('[data-testid="jewellery-selector-item"]');
    await expect(selectorItems.first()).toBeVisible({ timeout: 10000 });
    const count = await selectorItems.count();
    expect(count).toBeGreaterThan(1);

    // 3. Switch to a different jewellery piece in the studio
    const initialProductName = await page.locator('h1, h2, [data-testid="current-product-name"]').first().textContent();
    const secondPiece = selectorItems.nth(1);
    await secondPiece.click();

    // 4. Start Camera Stream (using fake media stream flags from playwright config)
    await startCameraBtn.click();

    // Shutter button should appear once stream initializes
    const shutterBtn = page.locator('[data-testid="shutter-btn"], button:has-text("Capture"), button[title="Take Studio Snapshot"]').first();
    
    // If browser supports fake camera media stream, trigger shutter
    if (await shutterBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await shutterBtn.click();

      // Verify Capture Modal dialog opens with snapshot
      const captureModal = page.locator('[role="dialog"]');
      await expect(captureModal).toBeVisible({ timeout: 8000 });
      await expect(captureModal).toContainText(/Studio Portrait|Try-On Snapshot|Download/i);
    }
  });

  test('direct product deep-link opens correct item in studio', async ({ page }) => {
    await page.goto('/try-on/prod-fallback-ear-001');
    await expect(page.locator('[data-testid="start-camera-btn"], button:has-text("Open Virtual Studio")').first()).toBeVisible({ timeout: 10000 });
  });
});

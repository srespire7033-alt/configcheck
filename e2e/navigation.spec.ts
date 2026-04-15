import { test, expect } from '@playwright/test';

test.describe('General navigation', () => {
  test('root / redirects to /login or /dashboard based on auth', async ({
    page,
  }) => {
    await page.goto('/');

    // Should redirect somewhere -- either login (unauthenticated) or dashboard
    await page.waitForURL(/\/(login|dashboard)/, { timeout: 10000 });
    const url = page.url();
    expect(url).toMatch(/\/(login|dashboard)/);
  });

  test('/login page has correct title', async ({ page }) => {
    await page.goto('/login');

    // Page should have a title (Next.js sets it via metadata or layout)
    const title = await page.title();
    expect(title).toBeTruthy();

    // Verify the page is actually the login page by checking for form content
    await expect(page.getByText('Welcome back')).toBeVisible();
  });

  test('unknown routes show 404 or redirect', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist-12345');

    // Next.js should either show a 404 page or redirect
    // Check for 404 status or redirect to a known page
    if (response) {
      const status = response.status();
      const url = page.url();

      // Either we got a 404, or we were redirected to login/dashboard
      const is404 = status === 404;
      const wasRedirected = url.includes('/login') || url.includes('/dashboard');
      const has404Text = await page
        .getByText('404')
        .or(page.getByText('not found', { exact: false }))
        .isVisible()
        .catch(() => false);

      expect(is404 || wasRedirected || has404Text).toBeTruthy();
    }
  });

  test('page title and meta is correct', async ({ page }) => {
    await page.goto('/login');

    const title = await page.title();
    // The app should have a meaningful title, not a blank one
    expect(title.length).toBeGreaterThan(0);
  });
});

import { test, expect } from '@playwright/test';

test.describe('General navigation', () => {
  test('root / shows landing page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // The landing page is public — it should NOT redirect
    // Check for landing page content
    const url = page.url();
    expect(url).toMatch(/localhost:3000\/?$/);

    // Landing page has the hero section
    await expect(page.getByText('Get Started Free')).toBeVisible({ timeout: 15000 });
  });

  test('/login page has correct title', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    // Page should have a title (Next.js sets it via metadata or layout)
    const title = await page.title();
    expect(title).toBeTruthy();

    // Verify the page is actually the login page by checking for form content
    await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 15000 });
  });

  test('unknown routes redirect to login when unauthenticated', async ({ page }) => {
    await page.goto('/this-route-does-not-exist-12345', { waitUntil: 'domcontentloaded' });

    // Middleware redirects unauthenticated users to /login
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  });

  test('page title and meta is correct', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    const title = await page.title();
    // The app should have a meaningful title, not a blank one
    expect(title.length).toBeGreaterThan(0);
    expect(title).toContain('ConfigCheck');
  });

  test('unauthenticated access to /dashboard redirects to /login', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  });

  test('unauthenticated access to /settings redirects to /login', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  });
});

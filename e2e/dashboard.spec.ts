import { test, expect } from '@playwright/test';
import { authenticateUser } from './helpers/auth';

/**
 * Dashboard tests require authentication.
 *
 * To run these tests, set the following environment variables:
 *   - PLAYWRIGHT_TEST_EMAIL: A valid test user email
 *   - PLAYWRIGHT_TEST_PASSWORD: The test user's password
 *
 * These tests will be skipped if credentials are not configured.
 */
test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    const hasCredentials =
      process.env.PLAYWRIGHT_TEST_EMAIL && process.env.PLAYWRIGHT_TEST_PASSWORD;

    if (!hasCredentials) {
      test.skip();
      return;
    }

    await authenticateUser(page);
  });

  test('dashboard page loads when authenticated', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);

    // Main heading should be visible
    await expect(
      page.getByRole('heading', { name: 'Your Organizations' })
    ).toBeVisible();
  });

  test('shows Connect Salesforce Org button or org list', async ({ page }) => {
    // The dashboard always shows the "Connect Salesforce Org" card
    await expect(page.getByText('Connect Salesforce Org')).toBeVisible();

    // The description text is also present
    await expect(
      page.getByText('Connect Salesforce orgs to scan their CPQ configuration')
    ).toBeVisible();
  });

  test('navigation header links exist', async ({ page }) => {
    // The app header has Dashboard and Settings links
    const dashboardLink = page.getByRole('link', { name: 'Dashboard' });
    const settingsLink = page.getByRole('link', { name: 'Settings' });

    await expect(dashboardLink).toBeVisible();
    await expect(settingsLink).toBeVisible();

    // Dashboard link should be active (highlighted) when on dashboard
    await expect(dashboardLink).toHaveClass(/bg-blue-50|text-blue-700/);
  });
});

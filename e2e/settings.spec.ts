import { test, expect } from '@playwright/test';
import { authenticateUser } from './helpers/auth';

/**
 * Settings page tests require authentication.
 *
 * To run these tests, set the following environment variables:
 *   - PLAYWRIGHT_TEST_EMAIL: A valid test user email
 *   - PLAYWRIGHT_TEST_PASSWORD: The test user's password
 *
 * These tests will be skipped if credentials are not configured.
 */
test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => {
    const hasCredentials =
      process.env.PLAYWRIGHT_TEST_EMAIL && process.env.PLAYWRIGHT_TEST_PASSWORD;

    if (!hasCredentials) {
      test.skip();
      return;
    }

    await authenticateUser(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
  });

  test('settings page loads with tabs', async ({ page }) => {
    await expect(page).toHaveURL(/\/settings/);

    // At least one tab should be visible
    await expect(page.getByText('Account')).toBeVisible();
  });

  test('all 5 tabs are visible', async ({ page }) => {
    const expectedTabs = [
      'Account',
      'Plan & Billing',
      'Usage',
      'Branding',
      'Notifications',
    ];

    for (const tabLabel of expectedTabs) {
      await expect(page.getByText(tabLabel, { exact: true })).toBeVisible();
    }
  });

  test('account tab shows profile form fields', async ({ page }) => {
    // Account tab should be the default active tab
    // Check for profile-related fields
    await expect(page.getByLabel('Full Name').or(page.getByText('Full Name'))).toBeVisible();
    await expect(page.getByLabel('Email').or(page.getByText('Email'))).toBeVisible();
  });

  test('danger zone section exists with Export and Delete buttons', async ({ page }) => {
    // Scroll down to find the Danger Zone
    await expect(page.getByText('Danger Zone')).toBeVisible();

    // Export Data button
    await expect(page.getByText('Export My Data')).toBeVisible();

    // Delete Account button
    await expect(page.getByText('Delete My Account')).toBeVisible();
  });

  test('delete account modal requires confirmation text', async ({ page }) => {
    // Find and click the Delete Account button to open the modal
    const deleteButton = page.getByRole('button', { name: /Delete My Account/i });
    await deleteButton.click();

    // Modal should appear
    await expect(page.getByText('This action cannot be undone')).toBeVisible();

    // Confirmation input should be present
    const confirmInput = page.getByPlaceholder('DELETE MY ACCOUNT');
    await expect(confirmInput).toBeVisible();

    // The confirm delete button should be disabled until correct text is typed
    const confirmDeleteButton = page.getByRole('button', {
      name: /Permanently Delete/i,
    });
    await expect(confirmDeleteButton).toBeDisabled();

    // Type the wrong text -- button stays disabled
    await confirmInput.fill('WRONG TEXT');
    await expect(confirmDeleteButton).toBeDisabled();

    // Type the correct text -- button becomes enabled
    await confirmInput.fill('DELETE MY ACCOUNT');
    await expect(confirmDeleteButton).toBeEnabled();

    // Close the modal without deleting (click cancel or backdrop)
    const cancelButton = page.getByRole('button', { name: /Cancel/i });
    await cancelButton.click();
  });
});

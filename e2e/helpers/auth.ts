import { type Page } from '@playwright/test';

/**
 * Authenticates a user by navigating to the login page and filling in credentials.
 *
 * Requires the following environment variables to be set:
 *   - PLAYWRIGHT_TEST_EMAIL: The test user's email address
 *   - PLAYWRIGHT_TEST_PASSWORD: The test user's password
 *
 * These should be configured in a .env file or CI secrets.
 * The test account should be a dedicated test user in your Supabase project.
 */
export async function authenticateUser(page: Page): Promise<void> {
  const email = process.env.PLAYWRIGHT_TEST_EMAIL;
  const password = process.env.PLAYWRIGHT_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Missing PLAYWRIGHT_TEST_EMAIL or PLAYWRIGHT_TEST_PASSWORD environment variables. ' +
      'Set these to a valid test account in your .env or CI secrets.'
    );
  }

  await page.goto('/login');

  // Fill in credentials
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);

  // Submit and wait for navigation to dashboard
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

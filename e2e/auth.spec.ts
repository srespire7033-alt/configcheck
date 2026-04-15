import { test, expect } from '@playwright/test';

// Run auth tests serially to avoid overwhelming the dev server cold start
test.describe.configure({ mode: 'serial' });

test.describe('Authentication flows', () => {
  test('login page loads with correct branding', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle', timeout: 60000 });

    // The left panel branding headline
    await expect(
      page.getByRole('heading', { name: /AI-Driven Config Audits/i })
    ).toBeVisible({ timeout: 10000 });

    // Welcome text on the form side
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(
      page.getByText('Sign in to your ConfigCheck account')
    ).toBeVisible();
  });

  test('shows email and password fields', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle', timeout: 60000 });

    const emailInput = page.getByPlaceholder('you@company.com');
    const passwordInput = page.getByPlaceholder('Min 6 characters');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('empty form submission stays on login page', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle', timeout: 60000 });

    const emailInput = page.getByPlaceholder('you@company.com');
    await expect(emailInput).toHaveAttribute('required', '');

    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('sign up toggle works', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle', timeout: 60000 });

    // Click the toggle button to switch to sign up
    const toggleButton = page.getByRole('button', { name: /Don't have an account/i });
    await expect(toggleButton).toBeVisible();
    await toggleButton.click();

    // Wait for heading to change to sign up mode
    await expect(page.getByText('Create your account')).toBeVisible({ timeout: 10000 });

    // Full Name field should appear
    await expect(page.getByPlaceholder('Your name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();

    // Switch back
    await page.getByRole('button', { name: /Already have an account/i }).click();
    await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 10000 });
  });

  test('password reset flow works', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle', timeout: 60000 });

    // Click forgot password
    const forgotButton = page.getByRole('button', { name: /Forgot password/i });
    await expect(forgotButton).toBeVisible();
    await forgotButton.click();

    // Wait for reset mode
    await expect(page.getByText('Reset your password')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Send Reset Link' })).toBeVisible();

    // Back to sign in
    await page.getByRole('button', { name: /Back to sign in/i }).click();
    await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 10000 });
  });

  test('invalid credentials stay on login page', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle', timeout: 60000 });

    await page.getByPlaceholder('you@company.com').fill('invalid@nonexistent.com');
    await page.getByPlaceholder('Min 6 characters').fill('wrongpassword123');

    const signInButton = page.getByRole('button', { name: 'Sign In' });
    await signInButton.click();

    // Wait for the request to complete — button becomes enabled again
    await expect(signInButton).toBeEnabled({ timeout: 20000 });

    // Still on login page (didn't navigate to dashboard)
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirect to /login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  });
});

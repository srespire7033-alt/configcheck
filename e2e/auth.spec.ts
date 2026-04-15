import { test, expect } from '@playwright/test';

test.describe('Authentication flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('login page loads with correct branding', async ({ page }) => {
    // The left panel branding headline
    await expect(
      page.getByText('AI-Driven Config Audits')
    ).toBeVisible();
    await expect(
      page.getByText('for Salesforce Revenue Cloud')
    ).toBeVisible();

    // Welcome text on the form side
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(
      page.getByText('Sign in to your ConfigCheck account')
    ).toBeVisible();
  });

  test('shows email and password fields', async ({ page }) => {
    const emailInput = page.getByLabel('Email');
    const passwordInput = page.getByLabel('Password');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    // Check placeholder text
    await expect(emailInput).toHaveAttribute('placeholder', 'you@company.com');
    await expect(passwordInput).toHaveAttribute('placeholder', 'Min 6 characters');

    // Check input types
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('empty form submission shows validation errors', async ({ page }) => {
    // HTML5 required attribute should prevent submission
    // The email field is required, so clicking submit with empty fields
    // should not navigate away
    const emailInput = page.getByLabel('Email');
    await expect(emailInput).toHaveAttribute('required', '');

    const submitButton = page.getByRole('button', { name: 'Sign In' });
    await submitButton.click();

    // Should still be on the login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('invalid credentials show error message', async ({ page }) => {
    await page.getByLabel('Email').fill('invalid@nonexistent.com');
    await page.getByLabel('Password').fill('wrongpassword123');

    await page.getByRole('button', { name: 'Sign In' }).click();

    // Wait for error message to appear
    const errorAlert = page.locator('.bg-red-50, .dark\\:bg-red-900\\/20');
    await expect(errorAlert).toBeVisible({ timeout: 10000 });
  });

  test('sign up form is accessible', async ({ page }) => {
    // Click the toggle to switch to sign up
    await page.getByText("Don't have an account? Sign up").click();

    // Verify sign up form elements appear
    await expect(page.getByText('Create your account')).toBeVisible();
    await expect(page.getByLabel('Full Name')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create Account' })
    ).toBeVisible();

    // Can switch back to sign in
    await page.getByText('Already have an account? Sign in').click();
    await expect(page.getByText('Welcome back')).toBeVisible();
  });

  test('password reset link exists and works', async ({ page }) => {
    const forgotLink = page.getByText('Forgot password?');
    await expect(forgotLink).toBeVisible();

    await forgotLink.click();

    // Reset mode shows different heading and button
    await expect(page.getByText('Reset your password')).toBeVisible();
    await expect(
      page.getByText("Enter your email and we'll send a reset link")
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Send Reset Link' })
    ).toBeVisible();

    // Can go back to sign in
    await page.getByText('Back to sign in').click();
    await expect(page.getByText('Welcome back')).toBeVisible();
  });

  test('redirect to /login when not authenticated', async ({ page }) => {
    // Visit dashboard without being logged in
    await page.goto('/dashboard');

    // Should redirect to login page
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});

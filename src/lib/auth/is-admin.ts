/**
 * Check if a user email is in the admin allowlist.
 * Admin emails are stored in ADMIN_EMAILS env var (comma-separated).
 */
export function isAdmin(email: string | undefined): boolean {
  if (!email) return false;
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return adminEmails.includes(email.toLowerCase());
}

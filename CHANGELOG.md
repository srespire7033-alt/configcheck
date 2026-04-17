# Changelog

All notable, user-facing changes to ConfigCheck are recorded here. Newest release at the top.

Versions use [CalVer](https://calver.org) in `YYYY.MM.DD` form, tagged in git as `vYYYY.MM.DD` (with a trailing `-N` if more than one release happens in a day). Internal refactors and docs-only commits are not listed here — see `git log` for the full history.

## v2026.04.17

### Added
- Auto sign-in after email confirmation. Clicking the confirmation link now lands users in `/onboarding` already authenticated, via a new `/auth/callback` route that exchanges Supabase's one-time code for a session.
- Welcome email now fires on email confirmation (previously only after completing onboarding), so the inbox-welcome arrives at the first useful moment.
- Premium-style welcome email template with personalized hero, numbered step cards, founder sign-off, and a plain-text MIME part for better inbox placement.
- Database migrations moved to `src/lib/db/migrations/` with `YYYYMMDDHHMMSS_description.sql` naming and a `public.schema_migrations` tracking table. See `src/lib/db/migrations/README.md`.
- This changelog.

## v2026.04.16

### Added
- Bundle Integrity (BN-001–BN-005) and Lookup Query (LQ-001–LQ-005) health checks, including info-level checks to ensure full severity coverage per category.
- 21 additional checks across categories to guarantee each has at least one critical, warning, and info severity.
- CPQ seed endpoint for creating test records that exercise every category at 100% coverage.
- Disconnect Org feature with confirmation dialog.

### Fixed
- SOQL field names corrected to match the actual Salesforce org schema (7 fields, fixes scan accuracy).
- Onboarding redirect loop when cookies were cleared.
- Category cards occasionally not appearing on the dashboard.
- `Data & Account` section (formerly `Danger Zone`) redesigned to match the rest of the app.

## v2026.04.15

### Added
- Full onboarding system: 3-step wizard, checklist, product tour, welcome email hook.
- Team / multi-user access with roles, invites, and shared orgs.

## v2026.04.14

### Added
- Multi-product SKU support: CPQ, CPQ+Billing, ARM — app is feature-gated by subscription.
- Dynamic package detection to drive scan-type pills.
- Rebuilt settings page with sidebar navigation and detailed profile fields.

## v2026.04.13

### Added
- Landing page.
- AI response caching to reduce Gemini API calls.
- Usage tracking for scans, AI calls, and PDF reports.
- Admin dashboard, 404 page, forgot-password flow.
- Email notifications for scan completion with a settings toggle.

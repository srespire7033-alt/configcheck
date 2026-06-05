# Changelog

All notable, user-facing changes to OrgPrism are recorded here. Newest release at the top.

Versions use [CalVer](https://calver.org) in `YYYY.MM.DD` form, tagged in git as `vYYYY.MM.DD` (with a trailing `-N` if more than one release happens in a day). Internal refactors and docs-only commits are not listed here — see `git log` for the full history.

## v2026.06.05

Phase 22 complete: full Vercel→Apex port of all 205 active health checks, recalibrated scoring, and per-category surfaces wired into the PDF + dashboard. OrgPrism is now functionally complete as a Salesforce-native AppExchange-ready package; remaining work is operational (ARM smoke validation, managed-package wrap) and optional polish.

### Added
- **ARM (Revenue Cloud Advanced) coverage** — 72 health checks across catalog, selling models, bundles, attributes, qualification, ramp segments, pricing (rate cards, adjustments, procedures, decision tables, price books), context service, assets, contracts, usage management, orchestration, cost books, billing policies, and document clauses. ARM is now a fully supported SKU.
- **Billing finance coverage** — 24 checks for Finance Books, General Ledger, Legal Entity, Revenue Recognition, and Tax Rules (in addition to the Billing Rules + Invoicing checks shipped earlier in Phase 22b-1).
- **Per-category sub-scores** — every completed scan now carries a per-category 0–100 score in addition to the overall health score. Visible in the Executive PDF (with a worst-first table) and in the Score Trend card as pills under the latest scan.
- **Health Score in the Executive PDF** — color-coded headline number with a category breakdown table directly under the severity tiles. Consultants get the "where is the org broken" answer in the deliverable, not just on the dashboard.
- **mdt-tunable scoring** — `ScoreFormula.Default` carries every constant (3 headline weights, penalty cap, curve coefficient, 3 category bucket weights). Admins can re-tune the entire app's scoring without code changes.

### Changed
- **Health score formula recalibrated** — old linear formula (`100 - 2c - 0.5w - 0.1i`) was saturating to 0 once the org had ~100+ findings. New sqrt-compressed formula (`100 - 4·√min(300, raw)`) preserves the severity ratio while keeping the score informative across realistic finding volumes. Pristine orgs score ~95–100, healthy production ~70–85, messy ~40–60, broken ~10–30. Existing scans were backfilled on both connected orgs.
- **Category Performance grid** — switched from a hardcoded internal scoring formula (`100 − 10c − 3w − 1i`) to the same mdt-driven bucket weights (`15c − 5w − 1i`) used by the pillar scores. One admin knob now drives the entire app's per-category UI.

### Fixed
- **Detector dispatch regression** — bundle-style detectors silently no-op'd when `productType` was passed as `null`. Affected every Phase 22 bundle (~30 of them). One-line fix in `ForensicScanService.getDetectorsFor` unlocked ~30 previously-missing findings on a real CPQ org.
- **ARM-130, ARM-131 always returned zero** — the underlying SOQL didn't actually SELECT the date fields the checks compared. Fixed in the Apex port by adding the fields explicitly. (Latent bug also present in the Vercel reference implementation.)
- **ARM-006 was effectively dead code** — the shared `ExpressionSet` SOQL pre-filtered `UsageType IN ('Pricing','PricingDiscovery')`, so the "missing UsageType" check could never fire. Apex re-queries without the filter.
- **ARM-007 false-positive in non-ARM orgs** — "multiple custom pricebooks per currency" fired on any CPQ org with >1 pricebook. Now gated behind a Revenue Cloud Advanced sentinel object presence.

### Internal
- 32 detector bundle classes + 70+ Detector__mdt records + 20+ Apex test classes shipped during Phase 22.
- Cpq smoke baseline: scan FS-0006 produces 367 findings, headline score **52**, category breakdown surfaces governance as the saturated (score 0) area.
- Two deployed orgs: techtorch (host) and cpq (test target). Ksolves-Sanjeev (real ARM org) added to org list, smoke validation pending Named Credential setup.

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

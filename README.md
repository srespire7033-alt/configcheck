# OrgPrism

> **Salesforce Revenue Cloud, audited in 30 seconds.**

[![Health Checks](https://img.shields.io/badge/health%20checks-209-3b82f6)](https://orgprism.vercel.app/checks)
[![Categories](https://img.shields.io/badge/categories-49-7c3aed)](https://orgprism.vercel.app/checks)
[![Unit Tests](https://img.shields.io/badge/unit%20tests-1163%20passing-22c55e)](https://github.com/srespire7033-alt/configcheck/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](./tsconfig.json)
[![Live](https://img.shields.io/badge/live-orgprism.vercel.app-000)](https://orgprism.vercel.app)

OrgPrism is an automated Salesforce Revenue Cloud audit tool for CPQ consultants and Salesforce admins. Connect via read-only OAuth, run **209 expert-coded health checks** across CPQ, Billing, and ARM/RLM configurations in under 3 seconds, get AI-generated remediation plans, and download white-labeled PDF reports for client deliverables.

---

## Health-check coverage

| Suite | Checks | Categories |
|---|---:|---:|
| **Salesforce CPQ** | 92 | 19 |
| **Salesforce Billing** | 39 | 8 |
| **Revenue Cloud (ARM / RLM)** | 78 | 22 |
| **Total** | **209** | **49** |

📋 [Full inventory at orgprism.vercel.app/checks](https://orgprism.vercel.app/checks)

Every check has:
- Deterministic SOQL query against standard Salesforce + Revenue Cloud objects
- Specific affected-record IDs in every finding
- Severity classification (Critical / Warning / Info)
- Hand-written recommendation + impact statement
- AI fix suggestion generated on demand

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Next.js 14 App Router + React + Tailwind               │
│   ├─ Server components + API routes (TypeScript strict) │
│   ├─ Supabase Auth (email + OAuth providers)            │
│   └─ Recharts for dashboards                            │
└─────────────────────────────────────────────────────────┘
         │                       │                  │
         ▼                       ▼                  ▼
┌──────────────────┐    ┌──────────────┐    ┌─────────────┐
│ Supabase         │    │ Salesforce   │    │ Gemini AI   │
│ - Postgres 17    │    │ jsforce 2.x  │    │ 2.5 Flash   │
│ - RLS enforced   │    │ OAuth 2.0 +  │    │ (executive  │
│ - Mumbai region  │    │ PKCE refresh │    │  summary +  │
│                  │    │ Read-only    │    │  remediation│
└──────────────────┘    └──────────────┘    └─────────────┘
         │                       │
         └───────────────────────┴── Vercel (Mumbai)
                                     ├─ Cron jobs
                                     ├─ @react-pdf/renderer
                                     └─ Resend (email)
```

### Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14 App Router | Server + client components, built-in API routes, Vercel-native |
| Language | TypeScript strict mode | No `any`, types end-to-end |
| Styling | Tailwind CSS | Utility-first, consistent design tokens |
| Database | Supabase Postgres 17 | RLS, real-time, auth in one product |
| Hosting | Vercel | Edge functions, auto-deploys |
| Salesforce SDK | jsforce | Industry standard, handles OAuth 2.0 + PKCE refresh |
| AI | Google Gemini 2.5 Flash | Fast (5–20s), cheap (~$0.02/scan), high quality |
| Email | Resend | Clean API, HTML rendering |
| PDF | @react-pdf/renderer | Generate branded reports as JSX |
| Testing | Vitest | 1,163 unit tests in ~4 seconds |
| Analytics | Self-hosted (Supabase `analytics_events`) | No third-party PII flow |

---

## Quality bar

| Signal | Status |
|---|---|
| **Unit tests** | 1,163 passing (Vitest, 52 files) |
| **TypeScript** | strict mode, zero `any` outside compatibility shims |
| **ESLint** | clean on every commit |
| **Production builds** | gate every commit via Vercel preview deploys |
| **Drift guards** | check counts auto-asserted vs live arrays — marketing numbers can't go stale |
| **Status page** | live at [/status](https://orgprism.vercel.app/status) |
| **Security boundaries** | OAuth scope read-only (`api refresh_token`); never `full` |
| **Data sanitization** | export endpoint strips all sensitive tokens before write |

---

## Quick start (development)

Requires Node 20+, npm, and a Supabase project.

```bash
# Clone + install
git clone https://github.com/srespire7033-alt/configcheck.git
cd configcheck
npm install

# Configure env
cp .env.example .env.local
# Edit .env.local — see "Environment" section below

# Run migrations against your Supabase project
# (see src/lib/db/migrations/ for ordering)

# Dev server
npm run dev
# → http://localhost:3000

# Tests
npm test             # vitest run, ~4 seconds
npm run test:watch   # watch mode

# Production build
npm run build
npm start
```

### Environment

Required env vars (in `.env.local` for dev, Vercel for production):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side service role |
| `SALESFORCE_CLIENT_ID` | Platform ECA Consumer Key (fallback for non-BYO connects) |
| `SALESFORCE_CLIENT_SECRET` | Platform ECA Consumer Secret |
| `SALESFORCE_REDIRECT_URI` | OAuth callback URL |
| `GEMINI_API_KEY` | Google Gemini API key |
| `RESEND_API_KEY` | Resend transactional email key |
| `CRON_SECRET` | Bearer token for Vercel cron auth |
| `ADMIN_EMAILS` | Comma-separated admin emails for `/admin` routes |
| `NEXT_PUBLIC_APP_URL` | Public base URL |
| `NEXT_PUBLIC_LOOM_ECA_VIDEO_ID` | (optional) Loom embed for connect modal |

---

## Project layout

```
src/
  app/                            Next.js App Router pages + API routes
    api/
      analytics/track/            POST event ingress (self-hosted analytics)
      ai/{explain,fix,insights}/  Gemini-backed endpoints
      cron/                       Scheduled workers (process-queue, digest)
      orgs/                       Org CRUD + listing
      salesforce/                 OAuth flow + REST helpers
      scans/                      Scan lifecycle
    checks/                       Public catalog of all 209 checks
    dashboard/                    Org grid + portfolio summary
    orgs/[orgId]/                 Per-org scan results + history
    admin/                        Admin dashboards (gated)
    status/                       Live health page
  components/
    dashboard/                    Org cards, portfolio strip, connect modal
    issues/                       Issue lists, severity modal, detail modal
    scan/                         Health score, category breakdown, charts
    ui/                           Logo, cards, primitive components
  lib/
    analysis/
      checks/                     CPQ check engine (92 checks)
      billing-checks/             Billing check engine (39 checks)
      arm-checks/                 ARM check engine (78 checks)
      constants.ts                Single source of truth for counts
      engine.ts                   CPQ analysis orchestration
      billing-engine.ts           Billing orchestration
      arm-engine.ts               ARM orchestration + data normalization
    ai/                           Gemini wrappers + throttle
    salesforce/                   OAuth, queries, package detection
    db/                           Supabase clients + migrations
    email/                        Resend integration
    analytics/                    Self-hosted event tracking
    report/                       PDF generation
  __tests__/                      Vitest (1,163 tests)
  types/                          Shared types
public/                           Static assets (favicons, OG card, logos)
```

---

## Key design decisions

| Decision | Rationale |
|---|---|
| **Read-only OAuth scope** (`api refresh_token`, never `full`) | We physically cannot modify customer data. Survives security review. |
| **BYO External Client App** | Customer's ECA lives in their org → refresh tokens work indefinitely (cross-org refresh problem solved at architectural level). |
| **Deferred AI summary** | Scan completes in ~3s before AI runs. Gemini outages can't kill a scan. |
| **Self-hosted analytics** | No third-party PII flow. Funnel data stays in our Supabase. |
| **Hardcoded check counts + drift guard** | Marketing numbers stay honest forever; CI fails if anyone adds a check without bumping the constant. |
| **TypeScript strict + 1,163 tests** | Refactoring is safe; regressions caught before deploy. |

---

## Security posture

- **OAuth scope:** `api` + `refresh_token`, never `full`
- **Encryption:** AES-256 at rest, TLS 1.3 in transit
- **Row-level security:** enforced on every user-data table
- **Token storage:** encrypted, never logged, sanitized from export endpoints
- **Audit trail:** every scan, AI call, PDF download recorded in `analytics_events` and `usage_logs`
- **Data export:** GDPR-compliant JSON dump from Settings → Privacy
- **Deletion:** one-click account + data deletion

Every data flow is documented in 3 audit-friendly files:
- `src/lib/salesforce/client.ts` (OAuth scope)
- `src/middleware.ts` (route protection)
- `src/app/api/account/export/route.ts` (data export sanitization)

---

## License

Source-available for evaluation. Commercial use requires a license — contact via [orgprism.vercel.app](https://orgprism.vercel.app).

---

## Links

- 🌐 [Live product](https://orgprism.vercel.app)
- 📋 [Full check inventory](https://orgprism.vercel.app/checks)
- 📊 [Live status page](https://orgprism.vercel.app/status)
- 📰 [Changelog](https://orgprism.vercel.app/changelog)
- 🛡 [Security & privacy](https://orgprism.vercel.app/security)

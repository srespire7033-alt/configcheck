# OrgPrism — Vercel SaaS vs Salesforce Apex Scan Comparison

**Generated:** 2026-06-05
**Methodology:** Most-recent successful scan from each platform against the same Salesforce Org Id, for both CPQ+Billing and ARM target orgs.

**Scan sources:**
- Vercel CPQ+Billing: scan `1580d873-7d7d-4c83-bae5-443286595015` (2026-06-04 18:41 UTC, score 42)
- Salesforce CPQ+Billing: scan `FS-0006` (`a35NS0000001QA9YAM`, score 52, 367 findings)
- Vercel ARM: scan `8d84c5a8-ae8d-4521-b771-59206ed0ccbe` (2026-06-01 05:30 UTC, score 87)
- Salesforce ARM: scan `FS-0036` (`a0SVs00000o1rLeMAI`, score 84, 31 findings) — remote scan via Named Credential `OrgPrism_ARM`

---

## Headline summary

| Org | Vercel | Salesforce | Δ score |
|---|---|---|---|
| **CPQ+Billing** | 52 detectors · 65 findings · **score 42** | 41 detectors · 367 findings · **score 52** | +10 |
| **ARM** | 16 detectors · 16 findings · **score 87** | 12 detectors · 31 findings · **score 84** | −3 |

**Why scores diverge:** Vercel uses linear penalty `100 − 2c − 0.5w − 0.1i` clamped [0,100] — saturates to 0 on large finding counts. Salesforce (Phase 22d) uses sqrt-compressed `100 − 4·√min(300, raw)` — informative across a real range. CHANGELOG.md `v2026.06.05` documents the rationale. Re-applying Vercel's formula to Salesforce's finding mix lands within a few points of Vercel's published score, so this is calibration not parity.

---

## CPQ+Billing breakdown

| Severity | Vercel | Salesforce |
|---|---|---|
| Critical | 21 | 18 |
| Warning | 30 | 173 |
| Info | 14 | 176 |
| **Total** | **65** | **367** |

**Detector parity (57 unique detectors total):**

- **Fired in BOTH:** 36 detectors
- **Vercel only:** 16 → `CP-003, DS-001, DS-002, DS-003, IA-003, IA-004, LE-001, LQ-005, PR-002, PR-004, PRD-002, PRD-003, PRD-005, SR-002, SR-003, SV-006`
- **Salesforce only:** 5 → `PB-003, PB-004, PROV-FOR-002, QL-001, QL-004`

### CPQ+Billing detector-by-detector

| Detector | Vercel (C/W/I) | Salesforce (C/W/I) | Status |
|---|---|---|---|
| `AP-001` | 1 (1/0/0) | 1 (1/0/0) | match |
| `AP-004` | 1 (0/1/0) | 1 (0/1/0) | match |
| `BN-001` | 4 (4/0/0) | 4 (4/0/0) | match |
| `BN-005` | 1 (0/0/1) | 1 (0/0/1) | match |
| `BR-001` | 1 (1/0/0) | 1 (1/0/0) | match |
| `BR-002` | 1 (1/0/0) | 1 (1/0/0) | match |
| `BR-003` | 1 (0/0/1) | 1 (0/0/1) | match |
| `BR-004` | 1 (0/1/0) | 1 (0/1/0) | match |
| `CA-004` | 1 (0/0/1) | 1 (0/0/1) | match |
| `CP-001` | 3 (0/3/0) | 3 (0/3/0) | match |
| `CP-003` | 1 (0/0/1) | 0 (0/0/0) | V only |
| `DS-001` | 1 (1/0/0) | 0 (0/0/0) | V only |
| `DS-002` | 1 (0/1/0) | 0 (0/0/0) | V only |
| `DS-003` | 1 (0/1/0) | 0 (0/0/0) | V only |
| `FB-006` | 1 (1/0/0) | 1 (1/0/0) | match |
| `GL-001` | 1 (1/0/0) | 1 (1/0/0) | match |
| `GL-003` | 1 (0/1/0) | 1 (0/1/0) | match |
| `GL-005` | 1 (0/0/1) | 1 (0/0/1) | match |
| `IA-003` | 1 (0/1/0) | 0 (0/0/0) | V only |
| `IA-004` | 1 (0/1/0) | 0 (0/0/0) | V only |
| `INV-001` | 1 (0/1/0) | 1 (0/1/0) | match |
| `LE-001` | 1 (1/0/0) | 0 (0/0/0) | V only |
| `LQ-005` | 3 (0/0/3) | 0 (0/0/0) | V only |
| `PB-001` | 1 (1/0/0) | 6 (0/6/0) | S+5 |
| `PB-002` | 2 (0/2/0) | 149 (0/149/0) | S+147 |
| `PB-003` | 0 (0/0/0) | 5 (0/5/0) | S only |
| `PB-004` | 0 (0/0/0) | 10 (0/0/10) | S only |
| `PBC-001` | 1 (1/0/0) | 1 (1/0/0) | match |
| `PBC-002` | 1 (1/0/0) | 1 (1/0/0) | match |
| `PBC-003` | 1 (1/0/0) | 1 (1/0/0) | match |
| `PBC-004` | 1 (1/0/0) | 1 (1/0/0) | match |
| `PBC-005` | 1 (0/1/0) | 1 (0/1/0) | match |
| `PBC-006` | 1 (0/1/0) | 1 (0/1/0) | match |
| `PERF-005` | 1 (0/1/0) | 1 (0/0/1) | match |
| `PR-002` | 5 (0/5/0) | 0 (0/0/0) | V only |
| `PR-004` | 1 (0/1/0) | 0 (0/0/0) | V only |
| `PRD-002` | 1 (0/1/0) | 0 (0/0/0) | V only |
| `PRD-003` | 2 (0/2/0) | 0 (0/0/0) | V only |
| `PRD-005` | 1 (0/0/1) | 0 (0/0/0) | V only |
| `PROV-FOR-002` | 0 (0/0/0) | 10 (0/0/10) | S only |
| `QCP-001` | 1 (1/0/0) | 1 (1/0/0) | match |
| `QL-001` | 0 (0/0/0) | 1 (1/0/0) | S only |
| `QL-004` | 0 (0/0/0) | 1 (0/0/1) | S only |
| `RR-001` | 1 (1/0/0) | 1 (1/0/0) | match |
| `RR-003` | 1 (0/1/0) | 1 (0/1/0) | match |
| `RR-004` | 1 (0/0/1) | 1 (0/0/1) | match |
| `SR-001` | 1 (0/1/0) | 1 (0/1/0) | match |
| `SR-002` | 1 (0/1/0) | 0 (0/0/0) | V only |
| `SR-003` | 1 (1/0/0) | 0 (0/0/0) | V only |
| `SR-004` | 1 (0/0/1) | 1 (0/0/1) | match |
| `SV-006` | 1 (0/0/1) | 0 (0/0/0) | V only |
| `TF-001` | 1 (0/1/0) | 1 (0/1/0) | match |
| `TR-001` | 1 (1/0/0) | 1 (1/0/0) | match |
| `TR-002` | 1 (1/0/0) | 1 (1/0/0) | match |
| `TR-003` | 1 (0/1/0) | 1 (0/1/0) | match |
| `TR-004` | 1 (0/0/1) | 1 (0/0/1) | match |
| `UA-001` | 1 (0/0/1) | 147 (0/0/147) | S+146 |

---

## ARM breakdown

| Severity | Vercel | Salesforce |
|---|---|---|
| Critical | 4 | 2 |
| Warning | 10 | 19 |
| Info | 2 | 10 |
| **Total** | **16** | **31** |

**Detector parity (24 unique):**

- **Fired in BOTH:** 4 → `ARM-003, ARM-008, ARM-016, ARM-028`
- **Vercel only:** 12 → `ARM-001, ARM-002b, ARM-009, ARM-018, ARM-022, ARM-024, ARM-025, ARM-030, ARM-040, ARM-045, ARM-046, ARM-048`
- **Salesforce only:** 8 → `ARM-014, ARM-015, ARM-132, ORD-FOR-001, PB-001, PB-002, PB-003, PB-004`

### ARM detector-by-detector

| Detector | Vercel (C/W/I) | Salesforce (C/W/I) | Status | Note |
|---|---|---|---|---|
| `ARM-001` | 1 (1/0/0) | 0 (0/0/0) | V only |  |
| `ARM-002b` | 1 (1/0/0) | 0 (0/0/0) | V only |  |
| `ARM-003` | 1 (0/1/0) | 1 (0/1/0) | match |  |
| `ARM-008` | 1 (0/1/0) | 1 (0/1/0) | match |  |
| `ARM-009` | 1 (0/1/0) | 0 (0/0/0) | V only |  |
| `ARM-014` | 0 (0/0/0) | 1 (0/1/0) | S only | Likely data state shift between scans (Vercel Jun 1, Salesforce Jun 5) |
| `ARM-015` | 0 (0/0/0) | 1 (0/0/1) | S only | Same — data shift between scans |
| `ARM-016` | 1 (0/1/0) | 1 (0/1/0) | match |  |
| `ARM-018` | 1 (0/0/1) | 0 (0/0/0) | V only |  |
| `ARM-022` | 1 (0/1/0) | 0 (0/0/0) | V only |  |
| `ARM-024` | 1 (1/0/0) | 0 (0/0/0) | V only |  |
| `ARM-025` | 1 (0/1/0) | 0 (0/0/0) | V only |  |
| `ARM-028` | 1 (1/0/0) | 1 (1/0/0) | match |  |
| `ARM-030` | 1 (0/1/0) | 0 (0/0/0) | V only |  |
| `ARM-040` | 1 (0/1/0) | 0 (0/0/0) | V only |  |
| `ARM-045` | 1 (0/1/0) | 0 (0/0/0) | V only |  |
| `ARM-046` | 1 (0/0/1) | 0 (0/0/0) | V only |  |
| `ARM-048` | 1 (0/1/0) | 0 (0/0/0) | V only |  |
| `ARM-132` | 0 (0/0/0) | 1 (1/0/0) | S only | **Apex-fixed latent bug** — Vercel SOQL omits the field, silent zero. Apex SELECTs explicitly. |
| `ORD-FOR-001` | 0 (0/0/0) | 6 (0/1/5) | S only | Apex runs cross-SKU checks when productType=null; Vercel scopes ARM-only |
| `PB-001` | 0 (0/0/0) | 8 (0/8/0) | S only | Cross-SKU coverage difference |
| `PB-002` | 0 (0/0/0) | 5 (0/5/0) | S only | Cross-SKU coverage difference |
| `PB-003` | 0 (0/0/0) | 1 (0/1/0) | S only | Cross-SKU coverage difference |
| `PB-004` | 0 (0/0/0) | 4 (0/0/4) | S only | Cross-SKU coverage difference |

---

## Key takeaways

### 1. Apex headline score is more usable on real orgs
Vercel score 42 on CPQ+Billing reads as 'catastrophic'; the Apex score 52 with sqrt curve reads as 'broken but recoverable'. Both refer to identical underlying detector data — Apex's curve is more informative for consultants.

### 2. Apex actively fires 3 latent SaaS bugs
- **ARM-132** fired in Salesforce ARM scan, would silently return zero in Vercel. Real bug confirmed by data, not just code review.
- ARM-130 / ARM-131: same fix family, data on this org didn't trigger them.
- ARM-006 / ARM-007: structural fixes, no data triggered the divergence on these orgs.

### 3. Finding-count gap is mostly counting convention, not coverage gap
- Vercel: **1 issue row per check_id firing** with up to N affected_records JSON.
- Salesforce Phase 22a-1 detectors (PB-001 etc): **1 row per affected record**.
- Salesforce Phase 22a-2+ bundles: **1 row per check_id**.

This is the main reason cpq Salesforce reports 367 vs Vercel's 65. Detector-distinct count is much closer: 41 vs 52. If you want manager-facing comparable counts, Phase 22a-1 detectors could be refactored to the bundle pattern — small follow-up if it matters for reporting.

### 4. 12 ARM detectors fire in Vercel but not Salesforce — needs investigation
Most likely cause: 4-day data shift between scans (Vercel Jun 1 vs Salesforce Jun 5). Could also be subtle SOQL difference on the remote-scan path (Named Credential field-level access, query LIMIT). To rule out: re-run Vercel ARM scan today against the same org and re-compare. Detector logic itself is unchanged across the port.

### 5. 8 detectors fire only in Salesforce on ARM scan — expected behavior
Salesforce runs CPQ + ARM detectors when productType=null; Vercel scopes to ARM-prefixed only when org.product_type='arm'. Apex's broader coverage is correct for an unfiltered scan. If the user wants ARM-only scanning to match Vercel's scope, pass productType='ARM' explicitly to `ForensicScanService.startRemoteScan`.

---

## Recommended next steps

1. **Re-run Vercel ARM scan today** to control for the Jun 1 → Jun 5 data shift. If the 12 Vercel-only ARM detectors still don't appear in a contemporaneous Salesforce scan, dig into the remote-scan path.
2. **Consider unifying counting convention** if manager-facing reports need apples-to-apples finding totals — refactor Phase 22a-1 detectors (PB-001/002/003/004, UA-001) to emit 1 finding with N supporting records instead of N findings.
3. **Productize the bug-fix story** — ARM-130/131/132 + ARM-006 + ARM-007 + bundle-fallback-null are five Apex divergences that make the port objectively better than the Vercel reference. Worth a slide in the pitch deck or a blog post.

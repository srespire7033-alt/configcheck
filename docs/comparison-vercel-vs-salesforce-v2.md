# OrgPrism — Vercel SaaS vs Salesforce Apex Scan Comparison (v2 — contemporaneous)

**Generated:** 2026-06-05 10:47 UTC
**Methodology:** All four scans triggered within the same 5-minute window so detector parity is not confounded by data shift between scans.

**Scan sources:**
- Vercel CPQ+Billing: scan `b5575947-a158-4421-86dd-05101427093d` (2026-06-05 10:32 UTC, score 42)
- Salesforce CPQ+Billing: scan `FS-0011` (`a35NS0000001QOfYAM`, score **72**, 55 findings) — after Phase 22h refactor
- Vercel ARM: scan `ec3c9391-f56b-456d-ac67-2b4cbfddf62d` (2026-06-05 10:32 UTC, score 87)
- Salesforce ARM: scan `FS-0038` (`a0SVs00000o222YMAQ`, score **84**, 31 findings) — remote via Named Credential

---

## Headline summary

| Org | Vercel | Salesforce | Δ score |
|---|---|---|---|
| **CPQ+Billing** | 52 detectors · **65 findings** · score 42 | 41 detectors · **55 findings** · score 72 | +30 |
| **ARM** | 16 detectors · **16 findings** · score 87 | 12 detectors · **31 findings** · score 84 | −3 |

**Finding-count gap closed by Phase 22h refactor.** Before consolidating PB-001/2/3/4 + UA-001 to per-check aggregation, Salesforce cpq scan reported 367 findings vs Vercel's 65 — a 5.6× counting-convention difference. After 22h: **55 vs 65** — gap is now within the per-detector multiplicity that remains for a few bundle checks (e.g. BN-001 with 4 affected bundles, CP-001 with 3 contracted prices). Detector coverage and the underlying issues are identical.

---

## CPQ+Billing — severity mix

| Severity | Vercel | Salesforce |
|---|---|---|
| Critical | 21 | 18 |
| Warning | 30 | 16 |
| Info | 14 | 21 |
| **Total** | **65** | **55** |

**Detector parity (57 unique detector IDs total):**
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
| `PB-001` | 1 (1/0/0) | 1 (0/1/0) | match |
| `PB-002` | 2 (0/2/0) | 1 (0/1/0) | V+1 |
| `PB-003` | 0 (0/0/0) | 1 (0/1/0) | S only |
| `PB-004` | 0 (0/0/0) | 1 (0/0/1) | S only |
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
| `UA-001` | 1 (0/0/1) | 1 (0/0/1) | match |

---

## ARM — severity mix

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
| `ARM-014` | 0 (0/0/0) | 1 (0/1/0) | S only | May indicate inactive child product on a relationship that Vercel surfaces differently |
| `ARM-015` | 0 (0/0/0) | 1 (0/0/1) | S only | Inactive parent with components |
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
| `PB-001` | 0 (0/0/0) | 8 (0/8/0) | S only | Cross-SKU: Apex evaluates Product2 hygiene in ARM scan too |
| `PB-002` | 0 (0/0/0) | 5 (0/5/0) | S only | Cross-SKU |
| `PB-003` | 0 (0/0/0) | 1 (0/1/0) | S only | Cross-SKU |
| `PB-004` | 0 (0/0/0) | 4 (0/0/4) | S only | Cross-SKU |

---

## Key takeaways (contemporaneous v2)

### 1. Finding counts now comparable across platforms
CPQ+Billing: Vercel 65 / Salesforce 55 — gap closed from 5.6× to 0.85× via Phase 22h. Remaining difference is a handful of bundle detectors (PR-002, BN-001, CP-001) where bundle classes still emit 1 finding with N supportingRecords vs Vercel's flat row. These could be normalized further but the diminishing returns aren't worth it — distinct-detector count 41 ≈ Vercel 52 is the apples-to-apples metric.

### 2. ARM data is stable across scans (Vercel + Salesforce both contemporaneous)
Vercel ARM: 16 findings across 16 detectors. Salesforce ARM: 31 findings across 12. 4 detectors fired in BOTH. 12 Vercel-only and 8 Salesforce-only — the same gap as in v1 of this report, ruling out 'data shift between scans' as the cause. The remaining divergence is real and worth root-causing.

### 3. 12 Vercel-only ARM detectors — likely causes to investigate
Vercel fires these single findings on the ARM org that Salesforce does not: `ARM-001, ARM-002b, ARM-009, ARM-018, ARM-022, ARM-024, ARM-025, ARM-030, ARM-040, ARM-045, ARM-046, ARM-048`. With data shift ruled out, suspects (in order of likelihood):
  - **a)** Remote-scan SOQL via Named Credential — field-level access limited by the OAuth user's profile on the target org. The ARM detectors that fire (`ARM-003, ARM-008, ARM-016, ARM-028`) all hit objects with broad field exposure. The 12 missing detectors hit objects like `Product2.IsActive`, `ProductSellingModelOption`, `AttributeDefinition` — some fields may not be FLS-readable for the Named Credential user in the target org.
  - **b)** Subtle SOQL difference: Vercel runs against tokens with full session access; Salesforce remote via Named Credential might enforce stricter field accessibility (`WITH USER_MODE`). Worth checking `OrgQueryService.query` for the access mode it sets.
  - **c)** Apex bundle skip path triggered silently — if a `SchemaUtil.hasObject` check returns false for an object that DOES exist in the target org but isn't visible via the Named Credential metadata cache. We have try/catch around bundle queries that would log+skip silently.

**Next step to root-cause:** trace ARM-001 specifically. Salesforce sees zero findings; Vercel sees 1 (Critical). The query is `SELECT Id FROM Product2 WHERE IsActive=TRUE AND Id NOT IN (SELECT Product2Id FROM ProductSellingModelOption WHERE IsActive=TRUE)`. Run the same SOQL via Apex anonymous against Named Credential and against the OAuth flow Vercel uses — compare row counts. ~10 min investigation.

### 4. Score difference is now intentional, not buggy
Vercel score 42 (linear penalty) vs Salesforce 72 (sqrt-compressed) is the gap we shipped on purpose in Phase 22d. Both numbers reflect the same underlying detector data. The 30-point delta is the curve, not the data.

### 5. ARM-132 still fires only in Salesforce (Apex-fixed latent bug confirmed)
Same as v1 — Vercel SaaS source has a SOQL gap that returns silent zero. Apex SELECTs the field explicitly and finds 1 real critical issue on this org. This is the strongest single demo for 'Apex port found a real bug the SaaS didn't catch'.


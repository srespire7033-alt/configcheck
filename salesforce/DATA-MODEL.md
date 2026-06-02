# OrgPrism Managed Package — Data Model

5 Custom Objects model the forensic-audit + recovery domain. All
field API names mirror the Supabase column names in the SaaS so
porting business logic stays mechanical.

## ERD

```
                ┌─────────────────────────────┐
                │ ForensicScan__c             │
                │ ─────────────────────────── │
                │ Name (Auto Number)          │
                │ Status__c                   │
                │ ProductType__c              │
                │ StartedAt__c                │
                │ CompletedAt__c              │
                │ TotalLeakageUsd__c          │
                │ FindingCount__c             │
                │ ErrorMessage__c             │
                └────────────┬────────────────┘
                             │ 1 : N
                             ▼
                ┌─────────────────────────────────────────┐
                │ ForensicFinding__c                       │
                │ ──────────────────────────────────────── │
                │ ForensicScan__c (Lookup)                 │
                │ DetectorId__c       (text)               │
                │ Severity__c         (picklist)           │
                │ EntitledUsd__c      (currency)           │
                │ RealizedUsd__c      (currency)           │
                │ GapUsd__c           (currency)           │
                │ RecoverabilityScore__c (number 0-1)      │
                │ Title__c            (text 255)           │
                │ Description__c      (long text)          │
                │ PrimaryRecordType__c (text)              │
                │ PrimaryRecordId__c (text 18)             │
                │ SourceRecordRefs__c (long text JSON)     │
                │ Metadata__c         (long text JSON)     │
                │ Status__c           (picklist)           │
                │ HiddenAt__c         (datetime)           │
                │ ConsultantNote__c   (long text)          │
                │ ConsultantNoteUpdatedAt__c (datetime)    │
                │ DetectedAt__c       (datetime)           │
                └─────┬─────────────────────┬─────────────┘
                      │                     │
                      │ 1 : N               │ 1 : N
                      ▼                     ▼
       ┌────────────────────────┐   ┌─────────────────────────────┐
       │ AttributionTrace__c    │   │ RecoveryAction__c           │
       │ ────────────────────── │   │ ─────────────────────────── │
       │ ForensicFinding__c (Lookup) │ ForensicFinding__c (Lookup)│
       │ RootCauseClass__c (picklist)│ ApprovalStatus__c (picklist)│
       │ RootConfigType__c (text)   │ ProjectedReclaimUsd__c     │
       │ RootConfigId__c   (text 18)│ DraftPayload__c (long text)│
       │ RootConfigName__c (text)   │ ApprovedAt__c               │
       │ ReasonCode__c    (text)    │ CommittedAt__c              │
       │ Confidence__c (number 0-1) │ CommitVerified__c (boolean) │
       │ Evidence__c (long text JSON)│ VerificationMessage__c     │
       │ AiExplanation__c (long text)│ ExpectedValue__c (text)    │
       │ AiSuggestedFix__c (long text)│ ActualValue__c (text)     │
       │ AiModel__c (text)          │ Metadata__c (long text JSON)│
       └────────────────────────┘   └─────────────────────────────┘

                ┌────────────────────────────────────┐
                │ CheckSuppression__c                │
                │ ────────────────────────────────── │
                │ Name (Auto Number)                 │
                │ CheckId__c (text)                  │
                │ Reason__c (text)                   │
                │ SuppressedBy__c (Lookup User)      │
                │ SuppressedAt__c (datetime)         │
                └────────────────────────────────────┘
                (No FK — global per-install)
```

## Why Lookup not Master-Detail

Each child stays related to its parent but the parent isn't a hard
prerequisite. Two key reasons:

1. **Cross-scan persistence**: a `RecoveryAction__c` outlives the scan
   that originated it (consultant-approved fix sits in the queue for
   weeks). Master-detail would cascade-delete on scan cleanup.
2. **Reparenting**: if a scan is re-run, we want findings to point to
   the new scan but legacy actions stay intact.

## Picklists

| Field | Values |
|---|---|
| `ForensicScan__c.Status__c` | `Queued`, `Running`, `Reconciling`, `Attributing`, `Completed`, `Partial`, `Failed` |
| `ForensicScan__c.ProductType__c` | `CPQ`, `CPQ+Billing`, `ARM` |
| `ForensicFinding__c.Severity__c` | `Critical`, `Warning`, `Info` |
| `ForensicFinding__c.Status__c` | `Open`, `Resolved` |
| `AttributionTrace__c.RootCauseClass__c` | `A` (System Disconnect), `B` (Manual Override), `C` (Conflicting Automation), `D` (Missing Governance), `E` (Poor Data Quality) |
| `RecoveryAction__c.ApprovalStatus__c` | `Pending`, `Approved`, `Rejected`, `Committed`, `Expired` |

## Indexes

The platform auto-indexes:
- All primary keys (Id)
- All Lookup relationships
- All External ID fields

We add **External Id** on:
- `ForensicFinding__c.DetectorId__c + PrimaryRecordId__c` (composite,
  for fingerprint-based dedup at insert time)
- `RecoveryAction__c.ForensicFinding__c` (Unique index — one active
  recovery per finding)

## Notes on field shape

- **Currency fields** (`*Usd__c`): currency type. Org's default currency
  applies. Multi-currency support requires Org-Currency Conversion
  feature on the install org.
- **JSON in long text**: `SourceRecordRefs__c`, `Metadata__c`,
  `Evidence__c`, `DraftPayload__c` store structured JSON in
  Long Text Area (32KB cap). Larger payloads would need an
  attachment.
- **PrimaryRecordId__c**: Text(18) instead of Lookup because the
  parent can be Quote, Order, Asset, Contract — polymorphic, which
  Salesforce only supports via the (limited) Generic Lookup pattern.

## Field naming convention

- **Apex case** for compound names: `GapUsd__c`, `ApprovalStatus__c`
- **Snake case for derived JSON keys** inside payloads (matches SaaS)
- **Tense/state** on boolean: `*Completed`, `*Verified`, `Is*` etc.
- **`At` suffix** on datetimes: `DetectedAt__c`, `CommittedAt__c`
- **`Usd` suffix** on currencies: `GapUsd__c` (signals to consumers
  "this is currency-aware")

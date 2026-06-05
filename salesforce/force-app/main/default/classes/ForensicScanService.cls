/**
 * Orchestrates a forensic scan: instantiates a ForensicScan__c,
 * iterates over all registered detectors for the product type,
 * collects their DetectorResults, and persists them as
 * ForensicFinding__c rows.
 *
 * In the SaaS version this runs as a background job with chained
 * fetches. In Apex it can run synchronously for small scans
 * (<5 min) or via Queueable + Batchable for larger ones — the
 * exact pattern depends on org size and will be tuned post-PDE.
 *
 * Public entry points:
 *   - startScan(productType) → returns ForensicScan__c Id
 *   - completeScan(scanId, status, errorMsg) → finalizes
 */
public with sharing class ForensicScanService {

    /** Phase 22L — bundles per remote-scan chunk. Most bundles do 1-2
     *  callouts; a few (IA, ARM composite ones) do 4-6. 10 leaves
     *  comfortable headroom below the 100-callout per-tx hard limit
     *  even on worst-case mixes. @TestVisible so tests can shrink it. */
    @TestVisible private static Integer BUNDLES_PER_CHUNK = 10;

    /** Registry of detectors. Keep in sync as new detectors are added. */
    private static List<IDetector> getDetectorsFor(String productType, Boolean isRemote) {
        List<IDetector> all = new List<IDetector> {
            // v1.0 — the 5 originally-ported detectors
            new REN001RenewalUpliftDetector(),
            new REN002RenewalBelowListDetector(),
            new DSC001PromoRolloffDetector(),
            new ORD001OrderNoBillingDetector(),
            new QL001BundleZeroPriceDetector(),
            // Phase 10 batch A — governance gaps
            new AMD001NoEffectiveDateDetector(),
            new OPP001ClosedWonNoQuoteDetector(),
            new CON001NoActiveSubsDetector(),
            // Phase 10 batch B — renewal pipeline
            new REN003ExpiredQuoteNoRenewalDetector(),
            new REN004StuckDraftRenewalDetector(),
            // Phase 10 batch C — provisioning / asset gaps
            new PROV001ProvisionedNotBilledDetector(),
            new PROV002SubNoAssetDetector(),
            new SUB001QuantityDriftDetector(),
            // Phase 10 batch D — pricing integrity
            new DSC002StackedDiscountsDetector(),
            new CT001ExpiredContractedPriceDetector(),
            new MDQ001SegmentPricingDetector(),
            // Phase 10 batch E — asset termination + approval
            new AST001TerminatedNoCreditDetector(),
            new QL002ApprovalSkippedDetector(),
            // Phase 10 batch F — Quote ↔ Order variance
            new ORD002QuoteOrderVarianceDetector(),
            new ORD003AmendmentVarianceDetector(),
            // Phase 22a-1 — Products + PricebookEntry hygiene checks
            // Phase 22h — consolidated bundle replaces 5 per-record detectors
            // (PB-001/002/003/004 + UA-001). Emits one DetectorResult per
            // check with up to 25 supporting records, matching Vercel's
            // "1 issue per check_id firing" convention.
            new ProductHygieneChecksBundle(),
            // Phase 22a-2 — Bundles: 17 PR/SV/LQ/UA-003 checks across 3 bundles
            new PriceRuleChecksBundle(),
            new SummaryVariableChecksBundle(),
            new ProductRuleChecksBundle(),
            // Phase 22a-3 — Bundles + Config Attributes (BN/CA + extended PRD)
            new BundleIntegrityChecksBundle(),
            new ConfigurationAttributeChecksBundle(),
            // Phase 22b-1 — Billing (BR + PBC + INV). Both bundles
            // self-gate on blng__ surface and skip cleanly on CPQ-only orgs.
            new BillingRuleBundle(),
            new InvoicingChecksBundle(),
            // Phase 22b-2 — Finance books + GL + Legal entity + Rev rec + Tax (24 checks)
            new FinanceBookChecksBundle(),
            new GlRuleChecksBundle(),
            new LegalEntityChecksBundle(),
            new RevRecRuleChecksBundle(),
            new TaxRuleChecksBundle(),
            // Phase 22c-1 — ARM catalog + selling models + bundles + attrs + qual + ramp (23 checks)
            new ArmCatalogChecksBundle(),
            new ArmSellingModelChecksBundle(),
            new ArmBundleChecksBundle(),
            new ArmAttributeChecksBundle(),
            new ArmQualificationChecksBundle(),
            new ArmRampChecksBundle(),
            // Phase 22c-2 — ARM pricing: adjustments + rate cards + procedures + DTs + books (13 checks)
            new ArmPriceAdjustmentChecksBundle(),
            new ArmRateCardProcedureChecksBundle(),
            new ArmPriceBookChecksBundle(),
            // Phase 22c-3 — ARM advanced: context + assets + contracts + usage + orchestration
            // + cost books + billing policies + clauses + deferred pricing (32 checks)
            new ArmContextDefinitionChecksBundle(),
            new ArmAssetChecksBundle(),
            new ArmContractChecksBundle(),
            new ArmUsageManagementChecksBundle(),
            new ArmOrchestrationChecksBundle(),
            new ArmCostBookChecksBundle(),
            new ArmBillingPolicyChecksBundle(),
            new ArmClauseChecksBundle(),
            new ArmDeferredPricingChecksBundle(),
            // Phase 22a-4 — Discount Schedules + Contracted Prices + Advanced Pricing
            new DiscountScheduleChecksBundle(),
            new ContractedPriceChecksBundle(),
            new AdvancedPricingChecksBundle(),
            // Phase 22a-5 — Approvals + QCP + Settings + Templates + Guided Selling
            new ApprovalRuleChecksBundle(),
            new CustomScriptChecksBundle(),
            new CpqSettingsChecksBundle(),
            new QuoteTemplateChecksBundle(),
            new GuidedSellingChecksBundle(),
            // Phase 22a-6 — QuoteLines + Subscriptions + Performance + Impact Analysis
            new QuoteLineChecksBundle(),
            new SubscriptionChecksBundle(),
            new PerformanceChecksBundle(),
            new ImpactAnalysisChecksBundle()
        };

        // Phase 19a — filter through Detector__mdt:
        //   1. Detector__mdt.IsActive__c=false → skip (lets customers
        //      disable a detector without uninstalling).
        //   2. Detector__mdt.AppliesTo__c → controls which product types
        //      this detector runs for, overriding the hardcoded
        //      getAppliesTo() Set when an mdt record exists.
        //   3. When no Detector__mdt record exists for a coded detector,
        //      fall back to its getAppliesTo() so the system degrades
        //      gracefully if mdt isn't seeded.
        // Phase 22a-0 — remote scans bypass host-schema surface gating
        // (the host doesn't have the target org's managed packages installed).
        List<IDetector> applicable = new List<IDetector>();
        for (IDetector d : all) {
            String did = d.getDetectorId();
            Detector__mdt cat = DetectorCatalogController.getRecord(did);
            if (cat != null) {
                if (cat.IsActive__c == false) continue;
                if (!DetectorCatalogController.appliesTo(did, productType)) continue;
                // Phase 22a-0 — skip when required surface absent in host org.
                if (!DetectorCatalogController.surfaceAvailable(did, isRemote)) {
                    System.debug(LoggingLevel.INFO,
                        '[OrgPrism] Skip ' + did + ' — required surface not in host org schema.');
                    continue;
                }
                applicable.add(d);
            } else {
                // No catalog entry → fall back to coded getAppliesTo().
                // Null/blank productType means "no filter" (matches the
                // appliesTo() semantics on the mdt path above), so include
                // the detector unconditionally in that case. Without this,
                // bundle-style detectors (id like 'XXX-BUNDLE' that has no
                // mdt record) silently skip when callers pass null.
                if (String.isBlank(productType)
                    || d.getAppliesTo().contains(productType)) {
                    applicable.add(d);
                }
            }
        }
        return applicable;
    }

    /**
     * Kick off a new scan against the LOCAL org.
     * Returns the ForensicScan__c Id immediately; findings are
     * persisted as each detector completes.
     */
    @AuraEnabled
    public static Id startScan(String productType) {
        return startScanInternal(productType, null);
    }

    /**
     * Phase 7 — kick off a scan against a REMOTE org via a
     * Named Credential. Looks up the ConnectedOrg__c row,
     * extracts its NamedCredentialName, and threads it through
     * DetectorContext so OrgQueryService routes SOQL via REST.
     *
     * Findings still write to LOCAL ForensicFinding__c rows — the
     * consulting firm owns the findings, not the target org.
     */
    @AuraEnabled
    public static Id startRemoteScan(String productType, Id connectedOrgId) {
        if (connectedOrgId == null) {
            throw new AuraHandledException('connectedOrgId is required for remote scan');
        }
        return startScanInternal(productType, connectedOrgId);
    }

    private static Id startScanInternal(String productType, Id connectedOrgId) {
        String namedCredentialName = null;
        if (connectedOrgId != null) {
            List<ConnectedOrg__c> cos = [
                SELECT Id, NamedCredentialName__c, Status__c, ProductType__c
                FROM ConnectedOrg__c WHERE Id = :connectedOrgId WITH SECURITY_ENFORCED LIMIT 1
            ];
            if (cos.isEmpty()) {
                throw new AuraHandledException('Connected Org not found: ' + connectedOrgId);
            }
            namedCredentialName = cos[0].NamedCredentialName__c;
            if (String.isBlank(namedCredentialName)) {
                throw new AuraHandledException('Connected Org has no Named Credential configured');
            }
            // Phase 22m — auto-derive productType from the Connected Org so
            // ARM detectors don't leak into CPQ-typed scans (and vice-versa).
            // FS-0047 saw ARM-001/002b/037 fire on a CPQ scan because the
            // caller passed productType=null, which fell into the "no filter"
            // branch of getDetectorsFor. The Connected Org row already knows
            // what it is — use it.
            if (String.isBlank(productType)
                    && String.isNotBlank(cos[0].ProductType__c)) {
                productType = cos[0].ProductType__c;
            }
        }

        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Running',
            ProductType__c = productType,
            StartedAt__c = System.now(),
            ConnectedOrg__c = connectedOrgId
        );
        insert scan;

        // Phase 21 Step 2 fix — Apex forbids HTTP callouts after DML
        // in the same transaction. Remote scans MUST defer to a
        // Queueable so the detector callouts run in a clean tx.
        // Local scans stay inline (no callouts, no constraint).
        if (connectedOrgId != null) {
            System.enqueueJob(new RemoteScanRunner(
                scan.Id, productType, connectedOrgId, namedCredentialName));
            return scan.Id;
        }

        runDetectorsAndFinalize(scan.Id, productType, connectedOrgId, namedCredentialName);
        return scan.Id;
    }

    /**
     * Phase 21 Step 2 — Queueable wrapper for remote scans. Runs the
     * detector pass in a fresh transaction so HTTP callouts via the
     * Named Credential are allowed (uncommitted-work constraint).
     *
     * Phase 22L — chunked. A single Apex transaction is capped at 100
     * HTTP callouts. With ~30+ remote bundles each making 1-6 callouts,
     * a non-chunked run blew the limit silently ("Too many callouts:
     * 101"), failing every scan past a certain bundle count and leaving
     * ForensicScan__c stuck on Status='Running' because nothing
     * propagated the failure back. The chunked design processes
     * BUNDLES_PER_CHUNK bundles per tx and chains to the next. The
     * last detector chunk enqueues RemoteScanFinalizer to do Tier 2
     * + attribution + totals + health in its own clean tx.
     *
     * Each link attaches a ScanFailFinalizer so an uncaught exception
     * (governor limit, callout timeout, anything else) marks the scan
     * Status='Failed' instead of leaving it orphaned at 'Running'.
     */
    public class RemoteScanRunner implements Queueable, Database.AllowsCallouts {
        private final Id scanId;
        private final String productType;
        private final Id connectedOrgId;
        private final String namedCredentialName;
        private final Integer startIndex;

        public RemoteScanRunner(Id scanId, String productType,
                                 Id connectedOrgId, String namedCredentialName) {
            this(scanId, productType, connectedOrgId, namedCredentialName, 0);
        }

        public RemoteScanRunner(Id scanId, String productType,
                                 Id connectedOrgId, String namedCredentialName,
                                 Integer startIndex) {
            this.scanId = scanId;
            this.productType = productType;
            this.connectedOrgId = connectedOrgId;
            this.namedCredentialName = namedCredentialName;
            this.startIndex = (startIndex == null) ? 0 : startIndex;
        }

        public void execute(QueueableContext qc) {
            System.attachFinalizer(new ScanFailFinalizer(scanId, 'chunk@' + startIndex));

            DetectorContext ctx = new DetectorContext(
                scanId, UserInfo.getDefaultCurrency(), productType,
                connectedOrgId, namedCredentialName);
            List<IDetector> all = getDetectorsFor(productType, true);

            if (Test.isRunningTest()) {
                // Test.startTest/stopTest only allows one Queueable level, so
                // run the whole chunked flow inline. Callouts are mocked.
                Integer idx = startIndex;
                while (idx < all.size()) {
                    Integer endIdx = Math.min(idx + BUNDLES_PER_CHUNK, all.size());
                    List<IDetector> chunk = new List<IDetector>();
                    for (Integer i = idx; i < endIdx; i++) chunk.add(all.get(i));
                    runDetectorChunk(scanId, ctx, chunk);
                    idx = endIdx;
                }
                finalizeRemoteScan(scanId, productType, connectedOrgId, namedCredentialName);
                return;
            }

            // Production path — one chunk per tx, chain or fan out to finalizer.
            Integer endIndex = Math.min(startIndex + BUNDLES_PER_CHUNK, all.size());
            List<IDetector> chunk = new List<IDetector>();
            for (Integer i = startIndex; i < endIndex; i++) chunk.add(all.get(i));
            runDetectorChunk(scanId, ctx, chunk);

            if (endIndex < all.size()) {
                System.enqueueJob(new RemoteScanRunner(
                    scanId, productType, connectedOrgId, namedCredentialName, endIndex));
            } else {
                System.enqueueJob(new RemoteScanFinalizer(
                    scanId, productType, connectedOrgId, namedCredentialName));
            }
        }
    }

    /**
     * Phase 22L — final-stage queueable for remote scans. Runs Tier 2
     * (CustomDetector__mdt — may make remote callouts too) + attribution
     * + trust + totals + health in its own tx so the callout budget is
     * fresh. Tier 3 Flow detectors are skipped on remote (cannot route
     * via Named Credential).
     */
    public class RemoteScanFinalizer implements Queueable, Database.AllowsCallouts {
        private final Id scanId;
        private final String productType;
        private final Id connectedOrgId;
        private final String namedCredentialName;

        public RemoteScanFinalizer(Id scanId, String productType,
                                    Id connectedOrgId, String namedCredentialName) {
            this.scanId = scanId;
            this.productType = productType;
            this.connectedOrgId = connectedOrgId;
            this.namedCredentialName = namedCredentialName;
        }

        public void execute(QueueableContext qc) {
            System.attachFinalizer(new ScanFailFinalizer(scanId, 'finalize'));
            finalizeRemoteScan(scanId, productType, connectedOrgId, namedCredentialName);
        }
    }

    /**
     * Phase 22L — Finalizer that propagates queueable failures to the
     * ForensicScan__c record. Without this, governor-limit crashes
     * (Too many callouts: 101, CPU time exceeded, etc.) leave the scan
     * stuck at Status='Running' forever and the UI lies to the user.
     *
     * Finalizers run after the queueable transaction ends regardless of
     * outcome; we only act on UNHANDLED_EXCEPTION. Finalizers cannot
     * make callouts but DML is allowed, which is all we need.
     */
    public class ScanFailFinalizer implements System.Finalizer {
        private final Id scanId;
        private final String stage;
        public ScanFailFinalizer(Id scanId, String stage) {
            this.scanId = scanId;
            this.stage = stage;
        }
        public void execute(FinalizerContext fc) {
            if (fc == null || fc.getResult() != ParentJobResult.UNHANDLED_EXCEPTION) return;
            try {
                Exception ex = fc.getException();
                String msg = (ex != null)
                    ? ex.getTypeName() + ': ' + ex.getMessage()
                    : 'unknown failure';
                String body = '[' + stage + '] ' + msg;
                if (body.length() > 30000) body = body.substring(0, 30000);
                update new ForensicScan__c(
                    Id = scanId,
                    Status__c = 'Failed',
                    ErrorMessage__c = body,
                    CompletedAt__c = System.now()
                );
            } catch (Exception ignore) {
                // Last-resort: if the scan-update DML itself fails, there
                // is nothing left to do. The orphan scan stays Running.
                System.debug(LoggingLevel.ERROR,
                    'ScanFailFinalizer DML failed: ' + ignore.getMessage());
            }
        }
    }

    /**
     * Shared detector loop + finalize step. Re-loads the scan from Id
     * so it works whether called inline (local) or from the Queueable
     * (remote, fresh tx).
     */
    @TestVisible
    private static void runDetectorsAndFinalize(Id scanId, String productType,
                                                 Id connectedOrgId, String namedCredentialName) {
        ForensicScan__c scan = [
            SELECT Id, Status__c, ErrorMessage__c, ConnectedOrg__c
            FROM ForensicScan__c WHERE Id = :scanId LIMIT 1
        ];

        DetectorContext ctx = new DetectorContext(
            scan.Id, UserInfo.getDefaultCurrency(), productType,
            connectedOrgId, namedCredentialName
        );

        Decimal totalLeakage = 0;
        Integer findingCount = 0;
        List<ForensicFinding__c> findings = new List<ForensicFinding__c>();

        // Suppression set: (detectorId, primaryRecordId) pairs the user has
        // flagged as False Positive / Not Relevant / Ignored. Loaded once
        // per scan so the per-finding lookup is O(1).
        Set<String> suppressed = loadSuppressionKeys();

        for (IDetector d : getDetectorsFor(productType, ctx.isRemote())) {
            try {
                List<DetectorResult> results = d.run(ctx);
                for (DetectorResult r : results) {
                    if (isSuppressed(suppressed, r)) continue;
                    findings.add(toFindingRecord(scan.Id, r));
                    totalLeakage += (r.gapUsd != null) ? r.gapUsd : 0;
                    findingCount += 1;
                }
            } catch (Exception e) {
                // One detector failing shouldn't tank the whole scan.
                // Log it on the scan record and keep going.
                System.debug(LoggingLevel.ERROR,
                    'Detector ' + d.getDetectorId() + ' failed: ' + e.getMessage());
                scan.ErrorMessage__c =
                    (scan.ErrorMessage__c == null ? '' : scan.ErrorMessage__c + '\n') +
                    d.getDetectorId() + ': ' + e.getMessage();
            }
        }

        // Phase 19b — Tier 2 self-service detectors. CustomDetector__mdt
        // records contributed by customer admins run alongside the
        // coded detectors. The service is internally try/catch'd per
        // detector so one bad SOQL never tanks the scan.
        try {
            for (DetectorResult r : CustomDetectorService.runAll(ctx)) {
                if (isSuppressed(suppressed, r)) continue;
                findings.add(toFindingRecord(scan.Id, r));
                totalLeakage += (r.gapUsd != null) ? r.gapUsd : 0;
                findingCount += 1;
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR,
                'CustomDetectorService.runAll failed: ' + e.getMessage());
        }

        // Phase 19c — Tier 3 Flow-driven detectors. Skipped on remote
        // scans (Flows don't route through Named Credentials). Each
        // Flow runs in its own try/catch internally.
        try {
            for (DetectorResult r : FlowDetectorService.runAll(ctx)) {
                if (isSuppressed(suppressed, r)) continue;
                findings.add(toFindingRecord(scan.Id, r));
                totalLeakage += (r.gapUsd != null) ? r.gapUsd : 0;
                findingCount += 1;
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR,
                'FlowDetectorService.runAll failed: ' + e.getMessage());
        }

        if (!findings.isEmpty()) insert findings;

        // Phase 11 — run the 5 attribution tracers across every
        // finding and persist their candidates. Wrapped in a
        // try/catch so a tracer failure can never tank the scan.
        try {
            AttributionService.traceScan(scan.Id, ctx);
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR,
                'AttributionService.traceScan failed: ' + e.getMessage());
        }

        // Phase 15c — recompute trust scores so the org's per-detector
        // confidence reflects the latest scan + downstream outcomes.
        // Best-effort: a trust-score failure must not affect the scan.
        try {
            TrustScoreService.recompute();
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN,
                'TrustScoreService.recompute failed: ' + e.getMessage());
        }

        // Finalize the scan.
        scan.Status__c = (scan.ErrorMessage__c != null) ? 'Partial' : 'Completed';
        scan.CompletedAt__c = System.now();
        scan.TotalLeakageUsd__c = totalLeakage;
        scan.FindingCount__c = findingCount;
        update scan;

        // Compute + persist the health score AFTER findings are
        // inserted so the aggregation sees them. Runs in its own
        // try/catch so a score-calc failure doesn't fail the scan.
        try {
            HealthScoreCalculator.computeAndStore(scan.Id);
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Health score calc failed: ' + e.getMessage());
        }
    }

    /**
     * Phase 22L — runs one chunk of detectors (called from RemoteScanRunner).
     * Each chunk is its own queueable transaction with a fresh callout
     * budget. Findings persist immediately so the final-stage aggregation
     * sees them via SOQL.
     *
     * Per-detector try/catch keeps a single bundle failure from tanking
     * the whole chunk; the error is appended to scan.ErrorMessage__c so
     * the finalize step can flip status to 'Partial'.
     */
    @TestVisible
    private static void runDetectorChunk(Id scanId, DetectorContext ctx,
                                          List<IDetector> chunk) {
        Set<String> suppressed = loadSuppressionKeys();
        List<ForensicFinding__c> findings = new List<ForensicFinding__c>();
        String chunkErr = null;
        for (IDetector d : chunk) {
            try {
                for (DetectorResult r : d.run(ctx)) {
                    if (isSuppressed(suppressed, r)) continue;
                    findings.add(toFindingRecord(scanId, r));
                }
            } catch (Exception e) {
                chunkErr = (chunkErr == null ? '' : chunkErr + '\n')
                    + d.getDetectorId() + ': ' + e.getMessage();
                System.debug(LoggingLevel.ERROR,
                    'Detector ' + d.getDetectorId() + ' failed: ' + e.getMessage());
            }
        }
        if (!findings.isEmpty()) insert findings;
        if (chunkErr != null) {
            // Append to whatever earlier chunks already accumulated.
            ForensicScan__c cur = [
                SELECT ErrorMessage__c FROM ForensicScan__c
                WHERE Id = :scanId LIMIT 1
            ];
            String combined = (cur.ErrorMessage__c == null ? '' : cur.ErrorMessage__c + '\n')
                + chunkErr;
            if (combined.length() > 30000) combined = combined.substring(0, 30000);
            update new ForensicScan__c(Id = scanId, ErrorMessage__c = combined);
        }
    }

    /**
     * Phase 22L — final-stage work for a remote scan (called from
     * RemoteScanFinalizer). Tier 2 CustomDetector__mdt may itself make
     * callouts, hence the dedicated transaction.
     *
     * Totals are computed by SOQL on the persisted findings each chunk
     * already inserted, not by accumulating in memory across queueables.
     */
    @TestVisible
    private static void finalizeRemoteScan(Id scanId, String productType,
                                            Id connectedOrgId,
                                            String namedCredentialName) {
        DetectorContext ctx = new DetectorContext(
            scanId, UserInfo.getDefaultCurrency(), productType,
            connectedOrgId, namedCredentialName);
        Set<String> suppressed = loadSuppressionKeys();
        List<ForensicFinding__c> findings = new List<ForensicFinding__c>();

        // Tier 2 — self-service detectors. May make callouts.
        try {
            for (DetectorResult r : CustomDetectorService.runAll(ctx)) {
                if (isSuppressed(suppressed, r)) continue;
                findings.add(toFindingRecord(scanId, r));
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR,
                'CustomDetectorService.runAll failed: ' + e.getMessage());
        }

        // Tier 3 Flow detectors are intentionally skipped on remote — Flows
        // don't route through Named Credentials.

        if (!findings.isEmpty()) insert findings;

        try { AttributionService.traceScan(scanId, ctx); }
        catch (Exception e) {
            System.debug(LoggingLevel.ERROR,
                'AttributionService.traceScan failed: ' + e.getMessage());
        }
        try { TrustScoreService.recompute(); }
        catch (Exception e) {
            System.debug(LoggingLevel.WARN,
                'TrustScoreService.recompute failed: ' + e.getMessage());
        }

        AggregateResult[] agg = [
            SELECT COUNT(Id) ct, SUM(GapUsd__c) totalGap
            FROM ForensicFinding__c WHERE ForensicScan__c = :scanId
        ];
        Integer findingCount = (Integer) agg[0].get('ct');
        Decimal totalLeakage = (Decimal) agg[0].get('totalGap');
        if (totalLeakage == null) totalLeakage = 0;

        ForensicScan__c scan = [
            SELECT ErrorMessage__c FROM ForensicScan__c
            WHERE Id = :scanId LIMIT 1
        ];
        update new ForensicScan__c(
            Id = scanId,
            Status__c = (scan.ErrorMessage__c != null) ? 'Partial' : 'Completed',
            CompletedAt__c = System.now(),
            TotalLeakageUsd__c = totalLeakage,
            FindingCount__c = findingCount
        );

        try { HealthScoreCalculator.computeAndStore(scanId); }
        catch (Exception e) {
            System.debug(LoggingLevel.ERROR,
                'Health score calc failed: ' + e.getMessage());
        }
    }

    /**
     * Loads the active suppression set: "detectorId|primaryRecordId" keys.
     * Suppressions are a user-convenience filter, not security-sensitive
     * data — relies on standard object/sharing access (this class is
     * `with sharing`) rather than WITH SECURITY_ENFORCED, which would
     * reject the query whenever any field FLS gap exists for the
     * running user.
     */
    @TestVisible
    private static Set<String> loadSuppressionKeys() {
        Set<String> out = new Set<String>();
        try {
            for (ForensicSuppression__c s : [
                SELECT DetectorId__c, PrimaryRecordId__c
                FROM ForensicSuppression__c]) {
                out.add(suppressionKey(s.DetectorId__c, s.PrimaryRecordId__c));
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN,
                'loadSuppressionKeys failed, treating as no suppressions: ' + e.getMessage());
        }
        return out;
    }

    @TestVisible
    private static Boolean isSuppressed(Set<String> suppressed, DetectorResult r) {
        if (suppressed == null || suppressed.isEmpty()) return false;
        String pid = (r.primaryRecord == null) ? null : r.primaryRecord.recordId;
        return suppressed.contains(suppressionKey(r.detectorId, pid));
    }

    private static String suppressionKey(String detectorId, String primaryRecordId) {
        return (detectorId == null ? '' : detectorId)
            + '|' + (String.isBlank(primaryRecordId) ? '' : primaryRecordId);
    }

    /** DetectorResult DTO → ForensicFinding__c sObject. */
    @TestVisible
    private static ForensicFinding__c toFindingRecord(Id scanId, DetectorResult r) {
        ForensicFinding__c f = new ForensicFinding__c(
            ForensicScan__c = scanId,
            DetectorId__c = r.detectorId,
            Severity__c = r.severity,
            EntitledUsd__c = r.entitledUsd,
            RealizedUsd__c = r.realizedUsd,
            GapUsd__c = r.gapUsd,
            RecoverabilityScore__c = r.recoverabilityScore,
            Title__c = r.title,
            Description__c = r.description,
            Status__c = 'Open',
            DetectedAt__c = System.now()
        );

        if (r.primaryRecord != null) {
            f.PrimaryRecordType__c = r.primaryRecord.sObjectType;
            f.PrimaryRecordId__c = r.primaryRecord.recordId;
        }

        // Serialize the full source-record graph + detector metadata
        // as JSON in Long Text Area fields. Same shape as the SaaS DB
        // columns so any code that reads SourceRecordRefs__c looks
        // identical.
        Map<String, Object> sourceRefs = new Map<String, Object>{
            'primary_record' => primaryRecordAsMap(r.primaryRecord),
            'supporting_records' => supportingRecordsAsList(r.supportingRecords)
        };
        f.SourceRecordRefs__c = JSON.serialize(sourceRefs);
        f.Metadata__c = JSON.serialize(r.metadata);

        // Phase 12 — polish the title/description into business prose
        // using the parsed metadata. Detectors keep their drafts simple;
        // FindingRenderer rewrites the engineer-y ones in one place.
        try {
            FindingRenderer.polish(f, r.metadata);
        } catch (Exception e) {
            // Polish must never block a finding from being persisted.
            System.debug(LoggingLevel.WARN,
                'FindingRenderer.polish failed: ' + e.getMessage());
        }

        // Phase 16b — render the per-detector remediation recipe so
        // every finding ships with its own fix recipe. Read by the
        // issueDetailPage LWC and the executive PDF.
        try {
            String recipe = RemediationRecipeService.render(f);
            if (String.isNotBlank(recipe)) {
                if (recipe.length() > 32768) recipe = recipe.substring(0, 32768);
                f.RemediationRecipe__c = recipe;
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN,
                'RemediationRecipeService.render failed: ' + e.getMessage());
        }

        return f;
    }

    @TestVisible
    private static Map<String, Object> primaryRecordAsMap(SourceRecord sr) {
        if (sr == null) return null;
        return new Map<String, Object>{
            'type' => sr.sObjectType,
            'id' => sr.recordId,
            'name' => sr.name,
            'financials' => sr.financials
        };
    }

    @TestVisible
    private static List<Object> supportingRecordsAsList(List<SourceRecord> list1) {
        List<Object> out = new List<Object>();
        if (list1 == null) return out;
        for (SourceRecord sr : list1) {
            out.add(primaryRecordAsMap(sr));
        }
        return out;
    }
}

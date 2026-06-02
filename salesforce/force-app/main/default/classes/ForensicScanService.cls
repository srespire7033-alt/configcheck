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

    /** Registry of detectors. Keep in sync as new detectors are added. */
    private static List<IDetector> getDetectorsFor(String productType) {
        List<IDetector> all = new List<IDetector> {
            // v1.0 — the 5 ported detectors
            new REN001RenewalUpliftDetector(),
            new REN002RenewalBelowListDetector(),
            new DSC001PromoRolloffDetector(),
            new ORD001OrderNoBillingDetector(),
            new QL001BundleZeroPriceDetector()
        };

        List<IDetector> applicable = new List<IDetector>();
        for (IDetector d : all) {
            if (d.getAppliesTo().contains(productType)) applicable.add(d);
        }
        return applicable;
    }

    /**
     * Kick off a new scan. Returns the ForensicScan__c Id immediately;
     * findings are persisted as each detector completes.
     */
    @AuraEnabled
    public static Id startScan(String productType) {
        ForensicScan__c scan = new ForensicScan__c(
            Status__c = 'Running',
            ProductType__c = productType,
            StartedAt__c = System.now()
        );
        insert scan;

        DetectorContext ctx = new DetectorContext(scan.Id, UserInfo.getDefaultCurrency(), productType);

        Decimal totalLeakage = 0;
        Integer findingCount = 0;
        List<ForensicFinding__c> findings = new List<ForensicFinding__c>();

        for (IDetector d : getDetectorsFor(productType)) {
            try {
                List<DetectorResult> results = d.run(ctx);
                for (DetectorResult r : results) {
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

        if (!findings.isEmpty()) insert findings;

        // Finalize the scan.
        scan.Status__c = (scan.ErrorMessage__c != null) ? 'Partial' : 'Completed';
        scan.CompletedAt__c = System.now();
        scan.TotalLeakageUsd__c = totalLeakage;
        scan.FindingCount__c = findingCount;
        update scan;

        return scan.Id;
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

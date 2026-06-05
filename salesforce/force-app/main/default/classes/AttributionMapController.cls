/**
 * AttributionMapController — aggregates findings by their attributed root
 * config (Price Rule, Flow, Approval Process, etc.) and returns rows
 * ranked by total $ at risk.
 *
 * Falls back to grouping by detector ID when no AttributionTrace__c rows exist.
 */
public with sharing class AttributionMapController {

    public class MapDto {
        @AuraEnabled public Integer totalRoots;
        @AuraEnabled public Decimal totalUsd;
        @AuraEnabled public List<RootRow> roots;
    }

    public class RootRow {
        @AuraEnabled public String rootConfigType;
        @AuraEnabled public String rootConfigName;
        @AuraEnabled public String rootCauseClass; // A-E
        @AuraEnabled public Integer findingCount;
        @AuraEnabled public Decimal totalUsd;
        @AuraEnabled public List<FindingRef> findings;
    }

    public class FindingRef {
        @AuraEnabled public Id id;
        @AuraEnabled public String detectorId;
        @AuraEnabled public String title;
        @AuraEnabled public Decimal gapUsd;
        @AuraEnabled public String severity;
    }

    private static final Map<String, String> ROOT_CAUSE_LABELS = new Map<String, String>{
        'A' => 'Process & system disconnect',
        'B' => 'Manual override',
        'C' => 'Conflicting automation',
        'D' => 'Missing governance',
        'E' => 'Poor data quality'
    };

    @AuraEnabled(cacheable=true)
    public static MapDto getMap() {
        MapDto dto = new MapDto();
        dto.totalRoots = 0;
        dto.totalUsd = 0;
        dto.roots = new List<RootRow>();

        List<ForensicScan__c> scans = [
            SELECT Id FROM ForensicScan__c
            WHERE Status__c IN ('Completed','Partial')
            WITH SECURITY_ENFORCED ORDER BY CompletedAt__c DESC NULLS LAST LIMIT 1
        ];
        if (scans.isEmpty()) return dto;
        Id scanId = scans[0].Id;

        // Pull traces joined with their findings
        List<AttributionTrace__c> traces = [
            SELECT Id, RootConfigType__c, RootConfigName__c, RootCauseClass__c,
                   ForensicFinding__r.Id, ForensicFinding__r.DetectorId__c,
                   ForensicFinding__r.Title__c, ForensicFinding__r.GapUsd__c,
                   ForensicFinding__r.Severity__c, ForensicFinding__r.ForensicScan__c
            FROM AttributionTrace__c
            WHERE ForensicFinding__r.ForensicScan__c = :scanId
              AND ForensicFinding__r.HiddenAt__c = null WITH SECURITY_ENFORCED ];

        if (!traces.isEmpty()) {
            Map<String, RootRow> byKey = new Map<String, RootRow>();
            for (AttributionTrace__c t : traces) {
                String name = String.isBlank(t.RootConfigName__c) ? '(unnamed)' : t.RootConfigName__c;
                String type = String.isBlank(t.RootConfigType__c) ? '(unknown)' : t.RootConfigType__c;
                String key = type + '|' + name;
                RootRow row = byKey.get(key);
                if (row == null) {
                    row = new RootRow();
                    row.rootConfigType = type;
                    row.rootConfigName = name;
                    row.rootCauseClass = ROOT_CAUSE_LABELS.containsKey(t.RootCauseClass__c)
                        ? ROOT_CAUSE_LABELS.get(t.RootCauseClass__c) : t.RootCauseClass__c;
                    row.findingCount = 0;
                    row.totalUsd = 0;
                    row.findings = new List<FindingRef>();
                    byKey.put(key, row);
                }
                FindingRef ref = new FindingRef();
                ref.id = t.ForensicFinding__r.Id;
                ref.detectorId = t.ForensicFinding__r.DetectorId__c;
                ref.title = t.ForensicFinding__r.Title__c;
                ref.gapUsd = t.ForensicFinding__r.GapUsd__c == null ? 0 : t.ForensicFinding__r.GapUsd__c;
                ref.severity = t.ForensicFinding__r.Severity__c;
                row.findings.add(ref);
                row.findingCount += 1;
                row.totalUsd += ref.gapUsd;
                dto.totalUsd += ref.gapUsd;
            }
            dto.roots = byKey.values();
        } else {
            // Fallback: group by detectorId
            Map<String, RootRow> byDet = new Map<String, RootRow>();
            for (ForensicFinding__c f : [
                SELECT Id, DetectorId__c, Title__c, GapUsd__c, Severity__c
                FROM ForensicFinding__c
                WHERE ForensicScan__c = :scanId AND HiddenAt__c = null WITH SECURITY_ENFORCED ]) {
                String key = f.DetectorId__c == null ? '—' : f.DetectorId__c;
                RootRow row = byDet.get(key);
                if (row == null) {
                    row = new RootRow();
                    row.rootConfigType = 'Detector';
                    row.rootConfigName = key;
                    row.rootCauseClass = '—';
                    row.findingCount = 0;
                    row.totalUsd = 0;
                    row.findings = new List<FindingRef>();
                    byDet.put(key, row);
                }
                FindingRef ref = new FindingRef();
                ref.id = f.Id; ref.detectorId = f.DetectorId__c; ref.title = f.Title__c;
                ref.gapUsd = f.GapUsd__c == null ? 0 : f.GapUsd__c;
                ref.severity = f.Severity__c;
                row.findings.add(ref);
                row.findingCount += 1;
                row.totalUsd += ref.gapUsd;
                dto.totalUsd += ref.gapUsd;
            }
            dto.roots = byDet.values();
        }

        // Sort each root's findings + sort roots by totalUsd desc
        for (RootRow r : dto.roots) {
            r.findings.sort(new FindingRefComparator());
        }
        dto.roots.sort(new RootRowComparator());
        dto.totalRoots = dto.roots.size();
        return dto;
    }

    public class RootRowComparator implements Comparator<RootRow> {
        public Integer compare(RootRow a, RootRow b) {
            Decimal av = a.totalUsd == null ? 0 : a.totalUsd;
            Decimal bv = b.totalUsd == null ? 0 : b.totalUsd;
            if (bv > av) return 1;
            if (bv < av) return -1;
            return 0;
        }
    }
    public class FindingRefComparator implements Comparator<FindingRef> {
        public Integer compare(FindingRef a, FindingRef b) {
            Decimal av = a.gapUsd == null ? 0 : a.gapUsd;
            Decimal bv = b.gapUsd == null ? 0 : b.gapUsd;
            if (bv > av) return 1;
            if (bv < av) return -1;
            return 0;
        }
    }
}

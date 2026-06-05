/**
 * Phase 22b-2 — 7 checks on Billing finance books and periods.
 *
 *   FB-001 — No open finance period for current date (critical, per-book)
 *   FB-002 — Gaps between finance periods (critical, per-book)
 *   FB-003 — Overlapping finance periods (critical, per-book)
 *   FB-004 — Active finance books with no periods (critical, agg)
 *   FB-005 — Prior year periods still open (warning, agg)
 *   FB-006 — No finance books at all / none active (critical, agg)
 *   FB-007 — Periods past end date still open (info, agg)
 */
public with sharing class FinanceBookChecksBundle implements IDetector {

    @TestVisible static List<Map<String, Object>> testStubBooks;
    @TestVisible static List<Map<String, Object>> testStubPeriods;

    public String getDetectorId() { return 'FB-BUNDLE'; }
    public String getLabel() { return 'Finance Book health checks'; }
    public Set<String> getAppliesTo() { return new Set<String>{ 'CPQ+Billing', 'ARM' }; }

    public List<DetectorResult> run(DetectorContext ctx) {
        List<DetectorResult> results = new List<DetectorResult>();
        List<Map<String, Object>> books;
        List<Map<String, Object>> periods;
        if (testStubBooks != null || testStubPeriods != null) {
            books = (testStubBooks != null) ? testStubBooks : new List<Map<String, Object>>();
            periods = (testStubPeriods != null) ? testStubPeriods : new List<Map<String, Object>>();
        } else {
            if (!ctx.isRemote() && !SchemaUtil.hasObject('blng__FinanceBook__c')) {
                System.debug(LoggingLevel.INFO, '[OrgPrism Skip] FB-BUNDLE: blng__FinanceBook__c not present.');
                return results;
            }
            try {
                books = OrgQueryService.query(ctx,
                    'SELECT Id, Name, blng__Active__c, ' +
                    '  (SELECT Id, Name, blng__PeriodStatus__c, blng__PeriodStartDate__c, blng__PeriodEndDate__c ' +
                    '   FROM blng__FinancePeriods__r) ' +
                    'FROM blng__FinanceBook__c LIMIT 1000');
                periods = OrgQueryService.query(ctx,
                    'SELECT Id, Name, blng__FinanceBook__c, blng__PeriodStatus__c, ' +
                    '  blng__PeriodStartDate__c, blng__PeriodEndDate__c ' +
                    'FROM blng__FinancePeriod__c LIMIT 5000');
            } catch (Exception e) {
                System.debug(LoggingLevel.WARN, '[OrgPrism Skip] FB-BUNDLE: ' + e.getMessage());
                return results;
            }
        }

        if (DetectorCatalogController.isActive('FB-001')) results.addAll(evaluateFB001(books));
        if (DetectorCatalogController.isActive('FB-002')) results.addAll(evaluateFB002(periods, books));
        if (DetectorCatalogController.isActive('FB-003')) results.addAll(evaluateFB003(periods, books));
        if (DetectorCatalogController.isActive('FB-004')) results.addAll(evaluateFB004(books, periods));
        if (DetectorCatalogController.isActive('FB-005')) results.addAll(evaluateFB005(periods));
        if (DetectorCatalogController.isActive('FB-006')) results.addAll(evaluateFB006(books));
        if (DetectorCatalogController.isActive('FB-007')) results.addAll(evaluateFB007(periods));
        return results;
    }

    static Boolean isActive(Map<String, Object> m) { return Boolean.valueOf(m.get('blng__Active__c')); }
    static SourceRecord bookRef(Map<String, Object> b) {
        return new SourceRecord('blng__FinanceBook__c', (Id) b.get('Id'), (String) b.get('Name'));
    }
    static SourceRecord periodRef(Map<String, Object> p) {
        return new SourceRecord('blng__FinancePeriod__c', (Id) p.get('Id'), (String) p.get('Name'));
    }
    static List<Map<String, Object>> periodsOf(Map<String, Object> book) {
        Object o = book.get('blng__FinancePeriods__r');
        if (o == null) return new List<Map<String, Object>>();
        Object recs = ((Map<String, Object>) o).get('records');
        if (recs == null) return new List<Map<String, Object>>();
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Object r : (List<Object>) recs) out.add((Map<String, Object>) r);
        return out;
    }
    static Date parseD(Object o) {
        if (o == null) return null;
        if (o instanceof Date) return (Date) o;
        String s = String.valueOf(o);
        if (s.length() >= 10) s = s.substring(0, 10);
        try { return Date.valueOf(s); } catch (Exception e) { return null; }
    }

    @TestVisible
    static List<DetectorResult> evaluateFB001(List<Map<String, Object>> books) {
        List<DetectorResult> out = new List<DetectorResult>();
        Date todayDate = Date.today();
        for (Map<String, Object> book : books) {
            if (!isActive(book)) continue;
            List<Map<String, Object>> periods = periodsOf(book);
            if (periods.isEmpty()) continue;  // FB-004's domain
            Boolean hasOpenCurrent = false;
            for (Map<String, Object> p : periods) {
                if (String.valueOf(p.get('blng__PeriodStatus__c')) != 'Open') continue;
                Date sd = parseD(p.get('blng__PeriodStartDate__c'));
                Date ed = parseD(p.get('blng__PeriodEndDate__c'));
                if (sd == null || ed == null) continue;
                if (sd <= todayDate && ed >= todayDate) { hasOpenCurrent = true; break; }
            }
            if (hasOpenCurrent) continue;
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'FB-001'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
            dr.title = 'No open finance period for current date in "' + (String) book.get('Name') + '"';
            dr.description = 'Finance book "' + (String) book.get('Name') +
                '" has no open period covering today (' + todayDate + '). Invoice posting will be blocked.';
            dr.primaryRecord = bookRef(book);
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateFB002(List<Map<String, Object>> periods, List<Map<String, Object>> books) {
        Map<Id, String> bookNameById = new Map<Id, String>();
        for (Map<String, Object> b : books) bookNameById.put((Id) b.get('Id'), (String) b.get('Name'));
        Map<Id, List<Map<String, Object>>> byBook = groupPeriodsByBook(periods);
        List<DetectorResult> out = new List<DetectorResult>();
        for (Id bookId : byBook.keySet()) {
            List<Map<String, Object>> sorted = sortPeriodsByStart(byBook.get(bookId));
            if (sorted.size() < 2) continue;
            List<String> gaps = new List<String>();
            for (Integer i = 1; i < sorted.size(); i++) {
                Date prevEnd = parseD(sorted[i - 1].get('blng__PeriodEndDate__c'));
                Date currStart = parseD(sorted[i].get('blng__PeriodStartDate__c'));
                if (prevEnd == null || currStart == null) continue;
                Integer daysDiff = prevEnd.daysBetween(currStart);
                if (daysDiff > 1) gaps.add(prevEnd + ' → ' + currStart);
            }
            if (gaps.isEmpty()) continue;
            String bookName = bookNameById.containsKey(bookId) ? bookNameById.get(bookId) : String.valueOf(bookId);
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'FB-002'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.85;
            dr.title = 'Finance period gaps in "' + bookName + '"';
            List<String> gapSample = new List<String>();
            Integer cap = Math.min(3, gaps.size());
            for (Integer i = 0; i < cap; i++) gapSample.add(gaps[i]);
            dr.description = gaps.size() + ' gap(s) found between finance periods: ' +
                String.join(gapSample, '; ') +
                (gaps.size() > 3 ? ' and ' + (gaps.size() - 3) + ' more' : '') + '.';
            dr.primaryRecord = new SourceRecord('blng__FinanceBook__c', bookId, bookName);
            out.add(dr);
        }
        return out;
    }

    @TestVisible
    static List<DetectorResult> evaluateFB003(List<Map<String, Object>> periods, List<Map<String, Object>> books) {
        Map<Id, String> bookNameById = new Map<Id, String>();
        for (Map<String, Object> b : books) bookNameById.put((Id) b.get('Id'), (String) b.get('Name'));
        Map<Id, List<Map<String, Object>>> byBook = groupPeriodsByBook(periods);
        List<DetectorResult> out = new List<DetectorResult>();
        for (Id bookId : byBook.keySet()) {
            List<Map<String, Object>> sorted = sortPeriodsByStart(byBook.get(bookId));
            Boolean overlapFound = false;
            for (Integer i = 1; i < sorted.size() && !overlapFound; i++) {
                Date prevEnd = parseD(sorted[i - 1].get('blng__PeriodEndDate__c'));
                Date currStart = parseD(sorted[i].get('blng__PeriodStartDate__c'));
                if (prevEnd == null || currStart == null) continue;
                if (currStart < prevEnd) overlapFound = true;
            }
            if (!overlapFound) continue;
            String bookName = bookNameById.containsKey(bookId) ? bookNameById.get(bookId) : String.valueOf(bookId);
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'FB-003'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.85;
            dr.title = 'Overlapping finance periods in "' + bookName + '"';
            dr.description = 'Overlapping finance periods detected in "' + bookName + '". Transactions may be double-posted.';
            dr.primaryRecord = new SourceRecord('blng__FinanceBook__c', bookId, bookName);
            out.add(dr);
        }
        return out;
    }

    static Map<Id, List<Map<String, Object>>> groupPeriodsByBook(List<Map<String, Object>> periods) {
        Map<Id, List<Map<String, Object>>> byBook = new Map<Id, List<Map<String, Object>>>();
        for (Map<String, Object> p : periods) {
            Object bid = p.get('blng__FinanceBook__c');
            if (bid == null) continue;
            Id key = (Id) bid;
            if (!byBook.containsKey(key)) byBook.put(key, new List<Map<String, Object>>());
            byBook.get(key).add(p);
        }
        return byBook;
    }
    static List<Map<String, Object>> sortPeriodsByStart(List<Map<String, Object>> raw) {
        List<Map<String, Object>> sorted = new List<Map<String, Object>>(raw);
        // Insertion sort by start date (small N, no Comparator needed)
        for (Integer i = 1; i < sorted.size(); i++) {
            Map<String, Object> key = sorted[i];
            Date keyD = parseD(key.get('blng__PeriodStartDate__c'));
            Integer j = i - 1;
            while (j >= 0) {
                Date jD = parseD(sorted[j].get('blng__PeriodStartDate__c'));
                if (jD == null || keyD == null || jD <= keyD) break;
                sorted[j + 1] = sorted[j];
                j--;
            }
            sorted[j + 1] = key;
        }
        return sorted;
    }

    @TestVisible
    static List<DetectorResult> evaluateFB004(List<Map<String, Object>> books, List<Map<String, Object>> periods) {
        Set<Id> booksWithPeriods = new Set<Id>();
        for (Map<String, Object> p : periods) {
            Object b = p.get('blng__FinanceBook__c');
            if (b != null) booksWithPeriods.add((Id) b);
        }
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> book : books) {
            if (!isActive(book)) continue;
            if (booksWithPeriods.contains((Id) book.get('Id'))) continue;
            bad.add(bookRef(book));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'FB-004'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = 'Active finance books with no periods';
        dr.description = bad.size() + ' active finance book(s) have no finance periods defined. No transactions can be posted.';
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(20, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateFB005(List<Map<String, Object>> periods) {
        Integer cutoffYear = Date.today().year() - 1;
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : periods) {
            if (String.valueOf(p.get('blng__PeriodStatus__c')) != 'Open') continue;
            Date ed = parseD(p.get('blng__PeriodEndDate__c'));
            if (ed == null) continue;
            if (ed.year() >= cutoffYear) continue;
            bad.add(periodRef(p));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'FB-005'; dr.severity = 'Warning'; dr.gapUsd = 0; dr.recoverabilityScore = 0.9;
        dr.title = 'Old finance periods still open';
        dr.description = bad.size() + ' finance period(s) from prior fiscal years remain open. Close after year-end reconciliation.';
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(50, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateFB006(List<Map<String, Object>> books) {
        if (books.isEmpty()) {
            DetectorResult dr = new DetectorResult();
            dr.detectorId = 'FB-006'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
            dr.title = 'No finance books found';
            dr.description = 'No finance books exist in this org. Required for billing and revenue recognition.';
            return new List<DetectorResult>{ dr };
        }
        Integer activeCount = 0;
        for (Map<String, Object> b : books) if (isActive(b)) activeCount++;
        if (activeCount > 0) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'FB-006'; dr.severity = 'Critical'; dr.gapUsd = 0; dr.recoverabilityScore = 0.95;
        dr.title = 'No active finance books';
        dr.description = 'All ' + books.size() + ' finance book(s) are inactive. At least one must be active.';
        dr.primaryRecord = bookRef(books[0]);
        for (Integer i = 1; i < books.size(); i++) dr.supportingRecords.add(bookRef(books[i]));
        return new List<DetectorResult>{ dr };
    }

    @TestVisible
    static List<DetectorResult> evaluateFB007(List<Map<String, Object>> periods) {
        Date todayDate = Date.today();
        List<SourceRecord> bad = new List<SourceRecord>();
        for (Map<String, Object> p : periods) {
            if (String.valueOf(p.get('blng__PeriodStatus__c')) != 'Open') continue;
            Date ed = parseD(p.get('blng__PeriodEndDate__c'));
            if (ed == null || !(ed < todayDate)) continue;
            bad.add(periodRef(p));
        }
        if (bad.isEmpty()) return new List<DetectorResult>();
        DetectorResult dr = new DetectorResult();
        dr.detectorId = 'FB-007'; dr.severity = 'Info'; dr.gapUsd = 0; dr.recoverabilityScore = 1.0;
        dr.title = bad.size() + ' finance period(s) past end date still open';
        dr.description = bad.size() + ' finance period(s) have ended but remain open. Best practice: close after reconciliation.';
        dr.primaryRecord = bad[0];
        Integer cap = Math.min(20, bad.size());
        for (Integer i = 1; i < cap; i++) dr.supportingRecords.add(bad[i]);
        return new List<DetectorResult>{ dr };
    }
}

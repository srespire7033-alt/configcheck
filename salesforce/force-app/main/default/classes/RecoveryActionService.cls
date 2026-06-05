/**
 * Public API for the Recovery Action state machine.
 *
 * State machine:
 *
 *           ┌────────────────────────────────────────────────────┐
 *           │                                                    │
 *           ▼                                                    │
 *      ┌─────────┐ approve  ┌──────────┐ markCommitted ┌─────────┴┐
 *      │ Pending │ ──────▶  │ Approved │ ──────────▶   │ Committed │
 *      └────┬────┘          └────┬─────┘                └──────────┘
 *           │ reject              │ reject
 *           ▼                     ▼
 *      ┌─────────┐           ┌─────────┐
 *      │Rejected │           │Rejected │
 *      └────┬────┘           └─────────┘
 *           │ restage
 *           ▼
 *      (back to Pending)
 *
 *  Expired ──restage──▶ Pending
 *  Committed ──restage──▶ Pending (un-commit; clears ApprovedAt+CommittedAt)
 *
 * Side-effects:
 *   - approve()         sets ApprovedAt__c = now
 *   - markCommitted()   sets CommittedAt__c = now
 *   - restage()         clears ApprovedAt__c + CommittedAt__c
 *   - Verification fields (CommitVerified__c, VerificationMessage__c,
 *     ExpectedValue__c, ActualValue__c) are owned by CommitVerifier
 *     downstream; methods here don't touch them except restage() which
 *     clears them.
 *
 * Idempotency:
 *   - stage() on a finding that already has a Pending/Approved/Committed
 *     action returns the existing action (no duplicate).
 *   - Other terminal states (Rejected/Expired) get reset to Pending by
 *     stage(), matching the SaaS behavior.
 *
 * All methods @AuraEnabled so they're callable from LWC.
 */
public with sharing class RecoveryActionService {

    /**
     * Stage a single finding for recovery. Creates a Pending
     * RecoveryAction__c — or resurrects a Rejected/Expired one.
     */
    @AuraEnabled
    public static Id stageFinding(Id findingId) {
        if (findingId == null) {
            throw new RecoveryException('findingId is required');
        }

        // Idempotency: if an action already exists, return its Id or
        // reset to Pending depending on its current status.
        List<RecoveryAction__c> existing = [
            SELECT Id, ApprovalStatus__c
            FROM RecoveryAction__c
            WHERE ForensicFinding__c = :findingId
            WITH SECURITY_ENFORCED ORDER BY CreatedDate DESC
            LIMIT 1
        ];

        if (!existing.isEmpty()) {
            RecoveryAction__c action = existing[0];
            String status = action.ApprovalStatus__c;
            if (status == 'Pending' || status == 'Approved' || status == 'Committed') {
                return action.Id; // already staged
            }
            // Rejected or Expired → reset to Pending.
            action.ApprovalStatus__c = 'Pending';
            action.ApprovedAt__c = null;
            action.CommittedAt__c = null;
            action.CommitVerified__c = false;
            action.VerificationMessage__c = null;
            action.ExpectedValue__c = null;
            action.ActualValue__c = null;
            update action;
            return action.Id;
        }

        // Fresh stage. Build the payload from the finding.
        ForensicFinding__c finding = loadFinding(findingId);
        RecoveryAction__c newAction = new RecoveryAction__c(
            ForensicFinding__c = findingId,
            ApprovalStatus__c = 'Pending',
            ProjectedReclaimUsd__c = computeProjectedReclaim(finding),
            DraftPayload__c = JSON.serialize(buildPayload(finding))
        );
        insert newAction;
        return newAction.Id;
    }

    /**
     * Bulk-stage many findings in one transaction. Returns a summary
     * showing how many were freshly staged vs already-staged vs reset.
     */
    @AuraEnabled
    public static Map<String, Integer> bulkStage(List<Id> findingIds) {
        if (findingIds == null || findingIds.isEmpty()) {
            throw new RecoveryException('findingIds list cannot be empty');
        }
        if (findingIds.size() > 500) {
            throw new RecoveryException('Batch limit is 500 findings; got ' + findingIds.size());
        }

        Integer staged = 0;
        Integer alreadyStaged = 0;
        Integer reset = 0;

        Set<Id> idSet = new Set<Id>(findingIds);

        // Pull existing actions in bulk.
        Map<Id, RecoveryAction__c> existingByFindingId = new Map<Id, RecoveryAction__c>();
        for (RecoveryAction__c a : [
            SELECT Id, ForensicFinding__c, ApprovalStatus__c
            FROM RecoveryAction__c
            WHERE ForensicFinding__c IN :idSet WITH SECURITY_ENFORCED ]) {
            existingByFindingId.put(a.ForensicFinding__c, a);
        }

        // Pull findings for new-stages.
        String findingsByIdSoql =
            'SELECT Id, DetectorId__c, GapUsd__c, RecoverabilityScore__c' + CurrencyContext.soqlSelect() + ', ' +
            '       Title__c, Description__c, SourceRecordRefs__c, Metadata__c ' +
            'FROM ForensicFinding__c ' +
            'WHERE Id IN :idSet WITH SECURITY_ENFORCED';
        Map<Id, ForensicFinding__c> findingsById = new Map<Id, ForensicFinding__c>(
            (List<ForensicFinding__c>) Database.query(findingsByIdSoql)
        );

        List<RecoveryAction__c> toInsert = new List<RecoveryAction__c>();
        List<RecoveryAction__c> toUpdate = new List<RecoveryAction__c>();

        for (Id fid : findingIds) {
            RecoveryAction__c a = existingByFindingId.get(fid);
            if (a != null) {
                String s = a.ApprovalStatus__c;
                if (s == 'Pending' || s == 'Approved' || s == 'Committed') {
                    alreadyStaged += 1;
                } else {
                    a.ApprovalStatus__c = 'Pending';
                    a.ApprovedAt__c = null;
                    a.CommittedAt__c = null;
                    a.CommitVerified__c = false;
                    a.VerificationMessage__c = null;
                    a.ExpectedValue__c = null;
                    a.ActualValue__c = null;
                    toUpdate.add(a);
                    reset += 1;
                }
            } else {
                ForensicFinding__c f = findingsById.get(fid);
                if (f == null) continue;
                toInsert.add(new RecoveryAction__c(
                    ForensicFinding__c = fid,
                    ApprovalStatus__c = 'Pending',
                    ProjectedReclaimUsd__c = computeProjectedReclaim(f),
                    DraftPayload__c = JSON.serialize(buildPayload(f))
                ));
                staged += 1;
            }
        }

        if (!toInsert.isEmpty()) insert toInsert;
        if (!toUpdate.isEmpty()) update toUpdate;

        return new Map<String, Integer>{
            'requested' => findingIds.size(),
            'staged' => staged,
            'alreadyStaged' => alreadyStaged,
            'reset' => reset
        };
    }

    /** Pending → Approved. Sets ApprovedAt__c = now. */
    @AuraEnabled
    public static void approve(Id actionId) {
        transition(actionId, 'Pending', 'Approved', new Map<String, Object>{
            'ApprovedAt__c' => System.now()
        });
    }

    /**
     * Pending → Rejected, or Approved → Rejected (consultant changes
     * mind after approving but before committing).
     */
    @AuraEnabled
    public static void reject(Id actionId) {
        RecoveryAction__c action = loadAction(actionId);
        if (action.ApprovalStatus__c != 'Pending' && action.ApprovalStatus__c != 'Approved') {
            throw new RecoveryException(
                'Cannot reject from state ' + action.ApprovalStatus__c +
                '. Only Pending or Approved actions can be rejected.'
            );
        }
        action.ApprovalStatus__c = 'Rejected';
        update action;
    }

    /**
     * Approved → Committed. Sets CommittedAt__c = now AND immediately
     * runs the per-detector verifier so CommitVerified__c +
     * VerificationMessage__c populate in the same transaction. The
     * consultant doesn't have to click Re-verify separately — the
     * Committed tab shows verification state the moment the action
     * lands. Re-verify remains available for later re-checks.
     *
     * Auto-verify failure (e.g. unimplemented detector, callout error)
     * never blocks the state transition — the action still becomes
     * Committed; the verification fields just stay in their previous
     * state and the manual Re-verify button remains the fallback.
     */
    @AuraEnabled
    public static Map<String, Object> markCommitted(Id actionId) {
        transition(actionId, 'Approved', 'Committed', new Map<String, Object>{
            'CommittedAt__c' => System.now()
        });
        // Phase 14a — atomic verify after commit. Returns the verdict
        // so the LWC can render a green/red badge immediately without
        // a follow-up refresh.
        try {
            return reverify(actionId);
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN,
                'Auto-verify on markCommitted failed: ' + e.getMessage());
            return new Map<String, Object>{ 'verdict' => null };
        }
    }

    /**
     * Reset a Rejected/Expired/Committed action back to Pending.
     * Clears ApprovedAt + CommittedAt + verification fields so the
     * workflow runs from the top.
     */
    @AuraEnabled
    public static void restage(Id actionId) {
        RecoveryAction__c action = loadAction(actionId);
        String s = action.ApprovalStatus__c;
        if (s != 'Rejected' && s != 'Expired' && s != 'Committed') {
            throw new RecoveryException(
                'Cannot restage from state ' + s +
                '. Only Rejected, Expired, or Committed actions can be restaged.'
            );
        }
        action.ApprovalStatus__c = 'Pending';
        action.ApprovedAt__c = null;
        action.CommittedAt__c = null;
        action.CommitVerified__c = false;
        action.VerificationMessage__c = null;
        action.ExpectedValue__c = null;
        action.ActualValue__c = null;
        update action;
    }

    // ───────────────────────────────────────────────────────────────
    // Phase 14c — Bulk approve / bulk mark-committed
    // ───────────────────────────────────────────────────────────────

    /**
     * Bulk approve. Each Pending action transitions to Approved with
     * ApprovedAt__c set. Returns counts (approved, skipped, failed)
     * and per-action verdicts. Actions not in Pending state are
     * skipped with an explanatory message — same shape as bulkReverify.
     */
    @AuraEnabled
    public static Map<String, Object> bulkApprove(List<Id> actionIds) {
        return bulkTransition(actionIds, 'Pending', 'Approved', false);
    }

    /**
     * Bulk mark-committed. Each Approved action transitions to
     * Committed AND auto-verifies in the same transaction (Phase 14a).
     * Verdicts in the return value carry the verification status
     * (verified / regressed / manual) for each action — the UI can
     * surface a per-action badge after the bulk action lands.
     */
    @AuraEnabled
    public static Map<String, Object> bulkMarkCommitted(List<Id> actionIds) {
        return bulkTransition(actionIds, 'Approved', 'Committed', true);
    }

    /**
     * Shared engine for bulk approve and bulk mark-committed.
     *
     * @param fromState  required source state ('Pending' or 'Approved')
     * @param toState    target state ('Approved' or 'Committed')
     * @param autoVerify when true (Committed transitions), run the
     *                   per-detector verifier after the state update
     *                   and write verification fields in the same
     *                   transaction.
     */
    private static Map<String, Object> bulkTransition(
        List<Id> actionIds, String fromState, String toState, Boolean autoVerify
    ) {
        if (actionIds == null || actionIds.isEmpty()) {
            return new Map<String, Object>{
                'requested' => 0, 'transitioned' => 0, 'skipped' => 0,
                'failed' => 0, 'verdicts' => new List<Object>()
            };
        }
        if (actionIds.size() > 200) {
            throw new RecoveryException('Bulk transition limit is 200 actions; got ' + actionIds.size());
        }

        List<RecoveryAction__c> actions = [
            SELECT Id, ApprovalStatus__c, ApprovedAt__c, CommittedAt__c,
                   CommitVerified__c, VerificationMessage__c,
                   ExpectedValue__c, ActualValue__c,
                   ForensicFinding__c,
                   ForensicFinding__r.DetectorId__c,
                   ForensicFinding__r.PrimaryRecordType__c,
                   ForensicFinding__r.PrimaryRecordId__c,
                   ForensicFinding__r.Title__c,
                   ForensicFinding__r.GapUsd__c,
                   ForensicFinding__r.ForensicScan__c,
                   ForensicFinding__r.ForensicScan__r.ProductType__c,
                   ForensicFinding__r.ForensicScan__r.ConnectedOrg__c,
                   ForensicFinding__r.ForensicScan__r.ConnectedOrg__r.NamedCredentialName__c
            FROM RecoveryAction__c
            WHERE Id IN :actionIds
            WITH SECURITY_ENFORCED
        ];

        Map<Id, DetectorContext> ctxByScan = new Map<Id, DetectorContext>();
        if (autoVerify) {
            for (RecoveryAction__c a : actions) {
                Id scanId = a.ForensicFinding__r.ForensicScan__c;
                if (scanId == null || ctxByScan.containsKey(scanId)) continue;
                ctxByScan.put(scanId, buildCtxForReverify(a));
            }
        }

        Integer transitioned = 0;
        Integer skipped = 0;
        List<Object> verdicts = new List<Object>();
        List<RecoveryAction__c> toUpdate = new List<RecoveryAction__c>();
        Datetime now1 = System.now();

        for (RecoveryAction__c a : actions) {
            Map<String, Object> v = new Map<String, Object>{
                'actionId' => a.Id,
                'findingTitle' => a.ForensicFinding__r.Title__c,
                'detectorId' => a.ForensicFinding__r.DetectorId__c
            };

            if (a.ApprovalStatus__c != fromState) {
                v.put('status', 'skipped');
                v.put('message', 'Action is in ' + a.ApprovalStatus__c +
                    ' state; ' + fromState + ' required for this transition.');
                verdicts.add(v);
                skipped += 1;
                continue;
            }

            a.ApprovalStatus__c = toState;
            if (toState == 'Approved' && a.ApprovedAt__c == null) {
                a.ApprovedAt__c = now1;
            } else if (toState == 'Committed' && a.CommittedAt__c == null) {
                a.CommittedAt__c = now1;
            }

            if (autoVerify) {
                ReverifyResult rr = runVerifier(a, ctxByScan.get(a.ForensicFinding__r.ForensicScan__c));
                v.put('status', rr.status);
                v.put('message', rr.message);
                if (rr.status == 'verified') {
                    a.CommitVerified__c = true;
                    a.VerificationMessage__c = rr.message;
                    a.ExpectedValue__c = rr.expected;
                    a.ActualValue__c = rr.actual;
                } else if (rr.status == 'regressed') {
                    a.CommitVerified__c = false;
                    a.VerificationMessage__c = rr.message;
                    a.ExpectedValue__c = rr.expected;
                    a.ActualValue__c = rr.actual;
                }
                // 'manual' verdicts leave verification fields alone.
            } else {
                v.put('status', 'transitioned');
                v.put('message', fromState + ' → ' + toState);
            }
            verdicts.add(v);
            toUpdate.add(a);
            transitioned += 1;
        }

        Integer failed = 0;
        if (!toUpdate.isEmpty()) {
            // Partial-success so a single trigger reject doesn't tank
            // the batch — trigger guards transitions, so a rare guard
            // hit should be surfaced as a single failed action.
            List<Database.SaveResult> srs = Database.update(toUpdate, false);
            for (Integer i = 0; i < srs.size(); i++) {
                if (!srs[i].isSuccess()) {
                    // Demote this verdict to 'failed' so the LWC can
                    // show what went wrong.
                    transitioned -= 1;
                    failed += 1;
                    // Find this action's verdict in the list and update it.
                    Id aid = toUpdate[i].Id;
                    for (Object o : verdicts) {
                        Map<String, Object> ev = (Map<String, Object>) o;
                        if (ev.get('actionId') == aid) {
                            ev.put('status', 'failed');
                            ev.put('message', srs[i].getErrors()[0].getMessage());
                            break;
                        }
                    }
                }
            }
        }

        return new Map<String, Object>{
            'requested' => actionIds.size(),
            'transitioned' => transitioned,
            'skipped' => skipped,
            'failed' => failed,
            'verdicts' => verdicts
        };
    }

    // ───────────────────────────────────────────────────────────────
    // Phase 13 — Re-verification
    // ───────────────────────────────────────────────────────────────

    /**
     * Per-action re-verification. Re-queries the source record using
     * a detector-specific check and updates CommitVerified__c +
     * VerificationMessage__c + ExpectedValue__c + ActualValue__c.
     * Only meaningful on actions in Committed state — calls on
     * non-Committed actions return a "not applicable" message.
     */
    @AuraEnabled
    public static Map<String, Object> reverify(Id actionId) {
        Map<String, Object> summary = bulkReverify(new List<Id>{ actionId });
        // Return only this action's verdict in a shape that's easy for
        // single-action UI to consume.
        List<Object> verdicts = (List<Object>) summary.get('verdicts');
        return new Map<String, Object>{
            'verdict' => verdicts.isEmpty() ? null : verdicts[0]
        };
    }

    /**
     * Bulk re-verification. Re-checks each Committed action against
     * the org and writes verification fields. Returns a summary plus
     * a per-action verdict list so the UI can show a toast like
     * "Re-verified 12 actions: 9 still resolved, 3 regressed."
     *
     * Strategy:
     *   - For each action's detector, run a small "still leaking?"
     *     SOQL keyed on the finding's PrimaryRecordId__c.
     *   - If the leak signal is gone → CommitVerified__c=true.
     *   - If the leak signal is present → CommitVerified__c=false +
     *     message explaining what regressed.
     *   - For detectors with no implemented verifier → leave the
     *     action's verification fields alone and record a
     *     "manual verification required" verdict.
     */
    @AuraEnabled
    public static Map<String, Object> bulkReverify(List<Id> actionIds) {
        if (actionIds == null || actionIds.isEmpty()) {
            return new Map<String, Object>{
                'requested' => 0, 'reverified' => 0, 'stillResolved' => 0,
                'regressed' => 0, 'skipped' => 0, 'verdicts' => new List<Object>()
            };
        }
        if (actionIds.size() > 200) {
            throw new RecoveryException('Bulk re-verify limit is 200 actions; got ' + actionIds.size());
        }

        List<RecoveryAction__c> actions = [
            SELECT Id, ApprovalStatus__c, CommitVerified__c, VerificationMessage__c,
                   ExpectedValue__c, ActualValue__c, ForensicFinding__c,
                   ForensicFinding__r.DetectorId__c,
                   ForensicFinding__r.PrimaryRecordType__c,
                   ForensicFinding__r.PrimaryRecordId__c,
                   ForensicFinding__r.Title__c,
                   ForensicFinding__r.GapUsd__c,
                   ForensicFinding__r.ForensicScan__c,
                   ForensicFinding__r.ForensicScan__r.ProductType__c,
                   ForensicFinding__r.ForensicScan__r.ConnectedOrg__c,
                   ForensicFinding__r.ForensicScan__r.ConnectedOrg__r.NamedCredentialName__c
            FROM RecoveryAction__c
            WHERE Id IN :actionIds
            WITH SECURITY_ENFORCED
        ];

        // Build a DetectorContext per scan so each verifier can route
        // through OrgQueryService. Scans without a ConnectedOrg__c
        // get a local-mode context; scans with one get a remote-mode
        // context wired to the Named Credential.
        Map<Id, DetectorContext> ctxByScan = new Map<Id, DetectorContext>();
        for (RecoveryAction__c a : actions) {
            Id scanId = a.ForensicFinding__r.ForensicScan__c;
            if (scanId == null || ctxByScan.containsKey(scanId)) continue;
            ctxByScan.put(scanId, buildCtxForReverify(a));
        }

        Integer stillResolved = 0;
        Integer regressed = 0;
        Integer skipped = 0;
        List<Object> verdicts = new List<Object>();
        List<RecoveryAction__c> toUpdate = new List<RecoveryAction__c>();

        for (RecoveryAction__c a : actions) {
            Map<String, Object> v = new Map<String, Object>{
                'actionId' => a.Id,
                'findingTitle' => a.ForensicFinding__r.Title__c,
                'detectorId' => a.ForensicFinding__r.DetectorId__c
            };

            if (a.ApprovalStatus__c != 'Committed') {
                v.put('status', 'skipped');
                v.put('message', 'Action is in ' + a.ApprovalStatus__c +
                    ' state; re-verify only applies to Committed actions.');
                verdicts.add(v);
                skipped += 1;
                continue;
            }

            DetectorContext ctx = ctxByScan.get(a.ForensicFinding__r.ForensicScan__c);
            ReverifyResult rr = runVerifier(a, ctx);
            v.put('status', rr.status);
            v.put('message', rr.message);
            verdicts.add(v);

            if (rr.status == 'verified') {
                a.CommitVerified__c = true;
                a.VerificationMessage__c = rr.message;
                a.ExpectedValue__c = rr.expected;
                a.ActualValue__c = rr.actual;
                toUpdate.add(a);
                stillResolved += 1;
            } else if (rr.status == 'regressed') {
                a.CommitVerified__c = false;
                a.VerificationMessage__c = rr.message;
                a.ExpectedValue__c = rr.expected;
                a.ActualValue__c = rr.actual;
                toUpdate.add(a);
                regressed += 1;
            } else {
                // 'manual' — no verifier implemented for this detector;
                // don't blow away whatever CommitVerified__c was. Just
                // surface the verdict in the response.
                skipped += 1;
            }
        }

        if (!toUpdate.isEmpty()) update toUpdate;

        return new Map<String, Object>{
            'requested' => actionIds.size(),
            'reverified' => actions.size(),
            'stillResolved' => stillResolved,
            'regressed' => regressed,
            'skipped' => skipped,
            'verdicts' => verdicts
        };
    }

    /** Small DTO returned by per-detector verifier methods. */
    @TestVisible
    private class ReverifyResult {
        String status;       // 'verified' | 'regressed' | 'manual'
        String message;
        String expected;
        String actual;
    }

    /**
     * Builds a DetectorContext for the scan associated with a recovery
     * action. If the scan has a ConnectedOrg__c with a Named Credential,
     * the context routes through OrgQueryService to the remote org.
     * Otherwise it's a local-mode context.
     */
    @TestVisible
    private static DetectorContext buildCtxForReverify(RecoveryAction__c a) {
        ForensicFinding__c f = a.ForensicFinding__r;
        Id scanId = f.ForensicScan__c;
        String prodType = (f.ForensicScan__r != null)
            ? (String) f.ForensicScan__r.ProductType__c : 'CPQ';
        Id connectedOrgId = (f.ForensicScan__r != null)
            ? f.ForensicScan__r.ConnectedOrg__c : null;
        String namedCred = null;
        if (connectedOrgId != null && f.ForensicScan__r.ConnectedOrg__r != null) {
            namedCred = (String) f.ForensicScan__r.ConnectedOrg__r.NamedCredentialName__c;
        }
        return new DetectorContext(
            scanId, UserInfo.getDefaultCurrency(),
            prodType == null ? 'CPQ' : prodType,
            connectedOrgId, namedCred
        );
    }

    /**
     * Detector dispatch table. Each implemented verifier returns a
     * ReverifyResult; an unknown detector returns 'manual' so the UI
     * can prompt the user to verify by hand.
     *
     * Verifiers run their re-check SOQL through OrgQueryService — so
     * the same code path works against both local host orgs (rare) and
     * remote target orgs via Named Credential (the production path).
     * SBQQ__/blng__ object availability is determined by the TARGET
     * org, not the host; the SOQL string travels over the wire.
     */
    @TestVisible
    private static ReverifyResult runVerifier(RecoveryAction__c a, DetectorContext ctx) {
        try {
            String did = a.ForensicFinding__r.DetectorId__c;
            if (did == 'ORD-FOR-001') return verifyOrderNoBilling(a, ctx);
            if (did == 'QL-FOR-001')  return verifyBundleZero(a, ctx);
            if (did == 'DSC-FOR-001') return verifyExpiredPromo(a, ctx);
            if (did == 'AMD-FOR-001') return verifyAmendmentNoDate(a, ctx);
            if (did == 'CT-FOR-001')  return verifyContractedPriceExpired(a, ctx);
            if (did == 'CON-FOR-001') return verifyContractNoSubs(a, ctx);
            return manual('No automated verifier implemented for ' + did +
                          '; re-verify by inspecting the source record.');
        } catch (Exception e) {
            return manual('Verifier raised an error: ' + e.getMessage() +
                          ' — verify manually.');
        }
    }

    /** Quote a record Id as a SOQL string literal. Defensive guard against
     *  injection even though Ids are 18-char alphanumeric by construction. */
    @TestVisible
    private static String quoteId(Id id) {
        if (id == null) return 'null';
        // Strip any non-alphanumeric defensively.
        String s = String.valueOf(id).replaceAll('[^a-zA-Z0-9]', '');
        return '\'' + s + '\'';
    }

    private static ReverifyResult verifyOrderNoBilling(RecoveryAction__c a, DetectorContext ctx) {
        Id orderId = (Id) a.ForensicFinding__r.PrimaryRecordId__c;
        if (orderId == null) return manual('Finding has no Order Id to re-check.');
        try {
            List<Map<String, Object>> rows = OrgQueryService.query(ctx,
                'SELECT Id FROM blng__BillingSchedule__c ' +
                'WHERE blng__Order__c = ' + quoteId(orderId) + ' LIMIT 1');
            if (!rows.isEmpty()) return verified(
                'Billing schedule(s) now exist for this Order.', '≥1',
                String.valueOf(rows.size()));
            return regressed('No billing schedule has been generated for this Order yet.', '≥1', '0');
        } catch (Exception e) {
            return manual('Salesforce Billing not queryable in the target org; verify manually.');
        }
    }

    private static ReverifyResult verifyBundleZero(RecoveryAction__c a, DetectorContext ctx) {
        Id lineId = (Id) a.ForensicFinding__r.PrimaryRecordId__c;
        if (lineId == null) return manual('Finding has no QuoteLine Id to re-check.');
        try {
            List<Map<String, Object>> rows = OrgQueryService.query(ctx,
                'SELECT Id, SBQQ__NetPrice__c FROM SBQQ__QuoteLine__c ' +
                'WHERE Id = ' + quoteId(lineId) + ' LIMIT 1');
            if (rows.isEmpty()) return manual('Quote Line no longer exists; verify manually.');
            Object npObj = rows[0].get('SBQQ__NetPrice__c');
            Decimal netPrice = (npObj instanceof Decimal) ? (Decimal) npObj
                              : (npObj instanceof Double) ? Decimal.valueOf((Double) npObj)
                              : (npObj instanceof Integer) ? ((Integer) npObj) + 0.0
                              : null;
            if (netPrice != null && netPrice > 0) {
                return verified('Quote Line is now priced at ' + netPrice.setScale(2) + '.',
                    '> 0', String.valueOf(netPrice));
            }
            return regressed('Quote Line is still priced at $0.', '> 0', '0');
        } catch (Exception e) {
            return manual('CPQ not queryable in the target org; verify manually.');
        }
    }

    private static ReverifyResult verifyExpiredPromo(RecoveryAction__c a, DetectorContext ctx) {
        Id lineId = (Id) a.ForensicFinding__r.PrimaryRecordId__c;
        if (lineId == null) return manual('Finding has no QuoteLine Id to re-check.');
        try {
            List<Map<String, Object>> rows = OrgQueryService.query(ctx,
                'SELECT Id, SBQQ__Discount__c FROM SBQQ__QuoteLine__c ' +
                'WHERE Id = ' + quoteId(lineId) + ' LIMIT 1');
            if (rows.isEmpty()) return manual('Quote Line no longer exists; verify manually.');
            Object discObj = rows[0].get('SBQQ__Discount__c');
            Decimal disc = (discObj instanceof Decimal) ? (Decimal) discObj
                          : (discObj instanceof Double) ? Decimal.valueOf((Double) discObj)
                          : (discObj instanceof Integer) ? ((Integer) discObj) + 0.0
                          : null;
            if (disc == null || disc == 0) {
                return verified('Discount has been removed from the Quote Line.', '0%',
                    disc == null ? 'null' : String.valueOf(disc));
            }
            return regressed('Discount of ' + disc + '% is still being applied.', '0%',
                disc + '%');
        } catch (Exception e) {
            return manual('CPQ not queryable in the target org; verify manually.');
        }
    }

    private static ReverifyResult verifyAmendmentNoDate(RecoveryAction__c a, DetectorContext ctx) {
        Id quoteId = (Id) a.ForensicFinding__r.PrimaryRecordId__c;
        if (quoteId == null) return manual('Finding has no Quote Id to re-check.');
        try {
            List<Map<String, Object>> rows = OrgQueryService.query(ctx,
                'SELECT Id, SBQQ__StartDate__c FROM SBQQ__Quote__c ' +
                'WHERE Id = ' + quoteId(quoteId) + ' LIMIT 1');
            if (rows.isEmpty()) return manual('Quote no longer exists; verify manually.');
            Object sd = rows[0].get('SBQQ__StartDate__c');
            if (sd != null) {
                return verified('Effective date has been populated on the Quote.',
                    'not null', String.valueOf(sd));
            }
            return regressed('Effective date is still missing on this Quote.',
                'not null', 'null');
        } catch (Exception e) {
            return manual('CPQ not queryable in the target org; verify manually.');
        }
    }

    private static ReverifyResult verifyContractedPriceExpired(RecoveryAction__c a, DetectorContext ctx) {
        Id cpId = (Id) a.ForensicFinding__r.PrimaryRecordId__c;
        if (cpId == null) return manual('Finding has no Contracted Price Id to re-check.');
        try {
            List<Map<String, Object>> rows = OrgQueryService.query(ctx,
                'SELECT Id, SBQQ__ExpirationDate__c FROM SBQQ__ContractedPrice__c ' +
                'WHERE Id = ' + quoteId(cpId) + ' LIMIT 1');
            if (rows.isEmpty()) {
                return verified('Contracted Price has been deleted.', 'deleted', 'deleted');
            }
            Object expObj = rows[0].get('SBQQ__ExpirationDate__c');
            Date exp = (expObj instanceof Date) ? (Date) expObj
                      : (expObj instanceof String) ? Date.valueOf((String) expObj)
                      : null;
            if (exp == null || exp >= Date.today()) {
                return verified('Contracted Price expiration has been extended or cleared.',
                    '>= today', String.valueOf(exp));
            }
            return regressed('Contracted Price is still expired (' + exp + ').',
                '>= today', String.valueOf(exp));
        } catch (Exception e) {
            return manual('CPQ not queryable in the target org; verify manually.');
        }
    }

    private static ReverifyResult verifyContractNoSubs(RecoveryAction__c a, DetectorContext ctx) {
        Id contractId = (Id) a.ForensicFinding__r.PrimaryRecordId__c;
        if (contractId == null) return manual('Finding has no Contract Id to re-check.');
        try {
            List<Map<String, Object>> contracts = OrgQueryService.query(ctx,
                'SELECT Id, Status FROM Contract WHERE Id = ' + quoteId(contractId) + ' LIMIT 1');
            if (contracts.isEmpty()) return manual('Contract no longer exists; verify manually.');
            String status = (String) contracts[0].get('Status');
            if (status != 'Activated') {
                return verified('Contract is no longer Activated (now ' + status + ').',
                    'not Activated', status);
            }
            try {
                List<Map<String, Object>> subs = OrgQueryService.query(ctx,
                    'SELECT Id FROM SBQQ__Subscription__c ' +
                    'WHERE SBQQ__Contract__c = ' + quoteId(contractId) +
                    '  AND SBQQ__EndDate__c >= TODAY LIMIT 1');
                if (!subs.isEmpty()) {
                    return verified('Contract now has at least one active subscription.', '≥1', '1');
                }
                return regressed('Contract is still Activated with zero active subscriptions.', '≥1', '0');
            } catch (Exception subErr) {
                return manual('CPQ Subscriptions not queryable; verify manually.');
            }
        } catch (Exception e) {
            return manual('Contract verification failed: ' + e.getMessage());
        }
    }

    private static ReverifyResult verified(String msg, String expected, String actual) {
        ReverifyResult r = new ReverifyResult();
        r.status = 'verified'; r.message = msg; r.expected = expected; r.actual = actual;
        return r;
    }

    private static ReverifyResult regressed(String msg, String expected, String actual) {
        ReverifyResult r = new ReverifyResult();
        r.status = 'regressed'; r.message = msg; r.expected = expected; r.actual = actual;
        return r;
    }

    private static ReverifyResult manual(String msg) {
        ReverifyResult r = new ReverifyResult();
        r.status = 'manual'; r.message = msg;
        return r;
    }

    // ───────────────────────────────────────────────────────────────
    // Helpers (private)
    // ───────────────────────────────────────────────────────────────

    /** Generic state transition with optional side-effect fields. */
    private static void transition(Id actionId, String fromState, String toState, Map<String, Object> sideEffects) {
        RecoveryAction__c action = loadAction(actionId);
        if (action.ApprovalStatus__c != fromState) {
            throw new RecoveryException(
                'Cannot transition from ' + action.ApprovalStatus__c + ' to ' + toState +
                '. Required source state: ' + fromState
            );
        }
        action.ApprovalStatus__c = toState;
        if (sideEffects != null) {
            for (String field : sideEffects.keySet()) {
                action.put(field, sideEffects.get(field));
            }
        }
        update action;
    }

    private static RecoveryAction__c loadAction(Id actionId) {
        if (actionId == null) throw new RecoveryException('actionId is required');
        List<RecoveryAction__c> rows = [
            SELECT Id, ApprovalStatus__c, ApprovedAt__c, CommittedAt__c,
                   CommitVerified__c, VerificationMessage__c,
                   ExpectedValue__c, ActualValue__c, ForensicFinding__c
            FROM RecoveryAction__c
            WHERE Id = :actionId
            WITH SECURITY_ENFORCED LIMIT 1
        ];
        if (rows.isEmpty()) {
            throw new RecoveryException('Recovery action ' + actionId + ' not found');
        }
        return rows[0];
    }

    private static ForensicFinding__c loadFinding(Id findingId) {
        String loadFindingSoql =
            'SELECT Id, DetectorId__c, GapUsd__c, RecoverabilityScore__c' + CurrencyContext.soqlSelect() + ', ' +
            '       Title__c, Description__c, SourceRecordRefs__c, Metadata__c ' +
            'FROM ForensicFinding__c ' +
            'WHERE Id = :findingId ' +
            'WITH SECURITY_ENFORCED LIMIT 1';
        List<ForensicFinding__c> rows = Database.query(loadFindingSoql);
        if (rows.isEmpty()) {
            throw new RecoveryException('Finding ' + findingId + ' not found');
        }
        return rows[0];
    }

    private static Decimal computeProjectedReclaim(ForensicFinding__c f) {
        Decimal gap = (f.GapUsd__c != null) ? f.GapUsd__c : 0;
        Decimal score = (f.RecoverabilityScore__c != null) ? f.RecoverabilityScore__c : 1;
        return gap * score;
    }

    private static Map<String, Object> buildPayload(ForensicFinding__c f) {
        return new Map<String, Object>{
            'detectorId' => f.DetectorId__c,
            'title' => f.Title__c,
            'description' => f.Description__c,
            'sourceRecordRefs' => f.SourceRecordRefs__c,
            'metadata' => f.Metadata__c
        };
    }

    /** Unchecked custom exception so AuraEnabled errors surface cleanly. */
    public class RecoveryException extends Exception {}
}

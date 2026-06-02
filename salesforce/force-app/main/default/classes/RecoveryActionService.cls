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
            ORDER BY CreatedDate DESC
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
            WHERE ForensicFinding__c IN :idSet
        ]) {
            existingByFindingId.put(a.ForensicFinding__c, a);
        }

        // Pull findings for new-stages.
        Map<Id, ForensicFinding__c> findingsById = new Map<Id, ForensicFinding__c>([
            SELECT Id, DetectorId__c, GapUsd__c, RecoverabilityScore__c, CurrencyIsoCode,
                   Title__c, Description__c, SourceRecordRefs__c, Metadata__c
            FROM ForensicFinding__c
            WHERE Id IN :idSet
        ]);

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

    /** Approved → Committed. Sets CommittedAt__c = now. Verification follows. */
    @AuraEnabled
    public static void markCommitted(Id actionId) {
        transition(actionId, 'Approved', 'Committed', new Map<String, Object>{
            'CommittedAt__c' => System.now()
        });
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
            LIMIT 1
        ];
        if (rows.isEmpty()) {
            throw new RecoveryException('Recovery action ' + actionId + ' not found');
        }
        return rows[0];
    }

    private static ForensicFinding__c loadFinding(Id findingId) {
        List<ForensicFinding__c> rows = [
            SELECT Id, DetectorId__c, GapUsd__c, RecoverabilityScore__c, CurrencyIsoCode,
                   Title__c, Description__c, SourceRecordRefs__c, Metadata__c
            FROM ForensicFinding__c
            WHERE Id = :findingId
            LIMIT 1
        ];
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

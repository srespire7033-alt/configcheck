/**
 * Trigger logic for RecoveryAction__c state machine enforcement.
 *
 * Rules enforced:
 *   - New rows must start in 'Pending' status
 *   - Status transitions follow the allowed graph in
 *     RecoveryActionService (Pending→Approved, Pending→Rejected,
 *     Approved→Committed, Approved→Rejected, Rejected→Pending,
 *     Committed→Pending, Expired→Pending)
 *   - ApprovedAt__c, CommittedAt__c cannot be cleared without
 *     transitioning back to a state that doesn't have them
 *
 * If a rule is violated, addError() is called on the record so
 * the offending DML rolls back and the user sees a clear message.
 */
public with sharing class RecoveryActionTriggerHandler {

    // Allowed transitions: oldStatus → Set<newStatus>
    private static final Map<String, Set<String>> ALLOWED = new Map<String, Set<String>>{
        'Pending'   => new Set<String>{ 'Approved', 'Rejected' },
        'Approved'  => new Set<String>{ 'Committed', 'Rejected' },
        'Rejected'  => new Set<String>{ 'Pending' },
        'Committed' => new Set<String>{ 'Pending' },     // restage
        'Expired'   => new Set<String>{ 'Pending' }
    };

    public static void handleBeforeInsert(List<RecoveryAction__c> newRecords) {
        for (RecoveryAction__c r : newRecords) {
            // Allow blank → defaults to Pending picklist default
            if (r.ApprovalStatus__c == null) {
                r.ApprovalStatus__c = 'Pending';
            } else if (r.ApprovalStatus__c != 'Pending') {
                r.addError(
                    'New recovery actions must start in Pending state, not ' +
                    r.ApprovalStatus__c
                );
            }
        }
    }

    public static void handleBeforeUpdate(
        List<RecoveryAction__c> newRecords,
        Map<Id, RecoveryAction__c> oldMap
    ) {
        for (RecoveryAction__c neu : newRecords) {
            RecoveryAction__c old = oldMap.get(neu.Id);
            if (old == null) continue;

            String fromStatus = old.ApprovalStatus__c;
            String toStatus = neu.ApprovalStatus__c;

            if (fromStatus == toStatus) continue; // no change

            Set<String> allowedTargets = ALLOWED.get(fromStatus);
            if (allowedTargets == null || !allowedTargets.contains(toStatus)) {
                neu.addError(
                    'Illegal status transition: ' + fromStatus + ' → ' + toStatus +
                    '. Allowed: ' + (allowedTargets == null ? 'none' : String.join(new List<String>(allowedTargets), ', '))
                );
                continue;
            }

            // Side-effect enforcement on specific transitions.
            if (toStatus == 'Approved' && neu.ApprovedAt__c == null) {
                neu.ApprovedAt__c = System.now();
            }
            if (toStatus == 'Committed' && neu.CommittedAt__c == null) {
                neu.CommittedAt__c = System.now();
            }
            if (toStatus == 'Pending') {
                // restage — wipe approval/commit + verification state
                neu.ApprovedAt__c = null;
                neu.CommittedAt__c = null;
                neu.CommitVerified__c = false;
                neu.VerificationMessage__c = null;
                neu.ExpectedValue__c = null;
                neu.ActualValue__c = null;
            }
        }
    }
}

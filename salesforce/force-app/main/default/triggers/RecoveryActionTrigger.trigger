/**
 * Database-level guard for the RecoveryAction__c state machine.
 *
 * The trigger is intentionally thin — all logic lives in
 * RecoveryActionTriggerHandler so it stays unit-testable without
 * the trigger event context.
 *
 * Why have a trigger at all if RecoveryActionService enforces the
 * transitions? Defense in depth: someone editing a record via
 * Workbench, Data Loader, Flow, or Apex outside the Service should
 * still be prevented from making illegal transitions. The trigger
 * is the last line of defense.
 */
trigger RecoveryActionTrigger on RecoveryAction__c (before update, before insert) {
    if (Trigger.isBefore && Trigger.isInsert) {
        RecoveryActionTriggerHandler.handleBeforeInsert(Trigger.new);
    }
    if (Trigger.isBefore && Trigger.isUpdate) {
        RecoveryActionTriggerHandler.handleBeforeUpdate(Trigger.new, Trigger.oldMap);
    }
}

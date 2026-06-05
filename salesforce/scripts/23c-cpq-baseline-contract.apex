// Phase 23c step 2 — trigger CPQ's OOTB contract+order chain on the
// OP_TEST_ baseline Quote. Setting SBQQ__Ordered__c=true on an Approved
// Quote invokes CPQ's QuoteOrderingService which creates Order, OrderItem,
// Contract, Subscription, and Asset records via cascading triggers.

SBQQ__Quote__c qt = [
  SELECT Id, SBQQ__Status__c, SBQQ__Ordered__c
  FROM SBQQ__Quote__c
  WHERE SBQQ__Opportunity2__r.Name = 'OP_TEST_Baseline_Opportunity'
  LIMIT 1
];
System.debug(LoggingLevel.INFO, 'Found Quote: ' + qt.Id + ' status=' + qt.SBQQ__Status__c
  + ' ordered=' + qt.SBQQ__Ordered__c);

qt.SBQQ__Status__c = 'Approved';
update qt;
System.debug(LoggingLevel.INFO, 'Quote → Approved');

// Pop the contracting flag. CPQ triggers create the order chain async.
qt.SBQQ__Ordered__c = true;
try {
  update qt;
  System.debug(LoggingLevel.INFO, 'Quote.SBQQ__Ordered__c=true update succeeded');
} catch (Exception e) {
  System.debug(LoggingLevel.ERROR, 'Ordered=true update failed: ' + e.getMessage());
}

// Immediate state — the async cascade may not have run yet.
Integer ord  = [SELECT COUNT() FROM Order WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer oi   = [SELECT COUNT() FROM OrderItem WHERE Order.Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer ctr  = [SELECT COUNT() FROM Contract WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer sub  = [SELECT COUNT() FROM SBQQ__Subscription__c WHERE SBQQ__Account__r.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer ast  = [SELECT COUNT() FROM Asset WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
System.debug(LoggingLevel.INFO,
  '=== Immediate post-order: Order=' + ord + ' OI=' + oi + ' Contract=' + ctr
  + ' Sub=' + sub + ' Asset=' + ast + ' (async may still be in flight) ===');

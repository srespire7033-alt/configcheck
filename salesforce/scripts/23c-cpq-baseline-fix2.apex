// Phase 23c step 4 — wire existing Billing/Tax/GL/RevRec rules onto
// OP_TEST_Software_License and retry the contract flip.

Product2 p = [SELECT Id FROM Product2 WHERE Name = 'OP_TEST_Software_License' LIMIT 1];

// Pick first of each rule type.
blng__BillingRule__c br             = [SELECT Id FROM blng__BillingRule__c LIMIT 1];
blng__TaxRule__c tx                 = [SELECT Id FROM blng__TaxRule__c LIMIT 1];
blng__GLRule__c gl                  = [SELECT Id FROM blng__GLRule__c LIMIT 1];
blng__RevenueRecognitionRule__c rr  = [SELECT Id FROM blng__RevenueRecognitionRule__c LIMIT 1];

// Dynamic put so any missing field on a custom Product2 doesn't break compile
SObject sob = (SObject) p;
sob.put('blng__BillingRule__c', br.Id);
sob.put('blng__TaxRule__c', tx.Id);
sob.put('blng__RevenueRecognitionRule__c', rr.Id);
// GL Rule lookup isn't on Product2 — applied at transaction (Order/OrderItem) layer.
try { update sob; System.debug('Product wired to Billing/Tax/GL/RevRec'); }
catch (Exception e) { System.debug('Product update err: ' + e.getMessage()); }

// Now retry the order flip.
SBQQ__Quote__c qt = [
  SELECT Id, SBQQ__Status__c, SBQQ__Ordered__c
  FROM SBQQ__Quote__c
  WHERE SBQQ__Opportunity2__r.Name = 'OP_TEST_Baseline_Opportunity' LIMIT 1
];
qt.SBQQ__Ordered__c = true;
try { update qt; System.debug('Quote.SBQQ__Ordered__c=true OK'); }
catch (Exception e) { System.debug('Order flip err: ' + e.getMessage()); }

// Cascade may be async — check immediate state.
Integer ord  = [SELECT COUNT() FROM Order WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer oi   = [SELECT COUNT() FROM OrderItem WHERE Order.Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer ctr  = [SELECT COUNT() FROM Contract WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer sub  = [SELECT COUNT() FROM SBQQ__Subscription__c WHERE SBQQ__Account__r.Name = 'OP_TEST_Baseline_Healthy_Account'];
System.debug('Post-flip immediate: Order=' + ord + ' OI=' + oi + ' Contract=' + ctr + ' Sub=' + sub);

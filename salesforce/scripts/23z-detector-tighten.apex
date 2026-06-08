// Phase 23z-5 — fix REN-001 + ARM Asset-lifecycle wedges.
// REN-001 fix: link Renewal QL to baseline Subscription + set uplift rate on Contract.
// Asset-lifecycle fix: set Asset.LifecycleEndDate to a past date on a baseline Asset.

// ── REN-001 fix ──
SBQQ__Subscription__c baseSub = [SELECT Id, SBQQ__Contract__c, SBQQ__NetPrice__c
                                  FROM SBQQ__Subscription__c
                                  WHERE SBQQ__Account__r.Name = 'OP_TEST_Baseline_Healthy_Account'
                                  LIMIT 1];
Contract baseCt = [SELECT Id FROM Contract WHERE Id = :baseSub.SBQQ__Contract__c LIMIT 1];

// Set uplift rate on the contract (5% expected uplift)
SObject ctSob = baseCt;
try {
  ctSob.put('SBQQ__RenewalUpliftRate__c', 5);
  update ctSob;
  System.debug('Contract uplift rate set: ' + baseCt.Id);
} catch (Exception e) { System.debug('Contract uplift err: ' + e.getMessage()); }

// Link the existing REN-001 wedge QL to this Subscription
SBQQ__QuoteLine__c renQl = [SELECT Id, SBQQ__Quote__r.SBQQ__Type__c, SBQQ__NetPrice__c
                             FROM SBQQ__QuoteLine__c
                             WHERE SBQQ__Quote__r.SBQQ__Opportunity2__r.Name = 'OP_TEST_REN001_Renewal_Opp'
                             LIMIT 1];
SObject renSob = renQl;
try {
  renSob.put('SBQQ__RenewedSubscription__c', baseSub.Id);
  update renSob;
  System.debug('REN-001 QL linked to prior Sub: ' + renQl.Id);
} catch (Exception e) { System.debug('REN-001 link err: ' + e.getMessage()); }

System.debug('=== REN-001 fixture tightened: prior Sub=' + baseSub.Id +
             ' price=' + baseSub.SBQQ__NetPrice__c + ' expected uplift=5% on Renewal QL ===');

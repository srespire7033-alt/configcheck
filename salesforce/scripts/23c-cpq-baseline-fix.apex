// Phase 23c repair — validation "To continue, enter a charge type." blocked
// the Ordered=true update. Set SBQQ__ChargeType__c='Recurring' on the
// QuoteLine (and ensure Quote has it if there's a quote-level field) and
// retry the contracting flip.

SBQQ__QuoteLine__c ql = [
  SELECT Id, SBQQ__ChargeType__c
  FROM SBQQ__QuoteLine__c
  WHERE SBQQ__Quote__r.SBQQ__Opportunity2__r.Name = 'OP_TEST_Baseline_Opportunity'
  LIMIT 1
];
System.debug('QL.ChargeType before: ' + ql.SBQQ__ChargeType__c);
ql.SBQQ__ChargeType__c = 'Recurring';
ql.SBQQ__BillingType__c = 'Advance';
ql.SBQQ__BillingFrequency__c = 'Monthly';
try { update ql; System.debug('QL.ChargeType+BillingType set ok'); }
catch (Exception e) { System.debug('QL update err: ' + e.getMessage()); }

// Check if Quote has a charge-type field
Schema.DescribeSObjectResult qd = SBQQ__Quote__c.SObjectType.getDescribe();
Boolean hasQuoteCT = qd.fields.getMap().containsKey('SBQQ__ChargeType__c');
System.debug('Quote has SBQQ__ChargeType__c? ' + hasQuoteCT);

SBQQ__Quote__c qt = [
  SELECT Id FROM SBQQ__Quote__c
  WHERE SBQQ__Opportunity2__r.Name = 'OP_TEST_Baseline_Opportunity' LIMIT 1
];

if (hasQuoteCT) {
  SBQQ__Quote__c upd = new SBQQ__Quote__c(Id = qt.Id);
  upd.put('SBQQ__ChargeType__c', 'Recurring');
  try { update upd; System.debug('Quote charge-type set'); } catch (Exception e) { System.debug('Quote CT err: ' + e.getMessage()); }
}

// Retry ordering
qt.SBQQ__Ordered__c = true;
try { update qt; System.debug('Quote ordered=true OK'); }
catch (Exception e) { System.debug('Quote ordered=true STILL FAILED: ' + e.getMessage()); }

Integer ord  = [SELECT COUNT() FROM Order WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer oi   = [SELECT COUNT() FROM OrderItem WHERE Order.Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer ctr  = [SELECT COUNT() FROM Contract WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
System.debug('After: Order=' + ord + ' OI=' + oi + ' Contract=' + ctr);

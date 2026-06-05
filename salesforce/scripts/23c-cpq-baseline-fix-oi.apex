// Phase 23c step 6 — set default subscription term on OrderItem so activation passes.

OrderItem oi = [SELECT Id, SBQQ__SubscriptionTerm__c FROM OrderItem WHERE Order.Account.Name = 'OP_TEST_Baseline_Healthy_Account' LIMIT 1];
System.debug('OI before term=' + oi.SBQQ__SubscriptionTerm__c);
oi.SBQQ__SubscriptionTerm__c = 12;
oi.SBQQ__DefaultSubscriptionTerm__c = 12;
try { update oi; System.debug('OI term set'); }
catch (Exception e) { System.debug('OI update err: ' + e.getMessage()); }

Order o = [SELECT Id, Status FROM Order WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account' LIMIT 1];
o.Status = 'Activated';
try { update o; System.debug('Order activated OK'); }
catch (Exception e) { System.debug('Activate err: ' + e.getMessage()); }

// Now mark contracted
SObject ord = [SELECT Id FROM Order WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account' LIMIT 1];
ord.put('SBQQ__Contracted__c', true);
try { update ord; System.debug('Contracted=true OK'); }
catch (Exception e) { System.debug('Contracted err: ' + e.getMessage()); }

Integer ordN  = [SELECT COUNT() FROM Order WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer oiN   = [SELECT COUNT() FROM OrderItem WHERE Order.Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer ctrN  = [SELECT COUNT() FROM Contract WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer subN  = [SELECT COUNT() FROM SBQQ__Subscription__c WHERE SBQQ__Account__r.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer astN  = [SELECT COUNT() FROM Asset WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
System.debug('=== Final: Order=' + ordN + ' OI=' + oiN + ' Contract=' + ctrN + ' Sub=' + subN + ' Asset=' + astN);

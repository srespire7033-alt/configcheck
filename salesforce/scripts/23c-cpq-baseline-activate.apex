// Phase 23c step 5 — activate the OP_TEST_ Order to fire Contract + Sub + Asset cascade.

Order o = [SELECT Id, Status, AccountId FROM Order WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account' LIMIT 1];
System.debug('Order before: ' + o.Status);
o.Status = 'Activated';
try { update o; System.debug('Order activated OK'); }
catch (Exception e) { System.debug('Activation err: ' + e.getMessage()); }

// Force contracting via Order — if needed, set SBQQ__Contracted__c=true
SObject ord = (SObject) [SELECT Id FROM Order WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account' LIMIT 1];
Schema.DescribeSObjectResult od = Order.SObjectType.getDescribe();
if (od.fields.getMap().containsKey('SBQQ__Contracted__c')) {
  ord.put('SBQQ__Contracted__c', true);
  try { update ord; System.debug('Order.SBQQ__Contracted__c=true OK'); }
  catch (Exception e) { System.debug('Order Contracted err: ' + e.getMessage()); }
}

// State check
Integer ordN  = [SELECT COUNT() FROM Order WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer oiN   = [SELECT COUNT() FROM OrderItem WHERE Order.Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer ctrN  = [SELECT COUNT() FROM Contract WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer subN  = [SELECT COUNT() FROM SBQQ__Subscription__c WHERE SBQQ__Account__r.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer astN  = [SELECT COUNT() FROM Asset WHERE Account.Name = 'OP_TEST_Baseline_Healthy_Account'];
Integer bsN = 0;
try { bsN = Database.countQuery('SELECT COUNT() FROM blng__BillingSchedule__c'); } catch (Exception e) {}
System.debug('=== Post-activate: Order=' + ordN + ' OI=' + oiN + ' Contract=' + ctrN + ' Sub=' + subN + ' Asset=' + astN + ' BSched(total)=' + bsN);

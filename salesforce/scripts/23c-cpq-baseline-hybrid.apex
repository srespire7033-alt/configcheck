// Phase 23c finishing pass — hybrid OOTB + direct insert.
// Adds Contract + Subscription + Asset to complete the chain that
// CPQ contracting wouldn't auto-create in this org's config.

Account a = [SELECT Id FROM Account WHERE Name = 'OP_TEST_Baseline_Healthy_Account' LIMIT 1];
Order o   = [SELECT Id FROM Order WHERE AccountId = :a.Id LIMIT 1];
OrderItem oi = [SELECT Id, Product2Id, Quantity, UnitPrice FROM OrderItem WHERE OrderId = :o.Id LIMIT 1];
Product2 p = [SELECT Id FROM Product2 WHERE Name = 'OP_TEST_Software_License' LIMIT 1];
SBQQ__Quote__c q = [SELECT Id FROM SBQQ__Quote__c WHERE SBQQ__Opportunity2__r.Name = 'OP_TEST_Baseline_Opportunity' LIMIT 1];

// Contract — direct insert
Contract ct = new Contract(
  AccountId = a.Id,
  Status = 'Draft',
  StartDate = Date.today(),
  ContractTerm = 12
);
insert ct;
ct.Status = 'Activated';
try { update ct; System.debug('Contract activated: ' + ct.Id); }
catch (Exception e) { System.debug('Contract activate err: ' + e.getMessage()); }

// Subscription — direct insert
SBQQ__Subscription__c sub = new SBQQ__Subscription__c(
  SBQQ__Account__c = a.Id,
  SBQQ__Contract__c = ct.Id,
  SBQQ__Product__c = p.Id,
  SBQQ__Quantity__c = oi.Quantity,
  SBQQ__ListPrice__c = oi.UnitPrice,
  SBQQ__NetPrice__c = oi.UnitPrice,
  SBQQ__SubscriptionStartDate__c = Date.today(),
  SBQQ__SubscriptionEndDate__c = Date.today().addMonths(12),
  // SBQQ__SubscriptionType__c omitted — org's restricted picklist rejects 'Renewable'.
  SBQQ__SubscriptionPricing__c = 'Fixed Price',
  SBQQ__ChargeType__c = 'Recurring',
  SBQQ__BillingFrequency__c = 'Monthly',
  SBQQ__BillingType__c = 'Advance',
  SBQQ__OrderProduct__c = oi.Id,
  SBQQ__QuoteLine__c = [SELECT Id FROM SBQQ__QuoteLine__c WHERE SBQQ__Quote__c = :q.Id LIMIT 1].Id
);
try { insert sub; System.debug('Subscription: ' + sub.Id); }
catch (Exception e) { System.debug('Sub insert err: ' + e.getMessage()); }

// Asset
Asset ast = new Asset(
  AccountId = a.Id,
  Product2Id = p.Id,
  Name = 'OP_TEST_Baseline_Asset',
  Quantity = oi.Quantity,
  Price = oi.UnitPrice,
  Status = 'Installed',
  InstallDate = Date.today(),
  PurchaseDate = Date.today()
);
try { insert ast; System.debug('Asset: ' + ast.Id); }
catch (Exception e) { System.debug('Asset insert err: ' + e.getMessage()); }

Integer ctN  = [SELECT COUNT() FROM Contract WHERE AccountId = :a.Id];
Integer subN = [SELECT COUNT() FROM SBQQ__Subscription__c WHERE SBQQ__Account__c = :a.Id];
Integer astN = [SELECT COUNT() FROM Asset WHERE AccountId = :a.Id];
System.debug('=== Hybrid baseline final: Contract=' + ctN + ' Sub=' + subN + ' Asset=' + astN);

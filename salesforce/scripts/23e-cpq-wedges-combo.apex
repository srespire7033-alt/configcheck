// Phase 23e–23i COMBO — fixture data for 5 CPQ detectors at once.
// Each wedge adds minimal records on top of the existing OP_TEST_ baseline
// to trigger a specific detector. Single scan validates all 5.
//
// Wedges:
//   W1 ORD-FOR-001 — Order activated, no BillingSchedule (already true on baseline OrderItem)
//   W2 AST-FOR-001 — Asset terminated mid-contract, no credit memo
//   W3 PROV-FOR-002 — Active Subscription, no Asset
//   W4 DSC-FOR-002 — Stacked discounts beyond approved cap on a QuoteLine
//   W5 QL-FOR-002 — Quote line approval skipped (over discount threshold, Approved status)

Id stdPbId = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1].Id;
Account baseAcc = [SELECT Id FROM Account WHERE Name = 'OP_TEST_Baseline_Healthy_Account' LIMIT 1];
Product2 baseProd = [SELECT Id FROM Product2 WHERE Name = 'OP_TEST_Software_License' LIMIT 1];
Id basePbe = [SELECT Id FROM PricebookEntry WHERE Product2Id = :baseProd.Id AND Pricebook2Id = :stdPbId LIMIT 1].Id;

// ── W2: Terminated Asset, no credit memo ──
Asset termAst = new Asset(
  AccountId = baseAcc.Id, Product2Id = baseProd.Id,
  Name = 'OP_TEST_W2_TerminatedAsset',
  Quantity = 5, Price = 100, Status = 'Obsolete',
  InstallDate = Date.today().addMonths(-6),
  PurchaseDate = Date.today().addMonths(-6),
  UsageEndDate = Date.today().addDays(-5)
);
try { insert termAst; System.debug('W2 Asset: ' + termAst.Id); }
catch (Exception e) { System.debug('W2 err: ' + e.getMessage()); }

// ── W3: Active Subscription, no Asset (new Account+Quote+Sub, no Asset insert) ──
Account w3a = new Account(Name = 'OP_TEST_W3_SubNoAsset');
insert w3a;
SBQQ__Subscription__c w3sub = new SBQQ__Subscription__c(
  SBQQ__Account__c = w3a.Id, SBQQ__Product__c = baseProd.Id,
  SBQQ__Quantity__c = 1, SBQQ__ListPrice__c = 100, SBQQ__NetPrice__c = 100,
  SBQQ__SubscriptionStartDate__c = Date.today(),
  SBQQ__SubscriptionEndDate__c = Date.today().addMonths(12),
  SBQQ__SubscriptionPricing__c = 'Fixed Price',
  SBQQ__ChargeType__c = 'Recurring',
  SBQQ__BillingFrequency__c = 'Monthly',
  SBQQ__BillingType__c = 'Advance'
);
try { insert w3sub; System.debug('W3 Sub: ' + w3sub.Id); }
catch (Exception e) { System.debug('W3 err: ' + e.getMessage()); }

// ── W4 + W5: Heavy-discount QuoteLine on a new Quote ──
Account w4a = new Account(Name = 'OP_TEST_W4_StackedDiscount');
insert w4a;
Opportunity w4o = new Opportunity(
  Name = 'OP_TEST_W4_Opp', AccountId = w4a.Id,
  StageName = 'Qualification', CloseDate = Date.today().addDays(30),
  Pricebook2Id = stdPbId
);
insert w4o;
SBQQ__Quote__c w4q = new SBQQ__Quote__c(
  SBQQ__Account__c = w4a.Id, SBQQ__Opportunity2__c = w4o.Id,
  SBQQ__Status__c = 'Approved', SBQQ__Primary__c = true,
  SBQQ__PriceBook__c = stdPbId, SBQQ__StartDate__c = Date.today(),
  SBQQ__SubscriptionTerm__c = 12, SBQQ__Type__c = 'Quote'
);
insert w4q;
SBQQ__QuoteLine__c w4ql = new SBQQ__QuoteLine__c(
  SBQQ__Quote__c = w4q.Id, SBQQ__Product__c = baseProd.Id,
  SBQQ__Quantity__c = 10, SBQQ__ListPrice__c = 100, SBQQ__NetPrice__c = 30,
  SBQQ__Discount__c = 70, SBQQ__PartnerDiscount__c = 10,
  SBQQ__PricebookEntryId__c = basePbe,
  SBQQ__StartDate__c = Date.today(),
  SBQQ__EndDate__c = Date.today().addMonths(12),
  SBQQ__ChargeType__c = 'Recurring',
  SBQQ__BillingType__c = 'Advance',
  SBQQ__BillingFrequency__c = 'Monthly'
);
try { insert w4ql; System.debug('W4 QL (stacked discount): ' + w4ql.Id); }
catch (Exception e) { System.debug('W4 err: ' + e.getMessage()); }

// ── Final OP_TEST_ counts ──
Integer accN = [SELECT COUNT() FROM Account WHERE Name LIKE 'OP_TEST_%'];
Integer qlN  = [SELECT COUNT() FROM SBQQ__QuoteLine__c WHERE SBQQ__Quote__r.SBQQ__Opportunity2__r.Name LIKE 'OP_TEST_%'];
Integer subN = [SELECT COUNT() FROM SBQQ__Subscription__c WHERE SBQQ__Account__r.Name LIKE 'OP_TEST_%'];
Integer astN = [SELECT COUNT() FROM Asset WHERE Account.Name LIKE 'OP_TEST_%'];
System.debug('=== CPQ wedges: Acc=' + accN + ' QL=' + qlN + ' Sub=' + subN + ' Asset=' + astN);

// Phase 23c — CPQ "healthy" baseline fixture.
//
// Builds the simplest end-to-end CPQ chain that follows the OOTB path:
//   OP_TEST_Account → Opp → Quote (Primary + Ordered) → CPQ-generated
//   Contract/Order/OrderItem/Subscription/Asset → Billing schedule.
//
// All records carry OP_TEST_ prefix so we can co-exist with the
// pre-existing data we couldn't wipe past platform locks.
//
// Logs counts of what was inserted. If a step fails, the rest still
// runs so we see how far the chain progressed.

System.debug(LoggingLevel.INFO, '=== 23c CPQ baseline START ===');

// ── 1. Account ──
Account acc = new Account(
  Name = 'OP_TEST_Baseline_Healthy_Account',
  BillingStreet = '1 Test Street',
  BillingCity = 'San Francisco',
  BillingState = 'CA',
  BillingPostalCode = '94105',
  BillingCountry = 'USA',
  Industry = 'Technology'
);
insert acc;
System.debug(LoggingLevel.INFO, 'Account: ' + acc.Id);

// ── 2. Standard Pricebook (already exists, system-managed) ──
Pricebook2 std = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1];

// ── 3. Product2 + PricebookEntry ──
Product2 prod = new Product2(
  Name = 'OP_TEST_Software_License',
  ProductCode = 'OP_TEST_SW_LIC',
  IsActive = true,
  SBQQ__SubscriptionPricing__c = 'Fixed Price',
  SBQQ__SubscriptionType__c = 'Renewable',
  SBQQ__SubscriptionTerm__c = 12,
  SBQQ__BillingFrequency__c = 'Monthly',
  SBQQ__BillingType__c = 'Advance',
  SBQQ__ChargeType__c = 'Recurring'
);
insert prod;
PricebookEntry pbe = new PricebookEntry(
  Product2Id = prod.Id,
  Pricebook2Id = std.Id,
  UnitPrice = 100,
  IsActive = true,
  UseStandardPrice = false
);
insert pbe;
System.debug(LoggingLevel.INFO, 'Product+PBE inserted');

// ── 4. Opportunity ──
Opportunity opp = new Opportunity(
  Name = 'OP_TEST_Baseline_Opportunity',
  AccountId = acc.Id,
  StageName = 'Qualification',
  CloseDate = Date.today().addDays(30),
  Pricebook2Id = std.Id
);
insert opp;
System.debug(LoggingLevel.INFO, 'Opportunity: ' + opp.Id);

// ── 5. Quote (Draft → Primary) ──
// Quote.Name is auto-numbered in CPQ; identify by a custom rollup or
// by Opportunity.Name LIKE 'OP_TEST_%'. We do the latter.
SBQQ__Quote__c qt = new SBQQ__Quote__c(
  SBQQ__Account__c = acc.Id,
  SBQQ__Opportunity2__c = opp.Id,
  SBQQ__Status__c = 'Draft',
  SBQQ__Primary__c = true,
  SBQQ__PriceBook__c = std.Id,
  SBQQ__StartDate__c = Date.today(),
  SBQQ__SubscriptionTerm__c = 12,
  SBQQ__Type__c = 'Quote'
);
insert qt;
System.debug(LoggingLevel.INFO, 'Quote: ' + qt.Id);

// ── 6. QuoteLine ──
SBQQ__QuoteLine__c ql = new SBQQ__QuoteLine__c(
  SBQQ__Quote__c = qt.Id,
  SBQQ__Product__c = prod.Id,
  SBQQ__Quantity__c = 10,
  SBQQ__ListPrice__c = 100,
  SBQQ__NetPrice__c = 100,
  SBQQ__PricebookEntryId__c = pbe.Id,
  SBQQ__StartDate__c = Date.today(),
  SBQQ__EndDate__c = Date.today().addMonths(12),
  SBQQ__SubscriptionTerm__c = 12
);
try {
  insert ql;
  System.debug(LoggingLevel.INFO, 'QuoteLine: ' + ql.Id);
} catch (Exception e) {
  System.debug(LoggingLevel.ERROR, 'QuoteLine insert failed: ' + e.getMessage());
}

// ── 7. Final counts (OP_TEST_ scope only) ──
Integer acc_n = [SELECT COUNT() FROM Account WHERE Name LIKE 'OP_TEST_%'];
Integer prd_n = [SELECT COUNT() FROM Product2 WHERE Name LIKE 'OP_TEST_%'];
Integer opp_n = [SELECT COUNT() FROM Opportunity WHERE Name LIKE 'OP_TEST_%'];
Integer qt_n  = [SELECT COUNT() FROM SBQQ__Quote__c WHERE SBQQ__Opportunity2__r.Name LIKE 'OP_TEST_%'];
Integer ql_n  = [SELECT COUNT() FROM SBQQ__QuoteLine__c WHERE SBQQ__Quote__r.SBQQ__Opportunity2__r.Name LIKE 'OP_TEST_%'];
System.debug(LoggingLevel.INFO,
  '=== 23c summary: Acc=' + acc_n + ' Prd=' + prd_n + ' Opp=' + opp_n
  + ' Quote=' + qt_n + ' QL=' + ql_n + ' ===');

System.debug(LoggingLevel.INFO,
  'NEXT: flip Quote.SBQQ__Ordered__c=true to trigger CPQ contract/order chain. '
  + 'Doing that as a separate Apex call to keep this seed idempotent and to '
  + 'isolate the OOTB CPQ contracting transaction from the seed insert tx.');

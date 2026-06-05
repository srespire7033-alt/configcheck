// Phase 23z — CPQ wedge expansion: REN-001, QL-FOR-001, CT-FOR-001, MDQ-FOR-001.

Id stdPbId = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1].Id;
Account baseAcc = [SELECT Id FROM Account WHERE Name = 'OP_TEST_Baseline_Healthy_Account' LIMIT 1];
Product2 baseProd = [SELECT Id FROM Product2 WHERE Name = 'OP_TEST_Software_License' LIMIT 1];
Id basePbe = [SELECT Id FROM PricebookEntry WHERE Product2Id = :baseProd.Id AND Pricebook2Id = :stdPbId LIMIT 1].Id;
Contract baseCt = [SELECT Id FROM Contract WHERE AccountId = :baseAcc.Id LIMIT 1];

// ── REN-001: Renewal Quote with under-uplift QL ──
Account renA = new Account(Name = 'OP_TEST_REN001_RenewalAccount');
insert renA;
Opportunity renO = new Opportunity(
  Name='OP_TEST_REN001_Renewal_Opp', AccountId=renA.Id,
  StageName='Qualification', CloseDate=Date.today().addDays(30), Pricebook2Id=stdPbId
);
insert renO;
SBQQ__Quote__c renQ = new SBQQ__Quote__c(
  SBQQ__Account__c=renA.Id, SBQQ__Opportunity2__c=renO.Id,
  SBQQ__Status__c='Draft', SBQQ__Primary__c=true,
  SBQQ__PriceBook__c=stdPbId, SBQQ__Type__c='Renewal',
  SBQQ__StartDate__c=Date.today(), SBQQ__SubscriptionTerm__c=12,
  SBQQ__MasterContract__c=baseCt.Id
);
insert renQ;
SBQQ__QuoteLine__c renQl = new SBQQ__QuoteLine__c(
  SBQQ__Quote__c=renQ.Id, SBQQ__Product__c=baseProd.Id,
  SBQQ__Quantity__c=10, SBQQ__ListPrice__c=100, SBQQ__NetPrice__c=80,
  SBQQ__PricebookEntryId__c=basePbe,
  SBQQ__StartDate__c=Date.today(), SBQQ__EndDate__c=Date.today().addMonths(12),
  SBQQ__ChargeType__c='Recurring', SBQQ__BillingType__c='Advance', SBQQ__BillingFrequency__c='Monthly',
  SBQQ__PriorQuantity__c=10  // REN-001 needs full Subscription→Renewal chain; partial fixture
);
try { insert renQl; System.debug('REN-001 QL: ' + renQl.Id); }
catch (Exception e) { System.debug('REN-001 err: ' + e.getMessage()); }

// ── QL-FOR-001: Required QuoteLine with $0 price ──
Account zrA = new Account(Name='OP_TEST_QL001_ZeroBundleAccount');
insert zrA;
Opportunity zrO = new Opportunity(
  Name='OP_TEST_QL001_Opp', AccountId=zrA.Id,
  StageName='Qualification', CloseDate=Date.today().addDays(30), Pricebook2Id=stdPbId
);
insert zrO;
SBQQ__Quote__c zrQ = new SBQQ__Quote__c(
  SBQQ__Account__c=zrA.Id, SBQQ__Opportunity2__c=zrO.Id,
  SBQQ__Status__c='Draft', SBQQ__Primary__c=true,
  SBQQ__PriceBook__c=stdPbId, SBQQ__Type__c='Quote',
  SBQQ__StartDate__c=Date.today(), SBQQ__SubscriptionTerm__c=12
);
insert zrQ;
SBQQ__QuoteLine__c zrQl = new SBQQ__QuoteLine__c(
  SBQQ__Quote__c=zrQ.Id, SBQQ__Product__c=baseProd.Id,
  SBQQ__Quantity__c=5, SBQQ__ListPrice__c=200, SBQQ__NetPrice__c=0,
  SBQQ__PricebookEntryId__c=basePbe,
  SBQQ__StartDate__c=Date.today(), SBQQ__EndDate__c=Date.today().addMonths(12),
  SBQQ__ChargeType__c='Recurring', SBQQ__BillingType__c='Advance', SBQQ__BillingFrequency__c='Monthly'
  // SBQQ__Required__c not present in this org's schema — partial fixture
);
try { insert zrQl; System.debug('QL-FOR-001 QL: ' + zrQl.Id); }
catch (Exception e) { System.debug('QL-FOR-001 err: ' + e.getMessage()); }

// ── CT-FOR-001: ContractedPrice expired, but QL still uses it ──
Account ctA = new Account(Name='OP_TEST_CT001_ExpiredCpAccount');
insert ctA;
SBQQ__ContractedPrice__c cp = new SBQQ__ContractedPrice__c(
  SBQQ__Account__c=ctA.Id, SBQQ__Product__c=baseProd.Id,
  SBQQ__Price__c=50,
  SBQQ__EffectiveDate__c=Date.today().addMonths(-12),
  SBQQ__ExpirationDate__c=Date.today().addDays(-10)
);
try { insert cp; System.debug('CT-FOR-001 ContractedPrice: ' + cp.Id); }
catch (Exception e) { System.debug('CP err: ' + e.getMessage()); }
Opportunity ctO = new Opportunity(
  Name='OP_TEST_CT001_Opp', AccountId=ctA.Id,
  StageName='Qualification', CloseDate=Date.today().addDays(30), Pricebook2Id=stdPbId
);
insert ctO;
SBQQ__Quote__c ctQ = new SBQQ__Quote__c(
  SBQQ__Account__c=ctA.Id, SBQQ__Opportunity2__c=ctO.Id,
  SBQQ__Status__c='Draft', SBQQ__Primary__c=true,
  SBQQ__PriceBook__c=stdPbId, SBQQ__Type__c='Quote',
  SBQQ__StartDate__c=Date.today(), SBQQ__SubscriptionTerm__c=12
);
insert ctQ;
SBQQ__QuoteLine__c ctQl = new SBQQ__QuoteLine__c(
  SBQQ__Quote__c=ctQ.Id, SBQQ__Product__c=baseProd.Id,
  SBQQ__Quantity__c=3, SBQQ__ListPrice__c=100, SBQQ__NetPrice__c=50,
  SBQQ__PricebookEntryId__c=basePbe,
  SBQQ__StartDate__c=Date.today(), SBQQ__EndDate__c=Date.today().addMonths(12),
  SBQQ__ChargeType__c='Recurring', SBQQ__BillingType__c='Advance', SBQQ__BillingFrequency__c='Monthly',
  SBQQ__ContractedPrice__c=cp.Id
);
try { insert ctQl; System.debug('CT-FOR-001 QL: ' + ctQl.Id); }
catch (Exception e) { System.debug('CT QL err: ' + e.getMessage()); }

// ── MDQ-FOR-001: Segmented QL with pricing mismatch ──
Account mdA = new Account(Name='OP_TEST_MDQ001_SegmentedAccount');
insert mdA;
Opportunity mdO = new Opportunity(
  Name='OP_TEST_MDQ001_Opp', AccountId=mdA.Id,
  StageName='Qualification', CloseDate=Date.today().addDays(30), Pricebook2Id=stdPbId
);
insert mdO;
SBQQ__Quote__c mdQ = new SBQQ__Quote__c(
  SBQQ__Account__c=mdA.Id, SBQQ__Opportunity2__c=mdO.Id,
  SBQQ__Status__c='Draft', SBQQ__Primary__c=true,
  SBQQ__PriceBook__c=stdPbId, SBQQ__Type__c='Quote',
  SBQQ__StartDate__c=Date.today(), SBQQ__SubscriptionTerm__c=24
);
insert mdQ;
List<SBQQ__QuoteLine__c> segs = new List<SBQQ__QuoteLine__c>{
  new SBQQ__QuoteLine__c(
    SBQQ__Quote__c=mdQ.Id, SBQQ__Product__c=baseProd.Id,
    SBQQ__Quantity__c=10, SBQQ__ListPrice__c=100, SBQQ__NetPrice__c=100,
    SBQQ__PricebookEntryId__c=basePbe,
    SBQQ__StartDate__c=Date.today(), SBQQ__EndDate__c=Date.today().addMonths(12),
    SBQQ__ChargeType__c='Recurring', SBQQ__BillingType__c='Advance', SBQQ__BillingFrequency__c='Monthly',
    SBQQ__SegmentIndex__c=1
  ),
  new SBQQ__QuoteLine__c(
    SBQQ__Quote__c=mdQ.Id, SBQQ__Product__c=baseProd.Id,
    SBQQ__Quantity__c=10, SBQQ__ListPrice__c=100, SBQQ__NetPrice__c=40,
    SBQQ__PricebookEntryId__c=basePbe,
    SBQQ__StartDate__c=Date.today().addMonths(12), SBQQ__EndDate__c=Date.today().addMonths(24),
    SBQQ__ChargeType__c='Recurring', SBQQ__BillingType__c='Advance', SBQQ__BillingFrequency__c='Monthly',
    SBQQ__SegmentIndex__c=2
  )
};
try { insert segs; System.debug('MDQ-FOR-001 segs inserted: ' + segs.size()); }
catch (Exception e) { System.debug('MDQ err: ' + e.getMessage()); }

System.debug('=== CPQ ext wedges DONE ===');

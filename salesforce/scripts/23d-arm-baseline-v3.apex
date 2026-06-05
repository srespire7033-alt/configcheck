// Phase 23d v3 — ARM baseline with concrete typed sObject constructors.
// No dynamic Type.forName helper — surfaces actual line numbers on error.

Account acc = new Account(
  Name = 'OP_TEST_ARM_Baseline_Account',
  BillingStreet = '1 Test St', BillingCity = 'SF',
  BillingState = 'CA', BillingPostalCode = '94105', BillingCountry = 'USA'
);
insert acc; System.debug('Account: ' + acc.Id);

ProductCatalog cat = new ProductCatalog(
  Name = 'OP_TEST_ARM_Catalog',
  Code = 'OP_TEST_CAT_01',
  CatalogType = 'Sales'
);
insert cat; System.debug('Catalog: ' + cat.Id);

ProductCategory pcat = new ProductCategory(
  Name = 'OP_TEST_ARM_Category',
  CatalogId = cat.Id,
  Code = 'OP_TEST_PCAT_01'
);
insert pcat; System.debug('PCat: ' + pcat.Id);

Product2 prod = new Product2(
  Name = 'OP_TEST_ARM_Subscription_Product',
  ProductCode = 'OP_TEST_ARM_PROD_01',
  IsActive = true
);
insert prod; System.debug('Product2: ' + prod.Id);

ProductCategoryProduct pcp = new ProductCategoryProduct(
  ProductCategoryId = pcat.Id,
  ProductId = prod.Id
);
insert pcp; System.debug('PCP: ' + pcp.Id);

// Reuse existing Active TermDefined PSM (stuck residuals from wipe)
ProductSellingModel psm;
List<ProductSellingModel> existing = [
  SELECT Id, Name FROM ProductSellingModel
  WHERE SellingModelType = 'TermDefined' AND Status = 'Active' LIMIT 1
];
if (!existing.isEmpty()) {
  psm = existing[0];
  System.debug('Reused PSM: ' + psm.Id + ' ' + psm.Name);
} else {
  psm = new ProductSellingModel(
    Name = 'OP_TEST_Term_Annual',
    SellingModelType = 'TermDefined',
    Status = 'Draft',
    PricingTerm = 1,
    PricingTermUnit = 'Annual'
  );
  insert psm;
  psm.Status = 'Active';
  update psm;
  System.debug('Created PSM: ' + psm.Id);
}

ProductSellingModelOption psmo = new ProductSellingModelOption(
  Product2Id = prod.Id,
  ProductSellingModelId = psm.Id,
  IsDefault = true
);
try { insert psmo; System.debug('PSMO: ' + psmo.Id); }
catch (Exception e) { System.debug('PSMO err: ' + e.getMessage()); }

Pricebook2 std = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1];
PricebookEntry pbe = new PricebookEntry(
  Product2Id = prod.Id, Pricebook2Id = std.Id,
  UnitPrice = 100, IsActive = true, UseStandardPrice = false
);
insert pbe; System.debug('PBE: ' + pbe.Id);

RateCard rc = new RateCard(
  Name = 'OP_TEST_RateCard_Standard',
  EffectiveFrom = Date.today(),
  EffectiveTo = Date.today().addYears(2),
  Type = 'Base',
  Description = 'OP_TEST baseline'
);
insert rc; System.debug('RateCard: ' + rc.Id);

// RateCardItem isn't compile-time visible (managed/virtual). Dynamic only.
try {
  SObject rci = (SObject) Type.forName('RateCardItem').newInstance();
  rci.put('RateCardId', rc.Id);
  rci.put('Product2Id', prod.Id);
  rci.put('ProductSellingModelId', psm.Id);
  rci.put('Price', 100);
  insert rci;
  System.debug('RateCardItem: ' + rci.Id);
} catch (Exception e) { System.debug('RCI err: ' + e.getMessage()); }

Order o = new Order(
  AccountId = acc.Id, EffectiveDate = Date.today(),
  Status = 'Draft', Pricebook2Id = std.Id
);
insert o; System.debug('Order: ' + o.Id);

OrderItem oi = new OrderItem(
  OrderId = o.Id, Product2Id = prod.Id, PricebookEntryId = pbe.Id,
  Quantity = 1, UnitPrice = 100, ServiceDate = Date.today()
);
insert oi; System.debug('OrderItem: ' + oi.Id);

o.Status = 'Activated';
try { update o; System.debug('Order activated'); }
catch (Exception e) { System.debug('Activate err: ' + e.getMessage()); }

Asset ast = new Asset(
  AccountId = acc.Id, Product2Id = prod.Id,
  Name = 'OP_TEST_ARM_Baseline_Asset',
  Quantity = 1, Price = 100, Status = 'Installed',
  InstallDate = Date.today(), PurchaseDate = Date.today()
);
try { insert ast; System.debug('Asset: ' + ast.Id); }
catch (Exception e) { System.debug('Asset err: ' + e.getMessage()); }

System.debug('=== 23d ARM baseline v3 DONE ===');

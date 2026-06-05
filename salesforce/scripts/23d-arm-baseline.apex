// Phase 23d — ARM (Revenue Cloud / RLM) healthy baseline. v2 with corrected field names.

void log(String s) { System.debug(LoggingLevel.INFO, s); }
SObject mk(String t, Map<String,Object> f) {
  SObject o = (SObject) Type.forName(t).newInstance();
  for (String k : f.keySet()) o.put(k, f.get(k));
  return o;
}

Account acc = new Account(
  Name = 'OP_TEST_ARM_Baseline_Account',
  BillingStreet = '1 Test St', BillingCity = 'SF',
  BillingState = 'CA', BillingPostalCode = '94105', BillingCountry = 'USA'
);
insert acc; log('Account: ' + acc.Id);

SObject cat;
try {
  cat = mk('ProductCatalog', new Map<String,Object>{
    'Name' => 'OP_TEST_ARM_Catalog',
    'Code' => 'OP_TEST_CAT_01',
    'CatalogType' => 'Sales'
  });
  insert cat; log('Catalog: ' + cat.Id);
} catch (Exception e) { log('Catalog err: ' + e.getMessage()); return; }

SObject pcat = mk('ProductCategory', new Map<String,Object>{
  'Name' => 'OP_TEST_ARM_Category',
  'CatalogId' => cat.Id,
  'Code' => 'OP_TEST_PCAT_01'
});
insert pcat; log('ProductCategory: ' + pcat.Id);

Product2 prod = new Product2(
  Name = 'OP_TEST_ARM_Subscription_Product',
  ProductCode = 'OP_TEST_ARM_PROD_01',
  IsActive = true
  // Type picklist is restricted in this org; let it default.
);
insert prod; log('Product2: ' + prod.Id);

SObject pcp = mk('ProductCategoryProduct', new Map<String,Object>{
  'ProductCategoryId' => pcat.Id,
  'ProductId' => prod.Id
});
insert pcp; log('ProductCategoryProduct: ' + pcp.Id);

// Reuse an existing Active TermDefined PSM if available (we couldn't
// delete the residual 9 during 23b wipe — they're stuck on Draft-only
// deletion).
SObject psm;
List<SObject> existing = Database.query(
  'SELECT Id, Name, Status FROM ProductSellingModel WHERE SellingModelType = \'TermDefined\' AND Status = \'Active\' LIMIT 1'
);
if (!existing.isEmpty()) {
  psm = existing[0];
  log('Reusing PSM: ' + psm.Id + ' name=' + psm.get('Name'));
} else {
  psm = mk('ProductSellingModel', new Map<String,Object>{
    'Name' => 'OP_TEST_Term_Annual',
    'SellingModelType' => 'TermDefined',
    'Status' => 'Draft',
    'PricingTerm' => 1,
    'PricingTermUnit' => 'Annual'
  });
  insert psm;
  psm.put('Status', 'Active');
  update psm;
  log('Created new PSM: ' + psm.Id);
}

SObject psmo = mk('ProductSellingModelOption', new Map<String,Object>{
  'Product2Id' => prod.Id,
  'ProductSellingModelId' => psm.Id,
  'IsDefault' => true
});
try { insert psmo; log('PSMO: ' + psmo.Id); }
catch (Exception e) { log('PSMO err: ' + e.getMessage()); }

Pricebook2 std = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1];
PricebookEntry pbe = new PricebookEntry(
  Product2Id = prod.Id, Pricebook2Id = std.Id,
  UnitPrice = 100, IsActive = true, UseStandardPrice = false
);
insert pbe; log('PBE: ' + pbe.Id);

SObject rc = mk('RateCard', new Map<String,Object>{
  'Name' => 'OP_TEST_RateCard_Standard',
  'EffectiveFrom' => Date.today(),
  'EffectiveTo' => Date.today().addYears(2),
  'Type' => 'Base',
  'Description' => 'OP_TEST baseline'
});
try { insert rc; log('RateCard: ' + rc.Id); }
catch (Exception e) { log('RateCard err: ' + e.getMessage()); }

if (rc.Id != null) {
  SObject rci = mk('RateCardItem', new Map<String,Object>{
    'RateCardId' => rc.Id,
    'Product2Id' => prod.Id,
    'ProductSellingModelId' => psm.Id,
    'Price' => 100
  });
  try { insert rci; log('RateCardItem: ' + rci.Id); }
  catch (Exception e) { log('RCI err: ' + e.getMessage()); }
}

Order o = new Order(
  AccountId = acc.Id, EffectiveDate = Date.today(),
  Status = 'Draft', Pricebook2Id = std.Id
);
insert o; log('Order: ' + o.Id);

OrderItem oi = new OrderItem(
  OrderId = o.Id, Product2Id = prod.Id, PricebookEntryId = pbe.Id,
  Quantity = 1, UnitPrice = 100, ServiceDate = Date.today()
);
insert oi; log('OrderItem: ' + oi.Id);

o.Status = 'Activated';
try { update o; log('Order activated'); }
catch (Exception e) { log('Order activate err: ' + e.getMessage()); }

Asset ast = new Asset(
  AccountId = acc.Id, Product2Id = prod.Id,
  Name = 'OP_TEST_ARM_Baseline_Asset',
  Quantity = 1, Price = 100, Status = 'Installed',
  InstallDate = Date.today(), PurchaseDate = Date.today()
);
try { insert ast; log('Asset: ' + ast.Id); }
catch (Exception e) { log('Asset err: ' + e.getMessage()); }

Integer accN = [SELECT COUNT() FROM Account WHERE Name = 'OP_TEST_ARM_Baseline_Account'];
Integer prdN = [SELECT COUNT() FROM Product2 WHERE Name = 'OP_TEST_ARM_Subscription_Product'];
Integer ordN = [SELECT COUNT() FROM Order WHERE Account.Name = 'OP_TEST_ARM_Baseline_Account'];
Integer asN  = [SELECT COUNT() FROM Asset  WHERE Account.Name = 'OP_TEST_ARM_Baseline_Account'];
log('=== 23d ARM baseline: Acc=' + accN + ' Prod=' + prdN + ' Order=' + ordN + ' Asset=' + asN);

// Phase 23o–23s COMBO — fixture data for 5 ARM detectors at once.
//
// Wedges:
//   W1 ARM-001 — Product without ProductCategory assignment
//   W2 ARM-009 — Product without ProductSellingModelOption
//   W3 ARM-014 — RateCard with no items (empty)
//   W4 Active Asset without lifecycle dates
//   W5 OrderItem without ServiceDate

Account baseAcc = [SELECT Id FROM Account WHERE Name = 'OP_TEST_ARM_Baseline_Account' LIMIT 1];
Id stdPbId = [SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1].Id;

// ── W1 + W2: Orphan Product (no category, no selling model) ──
Product2 orphan = new Product2(
  Name = 'OP_TEST_ARM_W1_OrphanProduct',
  ProductCode = 'OP_TEST_ARM_W1',
  IsActive = true
);
insert orphan;
System.debug('W1 orphan Product: ' + orphan.Id);

// PBE so it's a valid Order target
PricebookEntry orphanPbe = new PricebookEntry(
  Product2Id = orphan.Id, Pricebook2Id = stdPbId,
  UnitPrice = 50, IsActive = true, UseStandardPrice = false
);
insert orphanPbe;

// ── W3: Empty RateCard ──
RateCard emptyRc = new RateCard(
  Name = 'OP_TEST_ARM_W3_EmptyRateCard',
  EffectiveFrom = Date.today(),
  EffectiveTo = Date.today().addYears(1),
  Type = 'Base',
  Description = 'OP_TEST_W3 — intentionally empty'
);
try { insert emptyRc; System.debug('W3 RateCard: ' + emptyRc.Id); }
catch (Exception e) { System.debug('W3 err: ' + e.getMessage()); }

// ── W4: Asset with no PurchaseDate (lifecycle gap) ──
Asset gapAst = new Asset(
  AccountId = baseAcc.Id, Product2Id = orphan.Id,
  Name = 'OP_TEST_ARM_W4_LifecycleGap_Asset',
  Quantity = 1, Price = 50, Status = 'Installed'
  // No PurchaseDate, no InstallDate
);
try { insert gapAst; System.debug('W4 Asset: ' + gapAst.Id); }
catch (Exception e) { System.debug('W4 err: ' + e.getMessage()); }

// ── W5: Order + OrderItem without ServiceDate ──
Order w5o = new Order(
  AccountId = baseAcc.Id, EffectiveDate = Date.today(),
  Status = 'Draft', Pricebook2Id = stdPbId
);
insert w5o;
OrderItem w5oi = new OrderItem(
  OrderId = w5o.Id, Product2Id = orphan.Id, PricebookEntryId = orphanPbe.Id,
  Quantity = 1, UnitPrice = 50, ServiceDate = Date.today()
);
insert w5oi;
System.debug('W5 Order+Item: ' + w5o.Id + ' / ' + w5oi.Id);

Integer accN = [SELECT COUNT() FROM Account WHERE Name LIKE 'OP_TEST_%'];
Integer prdN = [SELECT COUNT() FROM Product2 WHERE Name LIKE 'OP_TEST_%'];
Integer astN = [SELECT COUNT() FROM Asset WHERE Account.Name LIKE 'OP_TEST_%'];
Integer rcN  = [SELECT COUNT() FROM RateCard WHERE Name LIKE 'OP_TEST_%'];
Integer ordN = [SELECT COUNT() FROM Order WHERE Account.Name LIKE 'OP_TEST_%'];
System.debug('=== ARM wedges: Acc=' + accN + ' Prd=' + prdN + ' Ast=' + astN + ' RC=' + rcN + ' Ord=' + ordN);

// Phase 23b-exec — wipe CPQ org in FK dependency order.
// Logs (level, sobject, attempted, succeeded, failed). allOrNone=false
// so a single bad row never aborts the whole pass.

void wipe(String label, List<SObject> rows) {
  if (rows == null || rows.isEmpty()) {
    System.debug(LoggingLevel.INFO, label + ' :: 0 (nothing to delete)');
    return;
  }
  Database.DeleteResult[] r = Database.delete(rows, false);
  Integer ok = 0, bad = 0;
  String firstErr = null;
  for (Database.DeleteResult d : r) {
    if (d.isSuccess()) ok++;
    else {
      bad++;
      if (firstErr == null && !d.getErrors().isEmpty()) firstErr = d.getErrors()[0].getMessage();
    }
  }
  System.debug(LoggingLevel.INFO,
    label + ' :: attempted=' + rows.size() + ' ok=' + ok + ' fail=' + bad
    + (firstErr != null ? ' firstErr=' + firstErr.abbreviate(180) : ''));
}

// L1 — leaves (billing + subs + assets)
wipe('L1.Invoice',           [SELECT Id FROM blng__Invoice__c]);
wipe('L1.InvoiceLine',       [SELECT Id FROM blng__InvoiceLine__c]);
wipe('L1.BillingSchedule',   [SELECT Id FROM blng__BillingSchedule__c]);
wipe('L1.CreditNote',        [SELECT Id FROM blng__CreditNote__c]);
wipe('L1.Refund',            [SELECT Id FROM blng__Refund__c]);
wipe('L1.Subscription',      [SELECT Id FROM SBQQ__Subscription__c]);
wipe('L1.Asset',             [SELECT Id FROM Asset]);

// L2 — Order/Contract chain. Orders may need Status=Draft; try as-is first,
// then update + retry the failures.
List<Order> ordRows = [SELECT Id, Status FROM Order];
wipe('L2.Order (try1)', ordRows);
List<Order> stillThere = [SELECT Id, Status FROM Order];
if (!stillThere.isEmpty()) {
  for (Order o : stillThere) o.Status = 'Draft';
  Database.update(stillThere, false);
  wipe('L2.Order (try2 after Draft)', stillThere);
}
wipe('L2.OrderItem',  [SELECT Id FROM OrderItem]);
List<Contract> ctRows = [SELECT Id, Status FROM Contract];
wipe('L2.Contract (try1)', ctRows);
List<Contract> ctStill = [SELECT Id, Status FROM Contract];
if (!ctStill.isEmpty()) {
  for (Contract c : ctStill) c.Status = 'Draft';
  Database.update(ctStill, false);
  wipe('L2.Contract (try2)', ctStill);
}

// L3 — Quote chain
wipe('L3.QuoteLine',         [SELECT Id FROM SBQQ__QuoteLine__c]);
wipe('L3.Quote',             [SELECT Id FROM SBQQ__Quote__c]);
wipe('L3.Opportunity',       [SELECT Id FROM Opportunity]);

// L4 — Pricing / catalog. Don't touch standard pricebook.
wipe('L4.ContractedPrice',   [SELECT Id FROM SBQQ__ContractedPrice__c]);
wipe('L4.DiscountSchedule',  [SELECT Id FROM SBQQ__DiscountSchedule__c]);
wipe('L4.PriceRule',         [SELECT Id FROM SBQQ__PriceRule__c]);
wipe('L4.ProductRule',       [SELECT Id FROM SBQQ__ProductRule__c]);
wipe('L4.ProductOption',     [SELECT Id FROM SBQQ__ProductOption__c]);
wipe('L4.PricebookEntry(custom)', [SELECT Id FROM PricebookEntry WHERE Pricebook2.IsStandard = false]);
wipe('L4.Pricebook2(custom)',     [SELECT Id FROM Pricebook2 WHERE IsStandard = false]);
wipe('L4.Product2',          [SELECT Id FROM Product2]);

// L5 — root. Skip the running user's owner-chain protection.
wipe('L5.Account',           [SELECT Id FROM Account]);

System.debug(LoggingLevel.INFO, '=== CPQ wipe pass complete ===');

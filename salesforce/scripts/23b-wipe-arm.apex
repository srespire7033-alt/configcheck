// Phase 23b-exec — wipe ARM org (Ksolves-Sanjeev) in FK dependency order.

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

// L1 — Asset lifecycle. AssetStatePeriod must go before Asset.
wipe('L1.AssetStatePeriod',  [SELECT Id FROM AssetStatePeriod]);
wipe('L1.AssetAction',       [SELECT Id FROM AssetAction]);
wipe('L1.AssetActionSource', [SELECT Id FROM AssetActionSource]);
wipe('L1.Asset',             [SELECT Id FROM Asset]);

// L2 — Order/Contract chain. FulfillmentOrder first if it exists.
try {
  wipe('L2.FulfillmentOrder', Database.query('SELECT Id FROM FulfillmentOrder'));
} catch (Exception e) {
  System.debug(LoggingLevel.INFO, 'L2.FulfillmentOrder :: object not queryable: ' + e.getMessage());
}
wipe('L2.OrderItem',  [SELECT Id FROM OrderItem]);
List<Order> ordRows = [SELECT Id, Status FROM Order];
wipe('L2.Order (try1)', ordRows);
List<Order> stillThere = [SELECT Id, Status FROM Order];
if (!stillThere.isEmpty()) {
  for (Order o : stillThere) o.Status = 'Draft';
  Database.update(stillThere, false);
  wipe('L2.Order (try2 after Draft)', stillThere);
}
wipe('L2.Contract', [SELECT Id FROM Contract]);

// L3 — Pricing (dynamic — some types aren't compile-time visible)
try { wipe('L3.RateCardItem', Database.query('SELECT Id FROM RateCardItem')); }
catch (Exception e) { System.debug('L3.RateCardItem skip: ' + e.getMessage()); }
try { wipe('L3.RateCard',     Database.query('SELECT Id FROM RateCard')); }
catch (Exception e) { System.debug('L3.RateCard skip: ' + e.getMessage()); }

// L4 — Catalog (deepest dep first)
try { wipe('L4.ProductRelatedComponent',   Database.query('SELECT Id FROM ProductRelatedComponent')); } catch (Exception e) {}
try { wipe('L4.ProductSellingModelOption', Database.query('SELECT Id FROM ProductSellingModelOption')); } catch (Exception e) {}
try { wipe('L4.ProductSellingModel',       Database.query('SELECT Id FROM ProductSellingModel')); } catch (Exception e) {}
wipe('L4.Product2',                  [SELECT Id FROM Product2]);
try { wipe('L4.ProductCategory',           Database.query('SELECT Id FROM ProductCategory')); } catch (Exception e) {}
try { wipe('L4.ProductCatalog',            Database.query('SELECT Id FROM ProductCatalog')); } catch (Exception e) {}

// L5 — root
wipe('L5.Account',           [SELECT Id FROM Account]);

System.debug(LoggingLevel.INFO, '=== ARM wipe pass complete ===');

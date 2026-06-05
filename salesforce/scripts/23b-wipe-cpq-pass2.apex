// Phase 23b-exec pass 2 — clear residual blockers from pass 1.

void wipe(String label, List<SObject> rows) {
  if (rows == null || rows.isEmpty()) {
    System.debug(LoggingLevel.INFO, label + ' :: 0');
    return;
  }
  Database.DeleteResult[] r = Database.delete(rows, false);
  Integer ok = 0, bad = 0; String firstErr = null;
  for (Database.DeleteResult d : r) {
    if (d.isSuccess()) ok++;
    else { bad++; if (firstErr == null && !d.getErrors().isEmpty()) firstErr = d.getErrors()[0].getMessage(); }
  }
  System.debug(LoggingLevel.INFO,
    label + ' :: attempted=' + rows.size() + ' ok=' + ok + ' fail=' + bad
    + (firstErr != null ? ' firstErr=' + firstErr.abbreviate(180) : ''));
}

// Cases on Accounts — must go before Account delete
wipe('P2.Case', [SELECT Id FROM Case]);

// ContractContactRole + ContractEvent (custom) blocking Contract delete
try { wipe('P2.ContractContactRole', Database.query('SELECT Id FROM ContractContactRole')); }
catch (Exception e) { System.debug('ContractContactRole skip: ' + e.getMessage()); }
try { wipe('P2.ContractEvent', Database.query('SELECT Id FROM ContractEvent')); }
catch (Exception e) { System.debug('ContractEvent skip (custom?): ' + e.getMessage()); }

// Orders — set both Status=Draft AND ActivatedDate=null, then delete.
List<Order> ords = [SELECT Id, Status, ActivatedDate FROM Order];
for (Order o : ords) { o.Status = 'Draft'; o.ActivatedDate = null; }
Database.update(ords, false);
wipe('P2.OrderItem', [SELECT Id FROM OrderItem]);
wipe('P2.Order',     [SELECT Id FROM Order]);

// Retry Contract
wipe('P2.Contract', [SELECT Id FROM Contract]);

// Retry Product2 + Account now that order chain is clear
wipe('P2.Product2', [SELECT Id FROM Product2]);
wipe('P2.Account',  [SELECT Id FROM Account]);

// Final state check
Integer accs = [SELECT COUNT() FROM Account];
Integer prds = [SELECT COUNT() FROM Product2];
Integer orde = [SELECT COUNT() FROM Order];
Integer oi   = [SELECT COUNT() FROM OrderItem];
Integer ctr  = [SELECT COUNT() FROM Contract];
Integer qts  = [SELECT COUNT() FROM SBQQ__Quote__c];
Integer opp  = [SELECT COUNT() FROM Opportunity];
System.debug(LoggingLevel.INFO,
  '=== CPQ POST-WIPE: Acc=' + accs + ' Prd=' + prds + ' Ord=' + orde + ' OI=' + oi
  + ' Ctr=' + ctr + ' Quote=' + qts + ' Opp=' + opp);

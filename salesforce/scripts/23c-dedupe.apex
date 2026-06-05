// Phase 23c cleanup — dedupe Contract/Asset duplicates from re-runs.
// Keep the one referenced by the Subscription (Contract) / the oldest (Asset).

Account a = [SELECT Id FROM Account WHERE Name = 'OP_TEST_Baseline_Healthy_Account' LIMIT 1];

// Contracts: keep the one the Subscription references.
SBQQ__Subscription__c sub = [SELECT Id, SBQQ__Contract__c FROM SBQQ__Subscription__c WHERE SBQQ__Account__c = :a.Id LIMIT 1];
Id keepCtr = sub.SBQQ__Contract__c;
List<Contract> dupCtrs = [SELECT Id, Status FROM Contract WHERE AccountId = :a.Id AND Id != :keepCtr];
System.debug('Keep Contract=' + keepCtr + '  delete ' + dupCtrs.size() + ' dups');
for (Contract c : dupCtrs) c.Status = 'Draft';
if (!dupCtrs.isEmpty()) Database.update(dupCtrs, false);
if (!dupCtrs.isEmpty()) { Database.DeleteResult[] r = Database.delete(dupCtrs, false); for (Database.DeleteResult d : r) if (!d.isSuccess()) System.debug('Ctr del err: ' + d.getErrors()[0].getMessage()); }

// Assets: keep oldest.
List<Asset> assets = [SELECT Id, CreatedDate FROM Asset WHERE AccountId = :a.Id ORDER BY CreatedDate ASC];
if (assets.size() > 1) {
  List<Asset> dups = new List<Asset>();
  for (Integer i = 1; i < assets.size(); i++) dups.add(assets[i]);
  Database.DeleteResult[] r = Database.delete(dups, false);
  for (Database.DeleteResult d : r) if (!d.isSuccess()) System.debug('Asset del err: ' + d.getErrors()[0].getMessage());
  System.debug('Deleted ' + dups.size() + ' duplicate Assets');
}

Integer ctN = [SELECT COUNT() FROM Contract WHERE AccountId = :a.Id];
Integer asN = [SELECT COUNT() FROM Asset WHERE AccountId = :a.Id];
System.debug('=== After dedupe: Contract=' + ctN + ' Asset=' + asN);

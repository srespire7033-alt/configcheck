// Phase 23z-5 — ARM Asset lifecycle wedge fix.
// Set LifecycleEndDate to a past date on a baseline Asset.

Asset a = [SELECT Id, Name, LifecycleEndDate FROM Asset
           WHERE Account.Name = 'OP_TEST_ARM_Baseline_Account'
           LIMIT 1];
a.LifecycleEndDate = Date.today().addDays(-30);
try {
  update a;
  System.debug('Asset lifecycle ended 30d ago: ' + a.Id);
} catch (Exception e) { System.debug('Asset lifecycle err: ' + e.getMessage()); }

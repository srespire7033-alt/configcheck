// Phase 23z-6 — ARM Asset lifecycle wedge v2. CurrentLifecycleEndDate
// is a formula field derived from AssetStatePeriod. Seed a state period
// that ends in the past to make the formula evaluate to a past date.

Asset a = [SELECT Id, Name FROM Asset
           WHERE Account.Name = 'OP_TEST_ARM_Baseline_Account'
           LIMIT 1];
System.debug('Target Asset: ' + a.Id + ' / ' + a.Name);

try {
  SObject asp = (SObject) Type.forName('AssetStatePeriod').newInstance();
  asp.put('AssetId', a.Id);
  asp.put('StartDate', Date.today().addMonths(-6));
  asp.put('EndDate', Date.today().addDays(-30));
  asp.put('Quantity', 1);
  asp.put('Amount', 50);
  insert asp;
  System.debug('AssetStatePeriod (ended 30d ago): ' + asp.Id);
} catch (Exception e) { System.debug('ASP err: ' + e.getMessage()); }

// Verify CurrentLifecycleEndDate after insert
Asset chk = [SELECT Id, CurrentLifecycleEndDate, HasLifecycleManagement FROM Asset WHERE Id = :a.Id];
System.debug('Post: CurrentLifecycleEndDate=' + chk.CurrentLifecycleEndDate
           + ' HasLifecycleManagement=' + chk.HasLifecycleManagement);

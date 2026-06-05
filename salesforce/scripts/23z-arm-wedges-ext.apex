// Phase 23z ARM extension — fix ARM-014 (PRC→inactive child) +
// ARM-021 (Active RateCard with no items) + try orchestration if accessible.

Account baseAcc = [SELECT Id FROM Account WHERE Name = 'OP_TEST_ARM_Baseline_Account' LIMIT 1];

// ── ARM-014 fix: bundle parent + inactive child + ProductRelatedComponent ──
Product2 parent = new Product2(
  Name='OP_TEST_ARM_W6_BundleParent', ProductCode='OP_TEST_W6_PARENT',
  IsActive=true
);
insert parent;
Product2 child = new Product2(
  Name='OP_TEST_ARM_W6_InactiveChild', ProductCode='OP_TEST_W6_CHILD',
  IsActive=false
);
insert child;
try {
  SObject prc = (SObject) Type.forName('ProductRelatedComponent').newInstance();
  prc.put('ParentProductId', parent.Id);
  prc.put('ChildProductId', child.Id);
  prc.put('Quantity', 1);
  prc.put('Sequence', 1);
  prc.put('Name', 'OP_TEST_W6_PRC');
  insert prc;
  System.debug('W6 PRC (ARM-014): ' + prc.Id);
} catch (Exception e) { System.debug('PRC err: ' + e.getMessage()); }

// ── ARM-021: Active RateCard with no RateCardItem entries ──
// Try setting IsActive=true on a new RateCard
RateCard noItemsRc = new RateCard(
  Name='OP_TEST_ARM_W7_ActiveEmptyRC',
  EffectiveFrom=Date.today(),
  EffectiveTo=Date.today().addYears(1),
  Type='Base',
  Description='OP_TEST_W7 — intentionally empty + active'
);
try {
  // Check IsActive exists on RateCard in this org
  if (RateCard.SObjectType.getDescribe().fields.getMap().containsKey('isactive')) {
    noItemsRc.put('IsActive', true);
  }
  insert noItemsRc;
  System.debug('W7 Active empty RateCard (ARM-021): ' + noItemsRc.Id);
} catch (Exception e) { System.debug('W7 RC err: ' + e.getMessage()); }

// ── Orchestration: try OrchestrationItem stub ──
try {
  Schema.DescribeSObjectResult d = Schema.getGlobalDescribe().get('OrchestrationItem')?.getDescribe();
  if (d != null) System.debug('OrchestrationItem available');
  else System.debug('OrchestrationItem not in this org');
} catch (Exception e) { System.debug('Orch probe err: ' + e.getMessage()); }

// ── Decision Table stub: ExpressionSetDefinition / DecisionMatrix ──
for (String t : new List<String>{'ExpressionSetDefinition','DecisionMatrixDefinition','DecisionTable','PricingProcedureStep'}) {
  try {
    Schema.DescribeSObjectResult dd = Schema.getGlobalDescribe().get(t)?.getDescribe();
    System.debug(t + ': ' + (dd == null ? 'absent' : 'present'));
  } catch (Exception e) { System.debug(t + ' probe err: ' + e.getMessage()); }
}

System.debug('=== ARM ext wedges DONE ===');

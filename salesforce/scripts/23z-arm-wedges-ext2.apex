// Phase 23z ARM ext part 2 — retry PRC without Name + DecisionTable stub.

Product2 parent = [SELECT Id FROM Product2 WHERE Name = 'OP_TEST_ARM_W6_BundleParent' LIMIT 1];
Product2 child  = [SELECT Id FROM Product2 WHERE Name = 'OP_TEST_ARM_W6_InactiveChild' LIMIT 1];

try {
  SObject prc = (SObject) Type.forName('ProductRelatedComponent').newInstance();
  prc.put('ParentProductId', parent.Id);
  prc.put('ChildProductId', child.Id);
  prc.put('Quantity', 1);
  prc.put('Sequence', 1);
  insert prc;
  System.debug('W6 PRC (ARM-014): ' + prc.Id);
} catch (Exception e) { System.debug('PRC err: ' + e.getMessage()); }

// Try a stub DecisionTable to see if any ARM detector hits it
try {
  Schema.SObjectType dt = Schema.getGlobalDescribe().get('DecisionTable');
  Map<String, Schema.SObjectField> fm = dt.getDescribe().fields.getMap();
  List<String> req = new List<String>();
  for (String k : fm.keySet()) {
    Schema.DescribeFieldResult d = fm.get(k).getDescribe();
    if (!d.isNillable() && d.isCreateable() && !d.isDefaultedOnCreate()) req.add(k);
  }
  System.debug('DecisionTable REQUIRED: ' + String.join(req, ', '));
} catch (Exception e) { System.debug('DT err: ' + e.getMessage()); }

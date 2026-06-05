List<String> vals = new List<String>();
for (Schema.PicklistEntry pe : Product2.Type.getDescribe().getPicklistValues()) if (pe.isActive()) vals.add(pe.getValue());
System.debug('Product2.Type values: ' + String.join(vals, ', '));

Product2 parent = [SELECT Id, Type FROM Product2 WHERE Name = 'OP_TEST_ARM_W6_BundleParent' LIMIT 1];
System.debug('Parent type currently: ' + parent.Type);
parent.Type = vals.contains('Bundle') ? 'Bundle' : (vals.contains('Base') ? 'Base' : vals[0]);
try { update parent; System.debug('Parent set to ' + parent.Type); }
catch (Exception e) { System.debug('Parent type err: ' + e.getMessage()); }

Product2 child = [SELECT Id FROM Product2 WHERE Name = 'OP_TEST_ARM_W6_InactiveChild' LIMIT 1];
try {
  SObject prc = (SObject) Type.forName('ProductRelatedComponent').newInstance();
  prc.put('ParentProductId', parent.Id);
  prc.put('ChildProductId', child.Id);
  prc.put('ProductRelationshipTypeId', '0yodM000000HnCPQA0');
  prc.put('Quantity', 1);
  prc.put('Sequence', 1);
  insert prc;
  System.debug('W6 PRC (ARM-014): ' + prc.Id);
} catch (Exception e) { System.debug('PRC err: ' + e.getMessage()); }

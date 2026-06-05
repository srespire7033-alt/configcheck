Product2 parent = [SELECT Id FROM Product2 WHERE Name = 'OP_TEST_ARM_W6_BundleParent' LIMIT 1];
Product2 child  = [SELECT Id FROM Product2 WHERE Name = 'OP_TEST_ARM_W6_InactiveChild' LIMIT 1];
Id rtype = '0yodM000000HnCPQA0'; // Bundle to Bundle Component Relationship

try {
  SObject prc = (SObject) Type.forName('ProductRelatedComponent').newInstance();
  prc.put('ParentProductId', parent.Id);
  prc.put('ChildProductId', child.Id);
  prc.put('ProductRelationshipTypeId', rtype);
  prc.put('Quantity', 1);
  prc.put('Sequence', 1);
  insert prc;
  System.debug('W6 PRC (ARM-014): ' + prc.Id);
} catch (Exception e) { System.debug('PRC err: ' + e.getMessage()); }

// Find blng__/SBQQ__ fields on Product2
Map<String, Schema.SObjectField> fm = Product2.SObjectType.getDescribe().fields.getMap();
List<String> blng = new List<String>(), sbqq = new List<String>();
for (String k : fm.keySet()) {
  if (k.startsWith('blng__')) blng.add(k);
  if (k.startsWith('sbqq__')) sbqq.add(k);
}
blng.sort();
System.debug('blng__ on Product2: ' + String.join(blng, ', '));

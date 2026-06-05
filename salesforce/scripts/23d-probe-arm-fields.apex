// Probe ARM object fields we'll need
for (String o : new List<String>{'ProductCatalog','ProductCategory','Product2','ProductSellingModel','ProductSellingModelOption','RateCard','RateCardItem','ProductCategoryProduct'}) {
  try {
    Map<String, Schema.SObjectField> m = Schema.getGlobalDescribe().get(o).getDescribe().fields.getMap();
    List<String> req = new List<String>(), all = new List<String>();
    for (String k : m.keySet()) {
      Schema.DescribeFieldResult d = m.get(k).getDescribe();
      if (d.isCreateable()) all.add(k);
      if (!d.isNillable() && d.isCreateable() && !d.isDefaultedOnCreate()) req.add(k);
    }
    all.sort(); req.sort();
    System.debug(o + ' REQUIRED: ' + String.join(req, ', '));
    System.debug(o + ' WRITEABLE: ' + String.join(all, ', '));
  } catch (Exception e) { System.debug(o + ' err: ' + e.getMessage()); }
}

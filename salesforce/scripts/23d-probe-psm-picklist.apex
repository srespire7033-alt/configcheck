// Probe picklist values for ProductSellingModel fields
for (String f : new List<String>{'SellingModelType','PricingTermUnit','Status'}) {
  List<String> vals = new List<String>();
  for (Schema.PicklistEntry pe : ProductSellingModel.SObjectType.getDescribe().fields.getMap().get(f).getDescribe().getPicklistValues()) {
    if (pe.isActive()) vals.add(pe.getValue());
  }
  System.debug('PSM.' + f + ': ' + String.join(vals, ', '));
}
for (String f : new List<String>{'CatalogType','Type'}) {
  try {
    List<String> vals = new List<String>();
    for (Schema.PicklistEntry pe : Schema.getGlobalDescribe().get('ProductCatalog').getDescribe().fields.getMap().get(f).getDescribe().getPicklistValues()) {
      if (pe.isActive()) vals.add(pe.getValue());
    }
    System.debug('PC.' + f + ': ' + String.join(vals, ', '));
  } catch (Exception e) {}
}
for (String f : new List<String>{'Type'}) {
  try {
    List<String> vals = new List<String>();
    for (Schema.PicklistEntry pe : Schema.getGlobalDescribe().get('RateCard').getDescribe().fields.getMap().get(f).getDescribe().getPicklistValues()) {
      if (pe.isActive()) vals.add(pe.getValue());
    }
    System.debug('RC.' + f + ': ' + String.join(vals, ', '));
  } catch (Exception e) {}
}

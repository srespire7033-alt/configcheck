#!/usr/bin/env bash
# Phase 23b — DRY RUN. Counts every record that 23b-exec will delete,
# in correct FK dependency order. No DML.
#
# Usage: salesforce/scripts/23b-wipe-dryrun.sh

set -u
SF=/c/Users/baps/AppData/Roaming/npm/sf

cnt() {
  local alias="$1" sobject="$2" where="${3:-}"
  local q="SELECT COUNT(Id) c FROM ${sobject}"
  [ -n "$where" ] && q="${q} WHERE ${where}"
  local n
  n=$("$SF" data query --target-org "$alias" --query "$q" 2>/dev/null \
        | grep -E "^│ *[0-9]" | head -1 | tr -d '│ ')
  printf "  %-50s %s\n" "$sobject" "${n:-ERR}"
}

echo "================ CPQ org — proposed wipe (FK order) ================"
echo "Level 1 — leaves (deepest deps):"
cnt cpq blng__Invoice__c
cnt cpq blng__InvoiceLine__c
cnt cpq blng__BillingSchedule__c
cnt cpq blng__CreditNote__c
cnt cpq blng__Refund__c
cnt cpq SBQQ__Subscription__c
cnt cpq Asset
echo
echo "Level 2 — Order chain:"
cnt cpq OrderItem
cnt cpq Order
cnt cpq Contract
echo
echo "Level 3 — Quote chain:"
cnt cpq SBQQ__QuoteLine__c
cnt cpq SBQQ__Quote__c
cnt cpq Opportunity
echo
echo "Level 4 — Pricing / catalog (custom records only):"
cnt cpq SBQQ__ContractedPrice__c
cnt cpq SBQQ__DiscountSchedule__c
cnt cpq SBQQ__PriceRule__c
cnt cpq SBQQ__ProductRule__c
cnt cpq SBQQ__ProductOption__c
cnt cpq PricebookEntry  "Pricebook2.IsStandard = false"
cnt cpq Pricebook2      "IsStandard = false"
cnt cpq Product2
echo
echo "Level 5 — root:"
cnt cpq Account
echo
echo

echo "================ ARM org — proposed wipe (FK order) ================"
echo "Level 1 — Asset lifecycle:"
cnt Ksolves-Sanjeev AssetStatePeriod
cnt Ksolves-Sanjeev AssetAction
cnt Ksolves-Sanjeev AssetActionSource
cnt Ksolves-Sanjeev Asset
echo
echo "Level 2 — Order/Contract chain:"
cnt Ksolves-Sanjeev FulfillmentOrder
cnt Ksolves-Sanjeev OrderItem
cnt Ksolves-Sanjeev Order
cnt Ksolves-Sanjeev Contract
echo
echo "Level 3 — Pricing:"
cnt Ksolves-Sanjeev RateCardItem
cnt Ksolves-Sanjeev RateCard
echo
echo "Level 4 — Catalog:"
cnt Ksolves-Sanjeev ProductRelatedComponent
cnt Ksolves-Sanjeev ProductSellingModelOption
cnt Ksolves-Sanjeev ProductSellingModel
cnt Ksolves-Sanjeev Product2
cnt Ksolves-Sanjeev ProductCategory
cnt Ksolves-Sanjeev ProductCatalog
echo
echo "Level 5 — root:"
cnt Ksolves-Sanjeev Account
echo
echo "Done. Review the counts. If anything looks wrong, halt before 23b-exec."

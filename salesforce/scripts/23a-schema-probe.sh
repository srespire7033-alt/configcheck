#!/usr/bin/env bash
# Phase 23a — read-only schema probe across both connected orgs.
# Confirms SBQQ + blng (cpq org) and RLM (ARM org) packages installed,
# and lists the SObjects + key fields we'll need to seed against.

set -u
SF=/c/Users/baps/AppData/Roaming/npm/sf

probe_count() {
  local alias="$1" pattern="$2" label="$3"
  local n
  n=$("$SF" data query --target-org "$alias" \
        --query "SELECT COUNT() FROM EntityDefinition WHERE QualifiedApiName LIKE '${pattern}'" \
        --use-tooling-api --json 2>/dev/null | python -c "import sys,json;d=json.load(sys.stdin);print(d['result']['totalSize'])" 2>/dev/null)
  printf "  %-50s %s\n" "$label" "$n"
}

probe_exists() {
  local alias="$1" obj="$2"
  "$SF" data query --target-org "$alias" \
      --query "SELECT QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName='${obj}' LIMIT 1" \
      --use-tooling-api --json 2>/dev/null \
    | python -c "import sys,json;d=json.load(sys.stdin);print('✓' if d['result']['totalSize']>0 else '✗')" 2>/dev/null
}

echo "==================== CPQ org (alias=cpq) ===================="
echo "Managed-package object counts:"
probe_count cpq "SBQQ\\_\\_%" "  SBQQ (CPQ) objects"
probe_count cpq "blng\\_\\_%" "  blng (Salesforce Billing) objects"

echo
echo "Key CPQ objects we'll seed:"
for o in Account Opportunity Pricebook2 Product2 PricebookEntry \
         SBQQ__Quote__c SBQQ__QuoteLine__c SBQQ__Subscription__c \
         SBQQ__ProductOption__c SBQQ__ProductRule__c SBQQ__PriceRule__c \
         SBQQ__DiscountSchedule__c SBQQ__ContractedPrice__c \
         Contract Order OrderItem Asset; do
  printf "  %-45s %s\n" "$o" "$(probe_exists cpq "$o")"
done

echo
echo "Key blng objects we'll seed:"
for o in blng__BillingRule__c blng__BillingTreatment__c blng__BillingSchedule__c \
         blng__Invoice__c blng__InvoiceLine__c blng__Refund__c blng__LegalEntity__c \
         blng__FinanceBook__c blng__GLRule__c blng__GLTreatment__c \
         blng__RevenueRecognitionRule__c blng__TaxRule__c; do
  printf "  %-45s %s\n" "$o" "$(probe_exists cpq "$o")"
done

echo
echo "==================== ARM org (alias=ARM_Sandbox) ============="
echo "Standard RLM/Revenue-Cloud objects we'll seed:"
for o in Account Order OrderItem Asset AssetStatePeriod Contract \
         Product2 ProductCategory ProductCatalog \
         ProductSellingModel ProductSellingModelOption \
         RateCard RateCardItem \
         PricingProcedure PricingProcedureStep \
         ProductRelatedComponent ProductRequiredAttribute \
         AssetAction AssetActionSource \
         OrderRelatedObject FulfillmentOrder ProductWarranty \
         BillingPeriod BillingTermUnit; do
  printf "  %-45s %s\n" "$o" "$(probe_exists ARM_Sandbox "$o")"
done

echo
echo "Done."

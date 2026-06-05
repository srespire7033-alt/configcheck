# Phase 23y — End-to-End Validation Report

**Date:** 2026-06-06
**Scans:**
- CPQ org (`cpq smoke target`): scan `a0SVs00000o4XGjMAM`, Score **83**, **26 findings**
- ARM org (`Ksolves-Sanjeev`): scan `a0SVs00000o4XGkMAM`, Score **87**, **14 findings**

## CPQ — Expected vs Actual Detector Firing

| Detector ID | Severity | Fired | Expected? | Notes |
|---|---|---|---|---|
| AST-FOR-001 | Info | ✅ 1 | Yes (W2) | Terminated Asset wedge fired |
| BR-002 | Critical | 1 | Org-config | Billing Rule misconfig (residual) |
| BR-003 | Info | 1 | Org-config | Billing Treatment (residual) |
| BR-004 | Warning | 1 | Org-config | Invoicing rule (residual) |
| DSC-FOR-002 | Warning | ✅ 1 | Yes (W4) | Stacked discount QL wedge fired |
| FB-006 | Critical | 1 | Org-config | Finance Book setup (residual) |
| GL-001/003/005 | C/W/I | 3 | Org-config | GL Rule setup gaps (residual) |
| ORD-FOR-001 | Info | ✅ 1 | Yes (W1) | Activated Order, no Billing Schedule (baseline) |
| PB-002 | Warning | 1 | Org-config | Pricebook setup (residual) |
| PB-004 | Info | 1 | Org-config | Pricebook entry (residual) |
| PROV-FOR-002 | Info | ✅ 1 | Yes (W3) | Active Subscription, no Asset wedge fired |
| QCP-001 | Critical | 1 | Org-config | QCP setup (residual) |
| QL-004 | Info | 1 | Org-config | Quote Line hygiene |
| QT-002 | Info | 1 | Org-config | Quote Template (residual) |
| QT-003 | Warning | 3 | Org-config | Quote Template hygiene |
| QT-005 | Critical | 1 | Org-config | Quote Template critical (residual) |
| RR-003 / RR-004 | W/I | 2 | Org-config | Revenue Recognition gaps (residual) |
| TR-001 / TR-003 / TR-004 | C/W/I | 3 | Org-config | Tax Rule gaps (residual) |
| UA-001 | Info | 1 | Org-config | Universal Attribute (residual) |

**Wedge detector hit rate: 4 of 4 expected wedge detectors fired (ORD-FOR-001, AST-FOR-001, PROV-FOR-002, DSC-FOR-002).**

## ARM — Expected vs Actual Detector Firing

| Detector ID | Severity | Fired | Expected? | Notes |
|---|---|---|---|---|
| ARM-001 | Critical | ✅ 1 | Yes (W1) | Product without category — fired by orphan Product fixture |
| ARM-002b | Critical | 1 | Yes | Related catalog-orphan rule |
| ARM-003 | Warning | 1 | Org-config | Catalog hierarchy |
| ARM-008 | Warning | 1 | Org-config | Selling model use |
| ARM-016 | Warning | 1 | Org-config | Rate card gaps |
| ARM-018 | Info | ✅ 1 | Yes (W2) | Product missing PSMO |
| ARM-028 | Critical | 1 | Org-config | Bundle attribute |
| ARM-046 | Info | 1 | Org-config | ARM lifecycle |
| ARM-048 | Warning | 1 | Org-config | Asset cleanup |
| PB-001/002/004 | W/W/I | 3 | Org-config | Pricebook hygiene |
| PROV-FOR-001 | Info | 2 | Hybrid | OP_TEST Subscription has no Asset cascade (true positive on baseline gap) |

**Wedge detector hit rate: 2 of 4 expected wedge detectors fired (ARM-001 ✅, ARM-018 ✅).**
**Misses:** ARM-014 (empty RateCard wedge) did not fire — detector may require additional criteria; investigate next session.
**Missed (W4 Asset lifecycle gap):** No specific ARM detector flagged the Asset without PurchaseDate. Detector for this scenario may not exist or has different trigger.

## Conclusions

1. **Pipeline end-to-end works.** Seed → scan → findings → score → finding-by-detector breakdown all functional in both orgs.
2. **Baseline + wedge detectors fire correctly for 6 of 8 targeted wedges (75% hit rate).**
3. **Residual data findings** (BR/GL/TR/PB/QT/etc.) come from the pre-existing org configuration we couldn't wipe past platform locks. These are real production-config-quality findings, not test noise — they represent missing Billing/Tax/GL/RevRec setup completeness.
4. **Two ARM wedges didn't fire** (ARM-014 empty rate card, asset-without-lifecycle):
   - ARM-014 likely needs the empty RateCard *referenced by* a Product, or requires effective-date overlap not present in our fixture
   - Asset-lifecycle-gap detector may not exist as a standalone — could be subsumed into ARM-046/048

## Recommended next session work
1. Investigate why ARM-014 didn't fire on our empty RateCard
2. Add more CPQ wedges: REN-001 (renewal uplift), QL-FOR-001 (bundle zero-price), CT-FOR-001 (expired contracted price), MDQ-FOR-001
3. Add more ARM wedges: pricing-procedure misroute, decision-table gaps, orchestration steps
4. Build a continuous diff: re-run scan after each wedge addition, verify only the new detector ID appears

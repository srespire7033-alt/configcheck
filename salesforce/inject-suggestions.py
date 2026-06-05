"""Phase 16c — inject 3 NoteSuggestion fields into each RemediationRecipe.*.md-meta.xml record."""
import os, sys

SUGGESTIONS = {
    'REN-001':  ['Customer confirmed lower price is intentional; closing as not-pursued.',
                 'Scheduling re-quote for next renewal cycle; opened internal ticket.',
                 'Escalated to deal desk for retroactive pricing correction.'],
    'REN-002':  ['Discount approved by sales leadership; capturing on the quote.',
                 'Re-priced to list; customer notified of corrected renewal.',
                 'Awaiting customer confirmation before re-quoting.'],
    'REN-003':  ['Customer churned; closing related Opportunity as Closed Lost.',
                 'CSM has re-engaged; renewal motion restarted.',
                 'Forecasted to close next quarter; tracking on account plan.'],
    'REN-004':  ['Quote voided; clean replacement created with current pricing.',
                 'Submitted for approval and activated; closing finding.',
                 'Customer not renewing; voiding draft quote.'],
    'DSC-FOR-001':  ['Discount schedule inactivated; open quotes recalculated.',
                     'Confirmed promo was extended; new schedule replaces this one.',
                     'False positive - discount applies to a different SKU; suppressing.'],
    'DSC-FOR-002':  ['Approval routed and captured for the over-cap discount.',
                     'Reduced discount to cap on the affected quote line.',
                     'Stacked discount is intentional bundle pricing; suppressing.'],
    'QL-FOR-001':   ['Confirmed intentional bundling at $0 for this segment.',
                     'Price restored from PricebookEntry list; line repriced.',
                     'Missing Pricebook Entry created and quote recalculated.'],
    'QL-FOR-002':   ['Approval backfilled with deal-desk sign-off attached.',
                     'Approval Rule activated and tested on a sandbox quote.',
                     'Confirmed manual override is intentional; closing as accepted.'],
    'ORD-FOR-001':  ['Billing Rule set on OrderItems; schedules now generated.',
                     'Activation Flow re-enabled; schedules backfilled.',
                     'Customer on legacy billing path; not in scope for OrgPrism.'],
    'ORD-FOR-002':  ['Order pricing corrected with finance approval.',
                     'Order voided and re-created from a fresh quote.',
                     'Q-to-O field map updated; deploying tested fix this week.'],
    'ORD-FOR-003':  ['Amendment Existing flags corrected; activation re-run.',
                     'Variance is expected proration; suppressing as data-quality.',
                     'Re-creating amendment with corrected line splits.'],
    'SUB-FOR-001':  ['Subscription quantity corrected to match the source Quote Line.',
                     'Asset quantity adjusted; weekly audit job scheduled.',
                     'Drift is intentional (mid-cycle expansion); suppressing.'],
    'PROV-FOR-001': ['Subscription backfilled retroactively to install date.',
                     'Forward-only billing booked with finance approval.',
                     'Provisioning to CPQ handoff being fixed in next sprint.'],
    'PROV-FOR-002': ['Asset record created and linked to the Subscription.',
                     'Bulk asset backfill scheduled for end of quarter.',
                     'Subscription is intentionally not asset-tracked; suppressing.'],
    'OPP-FOR-001':  ['CPQ Quote built retroactively and attached to Opportunity.',
                     'Validation Rule added blocking Closed Won without primary Quote.',
                     'Opportunity is a renewal handled outside CPQ; suppressing.'],
    'CON-FOR-001':  ['Renewal Opportunity and Quote created; assigned to CSM.',
                     'Customer churned; updating Contract Status accordingly.',
                     'Renewal already in flight on a different Contract record.'],
    'AMD-FOR-001':  ['Effective date set; quote recalculated and re-activated.',
                     'Validation Rule added blocking null SBQQ__StartDate__c on activation.',
                     'Amendment is administrative-only; no proration needed.'],
    'AST-FOR-001':  ['Credit memo issued; account balance reconciled.',
                     'Termination flow updated to auto-generate credit records.',
                     'Termination is internal-only (no customer obligation); suppressing.'],
    'CT-FOR-001':   ['Contracted Price inactivated; open quotes recalculated.',
                     'Nightly cleanup job scheduled to retire expired CPs.',
                     'Contracted Price intentionally retained for audit history; suppressing.'],
    'MDQ-FOR-001':  ['Segment pricing reconciled with escalator schedule applied.',
                     'Approval captured for differentiated per-segment pricing.',
                     'MDQ drift acceptable per customer-signed amendment; suppressing.'],
}

NAME_MAP = {
    'REN_001': 'REN-001', 'REN_002': 'REN-002', 'REN_003': 'REN-003', 'REN_004': 'REN-004',
    'DSC_FOR_001': 'DSC-FOR-001', 'DSC_FOR_002': 'DSC-FOR-002',
    'QL_FOR_001': 'QL-FOR-001', 'QL_FOR_002': 'QL-FOR-002',
    'ORD_FOR_001': 'ORD-FOR-001', 'ORD_FOR_002': 'ORD-FOR-002', 'ORD_FOR_003': 'ORD-FOR-003',
    'SUB_FOR_001': 'SUB-FOR-001', 'PROV_FOR_001': 'PROV-FOR-001', 'PROV_FOR_002': 'PROV-FOR-002',
    'OPP_FOR_001': 'OPP-FOR-001', 'CON_FOR_001': 'CON-FOR-001', 'AMD_FOR_001': 'AMD-FOR-001',
    'AST_FOR_001': 'AST-FOR-001', 'CT_FOR_001': 'CT-FOR-001', 'MDQ_FOR_001': 'MDQ-FOR-001',
}

def xml_escape(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

cm_dir = 'force-app/main/default/customMetadata'
for fname in sorted(os.listdir(cm_dir)):
    if not fname.startswith('RemediationRecipe.') or not fname.endswith('.md-meta.xml'):
        continue
    devname = fname.replace('RemediationRecipe.', '').replace('.md-meta.xml', '')
    detector = NAME_MAP.get(devname)
    if not detector or detector not in SUGGESTIONS:
        print(f'SKIP {fname}: unknown detector')
        continue
    sugs = SUGGESTIONS[detector]
    path = os.path.join(cm_dir, fname)
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    if 'NoteSuggestion1__c' in content:
        continue
    new_block = ''
    for i, sug in enumerate(sugs, 1):
        new_block += f'    <values>\n        <field>NoteSuggestion{i}__c</field>\n        <value xsi:type="xsd:string">{xml_escape(sug)}</value>\n    </values>\n'
    content = content.replace('</CustomMetadata>', new_block + '</CustomMetadata>')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'OK {fname}')

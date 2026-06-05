/**
 * Phase 22r — generate ARM CategoryPerformanceCard__mdt records.
 *
 * The dashboard previously only had CPQ + BILLING section cards.
 * ARM-typed Connected Orgs need their own section so the user sees
 * meaningful per-category breakdowns of the 50+ ARM detectors instead
 * of CPQ/BILLING categories that don't apply.
 *
 * Run: node scripts/backfill-arm-cards.mjs
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// 12 cards covering the major ARM detector families. Detector lists
// drawn from the bundle classes (Phase 22c-1/c-2/c-3/c-4) so card
// coverage matches Apex implementation.
const ARM_CARDS = [
  {
    cardKey: 'arm_catalog',
    label: 'Catalog',
    icon: 'utility:product_workspace',
    detectors: ['ARM-001','ARM-002','ARM-002b','ARM-007','ARM-010','ARM-018','ARM-037'],
    seq: 1,
  },
  {
    cardKey: 'arm_selling_models',
    label: 'Selling Models',
    icon: 'utility:money',
    detectors: ['ARM-011','ARM-012','ARM-019','ARM-026'],
    seq: 2,
  },
  {
    cardKey: 'arm_bundles',
    label: 'Bundles',
    icon: 'utility:hierarchy',
    detectors: ['ARM-004','ARM-005','ARM-013','ARM-014','ARM-015','ARM-050','ARM-051'],
    seq: 3,
  },
  {
    cardKey: 'arm_attributes',
    label: 'Attributes',
    icon: 'utility:filterList',
    detectors: ['ARM-024','ARM-025'],
    seq: 4,
  },
  {
    cardKey: 'arm_pricing',
    label: 'Rate Cards & Pricing',
    icon: 'utility:currency',
    detectors: ['ARM-003','ARM-016','ARM-017','ARM-020','ARM-021','ARM-022','ARM-023'],
    seq: 5,
  },
  {
    cardKey: 'arm_decision_tables',
    label: 'Decision Tables',
    icon: 'utility:table',
    detectors: ['ARM-006','ARM-008','ARM-027','ARM-028','ARM-029','ARM-110','ARM-111','ARM-112'],
    seq: 6,
  },
  {
    cardKey: 'arm_context',
    label: 'Context Definitions',
    icon: 'utility:settings',
    detectors: ['ARM-009','ARM-030'],
    seq: 7,
  },
  {
    cardKey: 'arm_orchestration',
    label: 'Orchestration',
    icon: 'utility:flow',
    detectors: ['ARM-045','ARM-046','ARM-047','ARM-048','ARM-171'],
    seq: 8,
  },
  {
    cardKey: 'arm_usage',
    label: 'Usage Management',
    icon: 'utility:metrics',
    detectors: ['ARM-040','ARM-041','ARM-042','ARM-043','ARM-044'],
    seq: 9,
  },
  {
    cardKey: 'arm_billing_policy',
    label: 'Billing Policy',
    icon: 'utility:billing_statement',
    detectors: ['ARM-190','ARM-191','ARM-192','ARM-193'],
    seq: 10,
  },
  {
    cardKey: 'arm_deferred_pricing',
    label: 'Deferred Pricing',
    icon: 'utility:clock',
    detectors: ['ARM-130','ARM-131','ARM-132','ARM-133'],
    seq: 11,
  },
  {
    cardKey: 'arm_clauses',
    label: 'Clauses',
    icon: 'utility:file',
    detectors: ['ARM-120','ARM-121','ARM-122','ARM-210','ARM-211','ARM-212','ARM-213','ARM-214'],
    seq: 12,
  },
];

const dir = resolve('salesforce/force-app/main/default/customMetadata');
function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
for (const c of ARM_CARDS) {
  const labelEsc = xmlEscape(c.label);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" fqn="CategoryPerformanceCard__mdt.${c.cardKey}">
    <label>${labelEsc}</label>
    <protected>false</protected>
    <values><field>SectionKey__c</field><value xsi:type="xsd:string">arm</value></values>
    <values><field>CardKey__c</field><value xsi:type="xsd:string">${c.cardKey}</value></values>
    <values><field>Label__c</field><value xsi:type="xsd:string">${labelEsc}</value></values>
    <values><field>IconName__c</field><value xsi:type="xsd:string">${c.icon}</value></values>
    <values><field>DetectorIds__c</field><value xsi:type="xsd:string">${c.detectors.join(',')}</value></values>
    <values><field>Sequence__c</field><value xsi:type="xsd:double">${c.seq}</value></values>
    <values><field>IsActive__c</field><value xsi:type="xsd:boolean">true</value></values>
</CustomMetadata>
`;
  const path = resolve(dir, `CategoryPerformanceCard.${c.cardKey}.md-meta.xml`);
  writeFileSync(path, xml);
  console.log(`  ✓ ${c.cardKey.padEnd(24)} → ${c.detectors.length} detectors  (${c.label})`);
}
console.log(`\nDone. Created ${ARM_CARDS.length} ARM card(s).`);

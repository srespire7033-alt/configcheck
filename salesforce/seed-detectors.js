// Phase 19a — seed 20 Detector__mdt records based on existing detector values.
const fs = require('fs');
const path = require('path');

// [DeveloperName, DetectorId, Label, Category, AppliesTo, Critical, Warning, Recoverability, Effort]
const DETECTORS = [
  ['REN_001', 'REN-001', 'Renewal uplift suppressed', 'revenue', 'CPQ;CPQ+Billing;ARM', 10000, 1000, 0.9, 'medium'],
  ['REN_002', 'REN-002', 'Renewal below current list', 'pricing', 'CPQ;CPQ+Billing;ARM', 10000, 1000, 0.85, 'medium'],
  ['REN_003', 'REN-003', 'Renewal forecast slipping', 'pipeline', 'CPQ;CPQ+Billing;ARM', 50000, 5000, 0.7, 'low'],
  ['REN_004', 'REN-004', 'Renewal quote stuck in draft', 'pipeline', 'CPQ;CPQ+Billing;ARM', 10000, 1000, 0.6, 'low'],
  ['DSC_FOR_001', 'DSC-FOR-001', 'Expired promo discount applied', 'pricing', 'CPQ;CPQ+Billing;ARM', 10000, 1000, 0.6, 'medium'],
  ['DSC_FOR_002', 'DSC-FOR-002', 'Stacked discounts past cap', 'pricing', 'CPQ;CPQ+Billing;ARM', 10000, 1000, 0.65, 'medium'],
  ['QL_FOR_001', 'QL-FOR-001', 'Bundle required option at $0', 'revenue', 'CPQ;CPQ+Billing', 10000, 1000, 0.9, 'medium'],
  ['QL_FOR_002', 'QL-FOR-002', 'Quote line approval skipped', 'governance', 'CPQ;CPQ+Billing;ARM', 10000, 1000, 0.7, 'low'],
  ['ORD_FOR_001', 'ORD-FOR-001', 'Order activated, no billing schedule', 'revenue', 'CPQ+Billing', 50000, 5000, 0.95, 'high'],
  ['ORD_FOR_002', 'ORD-FOR-002', 'Q-to-O variance (new business)', 'revenue', 'CPQ;CPQ+Billing;ARM', 10000, 1000, 0.75, 'medium'],
  ['ORD_FOR_003', 'ORD-FOR-003', 'Q-to-O variance (amendment)', 'revenue', 'CPQ;CPQ+Billing;ARM', 10000, 1000, 0.75, 'medium'],
  ['SUB_FOR_001', 'SUB-FOR-001', 'Subscription quantity drift', 'revenue', 'CPQ;CPQ+Billing;ARM', 10000, 1000, 0.8, 'medium'],
  ['PROV_FOR_001', 'PROV-FOR-001', 'Provisioned, not billed', 'revenue', 'CPQ+Billing;ARM', 10000, 1000, 0.85, 'high'],
  ['PROV_FOR_002', 'PROV-FOR-002', 'Active subscription, no asset', 'revenue', 'CPQ+Billing;ARM', 10000, 1000, 0.7, 'medium'],
  ['OPP_FOR_001', 'OPP-FOR-001', 'Opportunity closed-won, no quote', 'governance', 'CPQ;CPQ+Billing;ARM', 50000, 5000, 0.5, 'low'],
  ['CON_FOR_001', 'CON-FOR-001', 'Contract activated, all subs expired', 'governance', 'CPQ;CPQ+Billing;ARM', 50000, 5000, 0.65, 'low'],
  ['AMD_FOR_001', 'AMD-FOR-001', 'Amendment without effective date', 'governance', 'CPQ;CPQ+Billing;ARM', 10000, 1000, 0.8, 'low'],
  ['AST_FOR_001', 'AST-FOR-001', 'Asset terminated, no credit', 'revenue', 'CPQ+Billing;ARM', 10000, 1000, 0.8, 'high'],
  ['CT_FOR_001', 'CT-FOR-001', 'Contracted price expired', 'pricing', 'CPQ;CPQ+Billing;ARM', 10000, 1000, 0.85, 'medium'],
  ['MDQ_FOR_001', 'MDQ-FOR-001', 'MDQ segment pricing inconsistency', 'pricing', 'CPQ;CPQ+Billing;ARM', 10000, 1000, 0.7, 'high'],
];

const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dir = 'force-app/main/default/customMetadata';
DETECTORS.forEach(([devname, did, label, category, appliesTo, crit, warn, recov, effort]) => {
  const fname = path.join(dir, `Detector.${devname}.md-meta.xml`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" fqn="Detector__mdt.${devname}">
    <label>${escape(did)}</label>
    <protected>false</protected>
    <values><field>DetectorId__c</field><value xsi:type="xsd:string">${escape(did)}</value></values>
    <values><field>Label__c</field><value xsi:type="xsd:string">${escape(label)}</value></values>
    <values><field>Category__c</field><value xsi:type="xsd:string">${escape(category)}</value></values>
    <values><field>AppliesTo__c</field><value xsi:type="xsd:string">${escape(appliesTo)}</value></values>
    <values><field>CriticalThresholdUsd__c</field><value xsi:type="xsd:double">${crit}</value></values>
    <values><field>WarningThresholdUsd__c</field><value xsi:type="xsd:double">${warn}</value></values>
    <values><field>RecoverabilityScore__c</field><value xsi:type="xsd:double">${recov}</value></values>
    <values><field>Effort__c</field><value xsi:type="xsd:string">${escape(effort)}</value></values>
    <values><field>IsActive__c</field><value xsi:type="xsd:boolean">true</value></values>
    <values><field>Version__c</field><value xsi:type="xsd:double">1</value></values>
</CustomMetadata>
`;
  fs.writeFileSync(fname, xml);
  console.log('OK', fname);
});
console.log(`Total: ${DETECTORS.length}`);

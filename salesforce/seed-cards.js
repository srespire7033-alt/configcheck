// Phase 20c — seed 30 CategoryPerformanceCard__mdt records from the
// hardcoded CPQ_DEFS / BILLING_DEFS arrays in CategoryPerformanceController.cls.
const fs = require('fs');
const path = require('path');

// [section, cardKey, label, icon, detectorIdsCsv]
const CARDS = [
  // CPQ section (22 cards) — order matches the existing CPQ_DEFS array
  ['cpq', 'products',       'Products',        'utility:product_required',    'PROV-FOR-001,PROV-FOR-002'],
  ['cpq', 'approvals',      'Approvals',       'utility:approval',            'QL-FOR-002'],
  ['cpq', 'bundles',        'Bundles',         'utility:layers',              'QL-FOR-001,PROV-FOR-002'],
  ['cpq', 'config_attrs',   'Config Attrs',    'utility:setup',               ''],
  ['cpq', 'contracted',     'Contracted',      'utility:contract',            'CT-FOR-001,CON-FOR-001'],
  ['cpq', 'discounts',      'Discounts',       'utility:money',               'DSC-FOR-001,DSC-FOR-002'],
  ['cpq', 'guided_selling', 'Guided Selling',  'utility:guidance',            ''],
  ['cpq', 'impact',         'Impact',          'utility:chart',               'AST-FOR-001'],
  ['cpq', 'lookups',        'Lookups',         'utility:search',              ''],
  ['cpq', 'performance',    'Performance',     'utility:speedometer',         ''],
  ['cpq', 'price_rules',    'Price Rules',     'utility:currency',            'REN-002,REN-001'],
  ['cpq', 'product_rules',  'Product Rules',   'utility:rules',               ''],
  ['cpq', 'qcp',            'QCP',             'utility:apex',                ''],
  ['cpq', 'quote_lines',    'Quote Lines',     'utility:quotes',              'QL-FOR-001,QL-FOR-002'],
  ['cpq', 'adv_pricing',    'Adv. Pricing',    'utility:advanced_function',   'MDQ-FOR-001'],
  ['cpq', 'cpq_settings',   'CPQ Settings',    'utility:settings',            ''],
  ['cpq', 'templates',      'Templates',       'utility:file',                ''],
  ['cpq', 'subscriptions',  'Subscriptions',   'utility:refresh',             'SUB-FOR-001,REN-003,REN-004'],
  ['cpq', 'summary_vars',   'Summary Vars',    'utility:variable',            ''],
  ['cpq', 'opportunity',    'Opportunity',     'utility:opportunity',         'OPP-FOR-001'],
  ['cpq', 'amendments',     'Amendments',      'utility:edit',                'AMD-FOR-001'],
  ['cpq', 'orders',         'Orders',          'utility:orders',              'ORD-FOR-002,ORD-FOR-003'],
  // BILLING section (8 cards)
  ['billing', 'billing_rules', 'Billing Rules', 'utility:rules',                    'ORD-FOR-001'],
  ['billing', 'finance_books', 'Finance Books', 'utility:knowledge_base',           ''],
  ['billing', 'gl_rules',      'GL Rules',      'utility:advanced_function',        ''],
  ['billing', 'invoicing',     'Invoicing',     'utility:list',                     ''],
  ['billing', 'legal_entity',  'Legal Entity',  'utility:case',                     ''],
  ['billing', 'billing_config','Billing Config','utility:setup_assistant_guide',    'ORD-FOR-001'],
  ['billing', 'rev_rec',       'Rev Rec',       'utility:percent',                  ''],
  ['billing', 'tax_rules',     'Tax Rules',     'utility:money',                    ''],
];

const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dir = 'force-app/main/default/customMetadata';

// Sequence is per-section, incrementing
let cpqSeq = 0, billingSeq = 0;
CARDS.forEach(([section, key, label, icon, detectors]) => {
  const seq = section === 'cpq' ? ++cpqSeq : ++billingSeq;
  // mdt DeveloperName must be alphanumeric/underscore
  const devname = key.replace(/[^a-zA-Z0-9_]/g, '_');
  const fname = path.join(dir, `CategoryPerformanceCard.${devname}.md-meta.xml`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" fqn="CategoryPerformanceCard__mdt.${devname}">
    <label>${escape(label)}</label>
    <protected>false</protected>
    <values><field>SectionKey__c</field><value xsi:type="xsd:string">${escape(section)}</value></values>
    <values><field>CardKey__c</field><value xsi:type="xsd:string">${escape(key)}</value></values>
    <values><field>Label__c</field><value xsi:type="xsd:string">${escape(label)}</value></values>
    <values><field>IconName__c</field><value xsi:type="xsd:string">${escape(icon)}</value></values>
    <values><field>DetectorIds__c</field><value xsi:type="xsd:string">${escape(detectors)}</value></values>
    <values><field>Sequence__c</field><value xsi:type="xsd:double">${seq}</value></values>
    <values><field>IsActive__c</field><value xsi:type="xsd:boolean">true</value></values>
</CustomMetadata>
`;
  fs.writeFileSync(fname, xml);
  console.log('OK', fname);
});
console.log(`Total: ${CARDS.length}`);

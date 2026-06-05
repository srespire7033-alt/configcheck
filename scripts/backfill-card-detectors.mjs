/**
 * Phase 22p — back-fill CategoryPerformanceCard__mdt.DetectorIds__c.
 *
 * Before: 24/30 cards had empty DetectorIds__c, and the 6 populated
 * ones only knew the Phase 12-era forensic detectors (REN-*, ORD-FOR-*,
 * etc.) — none of the Phase 22a/b/c-ported health-check detectors
 * (PR-*, ARM-*, BR-*, GL-*, ...). The category-performance grid
 * therefore showed "100% / No issues" for every card while the hero
 * correctly reported 64 findings.
 *
 * This script rewrites the DetectorIds__c element on every card .md-meta.xml
 * with the canonical detector list derived from the Detector__mdt
 * inventory + prefix-based taxonomy.
 *
 * Run: node scripts/backfill-card-detectors.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const CARDS = {
  // ── CPQ section ──
  bundles:        ['BN-001','BN-002','BN-003','BN-004','BN-005','BN-006','QL-FOR-001','PROV-FOR-002'],
  config_attrs:   ['CA-001','CA-002','CA-003','CA-004','TF-001'],
  contracted:     ['CP-001','CP-002','CP-003','CT-FOR-001','CON-FOR-001'],
  cpq_settings:   ['SET-001','SET-002','SET-003','SET-004'],
  discounts:      ['DS-001','DS-002','DS-003','DS-004','DSC-FOR-001','DSC-FOR-002'],
  guided_selling: ['GS-001','GS-002','GS-003','GS-004'],
  impact:         ['IA-001','IA-002','IA-003','IA-004','IA-005','IA-006','AST-FOR-001'],
  lookups:        ['LQ-001','LQ-002','LQ-003','LQ-004','LQ-005'],
  products:       ['PB-001','PB-002','PB-003','PB-004','UA-001','UA-003','PROV-FOR-001','PROV-FOR-002'],
  performance:    ['PERF-001','PERF-002','PERF-003','PERF-004','PERF-005'],
  price_rules:    ['PR-001','PR-002','PR-003','PR-004','PR-005','REN-001','REN-002'],
  product_rules:  ['PRD-001','PRD-002','PRD-003','PRD-004'],
  qcp:            ['QCP-001','QCP-002','QCP-003','QCP-004'],
  quote_lines:    ['QL-001','QL-002','QL-003','QL-004','QL-FOR-001','QL-FOR-002'],
  adv_pricing:    ['AP-001','AP-002','AP-003','AP-004','AP-005','MDQ-FOR-001'],
  templates:      ['QT-001','QT-002','QT-003','QT-004','QT-005'],
  subscriptions:  ['SR-001','SR-002','SR-003','SR-004','SUB-FOR-001','REN-003','REN-004'],
  summary_vars:   ['SV-001','SV-002','SV-003','SV-004','SV-005','SV-006'],
  opportunity:    ['OPP-FOR-001'],
  amendments:     ['AMD-FOR-001'],
  approvals:      ['AR-001','AR-002','AR-003','AR-004','AR-005','QL-FOR-002'],
  orders:         ['ORD-FOR-001','ORD-FOR-002','ORD-FOR-003'],
  // ── BILLING section ──
  billing_rules:  ['BR-001','BR-002','BR-003','BR-004'],
  finance_books:  ['FB-001','FB-002','FB-003','FB-004','FB-005','FB-006','FB-007'],
  gl_rules:       ['GL-001','GL-002','GL-003','GL-004','GL-005'],
  invoicing:      ['INV-001','INV-002','INV-003','INV-004','INV-005'],
  legal_entity:   ['LE-001','LE-002','LE-003','LE-004'],
  billing_config: ['PBC-001','PBC-002','PBC-003','PBC-004','PBC-005','PBC-006','ORD-FOR-001'],
  rev_rec:        ['RR-001','RR-002','RR-003','RR-004'],
  tax_rules:      ['TR-001','TR-002','TR-003','TR-004'],
};

const dir = resolve('salesforce/force-app/main/default/customMetadata');
const files = readdirSync(dir).filter(f => f.startsWith('CategoryPerformanceCard.') && f.endsWith('.md-meta.xml'));

let touched = 0;
let skipped = 0;
for (const file of files) {
  const cardKey = file.replace('CategoryPerformanceCard.', '').replace('.md-meta.xml', '');
  const dets = CARDS[cardKey];
  if (!dets) {
    console.log(`  ⚠ skip ${cardKey} — no taxonomy entry`);
    skipped++;
    continue;
  }
  const fullPath = resolve(dir, file);
  const before = readFileSync(fullPath, 'utf8');
  // Replace the existing DetectorIds__c value (empty or otherwise) with our canonical list.
  // Regex tolerates whitespace and arbitrary existing content.
  const re = /<values><field>DetectorIds__c<\/field><value xsi:type="xsd:string">[^<]*<\/value><\/values>/;
  const replacement = `<values><field>DetectorIds__c</field><value xsi:type="xsd:string">${dets.join(',')}</value></values>`;
  if (!re.test(before)) {
    console.log(`  ⚠ skip ${cardKey} — DetectorIds__c block not found`);
    skipped++;
    continue;
  }
  const after = before.replace(re, replacement);
  writeFileSync(fullPath, after);
  console.log(`  ✓ ${cardKey.padEnd(16)} → ${dets.length} detectors`);
  touched++;
}
console.log(`\nDone. Updated ${touched} card(s); skipped ${skipped}.`);

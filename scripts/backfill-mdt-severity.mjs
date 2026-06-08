#!/usr/bin/env node
// Phase 24a — backfill Severity__c on Detector.*.md-meta.xml records.
// Reads /tmp/vercel-sev.csv (detectorId,severity lower-case) and either
// inserts a new <values> block or updates the existing one.

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const csv = readFileSync(process.env.TEMP ? process.env.TEMP + '/vercel-sev.csv' : '/tmp/vercel-sev.csv', 'utf8');
const SEV = new Map();
for (const line of csv.split(/\r?\n/)) {
  if (!line) continue;
  const [id, sev] = line.split(',');
  if (!id || !sev) continue;
  // Capitalise to match the picklist convention (Critical/Warning/Info).
  SEV.set(id, sev[0].toUpperCase() + sev.slice(1));
}
console.log(`Loaded ${SEV.size} Vercel severities.`);

const dir = 'salesforce/force-app/main/default/customMetadata';
const files = readdirSync(dir).filter(f => f.startsWith('Detector.') && f.endsWith('.md-meta.xml'));
console.log(`Found ${files.length} Detector mdt files.`);

let updated = 0, skipped = 0, missing = 0;
const sevBlock = (s) =>
  `    <values><field>Severity__c</field><value xsi:type="xsd:string">${s}</value></values>\n`;

for (const f of files) {
  const path = join(dir, f);
  const xml = readFileSync(path, 'utf8');
  // Detector ID lives in the DetectorId__c value block.
  const idMatch = xml.match(/<field>DetectorId__c<\/field><value[^>]*>([^<]+)</);
  if (!idMatch) { console.warn(`  no DetectorId in ${f}`); continue; }
  const id = idMatch[1];
  const sev = SEV.get(id);
  if (!sev) { missing++; continue; }

  // If Severity__c block already exists, update in place; else insert
  // before the closing </CustomMetadata>.
  if (xml.includes('<field>Severity__c</field>')) {
    const next = xml.replace(
      /<values><field>Severity__c<\/field><value[^>]*>[^<]*<\/value><\/values>/,
      `<values><field>Severity__c</field><value xsi:type="xsd:string">${sev}</value></values>`
    );
    if (next === xml) { skipped++; continue; }
    writeFileSync(path, next);
  } else {
    const next = xml.replace('</CustomMetadata>', sevBlock(sev) + '</CustomMetadata>');
    writeFileSync(path, next);
  }
  updated++;
}
console.log(`Updated ${updated} files. Skipped ${skipped} (no change). Missing in Vercel: ${missing}.`);

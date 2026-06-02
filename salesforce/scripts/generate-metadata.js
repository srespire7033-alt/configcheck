/**
 * Generates Custom Object + Field metadata XML for the OrgPrism
 * managed package.
 *
 * Why a generator: 55+ field XMLs is a lot of boilerplate. Defining
 * the schema in one JS file + emitting XML keeps the data model
 * specification readable and easy to evolve. Re-run any time the
 * model changes:
 *
 *   node salesforce/scripts/generate-metadata.js
 *
 * Idempotent — overwrites existing files.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'force-app', 'main', 'default', 'objects');

// ───────────────────────────────────────────────────────────────
// Field type builders
// ───────────────────────────────────────────────────────────────
function text(name, label, length = 255, required = false, externalId = false) {
  return { name, label, type: 'Text', length, required, externalId };
}
function longText(name, label, length = 32768) {
  return { name, label, type: 'LongTextArea', length, visibleLines: 5 };
}
function currency(name, label, scale = 2) {
  return { name, label, type: 'Currency', precision: 18, scale };
}
function number(name, label, precision = 18, scale = 0) {
  return { name, label, type: 'Number', precision, scale };
}
function dt(name, label) {
  return { name, label, type: 'DateTime' };
}
function bool(name, label, defaultValue = false) {
  return { name, label, type: 'Checkbox', defaultValue };
}
function picklist(name, label, values, restricted = true) {
  return { name, label, type: 'Picklist', values, restricted };
}
function lookup(name, label, referenceTo, relName, relLabel, required = false) {
  return { name, label, type: 'Lookup', referenceTo, relationshipName: relName, relationshipLabel: relLabel, required };
}

// ───────────────────────────────────────────────────────────────
// Object specs
// ───────────────────────────────────────────────────────────────
const objects = {
  ForensicScan__c: {
    label: 'Forensic Scan',
    pluralLabel: 'Forensic Scans',
    description: 'One row per scan run. Findings + traces + recoveries hang off it.',
    autoNumberFormat: 'FS-{0000}',
    fields: [
      picklist('Status__c', 'Status', ['Queued', 'Running', 'Reconciling', 'Attributing', 'Completed', 'Partial', 'Failed']),
      picklist('ProductType__c', 'Product Type', ['CPQ', 'CPQ+Billing', 'ARM']),
      dt('StartedAt__c', 'Started At'),
      dt('CompletedAt__c', 'Completed At'),
      currency('TotalLeakageUsd__c', 'Total Leakage USD'),
      number('FindingCount__c', 'Finding Count', 18, 0),
      longText('ErrorMessage__c', 'Error Message', 1000),
    ],
  },

  ForensicFinding__c: {
    label: 'Forensic Finding',
    pluralLabel: 'Forensic Findings',
    description: 'One row per leak record. The heart of the data model.',
    autoNumberFormat: 'FF-{00000}',
    fields: [
      lookup('ForensicScan__c', 'Forensic Scan', 'ForensicScan__c', 'Findings', 'Findings'),
      text('DetectorId__c', 'Detector Id', 32, true),
      picklist('Severity__c', 'Severity', ['Critical', 'Warning', 'Info']),
      currency('EntitledUsd__c', 'Entitled USD'),
      currency('RealizedUsd__c', 'Realized USD'),
      currency('GapUsd__c', 'Gap USD'),
      number('RecoverabilityScore__c', 'Recoverability Score', 3, 2),
      text('Title__c', 'Title', 255, true),
      longText('Description__c', 'Description'),
      text('PrimaryRecordType__c', 'Primary Record Type', 80),
      text('PrimaryRecordId__c', 'Primary Record Id', 18, false, true),
      longText('SourceRecordRefs__c', 'Source Record Refs (JSON)'),
      longText('Metadata__c', 'Metadata (JSON)'),
      picklist('Status__c', 'Status', ['Open', 'Resolved']),
      dt('HiddenAt__c', 'Hidden At'),
      longText('ConsultantNote__c', 'Consultant Note', 4000),
      dt('ConsultantNoteUpdatedAt__c', 'Consultant Note Updated At'),
      dt('DetectedAt__c', 'Detected At'),
    ],
  },

  AttributionTrace__c: {
    label: 'Attribution Trace',
    pluralLabel: 'Attribution Traces',
    description: 'Root cause + evidence per finding. Multiple traces per finding allowed (ranked by confidence).',
    autoNumberFormat: 'AT-{00000}',
    fields: [
      lookup('ForensicFinding__c', 'Forensic Finding', 'ForensicFinding__c', 'AttributionTraces', 'Attribution Traces'),
      picklist('RootCauseClass__c', 'Root Cause Class', ['A', 'B', 'C', 'D', 'E']),
      text('RootConfigType__c', 'Root Config Type', 80),
      text('RootConfigId__c', 'Root Config Id', 18),
      text('RootConfigName__c', 'Root Config Name', 255),
      text('ReasonCode__c', 'Reason Code', 80),
      number('Confidence__c', 'Confidence', 3, 2),
      longText('Evidence__c', 'Evidence (JSON)'),
      longText('AiExplanation__c', 'AI Explanation', 8000),
      longText('AiSuggestedFix__c', 'AI Suggested Fix', 8000),
      text('AiModel__c', 'AI Model', 60),
    ],
  },

  RecoveryAction__c: {
    label: 'Recovery Action',
    pluralLabel: 'Recovery Actions',
    description: 'Staged fix workflow. State machine: Pending → Approved → Committed (or Rejected/Expired).',
    autoNumberFormat: 'RA-{00000}',
    fields: [
      lookup('ForensicFinding__c', 'Forensic Finding', 'ForensicFinding__c', 'RecoveryActions', 'Recovery Actions', true),
      picklist('ApprovalStatus__c', 'Approval Status', ['Pending', 'Approved', 'Rejected', 'Committed', 'Expired']),
      currency('ProjectedReclaimUsd__c', 'Projected Reclaim USD'),
      longText('DraftPayload__c', 'Draft Payload (JSON)'),
      dt('ApprovedAt__c', 'Approved At'),
      dt('CommittedAt__c', 'Committed At'),
      bool('CommitVerified__c', 'Commit Verified', false),
      longText('VerificationMessage__c', 'Verification Message', 2000),
      text('ExpectedValue__c', 'Expected Value', 255),
      text('ActualValue__c', 'Actual Value', 255),
      longText('Metadata__c', 'Metadata (JSON)'),
    ],
  },

  CheckSuppression__c: {
    label: 'Check Suppression',
    pluralLabel: 'Check Suppressions',
    description: 'Per-install false-positive memory. Future scans skip suppressed check_ids.',
    autoNumberFormat: 'CS-{0000}',
    fields: [
      text('CheckId__c', 'Check Id', 32, true, true),
      text('Reason__c', 'Reason', 255),
      lookup('SuppressedBy__c', 'Suppressed By', 'User', 'OrgPrismSuppressions', 'OrgPrism Suppressions'),
      dt('SuppressedAt__c', 'Suppressed At'),
    ],
  },
};

// ───────────────────────────────────────────────────────────────
// XML builders
// ───────────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function objectXml(apiName, spec) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <allowInChatterGroups>false</allowInChatterGroups>
    <compactLayoutAssignment>SYSTEM</compactLayoutAssignment>
    <deploymentStatus>Deployed</deploymentStatus>
    <description>${esc(spec.description)}</description>
    <enableActivities>false</enableActivities>
    <enableBulkApi>true</enableBulkApi>
    <enableFeeds>false</enableFeeds>
    <enableHistory>false</enableHistory>
    <enableReports>true</enableReports>
    <enableSearch>true</enableSearch>
    <enableSharing>true</enableSharing>
    <enableStreamingApi>true</enableStreamingApi>
    <label>${esc(spec.label)}</label>
    <nameField>
        <displayFormat>${esc(spec.autoNumberFormat)}</displayFormat>
        <label>${esc(spec.label)} ID</label>
        <type>AutoNumber</type>
    </nameField>
    <pluralLabel>${esc(spec.pluralLabel)}</pluralLabel>
    <searchLayouts/>
    <sharingModel>ReadWrite</sharingModel>
</CustomObject>
`;
}

function fieldXml(f) {
  let body = `    <fullName>${esc(f.name)}</fullName>\n`;
  body += `    <label>${esc(f.label)}</label>\n`;
  body += `    <type>${f.type}</type>\n`;

  switch (f.type) {
    case 'Text':
      body += `    <length>${f.length}</length>\n`;
      body += `    <required>${!!f.required}</required>\n`;
      body += `    <unique>false</unique>\n`;
      if (f.externalId) body += `    <externalId>true</externalId>\n`;
      break;
    case 'LongTextArea':
      body += `    <length>${f.length}</length>\n`;
      body += `    <visibleLines>${f.visibleLines || 5}</visibleLines>\n`;
      break;
    case 'Currency':
      body += `    <precision>${f.precision}</precision>\n`;
      body += `    <scale>${f.scale}</scale>\n`;
      break;
    case 'Number':
      body += `    <precision>${f.precision}</precision>\n`;
      body += `    <scale>${f.scale}</scale>\n`;
      break;
    case 'DateTime':
      // No extra params
      break;
    case 'Checkbox':
      body += `    <defaultValue>${f.defaultValue ? 'true' : 'false'}</defaultValue>\n`;
      break;
    case 'Picklist':
      body += `    <valueSet>\n`;
      body += `        <restricted>${!!f.restricted}</restricted>\n`;
      body += `        <valueSetDefinition>\n`;
      body += `            <sorted>false</sorted>\n`;
      for (const v of f.values) {
        body += `            <value>\n`;
        body += `                <fullName>${esc(v)}</fullName>\n`;
        body += `                <default>false</default>\n`;
        body += `                <label>${esc(v)}</label>\n`;
        body += `            </value>\n`;
      }
      body += `        </valueSetDefinition>\n`;
      body += `    </valueSet>\n`;
      break;
    case 'Lookup':
      body += `    <referenceTo>${esc(f.referenceTo)}</referenceTo>\n`;
      body += `    <relationshipName>${esc(f.relationshipName)}</relationshipName>\n`;
      body += `    <relationshipLabel>${esc(f.relationshipLabel)}</relationshipLabel>\n`;
      body += `    <required>${!!f.required}</required>\n`;
      body += `    <deleteConstraint>SetNull</deleteConstraint>\n`;
      break;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
${body}</CustomField>
`;
}

// ───────────────────────────────────────────────────────────────
// Emit files
// ───────────────────────────────────────────────────────────────
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

let objectCount = 0;
let fieldCount = 0;
for (const [apiName, spec] of Object.entries(objects)) {
  const objDir = path.join(ROOT, apiName);
  ensureDir(objDir);
  fs.writeFileSync(path.join(objDir, `${apiName}.object-meta.xml`), objectXml(apiName, spec));
  objectCount += 1;

  const fieldsDir = path.join(objDir, 'fields');
  ensureDir(fieldsDir);
  for (const f of spec.fields) {
    fs.writeFileSync(path.join(fieldsDir, `${f.name}.field-meta.xml`), fieldXml(f));
    fieldCount += 1;
  }
}

console.log(`Generated ${objectCount} objects, ${fieldCount} fields.`);

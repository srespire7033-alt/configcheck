# OrgPrism Managed Package — Salesforce-Native Build

This subdirectory holds the Salesforce metadata (Apex, LWC, Custom Objects)
that compiles into the OrgPrism managed package. The SaaS web app at the
repo root remains the consultant control plane; this is what installs into
each client's Salesforce org.

## Status

> 🚧 **Day 0 of the managed-package build.** Code is being written
> against a fresh PDE org allocation. Nothing has been deployed yet.

## Architecture at a glance

```
salesforce/
├── force-app/main/default/
│   ├── objects/        — Custom Objects (5 of them)
│   ├── classes/        — Apex (detectors, framework, services, tests)
│   ├── lwc/            — Lightning Web Components (dashboard UI)
│   ├── permissionsets/ — OrgPrism access role
│   ├── tabs/           — Custom Tabs for the LWC pages
│   └── applications/   — Custom App (navigation menu)
├── config/
│   └── project-scratch-def.json  — Scratch-org template
├── sfdx-project.json   — SFDX project descriptor
└── DATA-MODEL.md       — ERD + field-level spec
```

## Namespace

`orgprism` — every Custom Object + field + Apex class gets prefixed
`orgprism__` in customer orgs. The namespace is **not** in source code;
SFDX applies it at packaging time.

## Deploy from scratch

### Prerequisites

1. Salesforce CLI (`sf` v2): https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_install_cli.htm
2. A Partner Developer Edition (PDE) org from Salesforce (used as the
   Packaging org)
3. (Optional) A Dev Hub org for scratch-org-based development

### One-time setup

```bash
cd salesforce

# Authenticate to the PDE org
sf org login web --alias pde --set-default

# (Optional) Authenticate the Dev Hub
sf org login web --alias devhub --set-default-dev-hub
```

### Deploy to the PDE org

```bash
# From this directory
sf project deploy start --target-org pde
sf apex run test --target-org pde --code-coverage --result-format human
```

### Run the package in a scratch org (development)

```bash
sf org create scratch --target-dev-hub devhub --definition-file config/project-scratch-def.json --alias orgprism-scratch --duration-days 7
sf project deploy start --target-org orgprism-scratch
sf org open --target-org orgprism-scratch
```

### Create a managed package version (when ready to ship)

```bash
# First time: create the package (PDE org must be set up as Packaging org)
sf package create --name OrgPrism --description "OrgPrism CPQ Audit + Recovery" --package-type Managed --path force-app

# Each release: create a new version
sf package version create --package OrgPrism --installation-key-bypass --wait 30

# The output gives an install URL like:
# https://login.salesforce.com/packaging/installPackage.apexp?p0=04t...
# Customers paste this in their browser to install.
```

## Data model

See `DATA-MODEL.md` for the full ERD + field-level spec. TL;DR:

- **ForensicScan__c** — one row per scan run
- **ForensicFinding__c** — many per scan, the leak records
- **AttributionTrace__c** — root cause of each finding
- **RecoveryAction__c** — staged fixes, state machine
- **CheckSuppression__c** — per-org false-positive memory

## Release plan

See `../docs/OrgPrism-Feature-Inventory.xlsx` → Release Plan tab.

**v1.0 (this build):**
- 5 Custom Objects + fields
- 5 detectors: REN-001, REN-002, DSC-FOR-001, ORD-FOR-001, QL-FOR-001
- Apex detector framework + tests (≥75% coverage)
- Permission Set
- One LWC: findings list

## SaaS parity tracking

The Excel feature inventory has a "Deployed (Package)" column where you
mark each feature **Yes / No / Partial** as it lands in this package.
When the column is mostly green, the managed package has feature parity
with the SaaS.

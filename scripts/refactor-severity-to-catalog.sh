#!/usr/bin/env bash
# Phase 24b — replace hardcoded severities with catalog lookup.
# Walks every detector/bundle file and rewrites:
#   r.severity = 'Critical';   →   r.severity = DetectorCatalogController.getSeverity(r.detectorId, 'Critical');
#   dr.severity = 'Warning';   →   dr.severity = DetectorCatalogController.getSeverity(dr.detectorId, 'Warning');
# The original hardcoded value becomes the fallback when catalog is silent.

set -u
count=0
for f in $(grep -rln "\.severity = ['\"]\(Critical\|Warning\|Info\)['\"]" \
                 salesforce/force-app/main/default/classes/*.cls \
           | grep -v Test); do
  # Identify the variable name on each line ($1 in regex below is dr / r / etc.)
  # and rewrite, preserving the original literal as fallback.
  perl -i -pe '
    s{\b(\w+)\.severity\s*=\s*['\''"](Critical|Warning|Info)['\''"]\s*;}
     {$1.severity = DetectorCatalogController.getSeverity($1.detectorId, '\''$2'\'');}g
  ' "$f"
  count=$((count + 1))
done
echo "Refactored $count files."
echo "Sanity: any remaining hardcoded severities?"
grep -rn "\.severity = ['\"]\(Critical\|Warning\|Info\)['\"]" \
     salesforce/force-app/main/default/classes/*.cls \
   | grep -v Test | wc -l

#!/usr/bin/env bash
# Phase 24a — extract id+severity pairs from Vercel check definitions.
# Outputs CSV: detectorId,severity sorted by id.

set -u
declare -A SEV
for f in $(find src/lib/analysis -name "*.ts" -type f); do
  # Walk the file, when we see "id: 'X-NNN'" remember it, then take the
  # next "severity: 'Y'" we see on the same record (definition top-level).
  awk '
    /^[[:space:]]*id:[[:space:]]*['\''"][A-Z]+-[0-9]+[a-zA-Z]*['\''"]/ {
      id = $0
      sub(/.*id:[[:space:]]*['\''"]/, "", id)
      sub(/['\''"].*/, "", id)
      current = id
      printed[current] = 0
    }
    /^[[:space:]]*severity:[[:space:]]*['\''"](critical|warning|info)['\''"]/ {
      if (current != "" && !printed[current]) {
        s = $0
        sub(/.*severity:[[:space:]]*['\''"]/, "", s)
        sub(/['\''"].*/, "", s)
        print current "," s
        printed[current] = 1
      }
    }
  ' "$f"
done | sort -u

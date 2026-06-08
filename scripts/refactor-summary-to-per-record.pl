#!/usr/bin/env perl
# Phase 24c — convert summary-style finding emission to per-record.
# Detects the canonical 7-line pattern emitted by 80+ evaluators and
# rewrites to a per-record loop. Preserves detector id, severity
# fallback, gapUsd, recoverability, and description text. Title text
# is reshaped from "N <noun>" to "<noun> — {name}".

use strict; use warnings;
sub read_file { local $/; open my $fh, '<', $_[0] or die "open $_[0]: $!"; <$fh> }
sub write_file { open my $fh, '>', $_[0] or die "open $_[0]: $!"; print $fh $_[1] }

my $changed = 0;
for my $f (@ARGV) {
    my $src = read_file($f);
    my $orig = $src;

    # Multi-line capture of the summary block.
    # Group 1: leading indentation
    # Group 2: detector id literal (e.g. 'ARM-021')
    # Group 3: severity-fallback expression (e.g. 'Warning')
    # Group 4: gapUsd numeric or expression
    # Group 5: recoverabilityScore numeric
    # Group 6: title expression (right of '=')
    # Group 7: description expression
    # Group 8: variable name carrying the bad-records list (bad, dropped, etc.)
    $src =~ s{
        ^(\s+)if\s*\(\s*(\w+)\.isEmpty\(\)\)\s*return\s+new\s+List<DetectorResult>\(\);\s*\n
        \s+DetectorResult\s+dr\s*=\s*new\s+DetectorResult\(\);\s*\n
        \s+dr\.detectorId\s*=\s*'([^']+)';\s*dr\.severity\s*=\s*DetectorCatalogController\.getSeverity\(\s*dr\.detectorId\s*,\s*'([^']+)'\s*\);\s*dr\.gapUsd\s*=\s*([^;]+?);\s*dr\.recoverabilityScore\s*=\s*([0-9.]+);\s*\n
        \s+dr\.title\s*=\s*(.+?);\s*\n
        \s+dr\.description\s*=\s*(.+?);\s*\n
        \s+dr\.primaryRecord\s*=\s*\2\[0\];\s*\n
        (?:\s+Integer\s+cap\s*=\s*Math\.min\([^;]+\);\s*\n)?
        \s+for\s*\(Integer\s+i\s*=\s*1\s*;\s*i\s*<\s*[^;]+;\s*i\+\+\)\s*dr\.supportingRecords\.add\(\2\[i\]\);\s*\n
        \s+return\s+new\s+List<DetectorResult>\s*\{\s*dr\s*\};
    }{
        my ($ind, $bad, $did, $sev, $gap, $rec, $title, $desc) =
           ($1, $2, $3, $4, $5, $6, $7, $8);
        # Reshape title — if it starts with `<varname>.size() + ' '` strip it,
        # then prepend the record name with em-dash.
        my $tplLit = $title;
        $tplLit =~ s/\Q$bad\E\.size\(\)\s*\+\s*//;
        # If still starts with quote, prepend record name; otherwise pass through.
        # Result example:  'X' becomes  '"' + sr.name + '" — X'
        my $titleExpr = "'\"' + _sr.name + '\" — ' + (" . $tplLit . ")";
        my $out =
"${ind}List<DetectorResult> _out = new List<DetectorResult>();\n"
."${ind}String _sev = DetectorCatalogController.getSeverity('${did}', '${sev}');\n"
."${ind}for (SourceRecord _sr : ${bad}) {\n"
."${ind}    DetectorResult dr = new DetectorResult();\n"
."${ind}    dr.detectorId = '${did}'; dr.severity = _sev; dr.gapUsd = ${gap}; dr.recoverabilityScore = ${rec};\n"
."${ind}    dr.title = ${titleExpr};\n"
."${ind}    dr.description = ${desc};\n"
."${ind}    dr.primaryRecord = _sr;\n"
."${ind}    _out.add(dr);\n"
."${ind}}\n"
."${ind}return _out;";
        $out;
    }gmex;

    if ($src ne $orig) {
        write_file($f, $src);
        $changed++;
        printf "Refactored %s\n", $f;
    }
}
print "Files changed: $changed\n";

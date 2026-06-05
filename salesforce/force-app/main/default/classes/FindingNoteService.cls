/**
 * Phase 13 — Finding notes service.
 *
 * Consultants need a place to write context on a finding ("Customer
 * confirmed, scheduling fix for Q3" / "Already credited via manual
 * journal entry") that survives across sessions and across consultant
 * handoffs. We store the text in ForensicFinding__c.UserNotes__c
 * (Long Text, 32k) and expose minimal CRUD via AuraEnabled methods
 * for the inline editor LWC.
 *
 * Why a service vs. raw Apex on the LWC?
 *   - Centralized FLS check on UserNotes__c
 *   - Server-side trimming + length cap so the UI can't accidentally
 *     write a 100MB string
 *   - One place to add audit logging if the consulting firm ever
 *     wants "who wrote this note when" later
 */
public with sharing class FindingNoteService {

    private static final Integer MAX_LENGTH = 32768;

    /**
     * Persist or clear the note on a finding. Pass an empty string
     * to clear. Returns the saved text (server-trimmed) so the LWC
     * can confirm the canonical value.
     */
    @AuraEnabled
    public static String saveNote(Id findingId, String notes) {
        if (findingId == null) {
            throw new AuraHandledException('findingId is required');
        }
        String clean = notes == null ? '' : notes.trim();
        if (clean.length() > MAX_LENGTH) clean = clean.substring(0, MAX_LENGTH);

        List<ForensicFinding__c> rows = [
            SELECT Id, UserNotes__c FROM ForensicFinding__c
            WHERE Id = :findingId WITH SECURITY_ENFORCED LIMIT 1
        ];
        if (rows.isEmpty()) {
            throw new AuraHandledException('Finding ' + findingId + ' not found');
        }
        rows[0].UserNotes__c = String.isBlank(clean) ? null : clean;
        update rows[0];
        return clean;
    }

    /**
     * Read the current note. Returns empty string if unset — LWC can
     * just bind it to a textarea without null-check ceremony.
     */
    @AuraEnabled(cacheable=true)
    public static String getNote(Id findingId) {
        if (findingId == null) return '';
        List<ForensicFinding__c> rows = [
            SELECT UserNotes__c FROM ForensicFinding__c
            WHERE Id = :findingId WITH SECURITY_ENFORCED LIMIT 1
        ];
        if (rows.isEmpty()) return '';
        return rows[0].UserNotes__c == null ? '' : rows[0].UserNotes__c;
    }

    /**
     * Phase 16c — single-call payload for the findingNotes LWC:
     * returns the current note text PLUS up to 3 suggestion chips
     * resolved from RemediationRecipe__mdt for this finding's
     * detector. Saves the LWC from two round-trips.
     */
    public class NoteBundle {
        @AuraEnabled public String notes;
        @AuraEnabled public List<String> suggestions;
    }

    @AuraEnabled(cacheable=true)
    public static NoteBundle getNoteBundle(Id findingId) {
        NoteBundle b = new NoteBundle();
        b.notes = '';
        b.suggestions = new List<String>();
        if (findingId == null) return b;

        List<ForensicFinding__c> rows = [
            SELECT UserNotes__c, DetectorId__c FROM ForensicFinding__c
            WHERE Id = :findingId WITH SECURITY_ENFORCED LIMIT 1
        ];
        if (rows.isEmpty()) return b;
        ForensicFinding__c f = rows[0];
        b.notes = f.UserNotes__c == null ? '' : f.UserNotes__c;

        if (String.isBlank(f.DetectorId__c)) return b;
        List<RemediationRecipe__mdt> recipes = [
            SELECT NoteSuggestion1__c, NoteSuggestion2__c, NoteSuggestion3__c
            FROM RemediationRecipe__mdt
            WHERE DetectorId__c = :f.DetectorId__c
            LIMIT 1
        ];
        if (recipes.isEmpty()) return b;
        RemediationRecipe__mdt r = recipes[0];
        if (String.isNotBlank(r.NoteSuggestion1__c)) b.suggestions.add(r.NoteSuggestion1__c);
        if (String.isNotBlank(r.NoteSuggestion2__c)) b.suggestions.add(r.NoteSuggestion2__c);
        if (String.isNotBlank(r.NoteSuggestion3__c)) b.suggestions.add(r.NoteSuggestion3__c);
        return b;
    }
}

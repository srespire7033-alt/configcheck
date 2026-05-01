import type { DBIssue, IssueCategory, IssueSeverity } from '@/types';

/**
 * Group recognised sibling-issue patterns under a single parent for the
 * "Top Issues to Address" display.
 *
 * Background: certain issue families consistently fire multiple times for
 * what is conceptually one configuration gap. The classic example is
 * "Active products missing X" appearing four times in the same scan
 * (missing billing rule / charge type / tax rule / rev rec rule). Showing
 * each as a top-priority item overwhelms the user, makes the problem feel
 * 4× bigger than it is, and is bad triage — the fix is the same checklist.
 *
 * This grouper recognises a small set of family patterns and folds them
 * into a parent, leaving everything else as a single item.
 */

export interface SingleTopItem {
  kind: 'single';
  issue: DBIssue;
}

export interface ParentTopItem {
  kind: 'parent';
  /** A virtual ID combining the family slug + category, for React keys. */
  id: string;
  title: string;
  /** Plain-language description of what links the children. */
  description: string;
  severity: IssueSeverity;
  category: IssueCategory;
  /**
   * Count of unique affected records across all children — distinct
   * from issue count. Avoids double-counting when the same product
   * appears under three "missing X" siblings.
   */
  uniqueAffectedRecords: number;
  children: DBIssue[];
}

export type TopIssueItem = SingleTopItem | ParentTopItem;

interface FamilyPattern {
  /** Stable slug used in the parent's id. */
  slug: string;
  /** Match an issue's title (regex test). */
  matches: (issue: DBIssue) => boolean;
  /** Build the parent's title from the matched children. */
  buildTitle: (children: DBIssue[]) => string;
  /** Build the parent's description from the matched children. */
  buildDescription: (children: DBIssue[]) => string;
}

const FAMILIES: FamilyPattern[] = [
  // "Active products missing X" sibling family — billing config gap
  {
    slug: 'products_missing_billing_config',
    matches: (i) =>
      i.category === 'product_billing_config' &&
      /^\s*\d*\s*active products? missing /i.test(i.title),
    buildTitle: (children) => {
      const totalAffected = unionOfAffectedIds(children).size;
      return `${totalAffected} active product${totalAffected !== 1 ? 's are' : ' is'} missing billing configuration (${children.length} related findings)`;
    },
    buildDescription: (children) => {
      const what = children
        .map((c) => extractMissingThing(c.title))
        .filter((s): s is string => Boolean(s));
      if (what.length === 0) {
        return 'Multiple billing-config requirements are unset on the same set of products. Fixing all of them is typically one workflow.';
      }
      const list =
        what.length <= 2
          ? what.join(' and ')
          : `${what.slice(0, -1).join(', ')}, and ${what[what.length - 1]}`;
      return `Affected products are missing ${list}. These usually need to be set together — fixing one without the others leaves the products half-configured.`;
    },
  },
  // "Active products without X" — same shape, different verb ("without"
  // vs "missing"). Some checks phrase the title this way.
  {
    slug: 'products_without_billing_config',
    matches: (i) =>
      i.category === 'product_billing_config' &&
      /^\s*\d*\s*active products? without /i.test(i.title),
    buildTitle: (children) => {
      const totalAffected = unionOfAffectedIds(children).size;
      return `${totalAffected} active product${totalAffected !== 1 ? 's are' : ' is'} missing billing configuration (${children.length} related findings)`;
    },
    buildDescription: (children) => {
      const what = children
        .map((c) => extractWithoutThing(c.title))
        .filter((s): s is string => Boolean(s));
      if (what.length === 0) {
        return 'Multiple billing-config requirements are unset on the same set of products.';
      }
      const list =
        what.length <= 2
          ? what.join(' and ')
          : `${what.slice(0, -1).join(', ')}, and ${what[what.length - 1]}`;
      return `Affected products lack ${list}. These usually need to be set together.`;
    },
  },
];

function unionOfAffectedIds(children: DBIssue[]): Set<string> {
  const set = new Set<string>();
  for (const c of children) {
    if (Array.isArray(c.affected_records)) {
      for (const r of c.affected_records) {
        if (r && typeof r.id === 'string') set.add(r.id);
      }
    }
  }
  return set;
}

function extractMissingThing(title: string): string | null {
  // "12 active products missing billing rule" → "billing rule"
  const m = title.match(/^\s*\d*\s*active products? missing (.+?)\s*$/i);
  return m ? m[1].toLowerCase().replace(/\s*rules?$/i, ' rule') : null;
}

function extractWithoutThing(title: string): string | null {
  const m = title.match(/^\s*\d*\s*active products? without (.+?)\s*$/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Group an issue list. Order is preserved: the first child of each family
 * stays in its original sort position; siblings are collapsed under the
 * parent.
 */
export function groupTopIssues(issues: DBIssue[]): TopIssueItem[] {
  // For each family, find which issues match.
  const familyMembers = new Map<string, DBIssue[]>();
  for (const family of FAMILIES) {
    familyMembers.set(family.slug, issues.filter(family.matches));
  }

  // Issues are part of a fold only if their family has 2+ members.
  // Otherwise the issue stays a single. Track which issue IDs are folded.
  const foldedIds = new Set<string>();
  for (const family of FAMILIES) {
    const members = familyMembers.get(family.slug) || [];
    if (members.length >= 2) {
      for (const m of members) foldedIds.add(m.id);
    }
  }

  const result: TopIssueItem[] = [];
  const emittedFamilies = new Set<string>();

  for (const issue of issues) {
    if (!foldedIds.has(issue.id)) {
      result.push({ kind: 'single', issue });
      continue;
    }
    // Issue is folded into a family. Emit the parent the first time we
    // encounter any member of the family in this iteration order.
    for (const family of FAMILIES) {
      const members = familyMembers.get(family.slug) || [];
      if (members.length >= 2 && members.some((m) => m.id === issue.id)) {
        if (emittedFamilies.has(family.slug)) break;
        emittedFamilies.add(family.slug);
        const severity = pickHighestSeverity(members);
        const category = members[0].category as IssueCategory;
        result.push({
          kind: 'parent',
          id: `${family.slug}:${category}`,
          title: family.buildTitle(members),
          description: family.buildDescription(members),
          severity,
          category,
          uniqueAffectedRecords: unionOfAffectedIds(members).size,
          children: members,
        });
        break;
      }
    }
  }

  return result;
}

function pickHighestSeverity(issues: DBIssue[]): IssueSeverity {
  if (issues.some((i) => i.severity === 'critical')) return 'critical';
  if (issues.some((i) => i.severity === 'warning')) return 'warning';
  return 'info';
}

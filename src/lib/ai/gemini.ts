import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Issue, CategoryScores } from '@/types';

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';
  return new GoogleGenerativeAI(apiKey);
}

function getModel() {
  return getClient().getGenerativeModel({ model: 'gemini-2.5-flash' });
}

/**
 * Retry wrapper for Gemini API calls (handles 503 overload)
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const status = (error as { status?: number }).status;
      if (status === 503 && attempt < maxRetries) {
        // Wait 2s, 4s before retrying
        await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

const SYSTEM_PROMPT = `You are a Salesforce Revenue Cloud expert analyzing health check results for a consulting firm's client org.

Your audience is a Revenue Cloud consultant who will present this analysis to their client (VP of Sales, RevOps lead, or CTO).

Write in a professional, clear tone. Be specific about what's wrong and what to do. Avoid generic advice. Reference actual check IDs and affected records when relevant.

Keep the executive summary to 3-5 paragraphs maximum.`;

/**
 * Generate an AI-powered executive summary of scan results
 */
export async function generateExecutiveSummary(
  issues: Issue[],
  categoryScores: CategoryScores,
  overallScore: number,
  orgStats: { totalPriceRules: number; totalProducts: number; totalQuoteLines: number }
): Promise<string> {
  const criticalIssues = issues.filter((i) => i.severity === 'critical');
  const warningIssues = issues.filter((i) => i.severity === 'warning');

  const prompt = `${SYSTEM_PROMPT}

Analyze these Salesforce Revenue Cloud health check results and write an executive summary.

## Org Stats
- Total Price Rules: ${orgStats.totalPriceRules}
- Total Products: ${orgStats.totalProducts}
- Total Quote Lines (last 90 days): ${orgStats.totalQuoteLines}

## Health Score: ${overallScore}/100

## Category Scores
- Price Rules: ${categoryScores.price_rules}/100
- Discount Schedules: ${categoryScores.discount_schedules}/100
- Products & Bundles: ${categoryScores.products}/100
- Product Rules: ${categoryScores.product_rules}/100
- CPQ Settings: ${categoryScores.cpq_settings}/100
- Quote Lines: ${categoryScores.quote_lines}/100

## Critical Issues (${criticalIssues.length})
${criticalIssues.map((i) => `- [${i.check_id}] ${i.title}: ${i.description}`).join('\n')}

## Warnings (${warningIssues.length})
${warningIssues.map((i) => `- [${i.check_id}] ${i.title}: ${i.description}`).join('\n')}

Write an executive summary that:
1. Opens with the overall health assessment (good/concerning/critical)
2. Highlights the most impactful issues and their business risk
3. Groups related problems (e.g. "your pricing configuration has 3 interconnected issues")
4. Ends with a prioritized action plan (fix these first for maximum impact)

Do NOT use markdown headers. Use plain paragraphs. Keep it concise and actionable.`;

  try {
    const model = getModel();
    const result = await withRetry(() => model.generateContent(prompt));
    return result.response.text() || 'Unable to generate summary.';
  } catch (error) {
    console.error('Gemini AI error:', error);
    return generateFallbackSummary(issues, overallScore);
  }
}

/**
 * Generate a detailed AI fix suggestion for a specific issue
 */
export async function generateFixSuggestion(issue: Issue): Promise<string> {
  const prompt = `You are a Salesforce Revenue Cloud expert providing step-by-step fix instructions. Be specific, practical, and include exact Salesforce navigation paths.

You are helping a Salesforce Revenue Cloud consultant fix this issue in their client's org.

## Issue
- Check: ${issue.check_id}
- Title: ${issue.title}
- Description: ${issue.description}
- Impact: ${issue.impact}
- Current Recommendation: ${issue.recommendation}
- Affected Records: ${JSON.stringify(issue.affected_records)}

Provide a detailed, step-by-step fix guide that includes:
1. Exact navigation path in Salesforce Setup
2. What fields to change and to what values
3. How to verify the fix worked
4. Any risks or side effects to watch for

If relevant, include SOQL queries they can run to validate before and after. Be specific - use actual record names from the affected records list.`;

  try {
    const model = getModel();
    const result = await withRetry(() => model.generateContent(prompt));
    return result.response.text() || 'Unable to generate fix suggestion.';
  } catch (error) {
    console.error('Gemini AI fix suggestion error:', error);
    throw error;
  }
}

/**
 * Generate a plain-English explanation of an issue for business stakeholders
 */
export async function generateExplanation(issue: {
  title: string;
  description: string;
  impact: string;
  checkId: string;
  category: string;
  severity: string;
}): Promise<string> {
  const prompt = `You explain technical Salesforce configuration issues in plain, non-technical English for business stakeholders. Be concise, specific, and jargon-free.

You are explaining a Salesforce configuration issue to someone who is NOT a technical expert — they might be a VP of Sales, CFO, or RevOps manager.

## Issue Details
- Check ID: ${issue.checkId}
- Category: ${issue.category}
- Severity: ${issue.severity}
- Title: ${issue.title}
- Technical Description: ${issue.description}
- Business Impact: ${issue.impact}

Explain this in 3 short sections:

**What's happening:** Explain in plain English what this issue means. No jargon. Use analogies if helpful. 2-3 sentences max.

**Why it matters:** Explain the business impact — money, time, or risk. Be specific. 2-3 sentences max.

**What to do:** One clear action item. Not technical steps — just the decision or directive. 1-2 sentences.

Keep it concise. Write like you're explaining to a smart person who doesn't know Salesforce internals.`;

  try {
    const model = getModel();
    const result = await withRetry(() => model.generateContent(prompt));
    return result.response.text() || 'Unable to generate explanation.';
  } catch (error) {
    console.error('Gemini AI explain error:', error);
    return 'Unable to generate explanation.';
  }
}

/**
 * Generate scan comparison insights
 */
export async function generateScanDiffInsights(
  prevScore: number,
  newScore: number,
  newIssues: string[],
  resolvedIssues: string[],
  unchangedCount: number
): Promise<string> {
  const prompt = `You are a Salesforce Revenue Cloud expert analyzing changes between two health check scans.

## Score Change
- Previous score: ${prevScore}/100
- Current score: ${newScore}/100
- Change: ${newScore - prevScore > 0 ? '+' : ''}${newScore - prevScore} points

## New Issues Found (${newIssues.length})
${newIssues.map((i) => `- ${i}`).join('\n') || 'None'}

## Issues Resolved (${resolvedIssues.length})
${resolvedIssues.map((i) => `- ${i}`).join('\n') || 'None'}

## Unchanged Issues: ${unchangedCount}

Write a brief 2-3 sentence analysis explaining:
1. Why the score changed (or didn't)
2. Whether the trend is positive or concerning
3. One specific next action

Be direct and specific. No markdown headers. Plain text only.`;

  try {
    const model = getModel();
    const result = await withRetry(() => model.generateContent(prompt));
    return result.response.text() || '';
  } catch (error) {
    console.error('Gemini scan diff error:', error);
    throw error;
  }
}

/**
 * Generate a prioritized remediation plan across all issues
 */
export async function generateRemediationPlan(
  issues: Issue[],
  overallScore: number
): Promise<string> {
  const issueList = issues
    .filter((i) => i.severity !== 'info')
    .map((i) => `- [${i.check_id}] ${i.severity.toUpperCase()}: ${i.title} (${i.affected_records?.length || 0} records, est. ${i.effort_hours || '?'}h)`)
    .join('\n');

  const prompt = `You are a Salesforce Revenue Cloud expert creating a remediation plan for a consulting engagement.

## Current Score: ${overallScore}/100
## Issues to Address:
${issueList}

Create a prioritized remediation plan with 3 phases:

**Phase 1 — Quick Wins (< 1 hour each):** Issues that are fast to fix with high impact on score.

**Phase 2 — Core Fixes (1-4 hours each):** Critical and warning issues that need careful attention.

**Phase 3 — Optimization:** Lower priority improvements for long-term health.

For each item include: the check ID, what to do (1 sentence), and estimated time.

Keep it practical and actionable. No fluff. Format as plain text with clear sections.`;

  try {
    const model = getModel();
    const result = await withRetry(() => model.generateContent(prompt));
    return result.response.text() || '';
  } catch (error) {
    console.error('Gemini remediation plan error:', error);
    throw error;
  }
}

/**
 * Fallback summary when AI is unavailable
 */
function generateFallbackSummary(issues: Issue[], overallScore: number): string {
  const critical = issues.filter((i) => i.severity === 'critical').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  const health =
    overallScore >= 80 ? 'good' : overallScore >= 60 ? 'moderate with areas of concern' : 'critical and requires immediate attention';

  return `This Salesforce org scored ${overallScore}/100, indicating the overall health is ${health}. The scan found ${critical} critical issue(s) and ${warnings} warning(s) that should be reviewed. ${
    critical > 0
      ? `The critical issues should be addressed first as they may be causing revenue miscalculations or broken automation.`
      : `No critical issues were found, but the warnings should be reviewed to prevent future problems.`
  }`;
}

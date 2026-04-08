import Anthropic from '@anthropic-ai/sdk';
import type { Issue, CategoryScores } from '@/types';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are a Salesforce CPQ expert analyzing health check results for a consulting firm's client org.

Your audience is a CPQ consultant who will present this analysis to their client (VP of Sales, RevOps lead, or CTO).

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

  const prompt = `Analyze these Salesforce CPQ health check results and write an executive summary.

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
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    return textBlock?.text || 'Unable to generate summary.';
  } catch (error) {
    console.error('Claude AI error:', error);
    return generateFallbackSummary(issues, overallScore);
  }
}

/**
 * Generate a detailed AI fix suggestion for a specific issue
 */
export async function generateFixSuggestion(issue: Issue): Promise<string> {
  const prompt = `You are helping a Salesforce CPQ consultant fix this issue in their client's org.

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
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You are a Salesforce CPQ expert providing step-by-step fix instructions. Be specific, practical, and include exact Salesforce navigation paths.',
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    return textBlock?.text || 'Unable to generate fix suggestion.';
  } catch (error) {
    console.error('Claude AI fix suggestion error:', error);
    return issue.recommendation;
  }
}

/**
 * Fallback summary when Claude API is unavailable
 */
function generateFallbackSummary(issues: Issue[], overallScore: number): string {
  const critical = issues.filter((i) => i.severity === 'critical').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  const health =
    overallScore >= 80 ? 'good' : overallScore >= 60 ? 'moderate with areas of concern' : 'critical and requires immediate attention';

  return `This Salesforce CPQ org scored ${overallScore}/100, indicating the overall health is ${health}. The scan found ${critical} critical issue(s) and ${warnings} warning(s) that should be reviewed. ${
    critical > 0
      ? `The critical issues should be addressed first as they may be causing revenue miscalculations or broken automation.`
      : `No critical issues were found, but the warnings should be reviewed to prevent future problems.`
  }`;
}

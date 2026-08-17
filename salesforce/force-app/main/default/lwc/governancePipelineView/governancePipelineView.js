import { LightningElement } from 'lwc';

/**
 * Governance & Pipeline view — two cards side by side. Each
 * <c-risk-category-card> self-refreshes on 'op:scan-completed', so this
 * wrapper is a pure pass-through with no logic of its own.
 */
export default class GovernancePipelineView extends LightningElement {}

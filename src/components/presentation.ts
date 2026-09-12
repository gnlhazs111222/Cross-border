import type { DemoState, Stage } from '../types';

// Presentation copy only. The stored business states and transitions are unchanged.
const stageLabels: Record<Stage, string> = {
  initial: 'Ready to start', materials_ready: 'Dataset ready', task_created: 'Choose a product',
  sku_selected: 'Product selected', evidence_analyzed: 'Review product facts', pricing_ready: 'Pricing ready',
  listing_generated: 'Review required', review_blocked: 'Publish blocked', review_passed: 'Ready to publish', published: 'Mock publish complete',
};
export function stageLabel(state: DemoState) {
  if (state.stage === 'review_passed' && state.reviews[state.platform]?.reviewMode === 'rules_qwen') return 'Semantic review recorded';
  return state.workspace === 'evidence' && state.pricing?.status === 'blocked' ? 'Facts need attention' : stageLabels[state.stage];
}
export function nextStepMessage(state: DemoState) {
  switch (state.workspace) {
    case 'materials': return state.task ? 'Open your launch task, or inspect a product to review its facts.' : 'Import a supplier sample or use the built-in dataset, then create the demo task.';
    case 'tasks': return state.task ? 'Compare the reasons, then select a product. Top 1 is the shortest demo path.' : 'Create the fixed demo task to see the shortlist.';
    case 'evidence':
      if (!state.selectedSku) return 'Select a product in Launch Tasks to inspect its facts.';
      if (state.pricing?.status === 'blocked') return 'Add or confirm the missing pricing facts in Fact Review below.';
      if (!state.v2) return 'Analyze Evidence adds mock supplemental facts while keeping V1 separate.';
      return 'Review which facts are allowed, then continue to Listing Studio.';
    case 'studio': return state.listings[state.platform] ? 'Your draft needs review before publication. Continue to Review.' : 'Generate a draft from confirmed, allowed facts. US listing copy stays in English.';
    case 'review':
      if (state.publications[state.platform]) return state.platform === 'amazon' ? 'Download the Amazon CSV to finish the demo. Nothing was uploaded to Amazon.' : 'The simulated Shopify draft is ready. Nothing was created in a real store.';
      if (!state.listings[state.platform]) return 'Generate a draft in Listing Studio before running review.';
      if (state.reviews[state.platform]?.reviewMode === 'rules_qwen') {
        switch (state.reviews[state.platform]?.status) {
          case 'passed': return 'A semantic review result is saved. Check the current publish authorization below.';
          case 'blocked': return 'Edit the reported claims in Listing Studio, then run review again.';
          case 'needs_human_review': return 'Clarify the ambiguous facts or copy, then run review again.';
          case 'failed': return 'Review did not complete. Use Run Review to retry; publishing stays locked.';
          case 'running': return 'Wait for review to finish before attempting publication.';
        }
      }
      if (state.reviews[state.platform]?.status === 'blocked') return 'Apply Suggested Fix, then run review again. Publishing remains blocked until it passes.';
      if (state.reviews[state.platform]?.status === 'passed') return 'This revision passed the local rules. You can now simulate publishing.';
      return 'Run Review on the current revision. A saved fix is not yet a passed review.';
  }
}

/** Colour names from our dictionaries mapped to display values, so an imported product looks like itself. */
const COLOR_HEX: Record<string, string> = {
  black: '#303737', white: '#f2f2ef', ivory: '#ddd8ce', silver: '#c7ccd0', gray: '#8b9298', grey: '#8b9298', 'off-white': '#e9ebe4',
  navy: '#2c3e5c', blue: '#4a7fb5', green: '#5f8f66', sage: '#8b9c89', pink: '#e3a7b4', red: '#b5524c',
  gold: '#c9a961', purple: '#8a76b0', brown: '#8a6a4f', orange: '#d58a45', unspecified: '#303737', rainbow: '#8a76b0',
};
export function colorHex(name?: string): string {
  return COLOR_HEX[(name ?? '').trim().toLowerCase()] ?? COLOR_HEX.unspecified;
}

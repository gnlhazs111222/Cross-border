import type { DemoState, Stage } from '../types';

// Presentation copy only. The stored business states and transitions are unchanged.
const stageLabels: Record<Stage, string> = {
  initial: 'Ready to start', materials_ready: 'Dataset ready', task_created: 'Choose a product',
  sku_selected: 'Product selected', evidence_analyzed: 'Review product facts', pricing_ready: 'Pricing ready',
  listing_generated: 'Review required', review_blocked: 'Publish blocked', review_passed: 'Ready to publish', published: 'Mock publish complete',
};
export function stageLabel(state: DemoState) {
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
      if (state.reviews[state.platform]?.status === 'blocked') return 'Apply Suggested Fix, then run review again. Publishing remains blocked until it passes.';
      if (state.reviews[state.platform]?.status === 'passed') return 'This revision passed the local rules. You can now simulate publishing.';
      return 'Run Review on the current revision. A saved fix is not yet a passed review.';
  }
}

import type { Fact, Issue, Listing } from '../src/types';

export type ReviewStatus = 'passed' | 'blocked' | 'needs_human_review' | 'failed' | 'running';
export type ReviewCategory = 'spec_conflict' | 'unsupported_claim' | 'unauthorized_fact' | 'internal_disclosure';
export type ReviewLocation = { field: 'title' | 'bullets' | 'description' | 'attributes'; index?: number; key?: string; occurrence?: number };
export type ReviewMetadata = { mode: 'rules_qwen'; model: string; promptVersion: string; ruleVersion: string; inputHash: string; listingRevision: number; factsRevision: number; taskRevision: number; aiCallId?: string; errorCode?: string; validationIssues?: { path: string; code: string }[]; modelCalled: boolean };
export type ReviewInput = { listing: Pick<Listing, 'title' | 'bullets' | 'description' | 'attributes' | 'platform'>; facts: Fact[]; context: { market: string; category: string; taskRevision: number }; listingRevision: number; factsRevision: number };
export type SemanticReviewResult = { status: Exclude<ReviewStatus, 'running'>; issues: Issue[]; metadata: ReviewMetadata };
export const REVIEW_PROMPT_VERSION = 'review-qwen-v13';
export const REVIEW_RULE_VERSION = 'review-hard-v10';

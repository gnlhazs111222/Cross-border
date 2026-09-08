import { ruleRank, type RecommendationContext } from '../../shared/recommendation';
import type { FactCard, Issue, Listing, Product, Recommendation, Task } from '../../src/types';
import { enrichProductEvidence, makeTemplateListing, reviewAgainstTemplate, type ListingInput } from '../../shared/domain';
import { AppError } from '../errors';

export interface RecommendationProvider { recommend(products: Product[], task: Task, context?: RecommendationContext): Promise<Recommendation[]> }
export interface EvidenceProvider { enrich(product: Product, base: FactCard, task: Task): Promise<FactCard> }
export interface ListingProvider { generate(input: ListingInput): Promise<Listing> }
export interface ReviewProvider { review(listing: Listing, expected: Listing): Promise<Issue[]> }
export class MockRecommendationProvider implements RecommendationProvider { async recommend(products: Product[], task: Task, context?: RecommendationContext) { return ruleRank(products, task, context); } }
export class MockEvidenceProvider implements EvidenceProvider { async enrich(product: Product, base: FactCard, task: Task) { return enrichProductEvidence(product, base, task); } }
export class TemplateListingProvider implements ListingProvider { async generate(input: ListingInput) { return makeTemplateListing(input); } }
export class RuleReviewProvider implements ReviewProvider { async review(listing: Listing, expected: Listing) { return reviewAgainstTemplate(listing, expected); } }
const unavailable = () => new AppError('business_ai_not_implemented', 'Live business prompts are not implemented in this release.', 501);
// Explicit reserved adapters: never activated or silently substituted for working mock providers.
export { QwenRecommendationProvider } from './qwenRecommendation';
export class QwenEvidenceProvider implements EvidenceProvider { async enrich(): Promise<FactCard> { throw unavailable(); } }
export { QwenListingProvider } from './qwenListing';
export { QwenReviewProvider } from './qwenReview';
export const domainProviders = { recommendation: new MockRecommendationProvider(), evidence: new MockEvidenceProvider(), listing: new TemplateListingProvider(), review: new RuleReviewProvider() };

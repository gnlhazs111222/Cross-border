import type { Fact, Product, Task } from '../../src/types';
import cases from './cases.json';
export type EvaluationCase = { id: string; task: Task; candidates: Product[]; extraFacts?: Record<string, Fact[]>; expected: { preferredTop1: string[]; acceptableTop3: string[]; relevance: Record<string, number> }; notes: string };
// Frozen synthetic candidates and hand-authored labels; independent of the live application dataset and ranking code.
export const recommendationCases = cases as unknown as EvaluationCase[];

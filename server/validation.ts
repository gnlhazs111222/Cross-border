import { z } from 'zod';

const text = z.string().trim().min(1).max(220).refine(v => !/^[=+@]/.test(v), 'Use plain values.');
const positive = z.number().finite().positive().max(1000000);
/** Pool fields may legitimately be empty: a missing value is stored as to-be-completed, not rejected. */
const plain = z.string().trim().max(220);
export const productInput = z.object({
  sku: text, name: plain, category: plain, color: plain, capacity: z.number().int().min(0).max(1000000), localizedCapacity: plain,
  material: plain, straw: z.boolean(), countryOfOrigin: plain,
  packagingWeight: positive.optional(), packagingDimensions: text.optional(),
  packageLength: positive.optional(), packageWidth: positive.optional(), packageHeight: positive.optional(),
  supplierCost: z.number().finite().min(0).max(1000000), declaredValue: z.number().finite().min(0).max(1000000),
  importSource: z.object({ fileName: text, sheetName: text, row: z.number().int().min(2).max(501) }),
  assetReferences: z.array(text).max(20).optional(),
  assetUrls: z.array(z.string().url().max(500)).max(20).optional(),
  status: z.enum(['search_ready', 'missing_data']), duplicateStatus: z.literal('unique'),
  missing: z.array(z.string().max(220)).max(14), visual: z.enum(['bottle', 'bag', 'lamp']),
}).strict();
const issue = z.object({ code: z.enum(['required', 'number', 'boolean', 'formula', 'extra', 'long', 'duplicate', 'missing']), field: z.string().max(220) });
export const importSchema = z.object({
  mode: z.enum(['replace', 'append', 'merge']), expectedRevision: z.number().int().positive(), products: z.array(productInput).min(1).max(500),
  sourceFile: z.object({ fileName: text, mimeType: text, contentBase64: z.string().min(1).max(8_000_000) }).strict().optional(),
  report: z.object({ fileName: text, mode: z.enum(['replace', 'append', 'merge']), processed: z.number().int().min(1).max(500), ready: z.number().int().min(0), missing: z.number().int().min(0), duplicates: z.number().int().min(0), invalid: z.number().int().min(0), rows: z.array(z.object({ row: z.number().int().min(2).max(501), sku: z.string().max(220), status: z.enum(['ready', 'missing_data', 'duplicate', 'invalid']), issues: z.array(issue).max(30) })).max(500) }), 
}).strict();
export const resolveImportSchema = z.object({ action: z.enum(['keep_existing', 'use_incoming', 'separate', 'skipped']), expectedRevision: z.number().int().positive() }).strict();
export const bulkResolveImportSchema = z.object({
  action: z.enum(['keep_existing', 'use_incoming', 'separate', 'skipped']),
  verdict: z.enum(['conflict', 'probable']).optional(),
  field: z.string().trim().min(1).max(40).optional(),
  remember: z.boolean().optional(),
  expectedRevision: z.number().int().positive(),
}).strict();
export const credentialsSchema = z.object({ email: z.string().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(1).max(128) }).strict();
// Assets travel as base64 JSON so the demo keeps zero extra dependencies. The service re-checks the decoded size, sniffs the real type and ignores any client-supplied path.
export const assetUploadSchema = z.object({
  fileName: text,
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']),
  role: z.enum(['main', 'detail', 'packaging', 'spec', 'other']).optional(),
  contentBase64: z.string().min(1).max(28_000_000),
}).strict();
export const registerSchema = credentialsSchema.extend({ password: z.string().min(8).max(128), displayName: z.string().trim().min(1).max(80) });
export const taskSchema = z.object({ code: text, platform: text, market: text, category: text, requirements: z.array(z.string().trim().min(1).max(1500)).min(1).max(20).refine(rows => rows.join('\n').length <= 5000, 'Keep requirements within 5000 characters.'), minimumProfit: z.number().finite().min(0).max(1000000) }).strict();

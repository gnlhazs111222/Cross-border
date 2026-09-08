import { z } from 'zod';

const text = z.string().trim().min(1).max(220).refine(v => !/^[=+@]/.test(v), 'Use plain values.');
const positive = z.number().finite().positive().max(1000000);
export const productInput = z.object({
  sku: text, name: text, category: text, color: text, capacity: positive.int(), localizedCapacity: text,
  material: text, straw: z.boolean(), countryOfOrigin: text,
  packagingWeight: positive.optional(), packagingDimensions: text.optional(),
  packageLength: positive.optional(), packageWidth: positive.optional(), packageHeight: positive.optional(),
  supplierCost: z.number().finite().min(0).max(1000000), declaredValue: z.number().finite().min(0).max(1000000),
  importSource: z.object({ fileName: text, sheetName: text, row: z.number().int().min(2).max(501) }),
  status: z.enum(['search_ready', 'missing_data']), duplicateStatus: z.literal('unique'),
  missing: z.array(z.string().max(220)).max(14), visual: z.enum(['bottle', 'bag', 'lamp']),
}).strict();
const issue = z.object({ code: z.enum(['required', 'number', 'boolean', 'formula', 'extra', 'long', 'duplicate', 'missing']), field: z.string().max(220) });
export const importSchema = z.object({
  mode: z.enum(['replace', 'append']), expectedRevision: z.number().int().positive(), products: z.array(productInput).min(1).max(500),
  report: z.object({ fileName: text, mode: z.enum(['replace', 'append']), processed: z.number().int().min(1).max(500), ready: z.number().int().min(0), missing: z.number().int().min(0), duplicates: z.number().int().min(0), invalid: z.number().int().min(0), rows: z.array(z.object({ row: z.number().int().min(2).max(501), sku: z.string().max(220), status: z.enum(['ready', 'missing_data', 'duplicate', 'invalid']), issues: z.array(issue).max(30) })).max(500) }),
}).strict();
export const credentialsSchema = z.object({ email: z.string().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(1).max(128) }).strict();
export const registerSchema = credentialsSchema.extend({ password: z.string().min(8).max(128), displayName: z.string().trim().min(1).max(80) });
export const taskSchema = z.object({ code: text, platform: text, market: text, category: text, requirements: z.array(z.string().trim().min(1).max(1500)).min(1).max(20).refine(rows => rows.join('\n').length <= 5000, 'Keep requirements within 5000 characters.'), minimumProfit: z.number().finite().min(0).max(1000000) }).strict();

import { z } from 'zod';

// Request bodies for the routes that used to hand the raw body to the database layer.
// Everything is .strict(): an unknown field is a 400, never silently passed through. That
// matters because a raw body spread into a database call is mass assignment, including
// nested writes such as { integration: { connect: { id } } } that can re-parent a record.

/** A number, or a numeric string from a form field. Anything else (null, '', {}) is rejected. */
const number = z.union([
  z.number().finite(),
  z.string().trim().regex(/^-?\d+(\.\d+)?$/, 'must be a number').transform(Number),
]);
const int = (min: number, max: number) => number.pipe(z.number().int().min(min).max(max));
const decimal = (min: number, max: number) => number.pipe(z.number().min(min).max(max));

export const invariantFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000),
  predicateExpression: z.string().min(1).max(4000),
  predicateDescription: z.string().max(1000),
  predicateExample: z.string().max(1000),
  repairRepository: z.string().max(200).nullable(),
  repairFilePath: z.string().max(500).nullable(),
  repairRequiredChecks: z.array(z.string().max(200)).max(20),
  evaluationWindowSec: int(10, 86_400),
  minSamples: int(1, 100_000),
  expectedSuccessRate: decimal(0, 1),
};

export const invariantCreateSchema = z.object({
  integrationId: z.string().min(1).max(100),
  name: invariantFields.name,
  predicateExpression: invariantFields.predicateExpression,
  description: invariantFields.description.optional(),
  predicateDescription: invariantFields.predicateDescription.optional(),
  predicateExample: invariantFields.predicateExample.optional(),
  repairRepository: invariantFields.repairRepository.optional(),
  repairFilePath: invariantFields.repairFilePath.optional(),
  repairRequiredChecks: invariantFields.repairRequiredChecks.optional(),
  evaluationWindowSec: invariantFields.evaluationWindowSec.optional(),
  minSamples: invariantFields.minSamples.optional(),
  expectedSuccessRate: invariantFields.expectedSuccessRate.optional(),
}).strict();

export const invariantPatchSchema = z.object({
  name: invariantFields.name,
  description: invariantFields.description,
  predicateExpression: invariantFields.predicateExpression,
  predicateDescription: invariantFields.predicateDescription,
  predicateExample: invariantFields.predicateExample,
  repairRepository: invariantFields.repairRepository,
  repairFilePath: invariantFields.repairFilePath,
  repairRequiredChecks: invariantFields.repairRequiredChecks,
  evaluationWindowSec: invariantFields.evaluationWindowSec,
  minSamples: invariantFields.minSamples,
  expectedSuccessRate: invariantFields.expectedSuccessRate,
}).partial().strict();

const MAX_EVALUATION_SPAN_MS = 31 * 24 * 60 * 60 * 1000;
export const invariantEvaluateSchema = z.object({
  windowStart: z.string().datetime({ offset: true }).optional(),
  windowEnd: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.windowStart && value.windowEnd) {
    const span = new Date(value.windowEnd).getTime() - new Date(value.windowStart).getTime();
    if (span <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['windowEnd'], message: 'windowEnd must be after windowStart' });
    if (span > MAX_EVALUATION_SPAN_MS) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['windowEnd'], message: 'The window can span at most 31 days' });
  }
});

export const driftConfigSchema = z.object({
  baselineWindowDays: int(1, 365),
  detectionWindowHours: int(1, 168),
  minDetectionSamples: int(1, 100_000),
  significanceThreshold: decimal(0.000001, 0.5),
  minEffectSize: decimal(0, 10),
  enabled: z.boolean(),
}).partial().strict();

/** First problem as one plain sentence, for a 400 response. */
export function firstProblem(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request';
  const field = issue.path.join('.');
  if (issue.code === 'unrecognized_keys') return `Unknown field: ${issue.keys.join(', ')}`;
  return field ? `${field}: ${issue.message}` : issue.message;
}

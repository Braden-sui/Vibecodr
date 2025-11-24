import { z } from "zod";
import { PlanSchema, PlanLimitsSchema, type PlanLimits } from "../plans";

export const QuotaUsageSchema = z.object({
  storage: z.number().nonnegative(),
  runs: z.number().nonnegative(),
  bundleSize: z.number().nonnegative(),
  liveMinutes: z.number().nonnegative(),
});

export const QuotaPercentUsedSchema = z.object({
  storage: z.number().min(0),
  runs: z.number().min(0),
  liveMinutes: z.number().min(0).optional(),
  bundleSize: z.number().min(0).optional(),
});

export const UserQuotaResponseSchema = z.object({
  plan: PlanSchema,
  usage: QuotaUsageSchema,
  limits: PlanLimitsSchema,
  percentUsed: QuotaPercentUsedSchema.optional(),
});

export type QuotaUsage = z.infer<typeof QuotaUsageSchema>;
export type QuotaPercentUsed = z.infer<typeof QuotaPercentUsedSchema>;
export type UserQuotaResponse = z.infer<typeof UserQuotaResponseSchema>;
export type QuotaLimits = PlanLimits;

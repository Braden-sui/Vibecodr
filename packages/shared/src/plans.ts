import { z } from "zod";

export enum Plan {
  FREE = "free",
  CREATOR = "creator",
  PRO = "pro",
  TEAM = "team",
}

export const PlanSchema = z.nativeEnum(Plan);

export const PlanLimitsSchema = z.object({
  maxBundleSize: z.number().int().nonnegative(),
  maxRuns: z.number().int().nonnegative(),
  maxStorage: z.number().int().nonnegative(),
  liveMinutes: z.number().int().nonnegative(),
});

export type PlanLimits = z.infer<typeof PlanLimitsSchema>;

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  [Plan.FREE]: {
    maxBundleSize: 25 * 1024 * 1024, // 25 MB
    maxRuns: 5_000,
    maxStorage: 1 * 1024 * 1024 * 1024, // 1 GB
    liveMinutes: 0, // watch only
  },
  [Plan.CREATOR]: {
    maxBundleSize: 25 * 1024 * 1024, // 25 MB
    maxRuns: 50_000,
    maxStorage: 10 * 1024 * 1024 * 1024, // 10 GB
    liveMinutes: 0,
  },
  [Plan.PRO]: {
    maxBundleSize: 100 * 1024 * 1024, // 100 MB
    maxRuns: 250_000,
    maxStorage: 50 * 1024 * 1024 * 1024, // 50 GB
    liveMinutes: 2_500,
  },
  [Plan.TEAM]: {
    maxBundleSize: 250 * 1024 * 1024, // 250 MB
    maxRuns: 1_000_000,
    maxStorage: 250 * 1024 * 1024 * 1024, // 250 GB
    liveMinutes: 10_000,
  },
};

export function normalizePlan(value: unknown, fallback: Plan = Plan.FREE): Plan {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    for (const plan of Object.values(Plan)) {
      if (plan === normalized) {
        return plan as Plan;
      }
    }
  }
  return fallback;
}

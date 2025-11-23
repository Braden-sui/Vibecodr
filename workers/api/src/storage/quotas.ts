/**
 * Plan Quotas and Enforcement
 * Based on mvp-plan.md pricing section
 */

export enum Plan {
  FREE = "free",
  CREATOR = "creator",
  PRO = "pro",
  TEAM = "team",
}

export interface PlanLimits {
  maxBundleSize: number; // bytes
  maxRuns: number; // per month
  maxStorage: number; // bytes total
  liveMinutes: number; // streaming minutes
}

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

export interface QuotaUsage {
  bundleSize: number;
  runs: number;
  storage: number;
  liveMinutes: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  usage?: QuotaUsage;
  limits?: PlanLimits;
  percentUsed?: number;
}

export interface UserStorageState {
  plan: Plan;
  storageUsageBytes: number;
  storageVersion: number;
}

/**
 * Check if bundle size is within plan limits
 */
export function checkBundleSize(plan: Plan, bundleSize: number): QuotaCheckResult {
  const limits = PLAN_LIMITS[plan];

  if (bundleSize > limits.maxBundleSize) {
    return {
      allowed: false,
      reason: `Bundle size ${formatBytes(bundleSize)} exceeds plan limit of ${formatBytes(limits.maxBundleSize)}. Upgrade to ${getUpgradePlan(plan)} for larger bundles.`,
      limits,
    };
  }

  return {
    allowed: true,
    percentUsed: (bundleSize / limits.maxBundleSize) * 100,
    limits,
  };
}

/**
 * Check if storage usage is within plan limits
 */
export function checkStorageQuota(
  plan: Plan,
  currentUsage: number,
  additionalSize: number
): QuotaCheckResult {
  const limits = PLAN_LIMITS[plan];
  const totalUsage = currentUsage + additionalSize;

  if (totalUsage > limits.maxStorage) {
    return {
      allowed: false,
      reason: `Storage limit exceeded. Current: ${formatBytes(currentUsage)}, Additional: ${formatBytes(additionalSize)}, Limit: ${formatBytes(limits.maxStorage)}. Upgrade to ${getUpgradePlan(plan)} for more storage.`,
      limits,
      usage: { bundleSize: additionalSize, runs: 0, storage: currentUsage, liveMinutes: 0 },
    };
  }

  return {
    allowed: true,
    percentUsed: (totalUsage / limits.maxStorage) * 100,
    limits,
    usage: { bundleSize: additionalSize, runs: 0, storage: totalUsage, liveMinutes: 0 },
  };
}

/**
 * Check if run quota is within plan limits
 */
export function checkRunQuota(plan: Plan, runsThisMonth: number): QuotaCheckResult {
  const limits = PLAN_LIMITS[plan];

  if (runsThisMonth >= limits.maxRuns) {
    return {
      allowed: false,
      reason: `Monthly run quota exceeded (${runsThisMonth}/${limits.maxRuns}). Quota resets on the 1st. Upgrade to ${getUpgradePlan(plan)} for more runs.`,
      limits,
      usage: { bundleSize: 0, runs: runsThisMonth, storage: 0, liveMinutes: 0 },
    };
  }

  return {
    allowed: true,
    percentUsed: (runsThisMonth / limits.maxRuns) * 100,
    limits,
    usage: { bundleSize: 0, runs: runsThisMonth, storage: 0, liveMinutes: 0 },
  };
}

/**
 * Get recommended upgrade plan
 */
function getUpgradePlan(currentPlan: Plan): string {
  switch (currentPlan) {
    case Plan.FREE:
      return "Creator ($9/mo)";
    case Plan.CREATOR:
      return "Pro ($29/mo)";
    case Plan.PRO:
      return "Team ($99/mo)";
    case Plan.TEAM:
      return "Enterprise (contact sales)";
    default:
      return "a higher plan";
  }
}

/**
 * Format bytes for human-readable display
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * Get plan, storage usage, and optimistic version in a single read
 */
export async function getUserStorageState(
  userId: string,
  env: { DB: D1Database }
): Promise<UserStorageState> {
  const { results } = await env.DB.prepare(
    "SELECT plan, storage_usage_bytes, storage_version FROM users WHERE id = ? LIMIT 1"
  )
    .bind(userId)
    .all();

  const row = results?.[0] as
    | {
        plan?: string;
        storage_usage_bytes?: number;
        storage_version?: number;
      }
    | undefined;

  const planValue = row?.plan;
  const plan =
    typeof planValue === "string" && Object.values(Plan).includes(planValue as Plan)
      ? (planValue as Plan)
      : Plan.FREE;

  return {
    plan,
    storageUsageBytes:
      typeof row?.storage_usage_bytes === "number" && !Number.isNaN(row.storage_usage_bytes)
        ? row.storage_usage_bytes
        : 0,
    storageVersion:
      typeof row?.storage_version === "number" && !Number.isNaN(row.storage_version)
        ? row.storage_version
        : 0,
  };
}

/**
 * Get user's current plan (stub - implement with user lookup)
 */
export async function getUserPlan(userId: string, env: { DB: D1Database }): Promise<Plan> {
  const snapshot = await getUserStorageState(userId, env);
  return snapshot.plan;
}

/**
 * Get user's storage usage
 */
export async function getUserStorageUsage(
  userId: string,
  env: { DB: D1Database }
): Promise<number> {
  const snapshot = await getUserStorageState(userId, env);
  return snapshot.storageUsageBytes;
}

/**
 * Get user's run count for current month
 */
export async function getUserMonthlyRuns(
  userId: string,
  env: { DB: D1Database }
): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const timestamp = Math.floor(startOfMonth.getTime() / 1000);

  const { results } = await env.DB.prepare(`
    SELECT COUNT(*) as count
    FROM runs
    WHERE user_id = ? AND started_at >= ?
  `)
    .bind(userId, timestamp)
    .all();

  return (results?.[0]?.count as number) || 0;
}

export async function getUserRunQuotaState(
  userId: string,
  env: { DB: D1Database }
): Promise<{ plan: Plan; runsThisMonth: number; result: QuotaCheckResult }> {
  const [plan, runsThisMonth] = await Promise.all([getUserPlan(userId, env), getUserMonthlyRuns(userId, env)]);
  const result = checkRunQuota(plan, runsThisMonth);
  return { plan, runsThisMonth, result };
}

/**
 * Increment a user's recorded storage usage with optimistic locking.
 * Returns the new storage version when successful.
 */
export async function incrementStorageUsage(
  userId: string,
  env: { DB: D1Database },
  deltaBytes: number,
  options?: { expectedVersion?: number }
): Promise<number> {
  if (deltaBytes <= 0) {
    return options?.expectedVersion ?? 0;
  }

  let attempts = 0;
  let state = await getUserStorageState(userId, env);
  const maxAttempts = 2;

  while (attempts < maxAttempts) {
    const currentVersion = typeof options?.expectedVersion === "number" ? options.expectedVersion : state.storageVersion;
    const updateResult = await env.DB.prepare(
      `UPDATE users
       SET storage_usage_bytes = storage_usage_bytes + ?, storage_version = storage_version + 1
       WHERE id = ? AND storage_version = ?`
    )
      .bind(deltaBytes, userId, currentVersion)
      .run();

    const changes = updateResult?.meta?.changes ?? 0;
    if (changes > 0) {
      return currentVersion + 1;
    }

    // Re-read state and ensure quota still holds before retrying
    state = await getUserStorageState(userId, env);
    const quotaCheck = checkStorageQuota(state.plan, state.storageUsageBytes, deltaBytes);
    if (!quotaCheck.allowed) {
      throw new Error("E-VIBECODR-0405 storage quota exceeded during accounting");
    }

    attempts += 1;
  }

  throw new Error("E-VIBECODR-0406 failed to record storage usage");
}

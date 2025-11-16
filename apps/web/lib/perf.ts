export const FRAME_BUDGET_MS = 16;
export const HANDOFF_BUDGET_MS = 1500;

function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function budgeted<T>(name: string, fn: () => T): T {
  const t0 = now();
  try {
    return fn();
  } finally {
    const dt = now() - t0;
    if (dt > FRAME_BUDGET_MS) {
      try {
        console.warn(`[perf] ${name} took ${dt.toFixed(1)}ms > ${FRAME_BUDGET_MS}ms`);
      } catch {}
    }
  }
}

export async function budgetedAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = now();
  try {
    return await fn();
  } finally {
    const dt = now() - t0;
    if (dt > FRAME_BUDGET_MS) {
      try {
        console.warn(`[perf] ${name} took ${dt.toFixed(1)}ms > ${FRAME_BUDGET_MS}ms`);
      } catch {}
    }
  }
}

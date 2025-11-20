import { HANDOFF_BUDGET_MS } from "./perf";

type Dict = Record<string, unknown>;

const HANDOFF_LOG_LIMIT = 20;
const LOG_LEVELS = new Set(["log", "info", "warn", "error"] as const);

export type PreviewLogEntry = {
  level: "log" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
};

export interface PreviewHandoffState {
  t0: number;
  params?: Dict;
  source?: string;
  logs?: PreviewLogEntry[];
}

function key(postId: string) {
  return `preview_handoff:${postId}`;
}

function sanitizeLogs(logs?: unknown): PreviewLogEntry[] | undefined {
  if (!Array.isArray(logs) || logs.length === 0) {
    return undefined;
  }

  const normalized: PreviewLogEntry[] = [];
  for (const entry of logs) {
    if (!entry || typeof entry !== "object") continue;
    const { level, message, timestamp } = entry as PreviewLogEntry;
    if (!LOG_LEVELS.has(level)) continue;
    if (typeof message !== "string" || message.length === 0) continue;
    const ts = typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : Date.now();
    normalized.push({
      level,
      message: message.slice(0, 500),
      timestamp: ts,
    });
    if (normalized.length >= HANDOFF_LOG_LIMIT) {
      break;
    }
  }

  return normalized.length > 0 ? normalized : undefined;
}

export function writePreviewHandoff(
  postId: string,
  state?: { params?: Dict; source?: string; logs?: PreviewLogEntry[] }
) {
  try {
    if (typeof window === "undefined") return;
    const t0 = Date.now();
    const payload: PreviewHandoffState = {
      t0,
      params: state?.params,
      source: state?.source,
      logs: sanitizeLogs(state?.logs),
    };
    window.sessionStorage.setItem(key(postId), JSON.stringify(payload));
  } catch (error) {
    if (typeof console !== "undefined" && typeof console.error === "function") {
      console.error("E-VIBECODR-0204 preview handoff write failed", {
        postId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function readPreviewHandoff(
  postId: string
): { state: PreviewHandoffState | null; dt: number | null } {
  try {
    if (typeof window === "undefined") return { state: null, dt: null };
    const raw = window.sessionStorage.getItem(key(postId));
    if (!raw) return { state: null, dt: null };
    window.sessionStorage.removeItem(key(postId));
    const parsed = JSON.parse(raw) as PreviewHandoffState;
    parsed.logs = sanitizeLogs(parsed.logs);
    const t0 = Number(parsed?.t0 ?? 0);
    const dt = t0 ? Date.now() - t0 : null;
    if (dt != null && dt > HANDOFF_BUDGET_MS) {
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn(
          `[perf] preview->player handoff ${dt}ms > ${HANDOFF_BUDGET_MS}ms`,
          { postId }
        );
      }
    }
    return { state: parsed, dt };
  } catch (error) {
    if (typeof console !== "undefined" && typeof console.error === "function") {
      console.error("E-VIBECODR-0205 preview handoff read failed", {
        postId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return { state: null, dt: null };
  }
}


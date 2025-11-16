import { HANDOFF_BUDGET_MS } from "./perf";

type Dict = Record<string, unknown>;

export interface PreviewHandoffState {
  t0: number;
  params?: Dict;
  source?: string;
}

function key(postId: string) {
  return `preview_handoff:${postId}`;
}

export function writePreviewHandoff(postId: string, state?: { params?: Dict; source?: string }) {
  try {
    if (typeof window === "undefined") return;
    const t0 = Date.now();
    const payload: PreviewHandoffState = { t0, params: state?.params, source: state?.source };
    window.sessionStorage.setItem(key(postId), JSON.stringify(payload));
  } catch {}
}

export function readPreviewHandoff(postId: string): { state: PreviewHandoffState | null; dt: number | null } {
  try {
    if (typeof window === "undefined") return { state: null, dt: null };
    const raw = window.sessionStorage.getItem(key(postId));
    if (!raw) return { state: null, dt: null };
    window.sessionStorage.removeItem(key(postId));
    const parsed = JSON.parse(raw) as PreviewHandoffState;
    const t0 = Number(parsed?.t0 ?? 0);
    const dt = t0 ? Date.now() - t0 : null;
    if (dt != null && dt > HANDOFF_BUDGET_MS) {
      try {
        console.warn(`[perf] preview→player handoff ${dt}ms > ${HANDOFF_BUDGET_MS}ms`, { postId });
      } catch {}
    }
    return { state: parsed, dt };
  } catch {
    return { state: null, dt: null };
  }
}

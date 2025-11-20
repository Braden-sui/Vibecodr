type ToastVariant = "default" | "success" | "error" | "warning";

export type ToastPayload = {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
};

const EVENT = "vc:toast";

export function toast(payload: ToastPayload) {
  if (typeof window === "undefined") return;
  const event = new CustomEvent<ToastPayload>(EVENT, { detail: payload });
  window.dispatchEvent(event);
}

export const TOAST_EVENT = EVENT;

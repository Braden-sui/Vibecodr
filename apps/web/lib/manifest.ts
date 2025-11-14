// Manifest schema skeleton for App Capsules.
// TODO: validate shape server-side and client-side, align with docs/mvp-plan.md

export type CapsuleParam = {
  type: "number" | "string" | "boolean" | "select";
  min?: number;
  max?: number;
  step?: number;
  default?: number | string | boolean;
  options?: Array<{ label: string; value: string }>;
};

export type CapsuleManifest = {
  schema: 1;
  name: string;
  entry: string; // e.g., "/index.html"
  runner: "client-static" | "webcontainer"; // MVP: client-static only; WebContainer runner must honor pause/resume messages when enabled
  capabilities: {
    net: string[]; // allowlisted hosts
    storage: boolean;
    workers: boolean;
  };
  params?: Record<string, CapsuleParam>;
  meta?: { cover?: string; license?: string };
};


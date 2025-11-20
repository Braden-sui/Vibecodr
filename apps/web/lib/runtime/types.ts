import type React from "react";
import type { ClientRuntimeManifest, ClientRuntimeType } from "./loadRuntimeManifest";

export interface PolicyViolationEvent {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeLoaderArgs {
  manifest: ClientRuntimeManifest;
  bundleUrl?: string;
  params?: Record<string, unknown>;
  title?: string;
  className?: string;
  onReady?: () => void;
  onError?: (message: string) => void;
  onPolicyViolation?: (event: PolicyViolationEvent) => void;
  frameRef?: React.Ref<HTMLIFrameElement>;
}

export type RuntimeLoader = (args: RuntimeLoaderArgs) => React.ReactElement | null;

export type { ClientRuntimeType };

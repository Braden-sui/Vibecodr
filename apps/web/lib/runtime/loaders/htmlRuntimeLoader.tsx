import { SandboxFrame } from "@/components/runtime/SandboxFrame";
import type { RuntimeLoaderArgs } from "../types";

export function htmlRuntimeLoader(args: RuntimeLoaderArgs) {
  return (
    <SandboxFrame
      ref={args.frameRef}
      manifest={args.manifest}
      bundleUrl={args.bundleUrl}
      params={args.params}
      title={args.title ?? "Vibecodr HTML runtime"}
      className={args.className}
      onReady={args.onReady}
      onError={args.onError}
    />
  );
}

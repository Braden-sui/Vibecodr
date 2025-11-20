import type { ClientRuntimeType } from "./loadRuntimeManifest";
import { htmlRuntimeLoader } from "./loaders/htmlRuntimeLoader";
import { reactRuntimeLoader } from "./loaders/reactRuntimeLoader";
import type { RuntimeLoader, RuntimeLoaderArgs } from "./types";

const runtimeLoaders = new Map<ClientRuntimeType, RuntimeLoader>();

export function registerRuntime(type: ClientRuntimeType, loader: RuntimeLoader) {
  runtimeLoaders.set(type, loader);
}

export function getRuntimeLoader(type: ClientRuntimeType): RuntimeLoader | undefined {
  return runtimeLoaders.get(type);
}

export function loadRuntime(type: ClientRuntimeType, args: RuntimeLoaderArgs) {
  const loader = runtimeLoaders.get(type);
  if (!loader) {
    throw new Error(`E-VIBECODR-2107 unsupported runtime type: ${type}`);
  }
  return loader(args);
}

registerRuntime("react-jsx", reactRuntimeLoader);
registerRuntime("html", htmlRuntimeLoader);

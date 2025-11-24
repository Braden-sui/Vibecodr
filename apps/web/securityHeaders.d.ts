export type SecurityHeader = {
  key: string;
  value: string;
};

export type SecurityHeaderOptions = {
  allowEmbedding?: boolean;
  frameAncestors?: string | string[];
  crossOriginEmbedderPolicy?: string | null;
};

export const EMBED_PATH_PREFIX: string;

export function buildSecurityHeaders(options?: SecurityHeaderOptions): SecurityHeader[];

export function getSecurityHeaderSet(options?: SecurityHeaderOptions): SecurityHeader[];

export function applySecurityHeaders<T extends { headers: Headers }>(
  response: T,
  options?: SecurityHeaderOptions
): T;

declare const securityHeaders: {
  EMBED_PATH_PREFIX: typeof EMBED_PATH_PREFIX;
  buildSecurityHeaders: typeof buildSecurityHeaders;
  getSecurityHeaderSet: typeof getSecurityHeaderSet;
  applySecurityHeaders: typeof applySecurityHeaders;
};

export default securityHeaders;

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  RUNTIME_MANIFEST_KV?: KVNamespace;
  ALLOWLIST_HOSTS: string; // JSON string
  CLERK_JWT_ISSUER: string;
  CLERK_JWT_AUDIENCE?: string;
  BUILD_COORDINATOR_DURABLE: DurableObjectNamespace;
  ARTIFACT_COMPILER_DURABLE: DurableObjectNamespace;
  RATE_LIMIT_SHARD: DurableObjectNamespace;
  RUNTIME_EVENT_SHARD?: DurableObjectNamespace;
  COUNTER_SHARD?: DurableObjectNamespace;
  RUNTIME_EVENT_DO_MODE?: string;
  COUNTER_DO_MODE?: string;
  vibecodr_analytics_engine: AnalyticsEngineDataset;
  RUNTIME_ARTIFACTS_ENABLED?: string;
  CAPSULE_BUNDLE_NETWORK_MODE?: string;
  AWSBEDROCKAPI?: string;
  BEDROCK_REGION?: string;
  BEDROCK_SAFETY_MODEL?: string;
  SAFETY_ENABLED?: string;
  SAFETY_TIMEOUT_MS?: string;
  SAFETY_BLOCKED_CODE_HASHES?: string;
  NET_PROXY_ENABLED?: string;
  NET_PROXY_FREE_ENABLED?: string;
  CORS_ALLOWED_ORIGINS?: string;
  RUNTIME_MAX_CONCURRENT_ACTIVE?: string;
  RUNTIME_SESSION_MAX_MS?: string;
}

export type Handler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>
) => Promise<Response>;

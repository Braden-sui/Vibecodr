const DEFAULT_SHARDS = 32;

// Simple deterministic hash used to spread keys across Durable Object shards.
export function hashToShard(key: string, shardCount: number = DEFAULT_SHARDS): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const safeShardCount = Math.max(1, Math.trunc(shardCount));
  const shard = Math.abs(h) % safeShardCount;
  return String(shard >>> 0);
}

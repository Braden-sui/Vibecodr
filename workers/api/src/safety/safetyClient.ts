import type { Env } from "../types";

export type SafetyVerdict = {
  safe: boolean;
  risk_level: "low" | "medium" | "high";
  reasons: string[];
  blocked_capabilities: string[];
  tags: string[];
};

type SafetyInput = {
  code: string;
  language: string;
  environment: string;
  codeHash?: string;
};

type SafetyLog = {
  entryPath: string;
  codeHash?: string;
  verdict: SafetyVerdict;
};

const HEURISTIC_PATTERNS = [
  /child_process|exec|spawn|fork/i,
  /fs\./i,
  /eval|new Function/i,
  /while\s*\(true\)|for\s*\(\s*;\s*;\s*\)/i,
  /process\.env/i,
  /fetch|axios|http\.request|net\.connect/i,
  /stratum\+tcp|xmrig/i,
  /atob\(|Buffer\.from\(.*base64/i,
];

const BLOCKLIST_KV_PREFIX = "safety:blocked-code-hash:";
const DEFAULT_SAFETY_TAG = "mvp-allow";
const ERROR_PARSE_BLOCKLIST = "E-VIBECODR-0501";

export function collectSuspiciousPatterns(code: string): string[] {
  const hits: string[] = [];
  for (const pattern of HEURISTIC_PATTERNS) {
    if (pattern.test(code)) {
      hits.push(pattern.source);
    }
  }
  return hits;
}

export async function runSafetyCheck(env: Env, input: SafetyInput): Promise<SafetyVerdict> {
  const safetyEnabled = env.SAFETY_ENABLED !== "false";
  if (!safetyEnabled) {
    return allowWithNote("safety disabled");
  }

  const codeHash = input.codeHash || (await hashCode(input.code));
  const blocklistHit = await isHashBlocked(env, codeHash);
  if (blocklistHit.blocked) {
    return block(`blocked code hash ${codeHash}`, buildTags(["hash_block", blocklistHit.sourceTag], blocklistHit.reason));
  }

  // For MVP we only surface heuristics as visibility; we do not block unless hash-listed.
  const suspicious = collectSuspiciousPatterns(input.code);
  const reasons: string[] = suspicious.length > 0 ? [`${DEFAULT_SAFETY_TAG}: heuristics noted`] : [DEFAULT_SAFETY_TAG];
  const tags = buildTags(
    [DEFAULT_SAFETY_TAG, suspicious.length > 0 ? "heuristics" : undefined],
    suspicious.length > 0 ? `patterns=${suspicious.slice(0, 5).join(",")}` : undefined
  );

  return {
    safe: true,
    risk_level: suspicious.length > 0 ? "medium" : "low",
    reasons,
    blocked_capabilities: [],
    tags,
  };
}

function buildTags(tags: Array<string | undefined>, detail?: string): string[] {
  const set = new Set(tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0));
  if (detail) {
    set.add(detail);
  }
  return Array.from(set);
}

function block(reason: string, tags: string[] = []): SafetyVerdict {
  return {
    safe: false,
    risk_level: "high",
    reasons: [reason],
    blocked_capabilities: ["execution"],
    tags,
  };
}

function allowWithNote(note: string): SafetyVerdict {
  return {
    safe: true,
    risk_level: "low",
    reasons: [note],
    blocked_capabilities: [],
    tags: [],
  };
}

export async function hashCode(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function logSafetyVerdict(env: Env, log: SafetyLog) {
  try {
    env.vibecodr_analytics_engine?.writeDataPoint({
      blobs: [
        "safety_verdict",
        log.entryPath,
        log.verdict.risk_level,
        log.verdict.safe ? "allow" : "block",
        (log.verdict.tags || []).join(",") || "none",
        (log.verdict.reasons || []).slice(0, 3).join("|").slice(0, 512) || "n/a",
      ],
      indexes: [log.codeHash || ""],
      doubles: [],
    });
  } catch (error) {
    console.error("E-VIBECODR-SAFETY-LOG-FAILED", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function isHashBlocked(env: Env, hash: string): Promise<{ blocked: boolean; reason?: string; sourceTag?: string }> {
  const parsed = parseEnvBlocklist(env.SAFETY_BLOCKED_CODE_HASHES);
  if (parsed.list.has(hash)) {
    return { blocked: true, reason: parsed.reason, sourceTag: "env_blocklist" };
  }

  if (env.RUNTIME_MANIFEST_KV) {
    try {
      const kvHit = await env.RUNTIME_MANIFEST_KV.get(`${BLOCKLIST_KV_PREFIX}${hash}`);
      if (kvHit) {
        return { blocked: true, reason: kvHit, sourceTag: "kv_blocklist" };
      }
    } catch (error) {
      console.error("E-VIBECODR-0502 kv_blocklist_check_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { blocked: false };
}

function parseEnvBlocklist(raw?: string): { list: Set<string>; reason: string } {
  if (!raw) {
    return { list: new Set(), reason: DEFAULT_SAFETY_TAG };
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        list: new Set(parsed.filter((val): val is string => typeof val === "string" && val.trim().length > 0)),
        reason: "env blocklist",
      };
    }
  } catch (error) {
    console.error(ERROR_PARSE_BLOCKLIST, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { list: new Set(), reason: DEFAULT_SAFETY_TAG };
}

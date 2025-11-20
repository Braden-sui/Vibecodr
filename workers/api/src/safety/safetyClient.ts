import type { Env } from "../index";

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
};

type SafetyLog = {
  entryPath: string;
  codeHash?: string;
  verdict: SafetyVerdict;
};

const HARD_BLOCK_PATTERNS = [
  /xmrig|coinhive|stratum\+tcp/i,
  /child_process/i,
  /ProcessBuilder/,
];

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

const MAX_CODE_LENGTH = 12000;

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

  if (!env.AWSBEDROCKAPI) {
    return block("missing AWS Bedrock token");
  }

  if (HARD_BLOCK_PATTERNS.some((pattern) => pattern.test(input.code))) {
    return block("hard-block pattern match", ["hard_block"]);
  }

  const suspicious = collectSuspiciousPatterns(input.code);
  const truncated = input.code.length > MAX_CODE_LENGTH;
  const codeForModel = truncated ? `${input.code.slice(0, MAX_CODE_LENGTH)}\n/* truncated */` : input.code;

  const system = [
    "You are a security reviewer for a social coding platform.",
    "Decide if the provided code is safe to run in a restricted container.",
    "Focus on: remote code execution, crypto mining, arbitrary network calls, filesystem access, process spawning, data exfiltration (env/secrets/tokens), fingerprinting.",
    "Be conservative. Return ONLY valid JSON:",
    '{"safe":bool,"risk_level":"low|medium|high","reasons":[...],"blocked_capabilities":[...],"tags":[...]}',
  ].join(" ");

  const payload = {
    model: env.BEDROCK_SAFETY_MODEL || "openai.gpt-oss-120b-1:0",
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          language: input.language,
          environment: input.environment,
          suspicious_patterns: suspicious,
          code: codeForModel,
        }),
      },
    ],
    max_tokens: 256,
    temperature: 0,
    response_format: { type: "json_object" },
  };

  const timeoutMs = Number(env.SAFETY_TIMEOUT_MS || 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(
      `https://bedrock-runtime.${env.BEDROCK_REGION || "us-west-2"}.amazonaws.com/openai/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.AWSBEDROCKAPI}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!resp.ok) {
      return block(`safety model HTTP ${resp.status}`, ["model_error"]);
    }

    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return block("invalid safety model response", ["parse_error"]);
    }

    const parsed = JSON.parse(content) as SafetyVerdict;
    const tags = Array.from(new Set([...(parsed.tags ?? []), ...(truncated ? ["truncated"] : [])]));
    return {
      safe: !!parsed.safe,
      risk_level: parsed.risk_level ?? "high",
      reasons: parsed.reasons ?? ["no reasons provided"],
      blocked_capabilities: parsed.blocked_capabilities ?? [],
      tags,
    };
  } catch (error) {
    return block("safety model unavailable", ["timeout"]);
  }
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

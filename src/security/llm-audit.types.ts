// ── LLM Audit Interceptor — Types ───────────────────────────────

export type LlmAuditMode = "off" | "log-only" | "warn" | "block";

export type LlmAuditThreat = {
  type: "prompt_injection" | "data_exfiltration" | "privilege_escalation" | "other";
  description: string;
  severity: "low" | "medium" | "high";
};

export type LlmAuditResult = {
  severity: "safe" | "suspicious" | "dangerous";
  decision: "allow" | "flag" | "deny";
  reasoning: string;
  threats: LlmAuditThreat[];
  confidence: number;
  latencyMs: number;
  cached: boolean;
};

export type LlmAuditConfig = {
  mode?: LlmAuditMode;
  toolPatterns?: string[];
  maxAuditsPerSession?: number;
  model?: string;
  cacheEnabled?: boolean;
  cacheTtlMs?: number;
};

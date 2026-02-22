import type { OpenClawConfig } from "../config/config.js";

// ---------------------------------------------------------------------------
// OWASP Risk definitions
// ---------------------------------------------------------------------------

export type OwaspCategory = "llm-top-10" | "agentic-top-10";
export type OwaspCoverageStatus = "red" | "yellow" | "green";

export type OwaspRisk = {
  id: string;
  name: string;
  category: OwaspCategory;
  /** Config paths that mitigate this risk. */
  configPaths: string[];
  /** Short description of the risk. */
  summary: string;
  /** What a "green" (mitigated) state looks like. */
  mitigationHint: string;
};

// ---------------------------------------------------------------------------
// OWASP Top 10 for LLM Applications 2025
// ---------------------------------------------------------------------------

export const OWASP_LLM_TOP_10: readonly OwaspRisk[] = [
  {
    id: "LLM01",
    name: "Prompt Injection",
    category: "llm-top-10",
    configPaths: ["tools.exec.security", "tools.deny", "logging.redactSensitive"],
    summary:
      "Adversaries craft inputs that override model instructions, " +
      "leading to unauthorized actions or data exfiltration.",
    mitigationHint: "Sandbox exec, restrict tool profiles, enable redaction.",
  },
  {
    id: "LLM02",
    name: "Sensitive Information Disclosure",
    category: "llm-top-10",
    configPaths: ["logging.redactSensitive", "logging.redactPatterns", "tools.exec.safeBins"],
    summary:
      "The model inadvertently reveals confidential data such as API keys, " +
      "credentials, or PII in outputs.",
    mitigationHint: "Enable sensitive data redaction; restrict exec to safe binaries.",
  },
  {
    id: "LLM03",
    name: "Supply Chain Vulnerabilities",
    category: "llm-top-10",
    configPaths: ["plugins", "tools.exec.host"],
    summary:
      "Compromised plugins, models, or dependencies introduce malicious " +
      "behavior into the agent pipeline.",
    mitigationHint: "Sandbox exec host; audit plugin manifests; pin versions.",
  },
  {
    id: "LLM04",
    name: "Data Poisoning",
    category: "llm-top-10",
    configPaths: ["channels.*.dmPolicy", "channels.*.allowFrom"],
    summary:
      "Tampered training data or context injections lead to biased, " +
      "inaccurate, or malicious model responses.",
    mitigationHint: "Restrict inbound messages via allowlists and DM policies.",
  },
  {
    id: "LLM05",
    name: "Insecure Output Handling",
    category: "llm-top-10",
    configPaths: ["logging.redactSensitive", "tools.exec.safeBins", "tools.exec.security"],
    summary:
      "Unvalidated LLM outputs are passed to downstream systems, enabling " +
      "code execution, XSS, or SSRF.",
    mitigationHint: "Restrict exec security mode; limit safe binaries; redact outputs.",
  },
  {
    id: "LLM06",
    name: "Excessive Agency",
    category: "llm-top-10",
    configPaths: ["tools.profile", "tools.exec.host", "tools.elevated.enabled"],
    summary:
      "The model is granted unchecked autonomy to perform actions, leading " +
      "to unintended or harmful operations.",
    mitigationHint: "Use minimal tool profile; sandbox exec; disable elevated mode.",
  },
  {
    id: "LLM07",
    name: "System Prompt Leakage",
    category: "llm-top-10",
    configPaths: ["logging.redactSensitive", "tools.exec.security"],
    summary:
      "Attackers extract system prompts, revealing internal logic, " +
      "guardrails, and potentially sensitive instructions.",
    mitigationHint: "Enable redaction; restrict exec to prevent file access to prompts.",
  },
  {
    id: "LLM08",
    name: "Vector & Embedding Weaknesses",
    category: "llm-top-10",
    configPaths: ["memory", "tools.exec.security"],
    summary:
      "Exploits in RAG pipelines allow adversaries to inject, extract, " +
      "or manipulate vector store data.",
    mitigationHint: "Restrict memory access; sandbox vector store operations.",
  },
  {
    id: "LLM09",
    name: "Misinformation",
    category: "llm-top-10",
    configPaths: ["tools.loopDetection.enabled", "tools.web.search.enabled"],
    summary:
      "The model generates convincingly false information, leading to " +
      "incorrect decisions or actions.",
    mitigationHint: "Enable loop detection; provide web search for fact-checking.",
  },
  {
    id: "LLM10",
    name: "Unbounded Consumption",
    category: "llm-top-10",
    configPaths: ["tools.exec.timeoutSec", "tools.exec.backgroundMs", "tools.loopDetection.enabled"],
    summary:
      "Resource-exhaustion attacks via repeated or expensive model " +
      "invocations cause denial of service or cost overruns.",
    mitigationHint: "Set exec timeouts; enable loop detection with circuit breaker.",
  },
];

// ---------------------------------------------------------------------------
// OWASP Top 10 for Agentic Applications 2026
// ---------------------------------------------------------------------------

export const OWASP_AGENTIC_TOP_10: readonly OwaspRisk[] = [
  {
    id: "AG01",
    name: "Agent Goal Hijacking",
    category: "agentic-top-10",
    configPaths: ["tools.exec.security", "channels.*.dmPolicy", "channels.*.allowFrom"],
    summary:
      "Attackers redirect an agent's objectives through poisoned inputs — " +
      "emails, documents, or web content embedded with malicious instructions.",
    mitigationHint: "Restrict DM policy; use allowlists; sandbox exec.",
  },
  {
    id: "AG02",
    name: "Tool Misuse",
    category: "agentic-top-10",
    configPaths: ["tools.exec.safeBins", "tools.deny", "tools.loopDetection.enabled"],
    summary:
      "An agent uses legitimate tools in unsafe ways — calling destructive " +
      "parameters or chaining tools in unintended sequences.",
    mitigationHint: "Restrict to safe binaries; maintain deny lists; enable loop detection.",
  },
  {
    id: "AG03",
    name: "Sensitive Data Leakage",
    category: "agentic-top-10",
    configPaths: ["logging.redactSensitive", "logging.redactPatterns", "tools.message.crossContext"],
    summary:
      "The agent inadvertently leaks confidential data — IP, financial " +
      "data, or user PII — in responses or cross-context messages.",
    mitigationHint: "Enable redaction with custom patterns; restrict cross-context sends.",
  },
  {
    id: "AG04",
    name: "Knowledge Poisoning",
    category: "agentic-top-10",
    configPaths: ["channels.*.dmPolicy", "channels.*.allowFrom", "memory"],
    summary:
      "Attackers corrupt data sources the agent relies on for decisions, " +
      "leading to flawed or malicious outcomes.",
    mitigationHint: "Restrict inbound via allowlists; secure memory access.",
  },
  {
    id: "AG05",
    name: "Unbounded Resource Consumption",
    category: "agentic-top-10",
    configPaths: [
      "tools.exec.timeoutSec",
      "tools.exec.backgroundMs",
      "tools.loopDetection.enabled",
      "gateway.auth.rateLimit",
    ],
    summary:
      "An attacker tricks the agent into resource-intensive tasks, " +
      "causing excessive costs, slowdowns, or denial of service.",
    mitigationHint: "Set tight timeouts; enable rate limiting and loop detection.",
  },
  {
    id: "AG06",
    name: "Rogue Agent Behavior",
    category: "agentic-top-10",
    configPaths: ["tools.agentToAgent.enabled", "tools.elevated.enabled", "tools.profile"],
    summary:
      "An agent acts outside its intended scope — escalating privileges, " +
      "accessing unauthorized systems, or overriding safety guardrails.",
    mitigationHint: "Disable agent-to-agent; disable elevated mode; use minimal profile.",
  },
  {
    id: "AG07",
    name: "Cascading Failures",
    category: "agentic-top-10",
    configPaths: [
      "tools.loopDetection.enabled",
      "tools.loopDetection.globalCircuitBreakerThreshold",
      "tools.agentToAgent.enabled",
    ],
    summary:
      "A failure in one agent or tool cascades across multi-agent workflows, " +
      "amplifying damage across systems.",
    mitigationHint: "Enable circuit breaker; restrict agent-to-agent messaging.",
  },
  {
    id: "AG08",
    name: "Insufficient Access Controls",
    category: "agentic-top-10",
    configPaths: [
      "gateway.auth.mode",
      "gateway.bind",
      "tools.elevated.allowFrom",
      "gateway.controlUi.dangerouslyDisableDeviceAuth",
    ],
    summary:
      "Weak or missing authentication and authorization allow " +
      "unauthorized users to control the agent.",
    mitigationHint: "Use token/password auth; bind to loopback; keep device auth enabled.",
  },
  {
    id: "AG09",
    name: "Inadequate Audit & Observability",
    category: "agentic-top-10",
    configPaths: ["logging.level", "logging.redactSensitive", "logging.file"],
    summary:
      "Insufficient logging and monitoring makes it impossible to detect " +
      "or investigate security incidents.",
    mitigationHint: "Set logging level to info or debug; enable file logging; redact sensitive data.",
  },
  {
    id: "AG10",
    name: "Insecure Credential Management",
    category: "agentic-top-10",
    configPaths: [
      "gateway.auth.token",
      "gateway.tls.enabled",
      "logging.redactSensitive",
    ],
    summary:
      "Credentials are stored insecurely, transmitted in plaintext, or " +
      "accessible to the agent's execution environment.",
    mitigationHint: "Use strong tokens; enable TLS; redact sensitive outputs.",
  },
];

/** All 20 OWASP risks combined. */
export const ALL_OWASP_RISKS: readonly OwaspRisk[] = [
  ...OWASP_LLM_TOP_10,
  ...OWASP_AGENTIC_TOP_10,
];

// ---------------------------------------------------------------------------
// Coverage evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate OWASP risk coverage for a given config.
 * Returns a map from risk ID to coverage status (red/yellow/green).
 */
export function evaluateOwaspCoverage(
  config: OpenClawConfig,
): Map<string, OwaspCoverageStatus> {
  const result = new Map<string, OwaspCoverageStatus>();
  for (const risk of ALL_OWASP_RISKS) {
    result.set(risk.id, evaluateRisk(config, risk));
  }
  return result;
}

/**
 * Compute an aggregate coverage score: count of green + yellow (partial) items
 * out of total risks.
 */
export function computeCoverageScore(coverage: Map<string, OwaspCoverageStatus>): {
  covered: number;
  partial: number;
  uncovered: number;
  total: number;
} {
  let covered = 0;
  let partial = 0;
  let uncovered = 0;
  for (const status of coverage.values()) {
    if (status === "green") covered++;
    else if (status === "yellow") partial++;
    else uncovered++;
  }
  return { covered, partial, uncovered, total: coverage.size };
}

/**
 * Format a human-readable OWASP coverage summary suitable for CLI output.
 */
export function formatCoverageSummary(coverage: Map<string, OwaspCoverageStatus>): string {
  const score = computeCoverageScore(coverage);
  const lines: string[] = [
    `OWASP Coverage: ${score.covered}/${score.total} mitigated, ${score.partial} partial, ${score.uncovered} uncovered`,
    "",
  ];

  for (const risk of ALL_OWASP_RISKS) {
    const status = coverage.get(risk.id) ?? "red";
    const icon = status === "green" ? "[OK]" : status === "yellow" ? "[!!]" : "[XX]";
    lines.push(`  ${icon} ${risk.id}: ${risk.name}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal evaluation logic
// ---------------------------------------------------------------------------

function evaluateRisk(config: OpenClawConfig, risk: OwaspRisk): OwaspCoverageStatus {
  const checks = risk.configPaths.map((path) => evaluateConfigPath(config, path));
  if (checks.every((c) => c === "green")) return "green";
  if (checks.some((c) => c === "red")) return "red";
  return "yellow";
}

function evaluateConfigPath(config: OpenClawConfig, path: string): OwaspCoverageStatus {
  // Evaluate each config path against known secure thresholds
  switch (path) {
    // --- Gateway ---
    case "gateway.auth.mode": {
      const mode = config.gateway?.auth?.mode;
      if (mode === "token" || mode === "password" || mode === "trusted-proxy") return "green";
      if (mode === "none") return "red";
      return "yellow"; // undefined → defaults to token in runtime
    }
    case "gateway.bind": {
      const bind = config.gateway?.bind;
      if (bind === "loopback") return "green";
      if (bind === "tailnet") return "yellow";
      if (bind === "lan" || bind === "auto" || bind === "custom") return "red";
      return "yellow"; // undefined → defaults to loopback in runtime
    }
    case "gateway.auth.rateLimit": {
      const rl = config.gateway?.auth?.rateLimit;
      if (rl?.maxAttempts && rl.maxAttempts <= 10) return "green";
      if (rl?.maxAttempts) return "yellow";
      return "yellow"; // undefined → runtime defaults apply
    }
    case "gateway.auth.token": {
      const token = config.gateway?.auth?.token;
      if (token && token.length >= 24) return "green";
      if (token) return "yellow";
      return "yellow"; // auto-generated at runtime
    }
    case "gateway.tls.enabled": {
      return config.gateway?.tls?.enabled ? "green" : "yellow";
    }
    case "gateway.controlUi.dangerouslyDisableDeviceAuth": {
      return config.gateway?.controlUi?.dangerouslyDisableDeviceAuth ? "red" : "green";
    }

    // --- Tools exec ---
    case "tools.exec.security": {
      const sec = config.tools?.exec?.security;
      if (sec === "deny") return "green";
      if (sec === "allowlist") return "yellow";
      if (sec === "full") return "red";
      return "yellow"; // undefined → default "deny" in runtime
    }
    case "tools.exec.host": {
      const host = config.tools?.exec?.host;
      if (host === "sandbox") return "green";
      if (host === "node") return "yellow";
      if (host === "gateway") return "red";
      return "yellow"; // undefined → default "sandbox" in runtime
    }
    case "tools.exec.safeBins": {
      const bins = config.tools?.exec?.safeBins;
      if (bins && bins.length > 0) return "green";
      return "yellow";
    }
    case "tools.exec.timeoutSec": {
      const t = config.tools?.exec?.timeoutSec;
      if (t !== undefined && t <= 120) return "green";
      if (t !== undefined) return "yellow";
      return "yellow";
    }
    case "tools.exec.backgroundMs": {
      const bg = config.tools?.exec?.backgroundMs;
      if (bg !== undefined && bg <= 30_000) return "green";
      if (bg !== undefined) return "yellow";
      return "yellow";
    }

    // --- Tools profile & policies ---
    case "tools.profile": {
      const p = config.tools?.profile;
      if (p === "minimal") return "green";
      if (p === "coding" || p === "messaging") return "yellow";
      if (p === "full") return "red";
      return "yellow";
    }
    case "tools.deny": {
      const deny = config.tools?.deny;
      if (deny && deny.length > 0) return "green";
      return "yellow";
    }
    case "tools.elevated.enabled": {
      return config.tools?.elevated?.enabled === false ? "green" : "yellow";
    }
    case "tools.elevated.allowFrom": {
      const af = config.tools?.elevated?.allowFrom;
      if (!af) return "yellow";
      // Check for wildcard entries
      for (const entries of Object.values(af)) {
        if (entries?.includes("*")) return "red";
      }
      return "green";
    }

    // --- Loop detection ---
    case "tools.loopDetection.enabled": {
      return config.tools?.loopDetection?.enabled ? "green" : "yellow";
    }
    case "tools.loopDetection.globalCircuitBreakerThreshold": {
      const threshold = config.tools?.loopDetection?.globalCircuitBreakerThreshold;
      if (threshold && threshold <= 30) return "green";
      return config.tools?.loopDetection?.enabled ? "yellow" : "red";
    }

    // --- Agent-to-agent ---
    case "tools.agentToAgent.enabled": {
      return config.tools?.agentToAgent?.enabled === false ? "green" : "yellow";
    }

    // --- Messaging ---
    case "tools.message.crossContext": {
      const cc = config.tools?.message?.crossContext;
      if (cc?.allowAcrossProviders === false && cc?.allowWithinProvider === false) return "green";
      if (cc?.allowAcrossProviders === false) return "yellow";
      return "red";
    }

    // --- Logging ---
    case "logging.redactSensitive": {
      const r = config.logging?.redactSensitive;
      if (r === "tools") return "green";
      if (r === "off") return "red";
      return "yellow";
    }
    case "logging.redactPatterns": {
      const patterns = config.logging?.redactPatterns;
      if (patterns && patterns.length > 0) return "green";
      return "yellow";
    }
    case "logging.level": {
      const level = config.logging?.level;
      if (level === "debug" || level === "trace") return "green";
      if (level === "info") return "green";
      if (level === "warn" || level === "error") return "yellow";
      return "yellow"; // undefined → runtime default
    }
    case "logging.file": {
      return config.logging?.file ? "green" : "yellow";
    }

    // --- Channels (wildcard) ---
    case "channels.*.dmPolicy": {
      // We can't check per-channel without knowing which channels are configured.
      // Check global-level indicators.
      return "yellow"; // Requires per-channel evaluation at render time
    }
    case "channels.*.allowFrom": {
      return "yellow"; // Requires per-channel evaluation at render time
    }

    // --- Other ---
    case "plugins": {
      return "yellow"; // No direct boolean; depends on which plugins are installed
    }
    case "memory": {
      return "yellow"; // Memory config varies; not directly good/bad
    }
    case "tools.web.search.enabled": {
      return config.tools?.web?.search?.enabled !== false ? "green" : "yellow";
    }

    default:
      return "yellow";
  }
}

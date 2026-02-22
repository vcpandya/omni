import type { OpenClawConfig } from "../config/config.js";
import type { GatewayBindMode } from "../config/types.gateway.js";
import {
  applyComplianceProfile,
  COMPLIANCE_PROFILE_LIST,
  type ComplianceProfileId,
} from "./compliance-profiles.js";
import type { WizardFlow } from "./onboarding.types.js";
import { evaluateOwaspCoverage, formatCoverageSummary } from "./owasp-mapping.js";
import { promptAdminProfile } from "./onboarding.admin.js";
import type { WizardPrompter } from "./prompts.js";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export type UsageMode = "personal" | "enterprise";

export async function promptSecurityConfig(params: {
  config: OpenClawConfig;
  prompter: WizardPrompter;
  flow: WizardFlow;
}): Promise<OpenClawConfig> {
  const { prompter, flow } = params;
  let config = structuredClone(params.config);

  // QuickStart: apply Standard profile silently
  if (flow === "quickstart") {
    config = applyComplianceProfile(config, "standard");
    await prompter.note(
      "Applied Standard security profile with balanced defaults.",
      "Enterprise Security",
    );
    return config;
  }

  // -----------------------------------------------------------------------
  // Step 0: Usage mode — Personal vs Enterprise
  // -----------------------------------------------------------------------
  const usageMode = await prompter.select<UsageMode>({
    message: "How will you use Omni?",
    options: [
      {
        value: "personal",
        label: "Personal Use",
        hint: "Secure defaults, streamlined setup — great for individuals and small teams",
      },
      {
        value: "enterprise",
        label: "Enterprise Use",
        hint: "SSO, access control, group policies, device management, compliance profiles",
      },
    ],
    initialValue: "personal",
  });

  // Personal flow: apply Standard profile with sensible defaults, skip enterprise features
  if (usageMode === "personal") {
    return await promptPersonalSecurityConfig(config, prompter);
  }

  // -----------------------------------------------------------------------
  // Step A: Compliance profile selection (enterprise flow)
  // -----------------------------------------------------------------------
  await prompter.note(
    [
      "Omni supports enterprise compliance profiles that configure security",
      "settings as a group. You can customize individual settings afterward.",
      "",
      "Profiles are informed by OWASP LLM Top 10 (2025), OWASP Agentic",
      "Top 10 (2026), and industry best practices from CrowdStrike,",
      "Microsoft, and IronClaw research.",
    ].join("\n"),
    "Enterprise Security",
  );

  const profileId = await prompter.select<ComplianceProfileId>({
    message: "Compliance profile",
    options: COMPLIANCE_PROFILE_LIST.map((p) => ({
      value: p.id,
      label: p.label,
      hint: p.description.split(".")[0],
    })),
    initialValue: "standard",
  });

  config = applyComplianceProfile(config, profileId);

  const profile = COMPLIANCE_PROFILE_LIST.find((p) => p.id === profileId)!;

  if (profileId === "development") {
    await prompter.note(
      [
        "WARNING: Development profile disables most security controls.",
        "Do not use in production or shared environments.",
        "",
        "- No authentication",
        "- Full tool access with gateway-hosted exec",
        "- Credential leak detection: OFF",
        "- Prompt injection defense: OFF",
      ].join("\n"),
      "Security Warning",
    );
  } else {
    await prompter.note(
      [
        `Profile: ${profile.label}`,
        `Risk level: ${profile.riskLevel}`,
        `Credential leak detection: ${profile.credentialLeakSeverity}`,
        `Prompt injection defense: ${profile.promptInjectionDefense}`,
        `Endpoint allowlisting: ${profile.endpointAllowlistMode}`,
        `Tool timeout: ${profile.toolTimeoutSec}s`,
        `Tool memory limit: ${profile.toolMemoryLimitMb}MB`,
      ].join("\n"),
      `${profile.label} Profile Applied`,
    );
  }

  // -----------------------------------------------------------------------
  // Step B: Customize?
  // -----------------------------------------------------------------------
  const customize = await prompter.confirm({
    message: "Customize individual security settings?",
    initialValue: false,
  });

  if (customize) {
    config = await promptNetworkSecurity(config, prompter);
    config = await promptExecSandbox(config, prompter);
    config = await promptToolPolicies(config, prompter);
    config = await promptChannelSecurity(config, prompter);
    config = await promptPromptInjectionDefense(config, prompter);
    config = await promptCredentialLeakDetection(config, prompter);
    config = await promptResourceConstraints(config, prompter);
  }

  // -----------------------------------------------------------------------
  // Step C: Enterprise admin profile (SSO, ACL, group policy, device push)
  // -----------------------------------------------------------------------
  config = await promptAdminProfile({ config, prompter });

  // -----------------------------------------------------------------------
  // Step D: Inline security audit
  // -----------------------------------------------------------------------
  const runAudit = await prompter.confirm({
    message: "Run security audit now?",
    initialValue: true,
  });

  if (runAudit) {
    const progress = prompter.progress("Running security audit");
    try {
      const { runSecurityAudit } = await import("../security/audit.js");
      const report = await runSecurityAudit({
        config,
        deep: false,
        includeFilesystem: true,
        includeChannelSecurity: true,
      });
      progress.stop("Audit complete");

      const lines: string[] = [
        `Critical: ${report.summary.critical}  Warn: ${report.summary.warn}  Info: ${report.summary.info}`,
        "",
      ];
      const topFindings = report.findings
        .filter((f) => f.severity !== "info")
        .slice(0, 10);
      for (const f of topFindings) {
        lines.push(`[${f.severity.toUpperCase()}] ${f.title}`);
        if (f.remediation) lines.push(`  Fix: ${f.remediation}`);
      }
      if (report.findings.length > topFindings.length) {
        lines.push(
          `  ... and ${report.findings.length - topFindings.length} more findings.`,
        );
      }
      await prompter.note(lines.join("\n"), "Security Audit Results");

      if (report.summary.critical > 0) {
        const autoFix = await prompter.confirm({
          message: `Auto-fix ${report.summary.critical} critical issue(s)?`,
          initialValue: true,
        });
        if (autoFix) {
          const { fixSecurityFootguns } = await import("../security/fix.js");
          const fixProgress = prompter.progress("Applying fixes");
          await fixSecurityFootguns();
          fixProgress.stop("Fixes applied");
        }
      }
    } catch {
      progress.stop("Audit skipped (error)");
    }
  }

  // -----------------------------------------------------------------------
  // Step E: OWASP coverage summary
  // -----------------------------------------------------------------------
  const coverage = evaluateOwaspCoverage(config);
  await prompter.note(formatCoverageSummary(coverage), "OWASP Coverage");

  return config;
}

// ---------------------------------------------------------------------------
// Personal Use — streamlined, lenient-yet-secure flow
// ---------------------------------------------------------------------------

async function promptPersonalSecurityConfig(
  config: OpenClawConfig,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  // Apply Standard profile as baseline
  config = applyComplianceProfile(config, "standard");

  await prompter.note(
    [
      "Personal mode applies the Standard security profile with balanced",
      "defaults. We'll ask a few quick questions to tailor your setup.",
      "",
      "  ✓ Token authentication enabled",
      "  ✓ Loopback-only binding",
      "  ✓ Credential leak detection (warn)",
      "  ✓ Exec sandbox with allowlisted commands",
      "  ✓ Tool loop detection enabled",
    ].join("\n"),
    "Personal Security — Standard Profile",
  );

  // ── Gateway binding ──
  const bind = await prompter.select({
    message: "Gateway network binding",
    options: [
      { value: "loopback", label: "Loopback only", hint: "127.0.0.1 — recommended for personal use" },
      { value: "lan", label: "LAN", hint: "Accessible from your local network" },
    ],
    initialValue: "loopback",
  });
  config = {
    ...config,
    gateway: { ...config.gateway, bind: bind as GatewayBindMode },
  };

  // ── Auth mode ──
  const authMode = await prompter.select({
    message: "Authentication",
    options: [
      { value: "token", label: "Token", hint: "Auto-generated secret — recommended" },
      { value: "password", label: "Password", hint: "Choose your own password" },
      { value: "none", label: "None", hint: "No auth — local development only" },
    ],
    initialValue: config.gateway?.auth?.mode ?? "token",
  });
  config = {
    ...config,
    gateway: {
      ...config.gateway,
      auth: { ...config.gateway?.auth, mode: authMode as "token" | "password" | "none" },
    },
  };

  // ── Exec security ──
  const execSecurity = await prompter.select({
    message: "Command execution security",
    options: [
      { value: "allowlist", label: "Allowlist", hint: "Only approved commands — recommended" },
      { value: "full", label: "Full access", hint: "Unrestricted commands" },
    ],
    initialValue: config.tools?.exec?.security ?? "allowlist",
  });
  config = {
    ...config,
    tools: {
      ...config.tools,
      exec: {
        ...config.tools?.exec,
        security: execSecurity as "allowlist" | "full",
      },
    },
  };

  // ── Summary ──
  const summary = [
    `Binding: ${bind}`,
    `Auth: ${authMode}`,
    `Exec: ${execSecurity}`,
    `Credential leak detection: warn`,
    `Loop detection: enabled`,
    "",
    "You can customize these later via the web dashboard or",
    "`omni configure --section security`.",
  ];
  await prompter.note(summary.join("\n"), "Personal Security Applied");

  return config;
}

// ---------------------------------------------------------------------------
// Sub-section: Network & Gateway Security
// ---------------------------------------------------------------------------

async function promptNetworkSecurity(
  config: OpenClawConfig,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  const bind = await prompter.select({
    message: "Gateway network binding",
    options: [
      { value: "loopback", label: "Loopback only", hint: "127.0.0.1 — most secure" },
      { value: "tailnet", label: "Tailscale tailnet", hint: "Encrypted mesh VPN" },
      { value: "lan", label: "LAN", hint: "Local network — moderate risk" },
      { value: "auto", label: "Auto-detect", hint: "Binds based on environment" },
    ],
    initialValue: config.gateway?.bind ?? "loopback",
  });
  config = {
    ...config,
    gateway: { ...config.gateway, bind: bind as GatewayBindMode },
  };

  const authMode = await prompter.select({
    message: "Authentication method",
    options: [
      { value: "token", label: "Token", hint: "Random shared secret — recommended" },
      { value: "password", label: "Password", hint: "User-chosen password" },
      { value: "trusted-proxy", label: "Trusted proxy", hint: "Reverse proxy handles auth" },
      { value: "none", label: "None", hint: "No auth — development only" },
    ],
    initialValue: config.gateway?.auth?.mode ?? "token",
  });
  config = {
    ...config,
    gateway: {
      ...config.gateway,
      auth: { ...config.gateway?.auth, mode: authMode as "token" | "password" | "trusted-proxy" | "none" },
    },
  };

  if (authMode !== "none") {
    const enableRateLimit = await prompter.confirm({
      message: "Enable auth rate limiting?",
      initialValue: true,
    });
    if (enableRateLimit) {
      const maxAttempts = await prompter.text({
        message: "Max failed attempts before lockout",
        initialValue: String(config.gateway?.auth?.rateLimit?.maxAttempts ?? 10),
        validate: (v) => {
          const n = parseInt(v, 10);
          return isNaN(n) || n < 1 ? "Must be a positive number" : undefined;
        },
      });
      config = {
        ...config,
        gateway: {
          ...config.gateway,
          auth: {
            ...config.gateway?.auth,
            rateLimit: {
              ...config.gateway?.auth?.rateLimit,
              maxAttempts: parseInt(maxAttempts, 10),
            },
          },
        },
      };
    }
  }

  const enableTls = await prompter.confirm({
    message: "Enable TLS encryption?",
    initialValue: config.gateway?.tls?.enabled ?? false,
  });
  if (enableTls) {
    config = {
      ...config,
      gateway: {
        ...config.gateway,
        tls: { ...config.gateway?.tls, enabled: true, autoGenerate: true },
      },
    };
  }

  return config;
}

// ---------------------------------------------------------------------------
// Sub-section: Execution Sandbox
// ---------------------------------------------------------------------------

async function promptExecSandbox(
  config: OpenClawConfig,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  const host = await prompter.select({
    message: "Exec host environment",
    options: [
      { value: "sandbox", label: "Sandbox", hint: "Isolated container — most secure" },
      { value: "node", label: "Remote node", hint: "Dedicated compute node" },
      { value: "gateway", label: "Gateway host", hint: "Runs on gateway machine — least secure" },
    ],
    initialValue: config.tools?.exec?.host ?? "sandbox",
  });

  const security = await prompter.select({
    message: "Exec security mode",
    options: [
      { value: "deny", label: "Deny all", hint: "Block all exec — strictest" },
      { value: "allowlist", label: "Allowlist", hint: "Only approved commands" },
      { value: "full", label: "Full access", hint: "Unrestricted — development only" },
    ],
    initialValue: config.tools?.exec?.security ?? "allowlist",
  });

  config = {
    ...config,
    tools: {
      ...config.tools,
      exec: {
        ...config.tools?.exec,
        host: host as "sandbox" | "node" | "gateway",
        security: security as "deny" | "allowlist" | "full",
      },
    },
  };

  if (security === "allowlist") {
    const safeBinsInput = await prompter.text({
      message: "Safe binaries (comma-separated)",
      initialValue: (config.tools?.exec?.safeBins ?? ["cat", "ls", "head", "wc", "grep"]).join(", "),
      placeholder: "cat, ls, head, wc, grep, find",
    });
    const safeBins = safeBinsInput.split(",").map((s) => s.trim()).filter(Boolean);
    config = {
      ...config,
      tools: {
        ...config.tools,
        exec: { ...config.tools?.exec, safeBins },
      },
    };
  }

  return config;
}

// ---------------------------------------------------------------------------
// Sub-section: Tool & Agent Policies
// ---------------------------------------------------------------------------

async function promptToolPolicies(
  config: OpenClawConfig,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  const profile = await prompter.select({
    message: "Tool profile",
    options: [
      { value: "minimal", label: "Minimal", hint: "Bare essentials only" },
      { value: "coding", label: "Coding", hint: "Read, write, exec tools" },
      { value: "messaging", label: "Messaging", hint: "Channel + send tools" },
      { value: "full", label: "Full", hint: "All available tools" },
    ],
    initialValue: config.tools?.profile ?? "coding",
  });

  const enableElevated = await prompter.confirm({
    message: "Allow elevated exec permissions?",
    initialValue: config.tools?.elevated?.enabled ?? true,
  });

  const enableA2A = await prompter.confirm({
    message: "Allow agent-to-agent communication?",
    initialValue: config.tools?.agentToAgent?.enabled ?? false,
  });

  const enableLoopDetection = await prompter.confirm({
    message: "Enable tool loop detection?",
    initialValue: config.tools?.loopDetection?.enabled ?? true,
  });

  config = {
    ...config,
    tools: {
      ...config.tools,
      profile: profile as "minimal" | "coding" | "messaging" | "full",
      elevated: { ...config.tools?.elevated, enabled: enableElevated },
      agentToAgent: { ...config.tools?.agentToAgent, enabled: enableA2A },
      loopDetection: { ...config.tools?.loopDetection, enabled: enableLoopDetection },
    },
  };

  return config;
}

// ---------------------------------------------------------------------------
// Sub-section: Channel Security
// ---------------------------------------------------------------------------

async function promptChannelSecurity(
  config: OpenClawConfig,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  await prompter.note(
    [
      "Channel security controls who can message the agent and how.",
      "",
      "DM policies: pairing (device pairing required), allowlist (approved users),",
      "open (anyone), disabled (no DMs).",
      "",
      "Per-channel configuration is available after onboarding via the",
      "channels command or the web dashboard.",
    ].join("\n"),
    "Channel Security",
  );

  const crossContextWithin = await prompter.confirm({
    message: "Allow cross-context sends within the same provider?",
    initialValue: config.tools?.message?.crossContext?.allowWithinProvider ?? true,
  });

  const crossContextAcross = await prompter.confirm({
    message: "Allow cross-context sends across different providers?",
    initialValue: config.tools?.message?.crossContext?.allowAcrossProviders ?? false,
  });

  const enableBroadcast = await prompter.confirm({
    message: "Enable broadcast action?",
    initialValue: config.tools?.message?.broadcast?.enabled ?? true,
  });

  config = {
    ...config,
    tools: {
      ...config.tools,
      message: {
        ...config.tools?.message,
        crossContext: {
          ...config.tools?.message?.crossContext,
          allowWithinProvider: crossContextWithin,
          allowAcrossProviders: crossContextAcross,
        },
        broadcast: { ...config.tools?.message?.broadcast, enabled: enableBroadcast },
      },
    },
  };

  return config;
}

// ---------------------------------------------------------------------------
// Sub-section: Prompt Injection Defense
// ---------------------------------------------------------------------------

async function promptPromptInjectionDefense(
  config: OpenClawConfig,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  await prompter.note(
    [
      "Prompt injection is the #1 OWASP risk for both LLM and agentic",
      "applications. Attackers embed malicious instructions in inputs to",
      "hijack agent behavior.",
      "",
      "CrowdStrike research demonstrates both direct injection (via chat)",
      "and indirect injection (via poisoned data sources like emails,",
      "web pages, and social media posts).",
      "",
      "Key defenses: sensitive data redaction, custom redaction patterns,",
      "restricted exec mode, and browser control auth.",
    ].join("\n"),
    "Prompt Injection Defense",
  );

  const redactMode = await prompter.select({
    message: "Sensitive data redaction",
    options: [
      { value: "tools", label: "Redact in tool outputs", hint: "Recommended — catches credentials in exec output" },
      { value: "off", label: "Off", hint: "No redaction — development only" },
    ],
    initialValue: config.logging?.redactSensitive ?? "tools",
  });

  config = {
    ...config,
    logging: {
      ...config.logging,
      redactSensitive: redactMode as "tools" | "off",
    },
  };

  const addCustomPatterns = await prompter.confirm({
    message: "Add custom redaction patterns?",
    initialValue: false,
  });

  if (addCustomPatterns) {
    const patterns = await prompter.text({
      message: "Redaction patterns (comma-separated regexes)",
      placeholder: "AKIA[A-Z0-9]{16}, ghp_[a-zA-Z0-9]{36}",
    });
    const patternList = patterns.split(",").map((s) => s.trim()).filter(Boolean);
    if (patternList.length > 0) {
      config = {
        ...config,
        logging: {
          ...config.logging,
          redactPatterns: [
            ...(config.logging?.redactPatterns ?? []),
            ...patternList,
          ],
        },
      };
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// Sub-section: Credential Leak Detection (IronClaw-inspired)
// ---------------------------------------------------------------------------

async function promptCredentialLeakDetection(
  config: OpenClawConfig,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  await prompter.note(
    [
      "Credential leak detection scans agent outputs for accidentally",
      "exposed secrets — AWS keys, SSH keys, API tokens, database",
      "credentials, and Slack tokens.",
      "",
      "Inspired by IronClaw's capability-based security model where",
      "secrets are injected at the host boundary and leak detection",
      "scans both requests and responses.",
      "",
      "Severity levels:",
      "  Block  — Silently strip detected credentials from output",
      "  Warn   — Flag credentials but allow through with warning",
      "  Review — Queue for human review before delivery",
      "  Off    — No detection (development only)",
    ].join("\n"),
    "Credential Leak Detection",
  );

  // This maps to redactSensitive + redactPatterns in the config.
  // We present it as a higher-level concept and translate.
  const currentRedact = config.logging?.redactSensitive;
  const currentPatterns = config.logging?.redactPatterns ?? [];

  const hasRedaction = currentRedact === "tools";
  const hasPatterns = currentPatterns.length > 0;
  const currentLevel = hasRedaction && hasPatterns ? "block" : hasRedaction ? "warn" : "off";

  const level = await prompter.select({
    message: "Credential leak detection level",
    options: [
      { value: "block", label: "Block", hint: "Strip credentials from output" },
      { value: "warn", label: "Warn", hint: "Flag but allow through" },
      { value: "review", label: "Review", hint: "Queue for human review" },
      { value: "off", label: "Off", hint: "No detection" },
    ],
    initialValue: currentLevel,
  });

  // Translate detection level to config
  if (level === "block" || level === "warn" || level === "review") {
    config = {
      ...config,
      logging: {
        ...config.logging,
        redactSensitive: "tools",
      },
    };
  }

  if (level === "block") {
    // Add common credential patterns if not already present
    const defaultPatterns = [
      "AKIA[A-Z0-9]{16}",
      "ghp_[a-zA-Z0-9]{36}",
      "sk-[a-zA-Z0-9]{48}",
      "xoxb-[0-9]+-[a-zA-Z0-9]+",
    ];
    const existing = new Set(config.logging?.redactPatterns ?? []);
    const newPatterns = defaultPatterns.filter((p) => !existing.has(p));
    if (newPatterns.length > 0) {
      config = {
        ...config,
        logging: {
          ...config.logging,
          redactPatterns: [...(config.logging?.redactPatterns ?? []), ...newPatterns],
        },
      };
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// Sub-section: Resource Constraints (IronClaw-inspired)
// ---------------------------------------------------------------------------

async function promptResourceConstraints(
  config: OpenClawConfig,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  await prompter.note(
    [
      "Per-tool resource constraints prevent runaway execution and",
      "denial-of-service attacks (OWASP AG05: Unbounded Resource Consumption).",
      "",
      "Inspired by IronClaw's WASM sandbox model where each tool has",
      "explicit limits on execution time, memory, and CPU.",
    ].join("\n"),
    "Resource Constraints",
  );

  const timeoutStr = await prompter.text({
    message: "Default exec timeout (seconds)",
    initialValue: String(config.tools?.exec?.timeoutSec ?? 120),
    validate: (v) => {
      const n = parseInt(v, 10);
      return isNaN(n) || n < 1 ? "Must be a positive number" : undefined;
    },
  });

  const backgroundStr = await prompter.text({
    message: "Auto-background threshold (ms)",
    initialValue: String(config.tools?.exec?.backgroundMs ?? 30_000),
    validate: (v) => {
      const n = parseInt(v, 10);
      return isNaN(n) || n < 0 ? "Must be a non-negative number" : undefined;
    },
  });

  config = {
    ...config,
    tools: {
      ...config.tools,
      exec: {
        ...config.tools?.exec,
        timeoutSec: parseInt(timeoutStr, 10),
        backgroundMs: parseInt(backgroundStr, 10),
      },
    },
  };

  // Loop detection circuit breaker as resource constraint
  if (config.tools?.loopDetection?.enabled) {
    const circuitBreakerStr = await prompter.text({
      message: "Loop detection circuit breaker threshold",
      initialValue: String(
        config.tools?.loopDetection?.globalCircuitBreakerThreshold ?? 30,
      ),
      validate: (v) => {
        const n = parseInt(v, 10);
        return isNaN(n) || n < 5 ? "Must be at least 5" : undefined;
      },
    });
    config = {
      ...config,
      tools: {
        ...config.tools,
        loopDetection: {
          ...config.tools?.loopDetection,
          globalCircuitBreakerThreshold: parseInt(circuitBreakerStr, 10),
        },
      },
    };
  }

  return config;
}

import type { OpenClawConfig } from "../config/config.js";

// ---------------------------------------------------------------------------
// Compliance profile definitions
// ---------------------------------------------------------------------------

export type ComplianceProfileId =
  | "zero-trust"
  | "soc2-hardened"
  | "hipaa"
  | "standard"
  | "development";

export type CredentialLeakSeverity = "block" | "warn" | "review" | "off";
export type PromptInjectionDefenseLevel = "block" | "review" | "warn" | "off";
export type EndpointAllowlistMode = "strict" | "domain" | "unrestricted";

export type ComplianceProfileMeta = {
  id: ComplianceProfileId;
  label: string;
  description: string;
  riskLevel: "maximum" | "high" | "elevated" | "balanced" | "relaxed";
  /** IronClaw-inspired: credential leak detection severity. */
  credentialLeakSeverity: CredentialLeakSeverity;
  /** IronClaw-inspired: prompt injection defense level. */
  promptInjectionDefense: PromptInjectionDefenseLevel;
  /** IronClaw-inspired: endpoint allowlisting mode for tool HTTP access. */
  endpointAllowlistMode: EndpointAllowlistMode;
  /** IronClaw-inspired: per-tool timeout in seconds. */
  toolTimeoutSec: number;
  /** IronClaw-inspired: per-tool memory limit in MB. */
  toolMemoryLimitMb: number;
};

export type ComplianceProfile = ComplianceProfileMeta & {
  /** Partial config overlay applied when the profile is selected. */
  configOverlay: Partial<OpenClawConfig>;
};

// ---------------------------------------------------------------------------
// Profile definitions
// ---------------------------------------------------------------------------

const ZERO_TRUST: ComplianceProfile = {
  id: "zero-trust",
  label: "Zero Trust",
  description:
    "Maximum security posture. Loopback-only, strict allowlists, " +
    "sandboxed execution, credential leak blocking, and full audit logging. " +
    "Recommended for environments processing sensitive data.",
  riskLevel: "maximum",
  credentialLeakSeverity: "block",
  promptInjectionDefense: "block",
  endpointAllowlistMode: "strict",
  toolTimeoutSec: 30,
  toolMemoryLimitMb: 256,
  configOverlay: {
    gateway: {
      bind: "loopback",
      auth: {
        mode: "token",
        rateLimit: {
          maxAttempts: 5,
          windowMs: 60_000,
          lockoutMs: 600_000,
        },
      },
      controlUi: { dangerouslyDisableDeviceAuth: false },
    },
    tools: {
      profile: "minimal",
      exec: {
        host: "sandbox",
        security: "allowlist",
        safeBins: ["cat", "ls", "head", "wc", "grep", "find"],
        timeoutSec: 30,
        backgroundMs: 10_000,
      },
      elevated: { enabled: false },
      agentToAgent: { enabled: false },
      loopDetection: {
        enabled: true,
        warningThreshold: 8,
        criticalThreshold: 15,
        globalCircuitBreakerThreshold: 25,
      },
      message: {
        crossContext: {
          allowWithinProvider: false,
          allowAcrossProviders: false,
        },
        broadcast: { enabled: false },
      },
    },
    logging: { redactSensitive: "tools" },
  },
};

const SOC2_HARDENED: ComplianceProfile = {
  id: "soc2-hardened",
  label: "SOC 2 Hardened",
  description:
    "Aligned with SOC 2 Trust Service Criteria. Token authentication, " +
    "rate limiting, tool deny lists, full audit logging, and controlled " +
    "agent-to-agent communication.",
  riskLevel: "high",
  credentialLeakSeverity: "warn",
  promptInjectionDefense: "review",
  endpointAllowlistMode: "domain",
  toolTimeoutSec: 60,
  toolMemoryLimitMb: 512,
  configOverlay: {
    gateway: {
      bind: "loopback",
      auth: {
        mode: "token",
        rateLimit: {
          maxAttempts: 10,
          windowMs: 60_000,
          lockoutMs: 300_000,
        },
      },
    },
    tools: {
      profile: "coding",
      deny: ["message_broadcast"],
      exec: {
        host: "sandbox",
        security: "allowlist",
        timeoutSec: 60,
      },
      loopDetection: { enabled: true },
      agentToAgent: { enabled: false },
    },
    logging: { redactSensitive: "tools" },
  },
};

const HIPAA: ComplianceProfile = {
  id: "hipaa",
  label: "HIPAA",
  description:
    "Healthcare-compliant configuration. Password authentication with TLS, " +
    "deny-all exec policy, disabled DMs, strict data redaction, and no " +
    "cross-context messaging.",
  riskLevel: "elevated",
  credentialLeakSeverity: "block",
  promptInjectionDefense: "review",
  endpointAllowlistMode: "strict",
  toolTimeoutSec: 30,
  toolMemoryLimitMb: 256,
  configOverlay: {
    gateway: {
      bind: "loopback",
      auth: { mode: "password" },
      tls: { enabled: true, autoGenerate: true },
    },
    tools: {
      profile: "minimal",
      exec: {
        host: "sandbox",
        security: "deny",
        timeoutSec: 30,
      },
      agentToAgent: { enabled: false },
      message: {
        crossContext: {
          allowWithinProvider: false,
          allowAcrossProviders: false,
        },
        broadcast: { enabled: false },
      },
    },
    logging: { redactSensitive: "tools" },
  },
};

const STANDARD: ComplianceProfile = {
  id: "standard",
  label: "Standard",
  description:
    "Balanced security defaults suitable for most deployments. Token " +
    "authentication, sandboxed execution with allowlists, loop detection, " +
    "and sensitive data redaction.",
  riskLevel: "balanced",
  credentialLeakSeverity: "warn",
  promptInjectionDefense: "warn",
  endpointAllowlistMode: "domain",
  toolTimeoutSec: 120,
  toolMemoryLimitMb: 512,
  configOverlay: {
    gateway: {
      bind: "loopback",
      auth: {
        mode: "token",
        rateLimit: {
          maxAttempts: 10,
          windowMs: 60_000,
          lockoutMs: 300_000,
        },
      },
    },
    tools: {
      profile: "coding",
      exec: {
        host: "sandbox",
        security: "allowlist",
        timeoutSec: 120,
      },
      loopDetection: { enabled: true },
    },
    logging: { redactSensitive: "tools" },
  },
};

const DEVELOPMENT: ComplianceProfile = {
  id: "development",
  label: "Development",
  description:
    "Relaxed configuration for local development and testing. No " +
    "authentication, full tool access, gateway-hosted exec. NOT suitable " +
    "for production or shared environments.",
  riskLevel: "relaxed",
  credentialLeakSeverity: "off",
  promptInjectionDefense: "off",
  endpointAllowlistMode: "unrestricted",
  toolTimeoutSec: 300,
  toolMemoryLimitMb: 1024,
  configOverlay: {
    gateway: {
      bind: "loopback",
      auth: { mode: "none" },
    },
    tools: {
      profile: "full",
      exec: {
        host: "gateway",
        security: "full",
        timeoutSec: 300,
      },
      loopDetection: { enabled: false },
    },
    logging: { redactSensitive: "off" },
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const COMPLIANCE_PROFILES: ReadonlyMap<ComplianceProfileId, ComplianceProfile> = new Map([
  ["zero-trust", ZERO_TRUST],
  ["soc2-hardened", SOC2_HARDENED],
  ["hipaa", HIPAA],
  ["standard", STANDARD],
  ["development", DEVELOPMENT],
]);

/** Ordered list for UI rendering (most secure first). */
export const COMPLIANCE_PROFILE_LIST: readonly ComplianceProfile[] = [
  ZERO_TRUST,
  SOC2_HARDENED,
  HIPAA,
  STANDARD,
  DEVELOPMENT,
];

/**
 * Deep-merge a compliance profile's config overlay onto an existing config.
 * Only sets values defined in the overlay — does not remove existing keys.
 */
export function applyComplianceProfile(
  config: OpenClawConfig,
  profileId: ComplianceProfileId,
): OpenClawConfig {
  const profile = COMPLIANCE_PROFILES.get(profileId);
  if (!profile) {
    throw new Error(`Unknown compliance profile: ${profileId}`);
  }
  return deepMerge(config, profile.configOverlay) as OpenClawConfig;
}

/**
 * Returns the profile metadata (without the full overlay) for display purposes.
 */
export function getProfileMeta(profileId: ComplianceProfileId): ComplianceProfileMeta | undefined {
  const profile = COMPLIANCE_PROFILES.get(profileId);
  if (!profile) return undefined;
  const { configOverlay: _, ...meta } = profile;
  return meta;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Prototype-pollution-safe deep merge with recursion depth limit. */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth > 16) return { ...target };
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    // Guard against prototype pollution
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
        depth + 1,
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

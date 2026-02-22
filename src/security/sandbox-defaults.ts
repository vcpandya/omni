// ── Enhanced Sandbox Defaults — Secure defaults + enhanced validation ──

import type { SecurityAuditFinding } from "./audit.js";

// ── Secure Defaults ─────────────────────────────────────────────

export const SECURE_SANDBOX_DEFAULTS: Readonly<SandboxSecurityConfig> = Object.freeze({
  readOnlyRoot: true,
  capDrop: Object.freeze(["ALL"]) as unknown as string[],
  network: "none",
  pidsLimit: 256,
  memory: "512m",
  seccompProfile: "default",
  tmpfs: Object.freeze(["/tmp:rw,noexec,nosuid,size=128m"]) as unknown as string[],
});

export type SandboxSecurityConfig = {
  readOnlyRoot?: boolean;
  capDrop?: string[];
  network?: string;
  pidsLimit?: number;
  memory?: string;
  seccompProfile?: string;
  tmpfs?: string[];
};

// ── Apply Secure Defaults ───────────────────────────────────────

export function applySandboxSecureDefaults(
  userConfig?: Partial<SandboxSecurityConfig>,
): SandboxSecurityConfig {
  if (!userConfig) {
    return { ...SECURE_SANDBOX_DEFAULTS };
  }

  return {
    readOnlyRoot: userConfig.readOnlyRoot ?? SECURE_SANDBOX_DEFAULTS.readOnlyRoot,
    capDrop: userConfig.capDrop ?? [...(SECURE_SANDBOX_DEFAULTS.capDrop ?? ["ALL"])],
    network: userConfig.network ?? SECURE_SANDBOX_DEFAULTS.network,
    pidsLimit: userConfig.pidsLimit ?? SECURE_SANDBOX_DEFAULTS.pidsLimit,
    memory: userConfig.memory ?? SECURE_SANDBOX_DEFAULTS.memory,
    seccompProfile: userConfig.seccompProfile ?? SECURE_SANDBOX_DEFAULTS.seccompProfile,
    tmpfs: userConfig.tmpfs ?? [...(SECURE_SANDBOX_DEFAULTS.tmpfs ?? ["/tmp:rw,noexec,nosuid,size=128m"])],
  };
}

// ── Enhanced Validation ─────────────────────────────────────────

export type SandboxSecurityWarning = {
  checkId: string;
  severity: "info" | "warn" | "critical";
  title: string;
  detail: string;
  remediation: string;
};

export function validateSandboxSecurityEnhanced(
  cfg: Partial<SandboxSecurityConfig>,
): SandboxSecurityWarning[] {
  const warnings: SandboxSecurityWarning[] = [];

  if (!cfg.readOnlyRoot) {
    warnings.push({
      checkId: "sandbox-readonly-root",
      severity: "warn",
      title: "Sandbox root filesystem is writable",
      detail: "Container root filesystem is not read-only, allowing persistent modifications.",
      remediation: "Set readOnlyRoot: true in sandbox configuration.",
    });
  }

  if (!cfg.capDrop || !cfg.capDrop.includes("ALL")) {
    warnings.push({
      checkId: "sandbox-cap-drop",
      severity: "warn",
      title: "Linux capabilities not dropped",
      detail: "Container retains Linux capabilities that could be exploited.",
      remediation: 'Set capDrop: ["ALL"] to drop all capabilities.',
    });
  }

  if (cfg.network && cfg.network !== "none") {
    warnings.push({
      checkId: "sandbox-network",
      severity: "warn",
      title: "Sandbox has network access",
      detail: `Container network mode is "${cfg.network}" instead of "none".`,
      remediation: 'Set network: "none" to disable container networking.',
    });
  }

  if (!cfg.seccompProfile) {
    warnings.push({
      checkId: "sandbox-seccomp",
      severity: "warn",
      title: "No seccomp profile configured",
      detail: "Container runs without a seccomp syscall filter.",
      remediation: 'Set seccompProfile: "default" for baseline syscall filtering.',
    });
  }

  const memoryStr = cfg.memory ?? "";
  if (memoryStr) {
    const memoryMb = parseMemoryMb(memoryStr);
    if (memoryMb !== null && memoryMb > 1024) {
      warnings.push({
        checkId: "sandbox-memory",
        severity: "info",
        title: "High sandbox memory limit",
        detail: `Container memory limit is ${memoryStr} (>${1024}MB).`,
        remediation: "Consider reducing to 512m or less unless required.",
      });
    }
  }

  if (typeof cfg.pidsLimit === "number" && cfg.pidsLimit > 512) {
    warnings.push({
      checkId: "sandbox-pids",
      severity: "info",
      title: "High sandbox PID limit",
      detail: `Container PID limit is ${cfg.pidsLimit} (>512).`,
      remediation: "Consider reducing to 256 unless the workload requires more processes.",
    });
  }

  return warnings;
}

/** Convert enhanced sandbox warnings to audit findings format */
export function sandboxWarningsToFindings(
  warnings: SandboxSecurityWarning[],
): SecurityAuditFinding[] {
  return warnings.map((w) => ({
    checkId: w.checkId,
    severity: w.severity,
    title: w.title,
    detail: w.detail,
    remediation: w.remediation,
  }));
}

// ── Helpers ─────────────────────────────────────────────────────

const MAX_SANDBOX_MEMORY_MB = 16_384; // 16 GB hard cap

function parseMemoryMb(memStr: string): number | null {
  const match = memStr.match(/^(\d+)(m|g|mb|gb)?$/i);
  if (!match) return null;
  const value = parseInt(match[1]!, 10);
  const unit = (match[2] ?? "m").toLowerCase();
  const mb = (unit === "g" || unit === "gb") ? value * 1024 : value;
  // Enforce hard upper bound to prevent resource exhaustion
  return Math.min(mb, MAX_SANDBOX_MEMORY_MB);
}

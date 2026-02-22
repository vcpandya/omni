// ── Device Trust / MDM — Trust scoring, compliance evaluation, remote wipe ──

import { emitDeviceEvent } from "./audit-trail-emitters.js";
import type {
  DeviceTrustLevel,
  DeviceComplianceCheck,
  DeviceComplianceReport,
  DeviceTrustPolicy,
} from "./device-trust.types.js";

// ── Trust Level Thresholds ──────────────────────────────────────

const TRUST_THRESHOLDS: Record<DeviceTrustLevel, number> = {
  trusted: 80,
  verified: 60,
  known: 40,
  untrusted: 0,
};

const TRUST_LEVEL_ORDER: DeviceTrustLevel[] = ["trusted", "verified", "known", "untrusted"];

// ── Trust Score Computation ─────────────────────────────────────

export function computeDeviceTrustScore(checks: DeviceComplianceCheck[]): number {
  let totalWeight = 0;
  let passedWeight = 0;
  for (const c of checks) {
    totalWeight += c.weight;
    if (c.passed) passedWeight += c.weight;
  }
  if (totalWeight === 0) return 0;
  return Math.round((passedWeight / totalWeight) * 100);
}

// ── Trust Level Resolution ──────────────────────────────────────

export function resolveDeviceTrustLevel(score: number): DeviceTrustLevel {
  if (score >= TRUST_THRESHOLDS.trusted) return "trusted";
  if (score >= TRUST_THRESHOLDS.verified) return "verified";
  if (score >= TRUST_THRESHOLDS.known) return "known";
  return "untrusted";
}

// ── Compliance Evaluation ───────────────────────────────────────

export function evaluateDeviceCompliance(
  deviceId: string,
  metadata: {
    osVersion?: string;
    encryptionEnabled?: boolean;
    firewallEnabled?: boolean;
    lastUpdatedMs?: number;
    screenLockEnabled?: boolean;
    biometricsEnabled?: boolean;
    mdmEnrolled?: boolean;
  },
  policy?: DeviceTrustPolicy,
): DeviceComplianceReport {
  const checks: DeviceComplianceCheck[] = [];

  // Encryption check
  checks.push({
    checkId: "disk-encryption",
    passed: metadata.encryptionEnabled === true,
    detail: metadata.encryptionEnabled
      ? "Full-disk encryption is enabled"
      : "Full-disk encryption is not enabled or status unknown",
    weight: 25,
  });

  // Firewall check
  checks.push({
    checkId: "firewall",
    passed: metadata.firewallEnabled === true,
    detail: metadata.firewallEnabled
      ? "Firewall is enabled"
      : "Firewall is not enabled or status unknown",
    weight: 20,
  });

  // OS freshness check
  if (metadata.lastUpdatedMs) {
    const maxAgeDays = Math.max(1, policy?.maxOsAgeDays ?? 90);
    const ageMs = Date.now() - metadata.lastUpdatedMs;
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    checks.push({
      checkId: "os-freshness",
      passed: ageDays <= maxAgeDays,
      detail:
        ageDays <= maxAgeDays
          ? `OS updated ${Math.round(ageDays)} days ago (within ${maxAgeDays}-day policy)`
          : `OS updated ${Math.round(ageDays)} days ago (exceeds ${maxAgeDays}-day policy)`,
      weight: 15,
    });
  } else {
    checks.push({
      checkId: "os-freshness",
      passed: false,
      detail: "OS update date unknown",
      weight: 15,
    });
  }

  // Screen lock check
  checks.push({
    checkId: "screen-lock",
    passed: metadata.screenLockEnabled === true,
    detail: metadata.screenLockEnabled
      ? "Screen lock is enabled"
      : "Screen lock is not enabled or status unknown",
    weight: 15,
  });

  // Biometrics check
  checks.push({
    checkId: "biometrics",
    passed: metadata.biometricsEnabled === true,
    detail: metadata.biometricsEnabled
      ? "Biometric authentication is enabled"
      : "Biometric authentication is not enabled or status unknown",
    weight: 10,
  });

  // MDM enrollment check
  checks.push({
    checkId: "mdm-enrolled",
    passed: metadata.mdmEnrolled === true,
    detail: metadata.mdmEnrolled
      ? "Device is MDM enrolled"
      : "Device is not MDM enrolled",
    weight: 15,
  });

  const trustScore = computeDeviceTrustScore(checks);
  const trustLevel = resolveDeviceTrustLevel(trustScore);

  return {
    deviceId,
    trustLevel,
    trustScore,
    checks,
    reportedAt: Date.now(),
    osVersion: metadata.osVersion,
    encryptionEnabled: metadata.encryptionEnabled,
    firewallEnabled: metadata.firewallEnabled,
  };
}

// ── Policy Enforcement ──────────────────────────────────────────

export function enforceDeviceTrustPolicy(
  report: DeviceComplianceReport,
  policy: DeviceTrustPolicy,
): { allowed: boolean; reason?: string } {
  // Check minimum trust level
  if (policy.minTrustLevel) {
    const requiredIdx = TRUST_LEVEL_ORDER.indexOf(policy.minTrustLevel);
    const actualIdx = TRUST_LEVEL_ORDER.indexOf(report.trustLevel);
    if (actualIdx > requiredIdx) {
      return {
        allowed: false,
        reason: `Device trust level "${report.trustLevel}" is below required "${policy.minTrustLevel}" (score: ${report.trustScore})`,
      };
    }
  }

  // Check encryption requirement
  if (policy.requireEncryption && report.encryptionEnabled !== true) {
    return {
      allowed: false,
      reason: "Device encryption is required but not enabled",
    };
  }

  // Check firewall requirement
  if (policy.requireFirewall && report.firewallEnabled !== true) {
    return {
      allowed: false,
      reason: "Device firewall is required but not enabled",
    };
  }

  return { allowed: true };
}

// ── Remote Wipe ─────────────────────────────────────────────────

export function initiateRemoteWipe(
  deviceId: string,
  actor: { actorId: string },
): { initiated: boolean; deviceId: string; initiatedAt: number } {
  emitDeviceEvent(
    actor,
    "device.wiped",
    deviceId,
    { action: "remote_wipe_initiated" },
  );

  return {
    initiated: true,
    deviceId,
    initiatedAt: Date.now(),
  };
}

// Re-export types
export type {
  DeviceTrustLevel,
  DeviceComplianceCheck,
  DeviceComplianceReport,
  DeviceTrustPolicy,
} from "./device-trust.types.js";

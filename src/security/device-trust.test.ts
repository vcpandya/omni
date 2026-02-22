import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach } from "vitest";
import {
  computeDeviceTrustScore,
  resolveDeviceTrustLevel,
  evaluateDeviceCompliance,
  enforceDeviceTrustPolicy,
  initiateRemoteWipe,
} from "./device-trust.js";
import type { DeviceComplianceCheck } from "./device-trust.types.js";
import { resetAuditTrail, initAuditTrail } from "./audit-trail.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "device-trust-test-"));
}

describe("device-trust", () => {
  beforeEach(() => {
    resetAuditTrail();
    initAuditTrail(join(makeTempDir(), "audit"));
  });

  describe("computeDeviceTrustScore", () => {
    it("should return 100 when all checks pass", () => {
      const checks: DeviceComplianceCheck[] = [
        { checkId: "a", passed: true, detail: "ok", weight: 50 },
        { checkId: "b", passed: true, detail: "ok", weight: 50 },
      ];
      expect(computeDeviceTrustScore(checks)).toBe(100);
    });

    it("should return 0 when all checks fail", () => {
      const checks: DeviceComplianceCheck[] = [
        { checkId: "a", passed: false, detail: "fail", weight: 50 },
        { checkId: "b", passed: false, detail: "fail", weight: 50 },
      ];
      expect(computeDeviceTrustScore(checks)).toBe(0);
    });

    it("should weight checks properly", () => {
      const checks: DeviceComplianceCheck[] = [
        { checkId: "a", passed: true, detail: "ok", weight: 75 },
        { checkId: "b", passed: false, detail: "fail", weight: 25 },
      ];
      expect(computeDeviceTrustScore(checks)).toBe(75);
    });

    it("should return 0 for empty checks", () => {
      expect(computeDeviceTrustScore([])).toBe(0);
    });
  });

  describe("resolveDeviceTrustLevel", () => {
    it("should return trusted for score >= 80", () => {
      expect(resolveDeviceTrustLevel(80)).toBe("trusted");
      expect(resolveDeviceTrustLevel(100)).toBe("trusted");
    });

    it("should return verified for score >= 60", () => {
      expect(resolveDeviceTrustLevel(60)).toBe("verified");
      expect(resolveDeviceTrustLevel(79)).toBe("verified");
    });

    it("should return known for score >= 40", () => {
      expect(resolveDeviceTrustLevel(40)).toBe("known");
      expect(resolveDeviceTrustLevel(59)).toBe("known");
    });

    it("should return untrusted for score < 40", () => {
      expect(resolveDeviceTrustLevel(0)).toBe("untrusted");
      expect(resolveDeviceTrustLevel(39)).toBe("untrusted");
    });
  });

  describe("evaluateDeviceCompliance", () => {
    it("should produce high trust for fully compliant device", () => {
      const report = evaluateDeviceCompliance("device-1", {
        encryptionEnabled: true,
        firewallEnabled: true,
        lastUpdatedMs: Date.now() - 1000 * 60 * 60 * 24 * 5, // 5 days ago
        screenLockEnabled: true,
        biometricsEnabled: true,
        mdmEnrolled: true,
      });
      expect(report.trustLevel).toBe("trusted");
      expect(report.trustScore).toBe(100);
      expect(report.checks.every((c) => c.passed)).toBe(true);
    });

    it("should produce low trust for non-compliant device", () => {
      const report = evaluateDeviceCompliance("device-2", {
        encryptionEnabled: false,
        firewallEnabled: false,
        screenLockEnabled: false,
        biometricsEnabled: false,
        mdmEnrolled: false,
      });
      expect(report.trustLevel).toBe("untrusted");
      expect(report.trustScore).toBe(0);
    });

    it("should handle partial compliance", () => {
      const report = evaluateDeviceCompliance("device-3", {
        encryptionEnabled: true,
        firewallEnabled: true,
        lastUpdatedMs: Date.now(),
        screenLockEnabled: true,
        biometricsEnabled: false,
        mdmEnrolled: false,
      });
      // encryption(25) + firewall(20) + os(15) + screen(15) = 75 out of 100
      expect(report.trustScore).toBe(75);
      expect(report.trustLevel).toBe("verified");
    });
  });

  describe("enforceDeviceTrustPolicy", () => {
    it("should allow when trust level meets minimum", () => {
      const report = evaluateDeviceCompliance("device-1", {
        encryptionEnabled: true,
        firewallEnabled: true,
        lastUpdatedMs: Date.now(),
        screenLockEnabled: true,
        biometricsEnabled: true,
        mdmEnrolled: true,
      });
      const result = enforceDeviceTrustPolicy(report, { minTrustLevel: "verified" });
      expect(result.allowed).toBe(true);
    });

    it("should deny when trust level is below minimum", () => {
      const report = evaluateDeviceCompliance("device-2", {
        encryptionEnabled: false,
        firewallEnabled: false,
      });
      const result = enforceDeviceTrustPolicy(report, { minTrustLevel: "verified" });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("below required");
    });

    it("should deny when encryption required but not enabled", () => {
      const report = evaluateDeviceCompliance("device-3", {
        encryptionEnabled: false,
        firewallEnabled: true,
        lastUpdatedMs: Date.now(),
        screenLockEnabled: true,
        biometricsEnabled: true,
        mdmEnrolled: true,
      });
      const result = enforceDeviceTrustPolicy(report, { requireEncryption: true });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("encryption");
    });

    it("should deny when firewall required but not enabled", () => {
      const report = evaluateDeviceCompliance("device-4", {
        encryptionEnabled: true,
        firewallEnabled: false,
        lastUpdatedMs: Date.now(),
        screenLockEnabled: true,
        biometricsEnabled: true,
        mdmEnrolled: true,
      });
      const result = enforceDeviceTrustPolicy(report, { requireFirewall: true });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("firewall");
    });
  });

  describe("initiateRemoteWipe", () => {
    it("should return wipe initiation confirmation", () => {
      const result = initiateRemoteWipe("device-1", { actorId: "admin" });
      expect(result.initiated).toBe(true);
      expect(result.deviceId).toBe("device-1");
      expect(result.initiatedAt).toBeGreaterThan(0);
    });
  });
});

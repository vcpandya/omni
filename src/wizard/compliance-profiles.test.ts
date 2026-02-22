import { describe, expect, it } from "vitest";
import {
  applyComplianceProfile,
  COMPLIANCE_PROFILE_LIST,
  COMPLIANCE_PROFILES,
  getProfileMeta,
  type ComplianceProfileId,
} from "./compliance-profiles.js";

describe("compliance-profiles", () => {
  const ALL_IDS: ComplianceProfileId[] = [
    "zero-trust",
    "soc2-hardened",
    "hipaa",
    "standard",
    "development",
  ];

  it("exports all 5 profiles in the map", () => {
    expect(COMPLIANCE_PROFILES.size).toBe(5);
    for (const id of ALL_IDS) {
      expect(COMPLIANCE_PROFILES.has(id)).toBe(true);
    }
  });

  it("exports ordered list for UI rendering", () => {
    expect(COMPLIANCE_PROFILE_LIST).toHaveLength(5);
    expect(COMPLIANCE_PROFILE_LIST[0].id).toBe("zero-trust");
    expect(COMPLIANCE_PROFILE_LIST[4].id).toBe("development");
  });

  describe("applyComplianceProfile", () => {
    it("applies each profile to an empty config without error", () => {
      for (const id of ALL_IDS) {
        const result = applyComplianceProfile({}, id);
        expect(result).toBeDefined();
        expect(result.gateway).toBeDefined();
        expect(result.tools).toBeDefined();
      }
    });

    it("preserves existing config keys not in the overlay", () => {
      const base = {
        agents: { defaults: { workspace: "/my/workspace" } },
        gateway: { port: 9999 },
      };
      const result = applyComplianceProfile(base, "standard");
      expect(result.agents?.defaults?.workspace).toBe("/my/workspace");
      expect(result.gateway?.port).toBe(9999);
    });

    it("deep-merges nested objects", () => {
      const base = {
        gateway: {
          auth: { token: "existing-token" },
          port: 8080,
        },
      };
      const result = applyComplianceProfile(base, "soc2-hardened");
      expect(result.gateway?.auth?.token).toBe("existing-token");
      expect(result.gateway?.auth?.mode).toBe("token");
      expect(result.gateway?.port).toBe(8080);
    });

    it("throws for unknown profile id", () => {
      expect(() => applyComplianceProfile({}, "unknown" as ComplianceProfileId)).toThrow(
        "Unknown compliance profile",
      );
    });

    it("zero-trust sets most restrictive values", () => {
      const result = applyComplianceProfile({}, "zero-trust");
      expect(result.tools?.profile).toBe("minimal");
      expect(result.tools?.exec?.host).toBe("sandbox");
      expect(result.tools?.exec?.security).toBe("allowlist");
      expect(result.tools?.elevated?.enabled).toBe(false);
      expect(result.tools?.agentToAgent?.enabled).toBe(false);
      expect(result.tools?.message?.broadcast?.enabled).toBe(false);
      expect(result.gateway?.bind).toBe("loopback");
      expect(result.gateway?.auth?.rateLimit?.maxAttempts).toBe(5);
    });

    it("development sets most relaxed values", () => {
      const result = applyComplianceProfile({}, "development");
      expect(result.tools?.profile).toBe("full");
      expect(result.tools?.exec?.host).toBe("gateway");
      expect(result.tools?.exec?.security).toBe("full");
      expect(result.gateway?.auth?.mode).toBe("none");
      expect(result.logging?.redactSensitive).toBe("off");
    });

    it("hipaa enables TLS", () => {
      const result = applyComplianceProfile({}, "hipaa");
      expect(result.gateway?.tls?.enabled).toBe(true);
      expect(result.gateway?.auth?.mode).toBe("password");
    });
  });

  describe("getProfileMeta", () => {
    it("returns metadata without configOverlay", () => {
      const meta = getProfileMeta("standard");
      expect(meta).toBeDefined();
      expect(meta!.id).toBe("standard");
      expect(meta!.label).toBe("Standard");
      expect(meta!.riskLevel).toBe("balanced");
      expect((meta as Record<string, unknown>).configOverlay).toBeUndefined();
    });

    it("returns undefined for unknown id", () => {
      expect(getProfileMeta("bogus" as ComplianceProfileId)).toBeUndefined();
    });
  });

  describe("IronClaw-inspired properties", () => {
    it("zero-trust has strictest IronClaw settings", () => {
      const profile = COMPLIANCE_PROFILES.get("zero-trust")!;
      expect(profile.credentialLeakSeverity).toBe("block");
      expect(profile.promptInjectionDefense).toBe("block");
      expect(profile.endpointAllowlistMode).toBe("strict");
      expect(profile.toolTimeoutSec).toBe(30);
      expect(profile.toolMemoryLimitMb).toBe(256);
    });

    it("development has relaxed IronClaw settings", () => {
      const profile = COMPLIANCE_PROFILES.get("development")!;
      expect(profile.credentialLeakSeverity).toBe("off");
      expect(profile.promptInjectionDefense).toBe("off");
      expect(profile.endpointAllowlistMode).toBe("unrestricted");
      expect(profile.toolTimeoutSec).toBe(300);
      expect(profile.toolMemoryLimitMb).toBe(1024);
    });

    it("all profiles have valid IronClaw properties", () => {
      for (const profile of COMPLIANCE_PROFILE_LIST) {
        expect(["block", "warn", "review", "off"]).toContain(profile.credentialLeakSeverity);
        expect(["block", "review", "warn", "off"]).toContain(profile.promptInjectionDefense);
        expect(["strict", "domain", "unrestricted"]).toContain(profile.endpointAllowlistMode);
        expect(profile.toolTimeoutSec).toBeGreaterThan(0);
        expect(profile.toolMemoryLimitMb).toBeGreaterThan(0);
      }
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  applySandboxSecureDefaults,
  validateSandboxSecurityEnhanced,
  SECURE_SANDBOX_DEFAULTS,
} from "./sandbox-defaults.js";

describe("sandbox-defaults", () => {
  describe("applySandboxSecureDefaults", () => {
    it("should apply all secure defaults when no user config", () => {
      const result = applySandboxSecureDefaults();
      expect(result.readOnlyRoot).toBe(true);
      expect(result.capDrop).toEqual(["ALL"]);
      expect(result.network).toBe("none");
      expect(result.pidsLimit).toBe(256);
      expect(result.memory).toBe("512m");
      expect(result.seccompProfile).toBe("default");
    });

    it("should preserve user overrides", () => {
      const result = applySandboxSecureDefaults({
        memory: "1g",
        network: "bridge",
      });
      expect(result.memory).toBe("1g");
      expect(result.network).toBe("bridge");
      // Defaults for unspecified values
      expect(result.readOnlyRoot).toBe(true);
      expect(result.capDrop).toEqual(["ALL"]);
    });

    it("should apply defaults for undefined values only", () => {
      const result = applySandboxSecureDefaults({
        readOnlyRoot: false,
      });
      expect(result.readOnlyRoot).toBe(false);
      expect(result.capDrop).toEqual(["ALL"]);
      expect(result.seccompProfile).toBe("default");
    });
  });

  describe("validateSandboxSecurityEnhanced", () => {
    it("should produce no warnings for secure config", () => {
      const warnings = validateSandboxSecurityEnhanced(SECURE_SANDBOX_DEFAULTS);
      expect(warnings).toHaveLength(0);
    });

    it("should warn about writable root filesystem", () => {
      const warnings = validateSandboxSecurityEnhanced({
        readOnlyRoot: false,
        capDrop: ["ALL"],
        network: "none",
        seccompProfile: "default",
      });
      const match = warnings.find((w) => w.checkId === "sandbox-readonly-root");
      expect(match).toBeDefined();
      expect(match!.severity).toBe("warn");
    });

    it("should warn about missing cap drop ALL", () => {
      const warnings = validateSandboxSecurityEnhanced({
        readOnlyRoot: true,
        capDrop: ["NET_RAW"],
        network: "none",
        seccompProfile: "default",
      });
      const match = warnings.find((w) => w.checkId === "sandbox-cap-drop");
      expect(match).toBeDefined();
    });

    it("should warn about network access", () => {
      const warnings = validateSandboxSecurityEnhanced({
        readOnlyRoot: true,
        capDrop: ["ALL"],
        network: "bridge",
        seccompProfile: "default",
      });
      const match = warnings.find((w) => w.checkId === "sandbox-network");
      expect(match).toBeDefined();
      expect(match!.detail).toContain("bridge");
    });

    it("should warn about missing seccomp", () => {
      const warnings = validateSandboxSecurityEnhanced({
        readOnlyRoot: true,
        capDrop: ["ALL"],
        network: "none",
      });
      const match = warnings.find((w) => w.checkId === "sandbox-seccomp");
      expect(match).toBeDefined();
    });

    it("should warn about high memory limit", () => {
      const warnings = validateSandboxSecurityEnhanced({
        readOnlyRoot: true,
        capDrop: ["ALL"],
        network: "none",
        seccompProfile: "default",
        memory: "2g",
      });
      const match = warnings.find((w) => w.checkId === "sandbox-memory");
      expect(match).toBeDefined();
    });

    it("should catch multiple insecure settings", () => {
      const warnings = validateSandboxSecurityEnhanced({
        readOnlyRoot: false,
        network: "host",
      });
      expect(warnings.length).toBeGreaterThanOrEqual(3); // readonly, capDrop, network, seccomp
    });
  });
});

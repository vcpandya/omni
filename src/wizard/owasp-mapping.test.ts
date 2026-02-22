import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { applyComplianceProfile } from "./compliance-profiles.js";
import {
  ALL_OWASP_RISKS,
  computeCoverageScore,
  evaluateOwaspCoverage,
  formatCoverageSummary,
  OWASP_AGENTIC_TOP_10,
  OWASP_LLM_TOP_10,
} from "./owasp-mapping.js";

describe("owasp-mapping", () => {
  describe("risk definitions", () => {
    it("defines 10 LLM Top 10 risks", () => {
      expect(OWASP_LLM_TOP_10).toHaveLength(10);
      for (const risk of OWASP_LLM_TOP_10) {
        expect(risk.category).toBe("llm-top-10");
        expect(risk.id).toMatch(/^LLM\d{2}$/);
        expect(risk.name).toBeTruthy();
        expect(risk.configPaths.length).toBeGreaterThan(0);
        expect(risk.summary).toBeTruthy();
        expect(risk.mitigationHint).toBeTruthy();
      }
    });

    it("defines 10 Agentic Top 10 risks", () => {
      expect(OWASP_AGENTIC_TOP_10).toHaveLength(10);
      for (const risk of OWASP_AGENTIC_TOP_10) {
        expect(risk.category).toBe("agentic-top-10");
        expect(risk.id).toMatch(/^AG\d{2}$/);
        expect(risk.name).toBeTruthy();
        expect(risk.configPaths.length).toBeGreaterThan(0);
      }
    });

    it("ALL_OWASP_RISKS combines both lists to 20 items", () => {
      expect(ALL_OWASP_RISKS).toHaveLength(20);
    });

    it("all risk IDs are unique", () => {
      const ids = ALL_OWASP_RISKS.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("evaluateOwaspCoverage", () => {
    it("returns a map with 20 entries for any config", () => {
      const coverage = evaluateOwaspCoverage({});
      expect(coverage.size).toBe(20);
      for (const [id, status] of coverage) {
        expect(ALL_OWASP_RISKS.some((r) => r.id === id)).toBe(true);
        expect(["red", "yellow", "green"]).toContain(status);
      }
    });

    it("zero-trust profile yields mostly green coverage", () => {
      const config = applyComplianceProfile({}, "zero-trust");
      const coverage = evaluateOwaspCoverage(config);
      const score = computeCoverageScore(coverage);
      // Zero Trust covers core risks; some OWASP categories require
      // runtime features (LLM audit, audit trail) not in the config overlay
      expect(score.covered).toBeGreaterThanOrEqual(5);
      expect(score.uncovered).toBeLessThanOrEqual(8);
    });

    it("development profile yields poor coverage", () => {
      const config = applyComplianceProfile({}, "development");
      const coverage = evaluateOwaspCoverage(config);
      const score = computeCoverageScore(coverage);
      // Development profile is permissive
      expect(score.uncovered).toBeGreaterThanOrEqual(3);
    });

    it("standard profile yields balanced coverage", () => {
      const config = applyComplianceProfile({}, "standard");
      const coverage = evaluateOwaspCoverage(config);
      const score = computeCoverageScore(coverage);
      expect(score.total).toBe(20);
      expect(score.covered + score.partial).toBeGreaterThan(score.uncovered);
    });

    it("evaluates specific gateway.auth.mode scenarios", () => {
      const noAuth: OpenClawConfig = { gateway: { auth: { mode: "none" } } };
      const tokenAuth: OpenClawConfig = { gateway: { auth: { mode: "token" } } };

      const noAuthCoverage = evaluateOwaspCoverage(noAuth);
      const tokenAuthCoverage = evaluateOwaspCoverage(tokenAuth);

      // AG08 (Insufficient Access Controls) should be worse with no auth
      const noAuthAG08 = noAuthCoverage.get("AG08");
      const tokenAG08 = tokenAuthCoverage.get("AG08");
      expect(noAuthAG08).toBe("red");
      expect(["green", "yellow"]).toContain(tokenAG08);
    });

    it("exec.security=full triggers red for relevant risks", () => {
      const config: OpenClawConfig = {
        tools: { exec: { security: "full" } },
      };
      const coverage = evaluateOwaspCoverage(config);
      // LLM01 Prompt Injection should be red with full exec access
      expect(coverage.get("LLM01")).toBe("red");
    });
  });

  describe("computeCoverageScore", () => {
    it("correctly counts green, yellow, red", () => {
      const map = new Map([
        ["A", "green" as const],
        ["B", "yellow" as const],
        ["C", "red" as const],
        ["D", "green" as const],
      ]);
      const score = computeCoverageScore(map);
      expect(score.covered).toBe(2);
      expect(score.partial).toBe(1);
      expect(score.uncovered).toBe(1);
      expect(score.total).toBe(4);
    });
  });

  describe("formatCoverageSummary", () => {
    it("produces a readable string with risk IDs", () => {
      const coverage = evaluateOwaspCoverage({});
      const summary = formatCoverageSummary(coverage);
      expect(summary).toContain("OWASP Coverage:");
      expect(summary).toContain("LLM01");
      expect(summary).toContain("AG01");
      expect(summary).toContain("Prompt Injection");
    });

    it("contains [OK], [!!], or [XX] markers", () => {
      const coverage = evaluateOwaspCoverage(
        applyComplianceProfile({}, "zero-trust"),
      );
      const summary = formatCoverageSummary(coverage);
      // Zero Trust should have at least some [OK]
      expect(summary).toContain("[OK]");
    });
  });
});

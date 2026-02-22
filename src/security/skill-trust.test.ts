import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach } from "vitest";
import {
  computeSkillContentHash,
  registerSkillTrust,
  verifySkillIntegrity,
  quarantineSkill,
  loadManifest,
  resolveTrustLevel,
} from "./skill-trust.js";
import { resetAuditTrail, initAuditTrail } from "./audit-trail.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "skill-trust-test-"));
}

function writeSkillFiles(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
}

describe("skill-trust", () => {
  let tempDir: string;
  let manifestPath: string;

  beforeEach(() => {
    resetAuditTrail();
    tempDir = makeTempDir();
    manifestPath = join(tempDir, "skill-trust.json");
    initAuditTrail(join(tempDir, "audit"));
  });

  describe("computeSkillContentHash", () => {
    it("should produce deterministic hash for same content", () => {
      const skillDir = join(tempDir, "skill1");
      writeSkillFiles(skillDir, {
        "index.ts": 'export const foo = "bar";',
        "util.js": "module.exports = {};",
      });

      const hash1 = computeSkillContentHash(skillDir);
      const hash2 = computeSkillContentHash(skillDir);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex
    });

    it("should produce different hash for different content", () => {
      const dir1 = join(tempDir, "skill-a");
      const dir2 = join(tempDir, "skill-b");
      writeSkillFiles(dir1, { "index.ts": "const a = 1;" });
      writeSkillFiles(dir2, { "index.ts": "const b = 2;" });

      expect(computeSkillContentHash(dir1)).not.toBe(computeSkillContentHash(dir2));
    });

    it("should ignore non-scannable files", () => {
      const dir = join(tempDir, "skill-mixed");
      writeSkillFiles(dir, {
        "index.ts": "const x = 1;",
        "readme.md": "# Docs",
        "data.json": "{}",
      });

      const hash1 = computeSkillContentHash(dir);

      // Modify non-scannable file
      writeFileSync(join(dir, "readme.md"), "# Updated docs");
      const hash2 = computeSkillContentHash(dir);

      expect(hash1).toBe(hash2);
    });
  });

  describe("trust level assignment", () => {
    it("should assign verified for bundled sources", () => {
      expect(resolveTrustLevel("openclaw-bundled")).toBe("verified");
    });

    it("should assign community for npm/git sources", () => {
      expect(resolveTrustLevel("npm:some-package")).toBe("community");
      expect(resolveTrustLevel("git:github.com/user/repo")).toBe("community");
      expect(resolveTrustLevel("https://example.com/skill")).toBe("community");
    });

    it("should assign local for filesystem sources", () => {
      expect(resolveTrustLevel("/path/to/local/skill")).toBe("local");
      expect(resolveTrustLevel("./relative/path")).toBe("local");
    });
  });

  describe("quarantine", () => {
    it("should block loading of quarantined skills", () => {
      const skillDir = join(tempDir, "quarantine-test");
      writeSkillFiles(skillDir, { "index.ts": "export default {};" });

      registerSkillTrust({
        skillKey: "test-skill",
        dirPath: skillDir,
        source: "local",
        manifestPath,
      });

      // Verify passes before quarantine
      const before = verifySkillIntegrity({
        skillKey: "test-skill",
        dirPath: skillDir,
        manifestPath,
      });
      expect(before.ok).toBe(true);

      // Quarantine the skill
      quarantineSkill({
        skillKey: "test-skill",
        reason: "Suspicious network calls detected",
        manifestPath,
      });

      // Verify fails after quarantine
      const after = verifySkillIntegrity({
        skillKey: "test-skill",
        dirPath: skillDir,
        manifestPath,
      });
      expect(after.ok).toBe(false);
      expect(after.reason).toBe("quarantined");
    });
  });

  describe("manifest persistence", () => {
    it("should persist and reload manifest", () => {
      const skillDir = join(tempDir, "persist-test");
      writeSkillFiles(skillDir, { "index.ts": "const x = 1;" });

      registerSkillTrust({
        skillKey: "persist-skill",
        dirPath: skillDir,
        source: "openclaw-bundled",
        manifestPath,
      });

      // Load from disk
      const manifest = loadManifest(manifestPath);
      expect(manifest.entries["persist-skill"]).toBeDefined();
      expect(manifest.entries["persist-skill"]!.trustLevel).toBe("verified");
      expect(manifest.entries["persist-skill"]!.contentHash).toHaveLength(64);
    });

    it("should detect hash mismatch after modification", () => {
      const skillDir = join(tempDir, "tamper-test");
      writeSkillFiles(skillDir, { "index.ts": "const original = true;" });

      registerSkillTrust({
        skillKey: "tamper-skill",
        dirPath: skillDir,
        source: "local",
        manifestPath,
      });

      // Tamper with the skill
      writeFileSync(join(skillDir, "index.ts"), "const tampered = true;");

      const result = verifySkillIntegrity({
        skillKey: "tamper-skill",
        dirPath: skillDir,
        manifestPath,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("hash_mismatch");
    });
  });
});

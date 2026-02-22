import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach } from "vitest";
import {
  initAuditTrail,
  recordAuditEvent,
  queryAuditTrail,
  verifyAuditTrailIntegrity,
  exportAuditTrail,
  onAuditEvent,
  resetAuditTrail,
} from "./audit-trail.js";
import type { AuditActor, AuditEvent } from "./audit-trail.types.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "audit-trail-test-"));
}

const testActor: AuditActor = {
  actorId: "test-user",
  deviceId: "device-1",
  clientIp: "127.0.0.1",
};

describe("audit-trail", () => {
  let tempDir: string;

  beforeEach(() => {
    resetAuditTrail();
    tempDir = makeTempDir();
  });

  describe("hash chain integrity", () => {
    it("should produce valid hash chain for sequential events", async () => {
      initAuditTrail(tempDir);

      recordAuditEvent({
        category: "auth",
        action: "auth.success",
        severity: "info",
        actor: testActor,
      });

      recordAuditEvent({
        category: "config",
        action: "config.set",
        severity: "warn",
        actor: testActor,
        detail: { path: "gateway.auth" },
      });

      recordAuditEvent({
        category: "tool",
        action: "tool.blocked",
        severity: "critical",
        actor: testActor,
        resource: "exec",
      });

      const result = await verifyAuditTrailIntegrity({ filePath: join(tempDir, "audit-trail.jsonl") });
      expect(result.ok).toBe(true);
      expect(result.totalEvents).toBe(3);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect tampering when a line is modified", async () => {
      initAuditTrail(tempDir);

      recordAuditEvent({
        category: "auth",
        action: "auth.success",
        severity: "info",
        actor: testActor,
      });

      recordAuditEvent({
        category: "config",
        action: "config.set",
        severity: "warn",
        actor: testActor,
      });

      // Tamper with the file
      const filePath = join(tempDir, "audit-trail.jsonl");
      const content = readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n");
      const event: AuditEvent = JSON.parse(lines[0]!);
      event.action = "tampered.action";
      lines[0] = JSON.stringify(event);
      writeFileSync(filePath, lines.join("\n") + "\n");

      const result = await verifyAuditTrailIntegrity({ filePath });
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should detect deletion when a line is removed", async () => {
      initAuditTrail(tempDir);

      recordAuditEvent({ category: "auth", action: "a1", severity: "info", actor: testActor });
      recordAuditEvent({ category: "auth", action: "a2", severity: "info", actor: testActor });
      recordAuditEvent({ category: "auth", action: "a3", severity: "info", actor: testActor });

      // Remove the middle line
      const filePath = join(tempDir, "audit-trail.jsonl");
      const lines = readFileSync(filePath, "utf-8").trim().split("\n");
      writeFileSync(filePath, [lines[0], lines[2]].join("\n") + "\n");

      const result = await verifyAuditTrailIntegrity({ filePath });
      expect(result.ok).toBe(false);
    });
  });

  describe("query filtering", () => {
    it("should filter by category", async () => {
      initAuditTrail(tempDir);

      recordAuditEvent({ category: "auth", action: "a1", severity: "info", actor: testActor });
      recordAuditEvent({ category: "config", action: "a2", severity: "warn", actor: testActor });
      recordAuditEvent({ category: "auth", action: "a3", severity: "info", actor: testActor });

      const result = await queryAuditTrail({ category: "auth" });
      expect(result.total).toBe(2);
      expect(result.events.every((e) => e.category === "auth")).toBe(true);
    });

    it("should filter by severity", async () => {
      initAuditTrail(tempDir);

      recordAuditEvent({ category: "auth", action: "a1", severity: "info", actor: testActor });
      recordAuditEvent({ category: "tool", action: "a2", severity: "critical", actor: testActor });
      recordAuditEvent({ category: "auth", action: "a3", severity: "warn", actor: testActor });

      const result = await queryAuditTrail({ severity: "critical" });
      expect(result.total).toBe(1);
      expect(result.events[0]!.severity).toBe("critical");
    });

    it("should filter by date range", async () => {
      initAuditTrail(tempDir);

      const before = Date.now();
      recordAuditEvent({ category: "auth", action: "a1", severity: "info", actor: testActor });
      const after = Date.now() + 1;

      recordAuditEvent({ category: "auth", action: "a2", severity: "info", actor: testActor });

      const result = await queryAuditTrail({ since: before, until: after });
      expect(result.total).toBeGreaterThanOrEqual(1);
    });

    it("should filter by search text", async () => {
      initAuditTrail(tempDir);

      recordAuditEvent({
        category: "tool",
        action: "tool.blocked",
        severity: "critical",
        actor: testActor,
        resource: "exec",
        detail: { reason: "dangerous command detected" },
      });
      recordAuditEvent({
        category: "auth",
        action: "auth.success",
        severity: "info",
        actor: testActor,
      });

      const result = await queryAuditTrail({ search: "dangerous" });
      expect(result.total).toBe(1);
      expect(result.events[0]!.action).toBe("tool.blocked");
    });

    it("should support pagination", async () => {
      initAuditTrail(tempDir);

      for (let i = 0; i < 5; i++) {
        recordAuditEvent({ category: "auth", action: `a${i}`, severity: "info", actor: testActor });
      }

      const page1 = await queryAuditTrail({ limit: 2, offset: 0 });
      expect(page1.events).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.total).toBe(5);

      const page2 = await queryAuditTrail({ limit: 2, offset: 2 });
      expect(page2.events).toHaveLength(2);
      expect(page2.hasMore).toBe(true);

      const page3 = await queryAuditTrail({ limit: 2, offset: 4 });
      expect(page3.events).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
    });
  });

  describe("rotation at size threshold", () => {
    it("should rotate when file exceeds max size", () => {
      // Use a very small max size to trigger rotation
      initAuditTrail(tempDir, { maxFileSizeMb: 0.0001 });

      // Write enough events to exceed the tiny threshold
      for (let i = 0; i < 20; i++) {
        recordAuditEvent({
          category: "auth",
          action: `action_${i}_${"x".repeat(100)}`,
          severity: "info",
          actor: testActor,
        });
      }

      // Check that rotated files exist
      const { readdirSync } = require("node:fs");
      const files: string[] = readdirSync(tempDir);
      const rotatedFiles = files.filter(
        (f: string) => f.startsWith("audit-trail-") && f !== "audit-trail.jsonl",
      );
      expect(rotatedFiles.length).toBeGreaterThan(0);
    });
  });

  describe("recovery from existing file", () => {
    it("should recover seq and hash from existing audit file", async () => {
      initAuditTrail(tempDir);

      const e1 = recordAuditEvent({
        category: "auth",
        action: "a1",
        severity: "info",
        actor: testActor,
      });
      const e2 = recordAuditEvent({
        category: "auth",
        action: "a2",
        severity: "info",
        actor: testActor,
      });

      // Reset and re-init from same dir
      resetAuditTrail();
      initAuditTrail(tempDir);

      const e3 = recordAuditEvent({
        category: "auth",
        action: "a3",
        severity: "info",
        actor: testActor,
      });

      // e3 should continue the chain
      expect(e3.seq).toBe(3);
      expect(e3.previousHash).toBe(e2.hash);

      // Verify full chain integrity
      const result = await verifyAuditTrailIntegrity({
        filePath: join(tempDir, "audit-trail.jsonl"),
      });
      expect(result.ok).toBe(true);
      expect(result.totalEvents).toBe(3);
    });
  });

  describe("export", () => {
    it("should export as JSON", async () => {
      initAuditTrail(tempDir);
      recordAuditEvent({ category: "auth", action: "a1", severity: "info", actor: testActor });

      const data = await exportAuditTrail({ format: "json" });
      const parsed = JSON.parse(data);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
    });

    it("should export as CSV", async () => {
      initAuditTrail(tempDir);
      recordAuditEvent({ category: "auth", action: "a1", severity: "info", actor: testActor });

      const data = await exportAuditTrail({ format: "csv" });
      expect(data).toContain("seq,ts,category");
      expect(data).toContain("auth,a1,info");
    });

    it("should export as JSONL", async () => {
      initAuditTrail(tempDir);
      recordAuditEvent({ category: "auth", action: "a1", severity: "info", actor: testActor });
      recordAuditEvent({ category: "config", action: "a2", severity: "warn", actor: testActor });

      const data = await exportAuditTrail({ format: "jsonl" });
      const lines = data.trim().split("\n");
      expect(lines).toHaveLength(2);
    });
  });

  describe("listeners", () => {
    it("should notify listeners on new events", () => {
      initAuditTrail(tempDir);
      const received: AuditEvent[] = [];
      onAuditEvent((event) => received.push(event));

      recordAuditEvent({ category: "auth", action: "a1", severity: "info", actor: testActor });
      recordAuditEvent({ category: "config", action: "a2", severity: "warn", actor: testActor });

      expect(received).toHaveLength(2);
      expect(received[0]!.action).toBe("a1");
      expect(received[1]!.action).toBe("a2");
    });

    it("should support unsubscribe", () => {
      initAuditTrail(tempDir);
      const received: AuditEvent[] = [];
      const unsub = onAuditEvent((event) => received.push(event));

      recordAuditEvent({ category: "auth", action: "a1", severity: "info", actor: testActor });
      unsub();
      recordAuditEvent({ category: "auth", action: "a2", severity: "info", actor: testActor });

      expect(received).toHaveLength(1);
    });
  });
});

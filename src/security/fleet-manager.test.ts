import { describe, it, expect } from "vitest";
import {
  generateFleetComplianceReport,
  getFleetOverview,
  executeFleetOperation,
  listFleetOperations,
  getFleetOperation,
  pushPolicyToFleet,
  rotateFleetTokens,
} from "./fleet-manager.js";

describe("fleet-manager", () => {
  // ── Compliance Report ────────────────────────────────────────

  it("generates fleet compliance report", () => {
    const deviceIds = ["d1", "d2", "d3"];
    const metadata = new Map<string, Record<string, unknown>>([
      ["d1", { encryptionEnabled: true, firewallEnabled: true, screenLockEnabled: true }],
      ["d2", { encryptionEnabled: false, firewallEnabled: false }],
      // d3 is missing (unreachable)
    ]);

    const report = generateFleetComplianceReport(deviceIds, metadata);
    expect(report.totalDevices).toBe(3);
    expect(report.unreachable).toBe(1);
    expect(report.devices).toHaveLength(3);
    expect(report.reportedAt).toBeGreaterThan(0);
  });

  it("handles empty fleet", () => {
    const report = generateFleetComplianceReport([], new Map());
    expect(report.totalDevices).toBe(0);
    expect(report.compliant).toBe(0);
    expect(report.nonCompliant).toBe(0);
  });

  // ── Fleet Overview ───────────────────────────────────────────

  it("generates fleet overview", () => {
    const deviceIds = ["d1", "d2"];
    const metadata = new Map<string, Record<string, unknown>>([
      ["d1", { encryptionEnabled: true, firewallEnabled: true, screenLockEnabled: true, biometricsEnabled: true, mdmEnrolled: true }],
      ["d2", { encryptionEnabled: false }],
    ]);

    const overview = getFleetOverview(deviceIds, metadata, 5);
    expect(overview.totalDevices).toBe(2);
    expect(overview.totalAgents).toBe(5);
    expect(overview.byTrustLevel).toBeDefined();
  });

  // ── Bulk Operations ──────────────────────────────────────────

  it("executes fleet operation across devices", () => {
    const operation = executeFleetOperation(
      "policy-push",
      ["d1", "d2", "d3"],
      "admin",
      (deviceId) => ({
        deviceId,
        status: "success",
        detail: "Policy applied",
        completedAt: Date.now(),
      }),
    );

    expect(operation.type).toBe("policy-push");
    expect(operation.results).toHaveLength(3);
    expect(operation.status).toBe("completed");
    expect(operation.results.every((r) => r.status === "success")).toBe(true);
  });

  it("handles partial failures", () => {
    let callCount = 0;
    const operation = executeFleetOperation(
      "token-rotate",
      ["d1", "d2", "d3"],
      "admin",
      (deviceId) => {
        callCount++;
        if (callCount === 2) {
          return { deviceId, status: "failure", detail: "Connection refused", completedAt: Date.now() };
        }
        return { deviceId, status: "success", detail: "Rotated", completedAt: Date.now() };
      },
    );

    expect(operation.status).toBe("partial_failure");
    expect(operation.results.filter((r) => r.status === "success")).toHaveLength(2);
    expect(operation.results.filter((r) => r.status === "failure")).toHaveLength(1);
  });

  it("handles executor exceptions", () => {
    const operation = executeFleetOperation(
      "wipe",
      ["d1"],
      "admin",
      () => {
        throw new Error("Device offline");
      },
    );

    expect(operation.results[0]?.status).toBe("failure");
    expect(operation.results[0]?.detail).toContain("Device offline");
  });

  // ── Policy Push & Token Rotate ───────────────────────────────

  it("pushes policy to fleet", () => {
    const op = pushPolicyToFleet(["d1", "d2"], ["security", "compliance"], "admin");
    expect(op.type).toBe("policy-push");
    expect(op.status).toBe("completed");
    expect(op.results).toHaveLength(2);
  });

  it("rotates fleet tokens", () => {
    const op = rotateFleetTokens(["d1", "d2", "d3"], "admin");
    expect(op.type).toBe("token-rotate");
    expect(op.status).toBe("completed");
    expect(op.results).toHaveLength(3);
  });

  // ── Operation Store ──────────────────────────────────────────

  it("stores and retrieves fleet operations", () => {
    const op = pushPolicyToFleet(["d1"], ["security"], "admin");
    const retrieved = getFleetOperation(op.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(op.id);

    const listed = listFleetOperations();
    expect(listed.length).toBeGreaterThan(0);
  });
});

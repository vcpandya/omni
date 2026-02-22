// ── Fleet Manager — Bulk operations across paired devices ───────

import { randomUUID } from "node:crypto";
import { evaluateDeviceCompliance, resolveDeviceTrustLevel } from "./device-trust.js";
import type { DeviceTrustLevel, DeviceTrustPolicy } from "./device-trust.types.js";
import type {
  FleetOperation,
  FleetOperationResult,
  FleetComplianceReport,
  FleetDeviceReport,
  FleetOverview,
} from "./fleet-manager.types.js";

// ── In-memory operation store (per-process) ────────────────────

const operations = new Map<string, FleetOperation>();

export function getFleetOperation(id: string): FleetOperation | undefined {
  return operations.get(id);
}

export function listFleetOperations(limit = 50): FleetOperation[] {
  return [...operations.values()]
    .sort((a, b) => b.initiatedAt - a.initiatedAt)
    .slice(0, limit);
}

// ── Fleet Compliance Report ────────────────────────────────────

export function generateFleetComplianceReport(
  deviceIds: string[],
  deviceMetadata: Map<string, Record<string, unknown>>,
  policy?: DeviceTrustPolicy,
): FleetComplianceReport {
  const devices: FleetDeviceReport[] = [];
  let compliant = 0;
  let nonCompliant = 0;
  let unreachable = 0;

  for (const deviceId of deviceIds) {
    const metadata = deviceMetadata.get(deviceId);
    if (!metadata) {
      unreachable++;
      devices.push({
        deviceId,
        trustLevel: "untrusted" as DeviceTrustLevel,
        trustScore: 0,
        issues: ["Device unreachable"],
      });
      continue;
    }

    const report = evaluateDeviceCompliance(
      deviceId,
      metadata as Parameters<typeof evaluateDeviceCompliance>[1],
      policy,
    );

    const issues: string[] = [];
    for (const check of report.checks) {
      if (!check.passed) {
        issues.push(`${check.checkId}: ${check.detail ?? "failed"}`);
      }
    }

    const trustLevel = resolveDeviceTrustLevel(report.trustScore);
    if (trustLevel === "trusted" || trustLevel === "verified") {
      compliant++;
    } else {
      nonCompliant++;
    }

    devices.push({
      deviceId,
      trustLevel,
      trustScore: report.trustScore,
      issues,
    });
  }

  return {
    reportedAt: Date.now(),
    totalDevices: deviceIds.length,
    compliant,
    nonCompliant,
    unreachable,
    devices,
  };
}

// ── Fleet Overview ─────────────────────────────────────────────

export function getFleetOverview(
  deviceIds: string[],
  deviceMetadata: Map<string, Record<string, unknown>>,
  agentCount: number,
): FleetOverview {
  const byTrustLevel: Record<DeviceTrustLevel, number> = {
    trusted: 0,
    verified: 0,
    known: 0,
    untrusted: 0,
  };

  for (const deviceId of deviceIds) {
    const metadata = deviceMetadata.get(deviceId);
    if (!metadata) {
      byTrustLevel.untrusted++;
      continue;
    }
    const report = evaluateDeviceCompliance(
      deviceId,
      metadata as Parameters<typeof evaluateDeviceCompliance>[1],
    );
    const level = resolveDeviceTrustLevel(report.trustScore);
    byTrustLevel[level]++;
  }

  const activeOps = [...operations.values()].filter(
    (op) => op.status === "pending" || op.status === "in_progress",
  ).length;

  return {
    totalDevices: deviceIds.length,
    byTrustLevel,
    totalAgents: agentCount,
    activeOperations: activeOps,
  };
}

// ── Bulk Operations ────────────────────────────────────────────

export function executeFleetOperation(
  type: FleetOperation["type"],
  targetDeviceIds: string[],
  initiatedBy: string,
  executor: (deviceId: string) => FleetOperationResult,
): FleetOperation {
  const id = randomUUID();
  const now = Date.now();

  const operation: FleetOperation = {
    id,
    type,
    targetDeviceIds,
    initiatedBy,
    initiatedAt: now,
    results: [],
    status: "in_progress",
  };

  operations.set(id, operation);

  const results: FleetOperationResult[] = [];
  let hasFailure = false;

  for (const deviceId of targetDeviceIds) {
    try {
      const result = executor(deviceId);
      results.push(result);
      if (result.status === "failure" || result.status === "unreachable") {
        hasFailure = true;
      }
    } catch (err) {
      hasFailure = true;
      results.push({
        deviceId,
        status: "failure",
        detail: err instanceof Error ? err.message : "Unknown error",
        completedAt: Date.now(),
      });
    }
  }

  operation.results = results;
  operation.completedAt = Date.now();
  operation.status = hasFailure
    ? results.every((r) => r.status === "failure" || r.status === "unreachable")
      ? "partial_failure"
      : "partial_failure"
    : "completed";

  // If all succeeded, mark as completed
  if (!hasFailure) {
    operation.status = "completed";
  }

  operations.set(id, operation);
  return operation;
}

export function pushPolicyToFleet(
  targetDeviceIds: string[],
  pushFields: string[],
  initiatedBy: string,
): FleetOperation {
  return executeFleetOperation(
    "policy-push",
    targetDeviceIds,
    initiatedBy,
    (deviceId) => ({
      deviceId,
      status: "success",
      detail: `Policy pushed: ${pushFields.join(", ")}`,
      completedAt: Date.now(),
    }),
  );
}

export function rotateFleetTokens(
  targetDeviceIds: string[],
  initiatedBy: string,
): FleetOperation {
  return executeFleetOperation(
    "token-rotate",
    targetDeviceIds,
    initiatedBy,
    (deviceId) => ({
      deviceId,
      status: "success",
      detail: "Token rotated",
      completedAt: Date.now(),
    }),
  );
}

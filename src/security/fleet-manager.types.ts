// ── Fleet Manager Types ──────────────────────────────────────────

import type { DeviceTrustLevel } from "./device-trust.types.js";

export type FleetOperationType = "policy-push" | "token-rotate" | "wipe" | "agent-sync";

export type FleetOperationStatus = "pending" | "in_progress" | "completed" | "partial_failure";

export type FleetOperationResultStatus = "success" | "failure" | "skipped" | "unreachable";

export type FleetOperation = {
  id: string;
  type: FleetOperationType;
  targetDeviceIds: string[];
  initiatedBy: string;
  initiatedAt: number;
  results: FleetOperationResult[];
  status: FleetOperationStatus;
  completedAt?: number;
};

export type FleetOperationResult = {
  deviceId: string;
  status: FleetOperationResultStatus;
  detail?: string;
  completedAt?: number;
};

export type FleetDeviceReport = {
  deviceId: string;
  trustLevel: DeviceTrustLevel;
  trustScore: number;
  issues: string[];
};

export type FleetComplianceReport = {
  reportedAt: number;
  totalDevices: number;
  compliant: number;
  nonCompliant: number;
  unreachable: number;
  devices: FleetDeviceReport[];
};

export type FleetOverview = {
  totalDevices: number;
  byTrustLevel: Record<DeviceTrustLevel, number>;
  totalAgents: number;
  activeOperations: number;
  lastReportAt?: number;
};

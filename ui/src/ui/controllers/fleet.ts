// ── Fleet Controller — overview + bulk ops state ──────────────

import type { GatewayBrowserClient } from "../gateway.ts";

// ── Types ───────────────────────────────────────────────────────

export type DeviceTrustLevel = "high" | "medium" | "low" | "untrusted";

export type FleetOverviewUI = {
  totalDevices: number;
  byTrustLevel: Record<DeviceTrustLevel, number>;
  totalAgents: number;
  activeOperations: number;
  lastReportAt?: number;
};

export type FleetOperationStatus = "pending" | "in_progress" | "completed" | "partial_failure";
export type FleetOperationResultStatus = "success" | "failure" | "skipped" | "unreachable";
export type FleetOperationType = "policy-push" | "token-rotate" | "wipe" | "agent-sync";

export type FleetOperationResultUI = {
  deviceId: string;
  status: FleetOperationResultStatus;
  detail?: string;
  completedAt?: number;
};

export type FleetOperationUI = {
  id: string;
  type: FleetOperationType;
  targetDeviceIds: string[];
  initiatedBy: string;
  initiatedAt: number;
  results: FleetOperationResultUI[];
  status: FleetOperationStatus;
  completedAt?: number;
};

export type FleetComplianceReportUI = {
  reportedAt: number;
  totalDevices: number;
  compliant: number;
  nonCompliant: number;
  unreachable: number;
  devices: Array<{
    deviceId: string;
    trustLevel: DeviceTrustLevel;
    trustScore: number;
    issues: string[];
  }>;
};

export type FleetBulkOpDraft = {
  /** Comma-separated device ids; parsed on submit. */
  targetIds: string;
  /** For policy-push only — comma-separated field names. */
  pushFields: string;
  /** Required explicit opt-in before a wipe can be issued. */
  wipeConfirmed: boolean;
};

export type FleetState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  overview: FleetOverviewUI | null;
  operations: FleetOperationUI[];
  complianceReport: FleetComplianceReportUI | null;
  lastRefreshAt: number | null;
  selectedOperationId: string | null;
  /** Bulk-op panel state — collocated so the view can drive all 3 forms. */
  bulkOp: FleetBulkOpDraft;
  bulkOpSubmitting: FleetOperationType | null;
  bulkOpError: string | null;
  bulkOpLastResult: FleetOperationUI | null;
};

export function makeFleetState(): FleetState {
  return {
    client: null,
    connected: false,
    loading: false,
    error: null,
    overview: null,
    operations: [],
    complianceReport: null,
    lastRefreshAt: null,
    selectedOperationId: null,
    bulkOp: {
      targetIds: "",
      pushFields: "security,compliance",
      wipeConfirmed: false,
    },
    bulkOpSubmitting: null,
    bulkOpError: null,
    bulkOpLastResult: null,
  };
}

function parseDeviceIds(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const EMPTY_TRUST_COUNTS: Record<DeviceTrustLevel, number> = {
  high: 0,
  medium: 0,
  low: 0,
  untrusted: 0,
};

// ── Load ────────────────────────────────────────────────────────

export async function loadFleet(state: FleetState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.loading = true;
  state.error = null;
  try {
    const [overviewRes, opsRes] = await Promise.all([
      state.client.request<{ overview: FleetOverviewUI }>("fleet.overview", {}),
      state.client.request<{ operations: FleetOperationUI[] }>("fleet.operations.list", {
        limit: 20,
      }),
    ]);
    state.overview = {
      ...overviewRes.overview,
      byTrustLevel: {
        ...EMPTY_TRUST_COUNTS,
        ...overviewRes.overview?.byTrustLevel,
      },
    };
    state.operations = opsRes.operations ?? [];
    state.lastRefreshAt = Date.now();
  } catch (err) {
    state.error = String(err);
  } finally {
    state.loading = false;
  }
}

export async function loadOperation(
  state: FleetState,
  id: string,
): Promise<FleetOperationUI | null> {
  if (!state.client) {
    return null;
  }
  try {
    const res = await state.client.request<{ operation: FleetOperationUI }>(
      "fleet.operations.get",
      { id },
    );
    return res.operation;
  } catch (err) {
    state.error = String(err);
    return null;
  }
}

export function selectOperation(state: FleetState, id: string | null): void {
  state.selectedOperationId = id;
}

// ── Derived ─────────────────────────────────────────────────────

export function trustDistributionPct(state: FleetState): Record<DeviceTrustLevel, number> {
  const counts = state.overview?.byTrustLevel ?? EMPTY_TRUST_COUNTS;
  const total = counts.high + counts.medium + counts.low + counts.untrusted;
  if (total === 0) {
    return { high: 0, medium: 0, low: 0, untrusted: 0 };
  }
  return {
    high: Math.round((counts.high / total) * 100),
    medium: Math.round((counts.medium / total) * 100),
    low: Math.round((counts.low / total) * 100),
    untrusted: Math.round((counts.untrusted / total) * 100),
  };
}

export function operationSuccessRate(op: FleetOperationUI): {
  total: number;
  success: number;
  failure: number;
  pct: number;
} {
  const total = op.results.length;
  const success = op.results.filter((r) => r.status === "success").length;
  const failure = op.results.filter((r) => r.status === "failure").length;
  const pct = total === 0 ? 0 : Math.round((success / total) * 100);
  return { total, success, failure, pct };
}

// ── Actions ─────────────────────────────────────────────────────

export async function pushPolicy(
  state: FleetState,
  targetDeviceIds: string[],
  pushFields: string[],
): Promise<FleetOperationUI | null> {
  if (!state.client) {
    return null;
  }
  try {
    const res = await state.client.request<{ operation: FleetOperationUI }>("fleet.policy.push", {
      targetDeviceIds,
      pushFields,
    });
    await loadFleet(state);
    return res.operation;
  } catch (err) {
    state.error = String(err);
    return null;
  }
}

export async function rotateTokens(
  state: FleetState,
  targetDeviceIds: string[],
): Promise<FleetOperationUI | null> {
  if (!state.client) {
    return null;
  }
  try {
    const res = await state.client.request<{ operation: FleetOperationUI }>("fleet.tokens.rotate", {
      targetDeviceIds,
    });
    await loadFleet(state);
    return res.operation;
  } catch (err) {
    state.error = String(err);
    return null;
  }
}

export async function wipeDevices(
  state: FleetState,
  targetDeviceIds: string[],
): Promise<FleetOperationUI | null> {
  if (!state.client) {
    return null;
  }
  try {
    const res = await state.client.request<{ operation: FleetOperationUI }>("fleet.wipe", {
      targetDeviceIds,
      confirm: true,
    });
    await loadFleet(state);
    return res.operation;
  } catch (err) {
    state.error = String(err);
    return null;
  }
}

// ── Bulk-op panel: form-driven submit helpers ────────────────────
// These wrap the action primitives above with input parsing, input
// validation, per-op in-flight tracking, and error surfacing. The view
// binds its "Run" buttons to these so no parsing logic leaks into
// templates.

export async function submitBulkOp(state: FleetState, op: FleetOperationType): Promise<boolean> {
  state.bulkOpError = null;
  state.bulkOpLastResult = null;

  const targetDeviceIds = parseDeviceIds(state.bulkOp.targetIds);
  if (targetDeviceIds.length === 0) {
    state.bulkOpError = "Enter at least one device id";
    return false;
  }

  if (op === "wipe" && !state.bulkOp.wipeConfirmed) {
    state.bulkOpError = "Check the confirmation box to run a remote wipe";
    return false;
  }

  state.bulkOpSubmitting = op;
  try {
    let result: FleetOperationUI | null = null;
    switch (op) {
      case "policy-push":
        result = await pushPolicy(state, targetDeviceIds, parseDeviceIds(state.bulkOp.pushFields));
        break;
      case "token-rotate":
        result = await rotateTokens(state, targetDeviceIds);
        break;
      case "wipe":
        result = await wipeDevices(state, targetDeviceIds);
        // Reset confirmation after a wipe succeeds to prevent accidental
        // double-fire if the operator stays on the screen and re-clicks.
        state.bulkOp.wipeConfirmed = false;
        break;
      case "agent-sync":
        // Agent-sync requires an agentId + config — surface a
        // friendly error rather than wiring a half-flow here. A
        // proper agent-sync form belongs in remote-agents view.
        state.bulkOpError = "Agent sync is available from the Remote Agents view";
        return false;
    }
    if (!result) {
      // Controller-level error already set by the inner action.
      return false;
    }
    state.bulkOpLastResult = result;
    return true;
  } finally {
    state.bulkOpSubmitting = null;
  }
}

export function setBulkOpField<K extends keyof FleetBulkOpDraft>(
  state: FleetState,
  key: K,
  value: FleetBulkOpDraft[K],
): void {
  state.bulkOp = { ...state.bulkOp, [key]: value };
}

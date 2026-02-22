// ── Activity Timeline Controller — State + RPC loading + streaming ──

import type { GatewayBrowserClient } from "../gateway.ts";

// ── Types ───────────────────────────────────────────────────────

export type AuditEventUI = {
  seq: number;
  ts: number;
  category: string;
  action: string;
  severity: "info" | "warn" | "critical";
  actor: {
    actorId: string;
    deviceId?: string;
    clientIp?: string;
    connId?: string;
    role?: string;
  };
  resource?: string;
  detail?: Record<string, unknown>;
  expanded?: boolean;
};

export type ActivityFilters = {
  categories: Set<string>;
  severities: Set<string>;
  search: string;
  since?: string;
};

export type ActivityState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  activityLoading: boolean;
  activityError: string | null;
  activityEvents: AuditEventUI[];
  activityFilters: ActivityFilters;
  activityStreaming: boolean;
  activityTotal: number;
  activityHasMore: boolean;
  activityIntegrityOk: boolean | null;
  activityStatsToday: number;
  activityStatsCritical: number;
};

// ── Defaults ────────────────────────────────────────────────────

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = {
  categories: new Set(),
  severities: new Set(),
  search: "",
};

// ── Load Activity ───────────────────────────────────────────────

export async function loadActivity(
  state: ActivityState,
  opts?: { append?: boolean },
): Promise<void> {
  if (!state.client) return;
  state.activityLoading = true;
  state.activityError = null;

  try {
    const filters = state.activityFilters;
    const params: Record<string, unknown> = {
      limit: 50,
      offset: opts?.append ? state.activityEvents.length : 0,
    };
    if (filters.categories.size > 0) {
      params.category = [...filters.categories][0];
    }
    if (filters.severities.size > 0) {
      params.severity = [...filters.severities][0];
    }
    if (filters.search) {
      params.search = filters.search;
    }

    const result = await state.client.request<{
      events: AuditEventUI[];
      total: number;
      hasMore: boolean;
      integrityOk: boolean;
    }>("audit.query", params);

    if (opts?.append) {
      state.activityEvents = [...state.activityEvents, ...result.events];
    } else {
      state.activityEvents = result.events;
    }
    state.activityTotal = result.total;
    state.activityHasMore = result.hasMore;
    state.activityIntegrityOk = result.integrityOk;

    // Calculate stats
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    state.activityStatsToday = result.events.filter((e) => e.ts >= startOfDay).length;
    state.activityStatsCritical = result.events.filter((e) => e.severity === "critical").length;
  } catch (err) {
    state.activityError = String(err);
  } finally {
    state.activityLoading = false;
  }
}

// ── Load More ───────────────────────────────────────────────────

export async function loadMoreActivity(state: ActivityState): Promise<void> {
  return loadActivity(state, { append: true });
}

// ── Subscribe Stream ────────────────────────────────────────────

export function subscribeActivityStream(state: ActivityState): () => void {
  if (!state.client) return () => {};

  state.activityStreaming = true;

  const handler = (_event: string, data: unknown) => {
    const auditEvent = data as AuditEventUI;
    if (auditEvent && typeof auditEvent.seq === "number") {
      state.activityEvents = [auditEvent, ...state.activityEvents];
      state.activityTotal++;
      if (auditEvent.severity === "critical") {
        state.activityStatsCritical++;
      }
    }
  };

  state.client.on("audit.event", handler);

  // Also request the stream subscription
  void state.client.request("audit.stream", {}).catch(() => {});

  return () => {
    state.activityStreaming = false;
    state.client?.off("audit.event", handler);
  };
}

// ── Verify Integrity ────────────────────────────────────────────

export async function verifyIntegrity(
  state: ActivityState,
): Promise<void> {
  if (!state.client) return;
  try {
    const result = await state.client.request<{
      ok: boolean;
      totalEvents: number;
      errors: string[];
    }>("audit.verify", {});
    state.activityIntegrityOk = result.ok;
  } catch {
    state.activityIntegrityOk = false;
  }
}

// ── Export ───────────────────────────────────────────────────────

export async function exportActivity(
  state: ActivityState,
  format: "json" | "csv" | "jsonl",
): Promise<string | null> {
  if (!state.client) return null;
  try {
    const result = await state.client.request<{
      format: string;
      data: string;
      exportedAt: number;
    }>("audit.export", { format });
    return result.data;
  } catch {
    return null;
  }
}

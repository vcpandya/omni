// ── Immutable Audit Trail — Core Types ──────────────────────────

import type { TraceContext } from "./trace-context.js";

export type AuditEventCategory =
  | "auth"
  | "approval"
  | "config"
  | "tool"
  | "skill"
  | "sandbox"
  | "device"
  | "system"
  | "operator"
  | "remote-agent"
  | "sso"
  | "fleet"
  | "code-intel";

export type AuditEventSeverity = "info" | "warn" | "critical";

export type AuditActor = {
  actorId: string;
  deviceId?: string;
  clientIp?: string;
  connId?: string;
  role?: string;
  scopes?: string[];
};

export type AuditEvent = {
  seq: number;
  ts: number;
  category: AuditEventCategory;
  action: string;
  severity: AuditEventSeverity;
  actor: AuditActor;
  resource?: string;
  detail?: Record<string, unknown>;
  /** W3C trace context — optional correlation id for OTEL/SIEM pivot. */
  trace?: TraceContext;
  hash: string;
  previousHash: string;
};

export type AuditTrailQueryParams = {
  category?: AuditEventCategory;
  severity?: AuditEventSeverity;
  actorId?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
  search?: string;
  /** Filter to events carrying this W3C trace-id (32-char hex). */
  traceId?: string;
};

export type AuditTrailQueryResult = {
  events: AuditEvent[];
  total: number;
  hasMore: boolean;
  integrityOk: boolean;
};

export type AuditTrailExportFormat = "json" | "csv" | "jsonl";

export type AuditTrailConfig = {
  enabled?: boolean;
  maxFileSizeMb?: number;
  retentionDays?: number;
  categories?: AuditEventCategory[];
};

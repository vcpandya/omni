// ── Immutable Audit Trail — Core Types ──────────────────────────

export type AuditEventCategory =
  | "auth"
  | "approval"
  | "config"
  | "tool"
  | "skill"
  | "sandbox"
  | "device"
  | "system";

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

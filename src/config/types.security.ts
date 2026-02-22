// ── Security Configuration Types ────────────────────────────────

import type { AuditEventCategory } from "../security/audit-trail.types.js";
import type { EnterpriseAdminConfig } from "./types.admin.js";
import type { LlmAuditConfig } from "../security/llm-audit.types.js";
import type { DeviceTrustPolicy } from "../security/device-trust.types.js";

export type AuditTrailConfig = {
  enabled?: boolean;
  maxFileSizeMb?: number;
  retentionDays?: number;
  categories?: AuditEventCategory[];
};

export type SecurityConfig = {
  auditTrail?: AuditTrailConfig;
  llmAudit?: LlmAuditConfig;
  deviceTrust?: DeviceTrustPolicy;
  enterprise?: EnterpriseAdminConfig;
};

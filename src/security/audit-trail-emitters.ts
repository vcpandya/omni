// ── Audit Trail Emitters — Convenience wrappers per integration point ──

import { recordAuditEvent } from "./audit-trail.js";
import type { AuditActor, AuditEventSeverity } from "./audit-trail.types.js";

// ── Auth Events ─────────────────────────────────────────────────

export function emitAuthEvent(
  actor: AuditActor,
  action: "auth.success" | "auth.failure" | "auth.rate_limited",
  detail?: Record<string, unknown>,
): void {
  const severity: AuditEventSeverity =
    action === "auth.success" ? "info" : action === "auth.rate_limited" ? "warn" : "warn";
  recordAuditEvent({ category: "auth", action, severity, actor, detail });
}

// ── Approval Events ─────────────────────────────────────────────

export function emitApprovalEvent(
  actor: AuditActor,
  action: "approval.requested" | "approval.resolved" | "approval.expired",
  approvalId: string,
  command: string,
  detail?: Record<string, unknown>,
): void {
  const severity: AuditEventSeverity = action === "approval.resolved" ? "info" : "warn";
  recordAuditEvent({
    category: "approval",
    action,
    severity,
    actor,
    resource: approvalId,
    detail: { command, ...detail },
  });
}

// ── Config Events ───────────────────────────────────────────────

export function emitConfigEvent(
  actor: AuditActor,
  action: "config.set" | "config.patch" | "config.apply",
  paths: string[],
  detail?: Record<string, unknown>,
): void {
  recordAuditEvent({
    category: "config",
    action,
    severity: "warn",
    actor,
    detail: { changedPaths: paths, ...detail },
  });
}

// ── Tool Events ─────────────────────────────────────────────────

export function emitToolEvent(
  actor: AuditActor,
  action: "tool.blocked" | "tool.loop_detected" | "tool.audit_flagged",
  toolName: string,
  detail?: Record<string, unknown>,
): void {
  const severity: AuditEventSeverity = action === "tool.blocked" ? "critical" : "warn";
  recordAuditEvent({
    category: "tool",
    action,
    severity,
    actor,
    resource: toolName,
    detail,
  });
}

// ── Skill Events ────────────────────────────────────────────────

export function emitSkillEvent(
  actor: AuditActor,
  action:
    | "skill.installed"
    | "skill.updated"
    | "skill.toggled"
    | "skill.quarantined"
    | "skill.integrity_fail",
  skillKey: string,
  detail?: Record<string, unknown>,
): void {
  const severity: AuditEventSeverity =
    action === "skill.quarantined" || action === "skill.integrity_fail" ? "critical" : "info";
  recordAuditEvent({
    category: "skill",
    action,
    severity,
    actor,
    resource: skillKey,
    detail,
  });
}

// ── Sandbox Events ──────────────────────────────────────────────

export function emitSandboxEvent(
  actor: AuditActor,
  action:
    | "sandbox.created"
    | "sandbox.destroyed"
    | "sandbox.resource_warning"
    | "sandbox.insecure_config",
  containerId?: string,
  detail?: Record<string, unknown>,
): void {
  const severity: AuditEventSeverity =
    action === "sandbox.resource_warning" || action === "sandbox.insecure_config" ? "warn" : "info";
  recordAuditEvent({
    category: "sandbox",
    action,
    severity,
    actor,
    resource: containerId,
    detail,
  });
}

// ── Operator Events ─────────────────────────────────────────────

export function emitOperatorEvent(
  actor: AuditActor,
  action:
    | "operator.created"
    | "operator.updated"
    | "operator.deleted"
    | "operator.invited"
    | "operator.disabled"
    | "operator.login",
  operatorId: string,
  detail?: Record<string, unknown>,
): void {
  const severity: AuditEventSeverity =
    action === "operator.deleted" || action === "operator.disabled" ? "warn" : "info";
  recordAuditEvent({
    category: "operator",
    action,
    severity,
    actor,
    resource: operatorId,
    detail,
  });
}

// ── Remote Agent Events ─────────────────────────────────────────

export function emitRemoteAgentEvent(
  actor: AuditActor,
  action:
    | "remote-agent.pushed"
    | "remote-agent.pulled"
    | "remote-agent.synced"
    | "remote-agent.removed"
    | "remote-agent.drift_detected",
  agentId: string,
  deviceId: string,
  detail?: Record<string, unknown>,
): void {
  const severity: AuditEventSeverity =
    action === "remote-agent.drift_detected" ? "warn" : "info";
  recordAuditEvent({
    category: "remote-agent",
    action,
    severity,
    actor,
    resource: agentId,
    detail: { deviceId, ...detail },
  });
}

// ── SSO Events ──────────────────────────────────────────────────

export function emitSsoEvent(
  actor: AuditActor,
  action: "sso.login" | "sso.provisioned" | "sso.failure" | "sso.group_sync",
  detail?: Record<string, unknown>,
): void {
  const severity: AuditEventSeverity =
    action === "sso.failure" ? "warn" : "info";
  recordAuditEvent({
    category: "sso",
    action,
    severity,
    actor,
    detail,
  });
}

// ── Fleet Events ────────────────────────────────────────────────

export function emitFleetEvent(
  actor: AuditActor,
  action:
    | "fleet.policy_pushed"
    | "fleet.tokens_rotated"
    | "fleet.wipe_initiated"
    | "fleet.agents_synced"
    | "fleet.compliance_checked",
  detail?: Record<string, unknown>,
): void {
  const severity: AuditEventSeverity =
    action === "fleet.wipe_initiated" ? "critical" : "info";
  recordAuditEvent({
    category: "fleet",
    action,
    severity,
    actor,
    detail,
  });
}

// ── Device Events ───────────────────────────────────────────────

export function emitDeviceEvent(
  actor: AuditActor,
  action:
    | "device.paired"
    | "device.rejected"
    | "device.revoked"
    | "device.token_rotated"
    | "device.trust_changed"
    | "device.wiped",
  deviceId: string,
  detail?: Record<string, unknown>,
): void {
  const severity: AuditEventSeverity =
    action === "device.revoked" || action === "device.wiped" ? "critical" : "info";
  recordAuditEvent({
    category: "device",
    action,
    severity,
    actor,
    resource: deviceId,
    detail,
  });
}

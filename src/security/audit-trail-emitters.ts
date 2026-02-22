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

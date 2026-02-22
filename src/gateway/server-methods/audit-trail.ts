// ── Audit Trail RPC Handlers ────────────────────────────────────

import {
  queryAuditTrail,
  verifyAuditTrailIntegrity,
  exportAuditTrail,
  onAuditEvent,
} from "../../security/audit-trail.js";
import type {
  AuditTrailQueryParams,
  AuditTrailExportFormat,
} from "../../security/audit-trail.types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const auditTrailHandlers: GatewayRequestHandlers = {
  "audit.query": async ({ params, respond }) => {
    try {
      const p = params as Partial<AuditTrailQueryParams>;
      const result = await queryAuditTrail({
        category: p.category,
        severity: p.severity,
        actorId: p.actorId,
        since: typeof p.since === "number" ? p.since : undefined,
        until: typeof p.until === "number" ? p.until : undefined,
        limit: typeof p.limit === "number" ? Math.min(p.limit, 1000) : 100,
        offset: typeof p.offset === "number" ? p.offset : 0,
        search: typeof p.search === "string" ? p.search : undefined,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `audit query failed: ${String(err)}`),
      );
    }
  },

  "audit.stream": ({ respond, context }) => {
    // Subscribe to real-time audit events and broadcast them
    const unsubscribe = onAuditEvent((event) => {
      context.broadcast("audit.event", event, { dropIfSlow: true });
    });
    // Return subscription confirmation — unsubscribe when client disconnects
    // The broadcast mechanism handles delivery; this just confirms subscription is active
    respond(true, { subscribed: true }, undefined);
    // Note: In a real implementation, unsubscribe would be tied to client disconnect.
    // For now, we keep the subscription active for the server lifetime.
    // Store unsubscribe reference for potential cleanup
    void unsubscribe;
  },

  "audit.verify": async ({ respond }) => {
    try {
      const result = await verifyAuditTrailIntegrity();
      respond(
        true,
        {
          ok: result.ok,
          totalEvents: result.totalEvents,
          errors: result.errors.slice(0, 50), // Limit errors in response
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `audit verify failed: ${String(err)}`),
      );
    }
  },

  "audit.export": async ({ params, respond }) => {
    try {
      const p = params as { format?: string; query?: Partial<AuditTrailQueryParams> };
      const format = (p.format ?? "json") as AuditTrailExportFormat;
      if (!["json", "csv", "jsonl"].includes(format)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `invalid export format: ${format}`),
        );
        return;
      }
      const data = await exportAuditTrail({
        format,
        query: p.query ? { ...p.query, limit: Math.min(p.query.limit ?? 10000, 50000) } : undefined,
      });
      respond(true, { format, data, exportedAt: Date.now() }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `audit export failed: ${String(err)}`),
      );
    }
  },
};

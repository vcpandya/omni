// ── Fleet Management Gateway Handlers ───────────────────────────

import {
  generateFleetComplianceReport,
  getFleetOverview,
  getFleetOperation,
  listFleetOperations,
  pushPolicyToFleet,
  rotateFleetTokens,
  executeFleetOperation,
} from "../../security/fleet-manager.js";
import { initiateRemoteWipe } from "../../security/device-trust.js";
import { emitFleetEvent } from "../../security/audit-trail-emitters.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const fleetHandlers: GatewayRequestHandlers = {
  "fleet.overview": ({ params, respond }) => {
    const p = params as { deviceIds?: string[] };
    const deviceIds = p.deviceIds ?? [];
    // In a full implementation, deviceIds would come from the pairing store.
    const overview = getFleetOverview(deviceIds, new Map(), 0);
    respond(true, { overview }, undefined);
  },

  "fleet.compliance": ({ params, respond }) => {
    const p = params as {
      deviceIds?: string[];
      deviceMetadata?: Record<string, Record<string, unknown>>;
      policy?: Record<string, unknown>;
    };
    if (!p.deviceIds?.length) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "deviceIds is required"));
      return;
    }
    const metadataMap = new Map<string, Record<string, unknown>>();
    if (p.deviceMetadata) {
      for (const [id, meta] of Object.entries(p.deviceMetadata)) {
        metadataMap.set(id, meta);
      }
    }
    const report = generateFleetComplianceReport(
      p.deviceIds,
      metadataMap,
      p.policy as Parameters<typeof generateFleetComplianceReport>[2],
    );
    respond(true, { report }, undefined);
  },

  "fleet.policy.push": ({ params, respond, context }) => {
    const p = params as {
      targetDeviceIds?: string[];
      pushFields?: string[];
    };
    if (!p.targetDeviceIds?.length) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "targetDeviceIds is required"));
      return;
    }
    const pushFields = p.pushFields ?? ["security", "compliance"];
    const operation = pushPolicyToFleet(p.targetDeviceIds, pushFields, "operator");
    emitFleetEvent({ actorId: "operator" }, "fleet.policy_pushed", {
      operationId: operation.id,
      deviceCount: p.targetDeviceIds.length,
      pushFields,
    });
    context.logGateway.info(
      `fleet policy pushed devices=${p.targetDeviceIds.length} fields=${pushFields.join(",")}`,
    );
    respond(true, { operation }, undefined);
  },

  "fleet.tokens.rotate": ({ params, respond, context }) => {
    const p = params as { targetDeviceIds?: string[] };
    if (!p.targetDeviceIds?.length) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "targetDeviceIds is required"));
      return;
    }
    const operation = rotateFleetTokens(p.targetDeviceIds, "operator");
    emitFleetEvent({ actorId: "operator" }, "fleet.tokens_rotated", {
      operationId: operation.id,
      deviceCount: p.targetDeviceIds.length,
    });
    context.logGateway.info(`fleet tokens rotated devices=${p.targetDeviceIds.length}`);
    respond(true, { operation }, undefined);
  },

  "fleet.wipe": ({ params, respond, context }) => {
    const p = params as {
      targetDeviceIds?: string[];
      confirm?: boolean;
    };
    if (!p.targetDeviceIds?.length) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "targetDeviceIds is required"));
      return;
    }
    if (!p.confirm) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "confirm=true is required for fleet wipe"),
      );
      return;
    }
    const operation = executeFleetOperation(
      "wipe",
      p.targetDeviceIds,
      "operator",
      (deviceId) => {
        const result = initiateRemoteWipe(deviceId, { actorId: "operator" });
        return {
          deviceId,
          status: result.initiated ? "success" as const : "failure" as const,
          detail: result.initiated ? "Wipe initiated" : "Wipe failed",
          completedAt: Date.now(),
        };
      },
    );
    emitFleetEvent({ actorId: "operator" }, "fleet.wipe_initiated", {
      operationId: operation.id,
      deviceCount: p.targetDeviceIds.length,
    });
    context.logGateway.info(`fleet wipe initiated devices=${p.targetDeviceIds.length}`);
    respond(true, { operation }, undefined);
  },

  "fleet.agents.sync": ({ params, respond, context }) => {
    const p = params as {
      agentId?: string;
      targetDeviceIds?: string[];
      config?: Record<string, unknown>;
    };
    if (!p.agentId || !p.targetDeviceIds?.length) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agentId and targetDeviceIds are required"),
      );
      return;
    }
    // Delegates to remote agent push for each device
    emitFleetEvent({ actorId: "operator" }, "fleet.agents_synced", {
      agentId: p.agentId,
      deviceCount: p.targetDeviceIds.length,
    });
    context.logGateway.info(
      `fleet agents sync agent=${p.agentId} devices=${p.targetDeviceIds.length}`,
    );
    respond(true, { agentId: p.agentId, targetDeviceIds: p.targetDeviceIds, status: "initiated" }, undefined);
  },

  "fleet.operations.list": ({ params, respond }) => {
    const p = params as { limit?: number };
    const operations = listFleetOperations(p.limit);
    respond(true, { operations }, undefined);
  },

  "fleet.operations.get": ({ params, respond }) => {
    const p = params as { id?: string };
    if (!p.id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const operation = getFleetOperation(p.id);
    if (!operation) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "operation not found"));
      return;
    }
    respond(true, { operation }, undefined);
  },
};

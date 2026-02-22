// ── Remote Agent Fleet Management Gateway Handlers ──────────────

import {
  listRemoteAgents,
  getRemoteAgent,
  pushAgentConfig,
  pullAgentState,
  syncAgent,
  diffAgentConfig,
  removeRemoteAgent,
  detectDrift,
} from "../../agents/remote-registry.js";
import { emitRemoteAgentEvent } from "../../security/audit-trail-emitters.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const remoteAgentHandlers: GatewayRequestHandlers = {
  "remote.agents.list": ({ params, respond }) => {
    const p = params as { deviceId?: string; status?: string };
    const entries = listRemoteAgents({
      deviceId: p.deviceId,
      status: p.status as "synced" | "pending" | "diverged" | "unreachable" | undefined,
    });
    respond(true, { entries }, undefined);
  },

  "remote.agents.get": ({ params, respond }) => {
    const p = params as { deviceId?: string; agentId?: string };
    if (!p.deviceId || !p.agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "deviceId and agentId are required"));
      return;
    }
    const entry = getRemoteAgent(p.deviceId, p.agentId);
    if (!entry) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "remote agent not found"));
      return;
    }
    respond(true, { entry }, undefined);
  },

  "remote.agents.push": ({ params, respond, context }) => {
    const p = params as {
      agentId?: string;
      targetDeviceIds?: string[];
      config?: Record<string, unknown>;
    };
    if (!p.agentId || !p.targetDeviceIds?.length || !p.config) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agentId, targetDeviceIds, and config are required"),
      );
      return;
    }
    const results = pushAgentConfig(p.agentId, p.targetDeviceIds, p.config);
    for (const result of results) {
      emitRemoteAgentEvent(
        { actorId: "operator" },
        "remote-agent.pushed",
        result.agentId,
        result.deviceId,
        { previousHash: result.previousHash, newHash: result.newHash },
      );
    }
    context.logGateway.info(
      `remote agent pushed agent=${p.agentId} devices=${p.targetDeviceIds.join(",")}`,
    );
    respond(true, { results }, undefined);
  },

  "remote.agents.pull": ({ params, respond, context }) => {
    const p = params as {
      agentId?: string;
      deviceId?: string;
      config?: Record<string, unknown>;
    };
    if (!p.agentId || !p.deviceId || !p.config) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agentId, deviceId, and config are required"),
      );
      return;
    }
    const result = pullAgentState(p.agentId, p.deviceId, p.config);
    emitRemoteAgentEvent(
      { actorId: "operator" },
      "remote-agent.pulled",
      result.agentId,
      result.deviceId,
      { previousHash: result.previousHash, newHash: result.newHash },
    );
    context.logGateway.info(
      `remote agent pulled agent=${p.agentId} device=${p.deviceId}`,
    );
    respond(true, { result }, undefined);
  },

  "remote.agents.sync": ({ params, respond, context }) => {
    const p = params as {
      agentId?: string;
      deviceId?: string;
      direction?: "push" | "pull";
      config?: Record<string, unknown>;
    };
    if (!p.agentId || !p.deviceId || !p.direction || !p.config) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agentId, deviceId, direction, and config are required"),
      );
      return;
    }
    const result = syncAgent(p.agentId, p.deviceId, p.direction, p.config);
    emitRemoteAgentEvent(
      { actorId: "operator" },
      "remote-agent.synced",
      result.agentId,
      result.deviceId,
      { direction: p.direction, status: result.status },
    );
    context.logGateway.info(
      `remote agent synced agent=${p.agentId} device=${p.deviceId} direction=${p.direction}`,
    );
    respond(true, { result }, undefined);
  },

  "remote.agents.diff": ({ params, respond }) => {
    const p = params as {
      agentId?: string;
      sourceDeviceId?: string;
      targetDeviceId?: string;
      sourceConfig?: Record<string, unknown>;
      targetConfig?: Record<string, unknown>;
    };
    if (!p.agentId || !p.sourceDeviceId || !p.targetDeviceId || !p.sourceConfig || !p.targetConfig) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agentId, sourceDeviceId, targetDeviceId, sourceConfig, and targetConfig are required"),
      );
      return;
    }
    const result = diffAgentConfig(p.sourceConfig, p.targetConfig, {
      agentId: p.agentId,
      sourceDeviceId: p.sourceDeviceId,
      targetDeviceId: p.targetDeviceId,
    });
    respond(true, { result }, undefined);
  },

  "remote.agents.remove": ({ params, respond, context }) => {
    const p = params as { deviceId?: string; agentId?: string };
    if (!p.deviceId || !p.agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "deviceId and agentId are required"));
      return;
    }
    const removed = removeRemoteAgent(p.deviceId, p.agentId);
    if (!removed) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "remote agent not found"));
      return;
    }
    emitRemoteAgentEvent(
      { actorId: "operator" },
      "remote-agent.removed",
      p.agentId,
      p.deviceId,
    );
    context.logGateway.info(
      `remote agent removed agent=${p.agentId} device=${p.deviceId}`,
    );
    respond(true, { removed: true }, undefined);
  },

  "remote.agents.drift": ({ respond, context }) => {
    const drifted = detectDrift();
    if (drifted.length > 0) {
      for (const entry of drifted) {
        emitRemoteAgentEvent(
          { actorId: "system" },
          "remote-agent.drift_detected",
          entry.agentId,
          entry.deviceId,
          { configHash: entry.configHash },
        );
      }
      context.logGateway.info(`remote agent drift detected count=${drifted.length}`);
    }
    respond(true, { drifted, count: drifted.length }, undefined);
  },
};

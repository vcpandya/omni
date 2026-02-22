// ── Operator Management Gateway Handlers ────────────────────────

import {
  listOperators,
  getOperator,
  getOperatorByEmail,
  createOperator,
  updateOperator,
  deleteOperator,
  createInviteToken,
  redeemInvite,
} from "../../security/operator-store.js";
import { emitOperatorEvent } from "../../security/audit-trail-emitters.js";
import { loadConfig } from "../../config/config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const operatorHandlers: GatewayRequestHandlers = {
  "operators.list": ({ params, respond }) => {
    const p = params as { role?: string; disabled?: boolean };
    const filter: { role?: "admin" | "operator" | "viewer" | "auditor"; disabled?: boolean } = {};
    if (p.role && ["admin", "operator", "viewer", "auditor"].includes(p.role)) {
      filter.role = p.role as "admin" | "operator" | "viewer" | "auditor";
    }
    if (typeof p.disabled === "boolean") {
      filter.disabled = p.disabled;
    }
    const operators = listOperators(filter);
    respond(true, { operators }, undefined);
  },

  "operators.get": ({ params, respond }) => {
    const p = params as { id?: string; email?: string };
    if (!p.id && !p.email) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id or email is required"));
      return;
    }
    const operator = p.id ? getOperator(p.id) : getOperatorByEmail(p.email!);
    if (!operator) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "operator not found"));
      return;
    }
    respond(true, { operator }, undefined);
  },

  "operators.create": ({ params, respond, context }) => {
    const p = params as {
      email?: string;
      displayName?: string;
      role?: string;
      scopes?: string[];
    };
    if (!p.email?.trim()) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "email is required"));
      return;
    }
    if (!p.role || !["admin", "operator", "viewer", "auditor"].includes(p.role)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "valid role is required (admin|operator|viewer|auditor)"));
      return;
    }
    const cfg = loadConfig();
    const acl = cfg.security?.enterprise?.accessControl;
    const groupPolicy = cfg.security?.enterprise?.groupPolicy;

    const result = createOperator(
      {
        email: p.email,
        displayName: p.displayName,
        role: p.role as "admin" | "operator" | "viewer" | "auditor",
        createdBy: "operator",
      },
      acl,
      groupPolicy,
    );
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
      return;
    }
    emitOperatorEvent({ actorId: "operator" }, "operator.created", result.operator.id, {
      email: result.operator.email,
      role: result.operator.role,
    });
    context.logGateway.info(
      `operator created id=${result.operator.id} email=${result.operator.email} role=${result.operator.role}`,
    );
    respond(true, { operator: result.operator }, undefined);
  },

  "operators.update": ({ params, respond, context }) => {
    const p = params as {
      id?: string;
      displayName?: string;
      role?: string;
      scopes?: string[];
      disabled?: boolean;
    };
    if (!p.id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    if (p.role && !["admin", "operator", "viewer", "auditor"].includes(p.role)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid role"));
      return;
    }
    const cfg = loadConfig();
    const acl = cfg.security?.enterprise?.accessControl;
    const groupPolicy = cfg.security?.enterprise?.groupPolicy;

    const result = updateOperator(
      p.id,
      {
        displayName: p.displayName,
        role: p.role as "admin" | "operator" | "viewer" | "auditor" | undefined,
        disabled: p.disabled,
      },
      acl,
      groupPolicy,
    );
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
      return;
    }
    const action = p.disabled ? "operator.disabled" : "operator.updated";
    emitOperatorEvent({ actorId: "operator" }, action, result.operator.id, {
      role: result.operator.role,
      disabled: result.operator.disabled,
    });
    context.logGateway.info(
      `operator updated id=${result.operator.id} role=${result.operator.role}`,
    );
    respond(true, { operator: result.operator }, undefined);
  },

  "operators.delete": ({ params, respond, context }) => {
    const p = params as { id?: string; actorId?: string };
    if (!p.id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    const actorId = p.actorId ?? "operator";
    const result = deleteOperator(p.id, actorId);
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
      return;
    }
    emitOperatorEvent({ actorId }, "operator.deleted", result.deletedId);
    context.logGateway.info(`operator deleted id=${result.deletedId}`);
    respond(true, { deletedId: result.deletedId }, undefined);
  },

  "operators.invite": ({ params, respond, context }) => {
    const p = params as { email?: string; role?: string };
    if (!p.email?.trim()) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "email is required"));
      return;
    }
    if (!p.role || !["admin", "operator", "viewer", "auditor"].includes(p.role)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "valid role is required"));
      return;
    }
    const result = createInviteToken(
      p.email,
      p.role as "admin" | "operator" | "viewer" | "auditor",
      "operator",
    );
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
      return;
    }
    emitOperatorEvent({ actorId: "operator" }, "operator.invited", p.email, {
      role: p.role,
      expiresAt: result.expiresAt,
    });
    context.logGateway.info(`operator invite created for=${p.email} role=${p.role}`);
    respond(true, { token: result.token, expiresAt: result.expiresAt }, undefined);
  },

  "operators.redeem": ({ params, respond, context }) => {
    const p = params as { token?: string; displayName?: string };
    if (!p.token?.trim()) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "token is required"));
      return;
    }
    const cfg = loadConfig();
    const acl = cfg.security?.enterprise?.accessControl;
    const groupPolicy = cfg.security?.enterprise?.groupPolicy;

    const result = redeemInvite(p.token, p.displayName, acl, groupPolicy);
    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
      return;
    }
    emitOperatorEvent({ actorId: result.operator.email }, "operator.login", result.operator.id, {
      via: "invite",
    });
    context.logGateway.info(
      `operator invite redeemed id=${result.operator.id} email=${result.operator.email}`,
    );
    respond(true, { operator: result.operator }, undefined);
  },

  "operators.sessions": ({ params, respond }) => {
    const p = params as { operatorId?: string };
    if (!p.operatorId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "operatorId is required"));
      return;
    }
    const operator = getOperator(p.operatorId);
    if (!operator) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "operator not found"));
      return;
    }
    // Session tracking would integrate with the sessions subsystem.
    // For now, return operator info with placeholder sessions.
    respond(true, { operatorId: p.operatorId, sessions: [] }, undefined);
  },
};

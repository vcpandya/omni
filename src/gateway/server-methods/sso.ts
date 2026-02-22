// ── SSO Gateway Handlers ────────────────────────────────────────

import { processSsoCallback, validateSsoCallback, mapSsoAttributes } from "../../security/sso-provisioner.js";
import { emitSsoEvent } from "../../security/audit-trail-emitters.js";
import { loadConfig } from "../../config/config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";
import type { SsoCallback } from "../../security/sso-provisioner.types.js";

export const ssoHandlers: GatewayRequestHandlers = {
  "sso.callback": ({ params, respond, context }) => {
    const p = params as {
      provider?: string;
      subject?: string;
      email?: string;
      displayName?: string;
      groups?: string[];
      rawAttributes?: Record<string, string>;
    };
    if (!p.provider || !p.subject || !p.email) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "provider, subject, and email are required"),
      );
      return;
    }
    const cfg = loadConfig();
    const ssoConfig = cfg.security?.enterprise?.sso;
    if (!ssoConfig || ssoConfig.type === "none") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "SSO is not configured"));
      return;
    }

    const callback: SsoCallback = {
      provider: p.provider as "saml" | "oidc",
      subject: p.subject,
      email: p.email,
      displayName: p.displayName,
      groups: p.groups,
      rawAttributes: p.rawAttributes,
    };

    const acl = cfg.security?.enterprise?.accessControl;
    const groupPolicy = cfg.security?.enterprise?.groupPolicy;

    const result = processSsoCallback(callback, ssoConfig, acl, groupPolicy);
    if (!result.ok) {
      emitSsoEvent({ actorId: p.email }, "sso.failure", {
        provider: p.provider,
        error: result.error,
      });
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
      return;
    }

    emitSsoEvent(
      { actorId: result.result.operator.email },
      result.result.action === "created" ? "sso.provisioned" : "sso.login",
      {
        provider: p.provider,
        operatorId: result.result.operator.id,
        action: result.result.action,
      },
    );
    context.logGateway.info(
      `sso callback processed email=${p.email} action=${result.result.action}`,
    );
    respond(true, result.result, undefined);
  },

  "sso.status": ({ respond }) => {
    const cfg = loadConfig();
    const ssoConfig = cfg.security?.enterprise?.sso;
    respond(
      true,
      {
        configured: !!ssoConfig && ssoConfig.type !== "none",
        type: ssoConfig?.type ?? "none",
        displayName: ssoConfig?.displayName,
        autoProvision: ssoConfig?.autoProvision ?? false,
        enforced: ssoConfig?.enforced ?? false,
      },
      undefined,
    );
  },

  "sso.test": ({ params, respond }) => {
    const p = params as { rawAttributes?: Record<string, string> };
    const cfg = loadConfig();
    const ssoConfig = cfg.security?.enterprise?.sso;
    if (!ssoConfig || ssoConfig.type === "none") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "SSO is not configured"));
      return;
    }
    if (!p.rawAttributes) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "rawAttributes is required for dry-run"));
      return;
    }
    const mapped = mapSsoAttributes(p.rawAttributes, ssoConfig.attributeMapping);
    const testCallback: SsoCallback = {
      provider: ssoConfig.type as "saml" | "oidc",
      subject: "test-subject",
      email: mapped.email ?? "test@example.com",
      displayName: mapped.displayName,
      groups: mapped.groups,
      rawAttributes: p.rawAttributes,
    };
    const validation = validateSsoCallback(testCallback, ssoConfig);
    respond(
      true,
      {
        dryRun: true,
        mappedAttributes: mapped,
        validation,
        wouldProvision: ssoConfig.autoProvision && validation.valid,
      },
      undefined,
    );
  },
};

// ── SSO Provisioner — Auto-provision operators from SSO callbacks ──

import { resolveEffectiveScopesForRole } from "./admin-profile.js";
import {
  createOperator,
  getOperatorByEmail,
  updateOperator,
  recordOperatorLogin,
} from "./operator-store.js";
import type { SsoProviderConfig, GroupPolicyConfig, AccessControlMatrix } from "../config/types.admin.js";
import type {
  SsoCallback,
  SsoProvisionResult,
  SsoValidationResult,
} from "./sso-provisioner.types.js";

// ── Validation ─────────────────────────────────────────────────

export function validateSsoCallback(
  callback: SsoCallback,
  ssoConfig: SsoProviderConfig,
): SsoValidationResult {
  if (!callback.subject?.trim()) {
    return { valid: false, error: "SSO subject is required." };
  }
  if (!callback.email?.trim()) {
    return { valid: false, error: "SSO email is required." };
  }
  if (callback.provider !== ssoConfig.type && ssoConfig.type !== "none") {
    return { valid: false, error: `SSO provider mismatch: expected "${ssoConfig.type}", got "${callback.provider}".` };
  }
  return { valid: true };
}

// ── Attribute Mapping ──────────────────────────────────────────

export function mapSsoAttributes(
  rawAttributes: Record<string, string>,
  attributeMapping?: SsoProviderConfig["attributeMapping"],
): { email?: string; displayName?: string; groups?: string[] } {
  const mapping = attributeMapping ?? { email: "email", displayName: "name", groups: "groups" };
  const result: { email?: string; displayName?: string; groups?: string[] } = {};

  if (mapping.email && rawAttributes[mapping.email]) {
    result.email = rawAttributes[mapping.email];
  }
  if (mapping.displayName && rawAttributes[mapping.displayName]) {
    result.displayName = rawAttributes[mapping.displayName];
  }
  if (mapping.groups && rawAttributes[mapping.groups]) {
    const groupsRaw = rawAttributes[mapping.groups];
    result.groups = groupsRaw.split(",").map((g) => g.trim()).filter(Boolean);
  }

  return result;
}

// ── Core Provisioning ──────────────────────────────────────────

export function processSsoCallback(
  callback: SsoCallback,
  ssoConfig: SsoProviderConfig,
  acl?: AccessControlMatrix,
  groupPolicy?: GroupPolicyConfig,
  storePath?: string,
): { ok: true; result: SsoProvisionResult } | { ok: false; error: string } {
  // 1. Validate callback
  const validation = validateSsoCallback(callback, ssoConfig);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  // 2. Look up existing operator
  const existing = getOperatorByEmail(callback.email, storePath);

  if (existing) {
    // 3a. Existing operator — update groups and record login
    const groupsChanged = hasGroupsChanged(existing.groupMembership, callback.groups);

    if (groupsChanged || callback.displayName) {
      const newScopes = resolveEffectiveScopesForRole(
        existing.role,
        acl,
        groupPolicy,
        callback.groups,
      );

      const updateResult = updateOperator(
        existing.id,
        {
          displayName: callback.displayName ?? existing.displayName,
          groupMembership: callback.groups,
          scopes: newScopes,
        },
        acl,
        groupPolicy,
        storePath,
      );

      if (!updateResult.ok) {
        return { ok: false, error: updateResult.error };
      }

      recordOperatorLogin(existing.id, storePath);
      return {
        ok: true,
        result: {
          operator: updateResult.operator,
          action: "updated",
          groupsChanged,
        },
      };
    }

    recordOperatorLogin(existing.id, storePath);
    return {
      ok: true,
      result: { operator: existing, action: "login_only" },
    };
  }

  // 3b. New operator — auto-provision if enabled
  if (!ssoConfig.autoProvision) {
    return { ok: false, error: "Auto-provisioning is disabled and no matching operator found." };
  }

  const defaultRole = acl?.defaultRole ?? "viewer";
  const createResult = createOperator(
    {
      email: callback.email,
      displayName: callback.displayName,
      role: defaultRole,
      createdBy: "sso-provisioner",
      ssoSubject: callback.subject,
      groupMembership: callback.groups,
    },
    acl,
    groupPolicy,
    storePath,
  );

  if (!createResult.ok) {
    return { ok: false, error: createResult.error };
  }

  recordOperatorLogin(createResult.operator.id, storePath);
  return {
    ok: true,
    result: {
      operator: createResult.operator,
      action: "created",
      groupsChanged: false,
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────

function hasGroupsChanged(
  existing?: string[],
  incoming?: string[],
): boolean {
  if (!existing && !incoming) return false;
  if (!existing || !incoming) return true;
  if (existing.length !== incoming.length) return true;
  const sorted1 = [...existing].sort();
  const sorted2 = [...incoming].sort();
  return sorted1.some((g, i) => g !== sorted2[i]);
}

// ── Enterprise Admin Profile Management ─────────────────────────

import type { OpenClawConfig } from "../config/config.js";
import {
  ADMIN_SCOPE,
  APPROVALS_SCOPE,
  type OperatorScope,
  PAIRING_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
} from "../gateway/method-scopes.js";
import type {
  AccessControlEntry,
  AccessControlMatrix,
  AccessControlRole,
  AdminProfile,
  EnterpriseAdminConfig,
  GroupPolicyConfig,
  GroupPolicyRule,
  SsoProviderConfig,
} from "../config/types.admin.js";

// ---------------------------------------------------------------------------
// Default ACL matrix
// ---------------------------------------------------------------------------

/** Frozen default ACL entries — never mutate these directly. */
const DEFAULT_ACL_ENTRIES: Readonly<Record<AccessControlRole, Readonly<AccessControlEntry>>> = Object.freeze({
  admin: Object.freeze({
    role: "admin" as const,
    scopes: Object.freeze([ADMIN_SCOPE, APPROVALS_SCOPE, PAIRING_SCOPE, READ_SCOPE, WRITE_SCOPE]) as unknown as OperatorScope[],
    requireDeviceTrust: false,
  }),
  operator: Object.freeze({
    role: "operator" as const,
    scopes: Object.freeze([APPROVALS_SCOPE, PAIRING_SCOPE, READ_SCOPE, WRITE_SCOPE]) as unknown as OperatorScope[],
    requireDeviceTrust: false,
  }),
  viewer: Object.freeze({
    role: "viewer" as const,
    scopes: Object.freeze([READ_SCOPE]) as unknown as OperatorScope[],
    deniedMethods: Object.freeze(["config.set", "config.delete"]) as unknown as string[],
    requireDeviceTrust: false,
  }),
  auditor: Object.freeze({
    role: "auditor" as const,
    scopes: Object.freeze([READ_SCOPE]) as unknown as OperatorScope[],
    allowedMethodPrefixes: Object.freeze(["audit.", "health", "status"]) as unknown as string[],
    maxSessionHours: 8,
    requireDeviceTrust: true,
  }),
});

// ---------------------------------------------------------------------------
// Create admin profile
// ---------------------------------------------------------------------------

export function createAdminProfile(params: {
  email: string;
  displayName?: string;
}): AdminProfile {
  return {
    email: params.email,
    displayName: params.displayName,
    role: "admin",
    scopes: [ADMIN_SCOPE, APPROVALS_SCOPE, PAIRING_SCOPE, READ_SCOPE, WRITE_SCOPE],
    createdAt: Date.now(),
    canConfigureSso: true,
    canManageGroupPolicy: true,
    canPushToDevices: true,
  };
}

// ---------------------------------------------------------------------------
// Create default ACL matrix
// ---------------------------------------------------------------------------

export function createDefaultAccessControlMatrix(): AccessControlMatrix {
  return {
    roles: {
      admin: { ...DEFAULT_ACL_ENTRIES.admin, scopes: [...DEFAULT_ACL_ENTRIES.admin.scopes] },
      operator: { ...DEFAULT_ACL_ENTRIES.operator, scopes: [...DEFAULT_ACL_ENTRIES.operator.scopes] },
      viewer: { ...DEFAULT_ACL_ENTRIES.viewer, scopes: [...DEFAULT_ACL_ENTRIES.viewer.scopes] },
      auditor: { ...DEFAULT_ACL_ENTRIES.auditor, scopes: [...DEFAULT_ACL_ENTRIES.auditor.scopes] },
    },
    defaultRole: "viewer",
  };
}

// ---------------------------------------------------------------------------
// Create SSO placeholder config
// ---------------------------------------------------------------------------

export function createSsoPlaceholder(params: {
  type: "saml" | "oidc" | "none";
  displayName?: string;
}): SsoProviderConfig {
  return {
    type: params.type,
    displayName: params.displayName,
    autoProvision: params.type !== "none",
    enforced: false,
    attributeMapping: {
      email: "email",
      displayName: "name",
      groups: "groups",
      role: "role",
    },
  };
}

// ---------------------------------------------------------------------------
// Create group policy from rule list
// ---------------------------------------------------------------------------

export function createGroupPolicy(rules: GroupPolicyRule[]): GroupPolicyConfig {
  return {
    rules,
    syncIntervalMinutes: 60,
    autoRevoke: true,
  };
}

// ---------------------------------------------------------------------------
// Apply enterprise admin config to OpenClawConfig
// ---------------------------------------------------------------------------

export function applyEnterpriseAdminConfig(
  config: OpenClawConfig,
  enterprise: EnterpriseAdminConfig,
): OpenClawConfig {
  return {
    ...config,
    security: {
      ...config.security,
      enterprise: {
        ...config.security?.enterprise,
        ...enterprise,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Resolve effective scopes for a role (including group policy overrides)
// ---------------------------------------------------------------------------

export function resolveEffectiveScopesForRole(
  role: AccessControlRole,
  acl?: AccessControlMatrix,
  groupPolicy?: GroupPolicyConfig,
  userGroups?: string[],
): OperatorScope[] {
  const entry = acl?.roles[role] ?? DEFAULT_ACL_ENTRIES[role];
  if (!entry) return [];

  const scopes = new Set<OperatorScope>(entry.scopes);

  // Add scopes from group policy if user groups are known
  if (groupPolicy && userGroups) {
    for (const rule of groupPolicy.rules) {
      if (userGroups.includes(rule.groupName) && rule.additionalScopes) {
        for (const scope of rule.additionalScopes) {
          // Only add validated scopes to prevent injection of arbitrary scope strings
          if (isValidScope(scope)) {
            scopes.add(scope);
          }
        }
      }
    }
  }

  return [...scopes];
}

// ---------------------------------------------------------------------------
// Validate admin profile
// ---------------------------------------------------------------------------

/** Basic email format check (RFC 5321 local-part@domain). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** All known valid scope values for fast validation. */
const VALID_SCOPES: ReadonlySet<OperatorScope> = new Set([
  ADMIN_SCOPE,
  APPROVALS_SCOPE,
  PAIRING_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
]);

export function validateAdminProfile(
  profile: AdminProfile,
): { valid: true } | { valid: false; error: string } {
  if (!profile.email?.trim()) {
    return { valid: false, error: "Admin email is required." };
  }
  if (!EMAIL_RE.test(profile.email.trim())) {
    return { valid: false, error: "Invalid email format." };
  }
  if (profile.email.length > 320) {
    return { valid: false, error: "Email address too long." };
  }
  if (profile.role !== "admin") {
    return { valid: false, error: "Initial admin must have 'admin' role." };
  }
  if (!profile.scopes.includes(ADMIN_SCOPE)) {
    return { valid: false, error: "Admin must have operator.admin scope." };
  }
  return { valid: true };
}

/** Validate that a scope string is a known OperatorScope. */
export function isValidScope(scope: string): scope is OperatorScope {
  return VALID_SCOPES.has(scope as OperatorScope);
}

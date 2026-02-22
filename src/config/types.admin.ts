// ── Enterprise Admin & Access Control Configuration Types ────────

import type { OperatorScope } from "../gateway/method-scopes.js";

// ---------------------------------------------------------------------------
// SSO Provider Configuration
// ---------------------------------------------------------------------------

export type SsoProviderType = "saml" | "oidc" | "none";

export type SsoProviderConfig = {
  type: SsoProviderType;
  /** Display label for the SSO provider (e.g. "Okta", "Azure AD", "Google Workspace"). */
  displayName?: string;
  /** SAML/OIDC metadata URL or issuer. */
  metadataUrl?: string;
  /** OIDC client ID. */
  clientId?: string;
  /** OIDC client secret (stored encrypted in auth-profiles). */
  clientSecret?: string;
  /** SAML entity ID. */
  entityId?: string;
  /** Attribute mapping: SSO claim → internal field. */
  attributeMapping?: {
    email?: string;
    displayName?: string;
    groups?: string;
    role?: string;
  };
  /** Whether to auto-provision users on first SSO login. */
  autoProvision?: boolean;
  /** Whether to enforce SSO for all operator logins (disables token/password). */
  enforced?: boolean;
};

// ---------------------------------------------------------------------------
// Access Control Roles & ACL Matrix
// ---------------------------------------------------------------------------

export type AccessControlRole = "admin" | "operator" | "viewer" | "auditor";

export type AccessControlEntry = {
  role: AccessControlRole;
  scopes: OperatorScope[];
  /** Optional: restrict to specific method prefixes beyond scope check. */
  allowedMethodPrefixes?: string[];
  /** Optional: deny specific methods even if scope allows. */
  deniedMethods?: string[];
  /** Maximum session duration in hours. */
  maxSessionHours?: number;
  /** Require MFA/device trust for this role. */
  requireDeviceTrust?: boolean;
};

export type AccessControlMatrix = {
  roles: Record<AccessControlRole, AccessControlEntry>;
  /** Default role for new users (auto-provisioned via SSO). */
  defaultRole?: AccessControlRole;
};

// ---------------------------------------------------------------------------
// Group Policy
// ---------------------------------------------------------------------------

export type GroupPolicyRule = {
  /** SSO group name (e.g. "engineering", "security-team"). */
  groupName: string;
  /** Role assigned to members of this group. */
  role: AccessControlRole;
  /** Additional scopes beyond the role's default. */
  additionalScopes?: OperatorScope[];
  /** Override: restrict channels for this group. */
  allowedChannels?: string[];
};

export type GroupPolicyConfig = {
  rules: GroupPolicyRule[];
  /** Sync interval in minutes (how often to refresh group membership from SSO). */
  syncIntervalMinutes?: number;
  /** Whether to remove role when user is removed from SSO group. */
  autoRevoke?: boolean;
};

// ---------------------------------------------------------------------------
// Admin Profile (the initial admin created during onboarding)
// ---------------------------------------------------------------------------

export type AdminProfile = {
  /** Admin's email (used as identity for audit trail). */
  email: string;
  /** Display name. */
  displayName?: string;
  /** Role — always "admin" for the initial profile. */
  role: "admin";
  /** Scopes granted to this admin. */
  scopes: OperatorScope[];
  /** Timestamp of creation. */
  createdAt: number;
  /** Whether this admin can configure SSO. */
  canConfigureSso: boolean;
  /** Whether this admin can manage group policies. */
  canManageGroupPolicy: boolean;
  /** Whether this admin can push policies to devices. */
  canPushToDevices: boolean;
};

// ---------------------------------------------------------------------------
// Device Policy Push
// ---------------------------------------------------------------------------

export type DevicePolicyPushConfig = {
  enabled?: boolean;
  /** Auto-push on config change. */
  autoPush?: boolean;
  /** Require device trust check before accepting push. */
  requireDeviceTrust?: boolean;
  /** Policy fields to push (allow partial pushes). */
  pushFields?: Array<
    "security" | "compliance" | "tools" | "channels" | "accessControl"
  >;
};

// ---------------------------------------------------------------------------
// Top-level Enterprise Admin Config
// ---------------------------------------------------------------------------

export type EnterpriseAdminConfig = {
  adminProfile?: AdminProfile;
  sso?: SsoProviderConfig;
  accessControl?: AccessControlMatrix;
  groupPolicy?: GroupPolicyConfig;
  devicePolicyPush?: DevicePolicyPushConfig;
};

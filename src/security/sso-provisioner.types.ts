// ── SSO Provisioner Types ────────────────────────────────────────

import type { OperatorRecord } from "./operator-store.types.js";

export type SsoCallbackProvider = "saml" | "oidc";

export type SsoCallback = {
  provider: SsoCallbackProvider;
  subject: string;
  email: string;
  displayName?: string;
  groups?: string[];
  rawAttributes?: Record<string, string>;
};

export type SsoProvisionResult = {
  operator: OperatorRecord;
  action: "created" | "updated" | "login_only";
  groupsChanged?: boolean;
};

export type SsoValidationResult =
  | { valid: true }
  | { valid: false; error: string };

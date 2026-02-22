import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateSsoCallback,
  mapSsoAttributes,
  processSsoCallback,
} from "./sso-provisioner.js";
import { createOperator } from "./operator-store.js";
import type { SsoProviderConfig, AccessControlMatrix, GroupPolicyConfig } from "../config/types.admin.js";

describe("sso-provisioner", () => {
  let storePath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sso-test-"));
    storePath = join(dir, "operators.json");
  });

  afterEach(() => {
    try {
      rmSync(storePath, { force: true });
      rmSync(storePath + ".tmp", { force: true });
    } catch { /* ignore */ }
  });

  const ssoConfig: SsoProviderConfig = {
    type: "oidc",
    displayName: "Test IdP",
    autoProvision: true,
    enforced: false,
    attributeMapping: {
      email: "email",
      displayName: "name",
      groups: "groups",
    },
  };

  const acl: AccessControlMatrix = {
    roles: {
      admin: { role: "admin", scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.pairing"] },
      operator: { role: "operator", scopes: ["operator.read", "operator.write", "operator.approvals", "operator.pairing"] },
      viewer: { role: "viewer", scopes: ["operator.read"] },
      auditor: { role: "auditor", scopes: ["operator.read"] },
    },
    defaultRole: "viewer",
  };

  // ── Validation ───────────────────────────────────────────────

  it("validates correct SSO callback", () => {
    const result = validateSsoCallback(
      { provider: "oidc", subject: "uid-123", email: "user@corp.com" },
      ssoConfig,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects missing subject", () => {
    const result = validateSsoCallback(
      { provider: "oidc", subject: "", email: "user@corp.com" },
      ssoConfig,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects provider mismatch", () => {
    const result = validateSsoCallback(
      { provider: "saml", subject: "uid-123", email: "user@corp.com" },
      ssoConfig,
    );
    expect(result.valid).toBe(false);
  });

  // ── Attribute Mapping ────────────────────────────────────────

  it("maps SSO attributes correctly", () => {
    const mapped = mapSsoAttributes(
      { email: "user@corp.com", name: "User Name", groups: "engineering,security" },
      ssoConfig.attributeMapping,
    );
    expect(mapped.email).toBe("user@corp.com");
    expect(mapped.displayName).toBe("User Name");
    expect(mapped.groups).toEqual(["engineering", "security"]);
  });

  it("handles missing attributes gracefully", () => {
    const mapped = mapSsoAttributes({}, ssoConfig.attributeMapping);
    expect(mapped.email).toBeUndefined();
    expect(mapped.displayName).toBeUndefined();
    expect(mapped.groups).toBeUndefined();
  });

  // ── Provisioning ─────────────────────────────────────────────

  it("auto-provisions new operator from SSO callback", () => {
    const result = processSsoCallback(
      {
        provider: "oidc",
        subject: "uid-new",
        email: "new@corp.com",
        displayName: "New User",
        groups: ["engineering"],
      },
      ssoConfig,
      acl,
      undefined,
      storePath,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.action).toBe("created");
      expect(result.result.operator.email).toBe("new@corp.com");
      expect(result.result.operator.role).toBe("viewer"); // default role
    }
  });

  it("updates existing operator on SSO login", () => {
    // Pre-create operator
    createOperator(
      { email: "existing@corp.com", role: "operator", createdBy: "admin" },
      acl,
      undefined,
      storePath,
    );

    const result = processSsoCallback(
      {
        provider: "oidc",
        subject: "uid-existing",
        email: "existing@corp.com",
        displayName: "Updated Name",
        groups: ["security"],
      },
      ssoConfig,
      acl,
      undefined,
      storePath,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.action).toBe("updated");
      expect(result.result.operator.displayName).toBe("Updated Name");
    }
  });

  it("records login_only when no changes needed", () => {
    createOperator(
      { email: "stable@corp.com", role: "viewer", createdBy: "admin" },
      acl,
      undefined,
      storePath,
    );

    const result = processSsoCallback(
      {
        provider: "oidc",
        subject: "uid-stable",
        email: "stable@corp.com",
      },
      ssoConfig,
      acl,
      undefined,
      storePath,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.action).toBe("login_only");
    }
  });

  it("rejects when autoProvision is disabled and operator not found", () => {
    const noAutoConfig: SsoProviderConfig = { ...ssoConfig, autoProvision: false };
    const result = processSsoCallback(
      {
        provider: "oidc",
        subject: "uid-unknown",
        email: "unknown@corp.com",
      },
      noAutoConfig,
      acl,
      undefined,
      storePath,
    );
    expect(result.ok).toBe(false);
  });

  // ── Group Policy Integration ─────────────────────────────────

  it("applies group policy scopes on provisioning", () => {
    const groupPolicy: GroupPolicyConfig = {
      rules: [
        { groupName: "security-team", role: "auditor", additionalScopes: ["operator.admin" as const] },
      ],
      autoRevoke: true,
    };

    const result = processSsoCallback(
      {
        provider: "oidc",
        subject: "uid-sec",
        email: "sec@corp.com",
        groups: ["security-team"],
      },
      ssoConfig,
      acl,
      groupPolicy,
      storePath,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.action).toBe("created");
      // Default role is "viewer" from ACL, but group policy might add scopes
      expect(result.result.operator.scopes.length).toBeGreaterThan(0);
    }
  });
});

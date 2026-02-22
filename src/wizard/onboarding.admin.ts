// ── Enterprise Admin Profile Onboarding Step ────────────────────

import type { OpenClawConfig } from "../config/config.js";
import type {
  AccessControlRole,
  GroupPolicyRule,
  SsoProviderType,
} from "../config/types.admin.js";
import {
  applyEnterpriseAdminConfig,
  createAdminProfile,
  createDefaultAccessControlMatrix,
  createGroupPolicy,
  createSsoPlaceholder,
} from "../security/admin-profile.js";
import type { WizardPrompter } from "./prompts.js";

// ---------------------------------------------------------------------------
// Main entry — called from onboarding.security.ts after compliance profile
// ---------------------------------------------------------------------------

export async function promptAdminProfile(params: {
  config: OpenClawConfig;
  prompter: WizardPrompter;
}): Promise<OpenClawConfig> {
  const { prompter } = params;
  let config = params.config;

  // ── Step 1: Ask if they want enterprise admin setup ──
  const setupAdmin = await prompter.confirm({
    message: "Set up an admin profile? (recommended for enterprise/team use)",
    initialValue: true,
  });

  if (!setupAdmin) {
    return config;
  }

  await prompter.note(
    [
      "Enterprise admin profile setup:",
      "",
      "1. Create your admin account (first admin)",
      "2. Optionally configure SSO for team login",
      "3. Set up access control roles and permissions",
      "4. Optionally configure group policies from your IdP",
      "5. Enable device policy push for managed fleet",
    ].join("\n"),
    "Admin Profile",
  );

  // ── Step 2: Admin identity ──
  const email = await prompter.text({
    message: "Admin email address",
    placeholder: "admin@company.com",
    validate: (v) => {
      const trimmed = v.trim();
      if (!trimmed) return "Email is required";
      if (!trimmed.includes("@")) return "Enter a valid email address";
      return undefined;
    },
  });

  const displayName = await prompter.text({
    message: "Display name (optional)",
    placeholder: "Platform Admin",
    initialValue: "",
  });

  const adminProfile = createAdminProfile({
    email: email.trim(),
    displayName: displayName.trim() || undefined,
  });

  config = applyEnterpriseAdminConfig(config, { adminProfile });

  await prompter.note(
    [
      `Admin: ${adminProfile.email}`,
      `Role: ${adminProfile.role}`,
      `Scopes: ${adminProfile.scopes.join(", ")}`,
      "",
      "This admin has full control over configuration, approvals,",
      "device pairing, SSO, group policies, and device push.",
    ].join("\n"),
    "Admin Profile Created",
  );

  // ── Step 3: SSO configuration ──
  const configureSso = await prompter.confirm({
    message: "Configure SSO for team authentication?",
    initialValue: false,
  });

  if (configureSso) {
    config = await promptSsoConfig(config, prompter);
  }

  // ── Step 4: Access control matrix ──
  const configureAcl = await prompter.confirm({
    message: "Set up access control roles and permissions?",
    initialValue: true,
  });

  if (configureAcl) {
    config = await promptAccessControl(config, prompter);
  }

  // ── Step 5: Group policy ──
  const configureGroupPolicy = await prompter.confirm({
    message: "Configure group policy rules? (maps SSO groups → roles)",
    initialValue: configureSso,
  });

  if (configureGroupPolicy) {
    config = await promptGroupPolicy(config, prompter);
  }

  // ── Step 6: Device policy push ──
  const configureDevicePush = await prompter.confirm({
    message: "Enable device policy push? (push configs to managed devices)",
    initialValue: false,
  });

  if (configureDevicePush) {
    config = applyEnterpriseAdminConfig(config, {
      devicePolicyPush: {
        enabled: true,
        autoPush: true,
        requireDeviceTrust: true,
        pushFields: ["security", "compliance", "accessControl"],
      },
    });
    await prompter.note(
      [
        "Device policy push enabled.",
        "",
        "When you change security settings, compliance profiles, or access",
        "control rules, they will be automatically pushed to all trusted devices.",
        "",
        "Devices must pass trust verification before accepting policy updates.",
        "Manage devices: omni devices list / omni devices push",
      ].join("\n"),
      "Device Policy Push",
    );
  }

  return config;
}

// ---------------------------------------------------------------------------
// SSO sub-flow
// ---------------------------------------------------------------------------

async function promptSsoConfig(
  config: OpenClawConfig,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  await prompter.note(
    [
      "SSO integration allows your team to log in with their corporate",
      "identity provider. Supported protocols:",
      "",
      "  SAML 2.0 — Okta, Azure AD, OneLogin, PingIdentity",
      "  OIDC      — Google Workspace, Auth0, Keycloak",
      "",
      "You can configure the full connection now or set up a placeholder",
      "and complete it later via `omni configure --section sso`.",
    ].join("\n"),
    "SSO Configuration",
  );

  const ssoType = await prompter.select<SsoProviderType>({
    message: "SSO protocol",
    options: [
      { value: "oidc", label: "OIDC (OpenID Connect)", hint: "Google, Auth0, Keycloak" },
      { value: "saml", label: "SAML 2.0", hint: "Okta, Azure AD, OneLogin" },
      { value: "none", label: "Skip for now", hint: "Configure later" },
    ],
  });

  if (ssoType === "none") {
    return applyEnterpriseAdminConfig(config, {
      sso: createSsoPlaceholder({ type: "none" }),
    });
  }

  const displayName = await prompter.text({
    message: "Identity provider name",
    placeholder: ssoType === "oidc" ? "Google Workspace" : "Okta",
  });

  const sso = createSsoPlaceholder({ type: ssoType, displayName: displayName.trim() });

  if (ssoType === "oidc") {
    const clientId = await prompter.text({
      message: "OIDC Client ID (leave blank to configure later)",
      placeholder: "your-client-id.apps.googleusercontent.com",
      initialValue: "",
    });
    if (clientId.trim()) {
      sso.clientId = clientId.trim();
    }

    const metadataUrl = await prompter.text({
      message: "OIDC Discovery URL (leave blank to configure later)",
      placeholder: "https://accounts.google.com/.well-known/openid-configuration",
      initialValue: "",
    });
    if (metadataUrl.trim()) {
      sso.metadataUrl = metadataUrl.trim();
    }
  } else {
    const entityId = await prompter.text({
      message: "SAML Entity ID / Issuer (leave blank to configure later)",
      placeholder: "https://idp.example.com/metadata",
      initialValue: "",
    });
    if (entityId.trim()) {
      sso.entityId = entityId.trim();
    }

    const metadataUrl = await prompter.text({
      message: "SAML Metadata URL (leave blank to configure later)",
      placeholder: "https://idp.example.com/app/sso/saml/metadata",
      initialValue: "",
    });
    if (metadataUrl.trim()) {
      sso.metadataUrl = metadataUrl.trim();
    }
  }

  const enforced = await prompter.confirm({
    message: "Enforce SSO for all logins? (disables token/password auth)",
    initialValue: false,
  });
  sso.enforced = enforced;

  config = applyEnterpriseAdminConfig(config, { sso });

  const status = sso.clientId || sso.entityId ? "Configured" : "Placeholder";
  await prompter.note(
    [
      `SSO: ${status} (${sso.displayName ?? ssoType.toUpperCase()})`,
      `Protocol: ${ssoType.toUpperCase()}`,
      `Auto-provision: ${sso.autoProvision ? "Yes" : "No"}`,
      `Enforced: ${sso.enforced ? "Yes" : "No"}`,
      "",
      status === "Placeholder"
        ? "Complete SSO setup: omni configure --section sso"
        : "SSO is ready. Test with: omni sso test",
    ].join("\n"),
    "SSO Status",
  );

  return config;
}

// ---------------------------------------------------------------------------
// Access control sub-flow
// ---------------------------------------------------------------------------

async function promptAccessControl(
  config: OpenClawConfig,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  await prompter.note(
    [
      "Access control defines what each role can do.",
      "",
      "  Admin    — Full control: config, SSO, devices, approvals",
      "  Operator — Day-to-day: send messages, manage sessions, approve actions",
      "  Viewer   — Read-only: monitor status, view logs, read sessions",
      "  Auditor  — Audit access: query audit trail, verify integrity",
      "",
      "You can customize role permissions or use the defaults.",
    ].join("\n"),
    "Access Control Matrix",
  );

  const useDefaults = await prompter.confirm({
    message: "Use default role permissions?",
    initialValue: true,
  });

  const acl = createDefaultAccessControlMatrix();

  if (!useDefaults) {
    // Let admin customize the default role for SSO-provisioned users
    const defaultRole = await prompter.select<AccessControlRole>({
      message: "Default role for new SSO users",
      options: [
        { value: "viewer", label: "Viewer", hint: "Read-only — safest default" },
        { value: "operator", label: "Operator", hint: "Can send messages and manage sessions" },
        { value: "auditor", label: "Auditor", hint: "Audit trail access only" },
      ],
      initialValue: "viewer",
    });
    acl.defaultRole = defaultRole;

    // Allow customizing device trust requirements per role
    const requireDeviceTrust = await prompter.confirm({
      message: "Require device trust for all roles? (MDM, disk encryption, etc.)",
      initialValue: false,
    });

    if (requireDeviceTrust) {
      for (const entry of Object.values(acl.roles)) {
        entry.requireDeviceTrust = true;
      }
    }
  }

  config = applyEnterpriseAdminConfig(config, { accessControl: acl });

  const roleLines = Object.entries(acl.roles).map(
    ([role, entry]) =>
      `  ${role.padEnd(10)} ${entry.scopes.length} scope(s)${entry.requireDeviceTrust ? "  [device trust required]" : ""}`,
  );
  await prompter.note(
    [
      `Default role: ${acl.defaultRole ?? "viewer"}`,
      "",
      ...roleLines,
      "",
      "Customize roles later: omni configure --section access-control",
    ].join("\n"),
    "Access Control Applied",
  );

  return config;
}

// ---------------------------------------------------------------------------
// Group policy sub-flow
// ---------------------------------------------------------------------------

async function promptGroupPolicy(
  config: OpenClawConfig,
  prompter: WizardPrompter,
): Promise<OpenClawConfig> {
  await prompter.note(
    [
      "Group policies map SSO/IdP groups to Omni roles.",
      "",
      "When a user logs in via SSO, their group memberships determine",
      "their role and permissions. You can add rules now or import",
      "them later from a JSON file.",
      "",
      "Example rules:",
      '  "platform-admins"  → admin',
      '  "engineering"      → operator',
      '  "security-team"    → auditor',
    ].join("\n"),
    "Group Policy",
  );

  const importOrCreate = await prompter.select({
    message: "Group policy setup method",
    options: [
      { value: "create", label: "Create rules now", hint: "Add group → role mappings interactively" },
      { value: "import", label: "Import from file later", hint: "Load from JSON via omni configure" },
      { value: "skip", label: "Skip", hint: "No group policies for now" },
    ],
  });

  if (importOrCreate === "skip") {
    return config;
  }

  if (importOrCreate === "import") {
    await prompter.note(
      [
        "Import group policies after onboarding:",
        "",
        "  omni configure --section group-policy --import policy.json",
        "",
        "JSON format:",
        "  {",
        '    "rules": [',
        '      { "groupName": "admins", "role": "admin" },',
        '      { "groupName": "devs", "role": "operator" }',
        "    ]",
        "  }",
      ].join("\n"),
      "Import Instructions",
    );
    return config;
  }

  // Interactive rule creation
  const rules: GroupPolicyRule[] = [];
  let addMore = true;

  while (addMore) {
    const groupName = await prompter.text({
      message: `Group name (rule ${rules.length + 1})`,
      placeholder: "e.g. platform-admins, engineering",
      validate: (v) => (v.trim() ? undefined : "Group name is required"),
    });

    const role = await prompter.select<AccessControlRole>({
      message: `Role for "${groupName.trim()}"`,
      options: [
        { value: "admin", label: "Admin" },
        { value: "operator", label: "Operator" },
        { value: "viewer", label: "Viewer" },
        { value: "auditor", label: "Auditor" },
      ],
    });

    rules.push({ groupName: groupName.trim(), role });

    addMore = await prompter.confirm({
      message: "Add another group → role mapping?",
      initialValue: rules.length < 3,
    });
  }

  if (rules.length > 0) {
    const groupPolicy = createGroupPolicy(rules);
    config = applyEnterpriseAdminConfig(config, { groupPolicy });

    const ruleLines = rules.map((r) => `  ${r.groupName.padEnd(20)} → ${r.role}`);
    await prompter.note(
      [
        `${rules.length} group policy rule(s) configured:`,
        "",
        ...ruleLines,
        "",
        `Auto-revoke: ${groupPolicy.autoRevoke ? "Yes" : "No"}`,
        `Sync interval: ${groupPolicy.syncIntervalMinutes} min`,
      ].join("\n"),
      "Group Policy Applied",
    );
  }

  return config;
}

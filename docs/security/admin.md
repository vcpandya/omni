# Admin Profiles and RBAC

Omni supports role-based access control (RBAC) with four roles, five scopes, SSO integration, and group-based policy management.

## Roles

| Role | Description |
|------|-------------|
| `admin` | Full access — manage operators, devices, fleet, SSO, and configuration |
| `operator` | Standard access — read, write, approvals, and device pairing |
| `viewer` | Read-only access |
| `auditor` | Read-only access focused on compliance and audit review |

## Scopes

| Scope | Description |
|-------|-------------|
| `operator.admin` | Administrative operations (create/delete operators, configure SSO) |
| `operator.read` | Read access to operators, devices, sessions, audit trail |
| `operator.write` | Write access to configuration, skills, agents |
| `operator.approvals` | Approve/deny pending actions (pairing, tool execution) |
| `operator.pairing` | Manage device pairing and node registration |

## SSO Integration

- **SAML** and **OIDC** providers supported.
- Auto-provisioning: new users are created automatically on first SSO login.
- Group-based role assignment: SSO groups map to roles and additional scopes.
- Enforced SSO: optionally require SSO for all operator logins.

## Group Policies

Define rules that map SSO groups to roles and scopes:

```json5
{
  admin: {
    groupPolicy: {
      rules: [
        { groupName: "security-team", role: "auditor", additionalScopes: ["operator.admin"] },
        { groupName: "engineering", role: "operator" },
      ],
      autoRevoke: true,
    },
  },
}
```

## Related

- [Operator management](operators.md)
- [Compliance profiles](onboarding-security.md)
- [Security guide](https://docs.openclaw.ai/gateway/security)

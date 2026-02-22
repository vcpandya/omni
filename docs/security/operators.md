# Operator Management

Omni provides full operator lifecycle management with CRUD operations, invite flows, SSO auto-provisioning, and fleet-wide agent management.

## Overview

Operators are the users who manage and interact with the Omni gateway. Each operator has a role, scopes, and an audit history.

## Gateway Methods

| Method | Scope | Description |
|--------|-------|-------------|
| `operators.list` | READ | List operators with optional role filter |
| `operators.get` | READ | Get operator by ID or email |
| `operators.create` | ADMIN | Create operator with role and scopes |
| `operators.update` | ADMIN | Update role, scopes, display name, or disabled status |
| `operators.delete` | ADMIN | Remove operator (cannot delete self) |
| `operators.invite` | ADMIN | Generate invite token for email |
| `operators.redeem` | Public | Redeem invite token to create account |
| `operators.sessions` | READ | List active sessions for an operator |

## Invite Flow

1. Admin creates an invite: `operators.invite` with target email and role.
2. Invite token is generated with a 7-day TTL.
3. New user redeems the token: `operators.redeem` with the token and optional display name.
4. Operator record is created with the specified role and scopes.

## SSO Auto-Provisioning

When SSO is configured with `autoProvision: true`, new operators are created automatically on first SSO login. Group membership determines role and additional scopes via group policies.

## Related

- [Admin profiles and RBAC](admin.md)
- [Fleet management](fleet.md)
- [Audit trail](audit-trail.md)

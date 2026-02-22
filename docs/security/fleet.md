# Fleet Management

Omni supports fleet-wide operations for managing multiple devices and agents at scale.

## Overview

Fleet management provides bulk operations, compliance reporting, and remote agent synchronization across all paired devices.

## Fleet Operations

| Operation | Description |
|-----------|-------------|
| `policy-push` | Push security/compliance policies to target devices |
| `token-rotate` | Bulk rotate device authentication tokens |
| `wipe` | Remote wipe device data (requires explicit confirmation) |
| `agent-sync` | Synchronize agent configurations across devices |

## Compliance Reporting

Generate fleet-wide compliance reports that aggregate device trust scores:

- Total devices, compliant, non-compliant, unreachable counts.
- Per-device trust level, trust score, and compliance issues.
- Fleet overview with breakdown by trust level.

## Gateway Methods

| Method | Scope | Description |
|--------|-------|-------------|
| `fleet.overview` | READ | Fleet summary (devices, trust levels, agents) |
| `fleet.compliance` | READ | Full compliance report |
| `fleet.policy.push` | ADMIN | Push policies to devices |
| `fleet.tokens.rotate` | ADMIN | Bulk rotate device tokens |
| `fleet.wipe` | ADMIN | Remote wipe (requires `confirm: true`) |
| `fleet.agents.sync` | ADMIN | Sync agents across fleet |
| `fleet.operations.list` | READ | List recent fleet operations |
| `fleet.operations.get` | READ | Get operation status and results |

## Remote Agent Registry

Track and synchronize agent configurations across devices:

- **Push** — deploy agent config to multiple devices.
- **Pull** — retrieve current agent state from a device.
- **Diff** — compare agent configs between devices field by field.
- **Drift detection** — scan fleet for configuration drift.

## Related

- [Device trust](device-trust.md)
- [Operator management](operators.md)
- [Audit trail](audit-trail.md)

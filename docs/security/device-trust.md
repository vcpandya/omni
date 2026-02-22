# Device Trust

Omni evaluates the security posture of paired devices and assigns trust levels based on compliance signals.

## Trust Levels

| Level | Score Range | Description |
|-------|-------------|-------------|
| `high` | 80-100 | Fully compliant, all security features enabled |
| `medium` | 50-79 | Partially compliant, some features missing |
| `low` | 20-49 | Non-compliant, significant security gaps |
| `untrusted` | 0-19 | Critical security issues detected |

## Compliance Signals

- **Encryption** — disk encryption enabled (FileVault, BitLocker, LUKS).
- **Firewall** — host firewall active.
- **Screen lock** — auto-lock enabled with reasonable timeout.
- **Biometrics** — biometric auth available and configured.
- **MDM enrollment** — managed device with MDM profile.
- **OS version** — running a supported OS version.

## Policy Enforcement

Trust levels can trigger policy actions:

- `high` — full access, all tools available.
- `medium` — standard access, sensitive tools require approval.
- `low` — restricted access, sandbox enforced.
- `untrusted` — blocked or read-only access.

## Configuration

```json5
{
  security: {
    deviceTrust: {
      enabled: true,
      minimumTrustLevel: "medium",
      enforceMdm: false,
    },
  },
}
```

## Related

- [Security guide](https://docs.openclaw.ai/gateway/security)
- [Audit trail](audit-trail.md)
- [Fleet management](fleet.md)

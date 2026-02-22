# Audit Trail

Omni includes a SHA-256 hash-chained immutable audit trail that records security-relevant events across the system.

## Features

- **Hash-chained integrity** — each event includes the hash of the previous event, creating a tamper-evident chain.
- **Event categories** — auth, config, tool, skill, sandbox, device, approval, operator, remote-agent, SSO, fleet.
- **Severity levels** — info, warning, error, critical.
- **Query & filter** — search events by category, severity, actor, time range.
- **Stream** — real-time event streaming via Gateway WebSocket.
- **Verify** — validate chain integrity from any point.
- **Export** — export events in JSON format for external SIEM integration.

## Configuration

The audit trail is enabled by default. Configure retention and verbosity in `~/.openclaw/openclaw.json`:

```json5
{
  security: {
    auditTrail: {
      enabled: true,
      maxEvents: 10000,
      retentionDays: 90,
    },
  },
}
```

## CLI

```bash
# Query recent events
openclaw audit list --category auth --severity warning

# Verify chain integrity
openclaw audit verify

# Export for SIEM
openclaw audit export --format json --since 2025-01-01
```

## Related

- [Security guide](https://docs.openclaw.ai/gateway/security)
- [Compliance profiles](onboarding-security.md)
- [Device trust](device-trust.md)

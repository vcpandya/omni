# LLM Audit Interceptor

Omni includes an LLM audit layer that inspects prompts and responses for security threats before they reach the model or the user.

## Threat Detection

- **Prompt injection** — detects attempts to override system instructions via user input or tool results.
- **Data exfiltration** — scans for patterns that attempt to leak sensitive data (API keys, tokens, credentials, PII).
- **Privilege escalation** — identifies attempts to bypass sandbox restrictions or elevate permissions.

## Severity Levels

| Level | Action |
|-------|--------|
| `info` | Log only |
| `warning` | Log + flag in audit trail |
| `critical` | Log + block request + alert |

## Configuration

```json5
{
  security: {
    llmAudit: {
      enabled: true,
      blockOnCritical: true,
      scanPrompts: true,
      scanResponses: true,
    },
  },
}
```

## Integration

The LLM audit interceptor emits events to the [audit trail](audit-trail.md) and can trigger alerts via webhooks.

## Related

- [Security guide](https://docs.openclaw.ai/gateway/security)
- [Audit trail](audit-trail.md)
- [OWASP mapping](owasp.md)

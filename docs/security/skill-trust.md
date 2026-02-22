# Skill Trust Verification

Omni verifies the integrity and trustworthiness of skills before execution using content-hash verification and trust levels.

## Trust Levels

| Level | Description |
|-------|-------------|
| `trusted` | Verified hash, approved by admin |
| `unverified` | Hash not yet checked or skill is new |
| `quarantined` | Blocked from execution due to integrity failure or admin action |

## Content Hash Verification

Each skill's content is hashed (SHA-256) at install time. Before execution, the current hash is compared against the stored hash. If they differ, the skill is flagged as potentially tampered.

## Quarantine

Skills can be quarantined manually by an admin or automatically when integrity checks fail. Quarantined skills cannot execute until released.

## Gateway Methods

| Method | Scope | Description |
|--------|-------|-------------|
| `skills.trust.set` | ADMIN | Set trust level for a skill |
| `skills.trust.verify` | READ | Verify skill integrity |
| `skills.trust.quarantine` | ADMIN | Quarantine a skill |
| `skills.trust.release` | ADMIN | Release from quarantine |
| `skills.trust.audit` | READ | Trust change history |

## Related

- [Skills platform](https://docs.openclaw.ai/tools/skills)
- [Audit trail](audit-trail.md)
- [Security guide](https://docs.openclaw.ai/gateway/security)

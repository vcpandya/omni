---
summary: "Security configuration during onboarding: compliance profiles, OWASP coverage, admin profiles"
read_when:
  - Configuring security during onboarding
  - Choosing a compliance profile
  - Setting up enterprise security (SSO, ACL, device trust)
  - Understanding OWASP coverage
title: "Security Onboarding"
sidebarTitle: "Security Onboarding"
---

# Security Onboarding

The onboarding wizard includes a dedicated security configuration step that sets
up compliance profiles, sandbox policies, credential protection, and enterprise
access controls. The security step runs after gateway configuration and before
channel/skill setup.

## Usage modes

The wizard asks whether this is a **Personal** or **Enterprise** deployment.
This determines the depth of security configuration.

### Personal mode

Streamlined for individuals and small teams. Applies the **Standard** compliance
profile automatically, then asks three quick questions:

1. **Network binding** — Loopback (recommended), LAN, or custom
2. **Authentication** — Token (recommended), password, or none
3. **Exec security** — Allowlisted commands (recommended) or full access

Enterprise features (SSO, ACL, device trust, admin profiles) are skipped.

### Enterprise mode

Full compliance and policy configuration with five sub-steps:

1. **Compliance profile selection** — Choose from 5 profiles (see below)
2. **Optional customization** — Fine-tune individual security settings
3. **Admin profile setup** — SSO, access control lists, device trust
4. **Security audit** — Automated scan with auto-fix for critical issues
5. **OWASP coverage report** — Shows compliance with OWASP Top 10 frameworks

## Compliance profiles

Five pre-built profiles ordered by security level (strictest first):

### Zero Trust

Maximum security for environments processing sensitive data.

| Setting | Value |
|---------|-------|
| Network binding | Loopback only (127.0.0.1) |
| Authentication | Token with aggressive rate limiting (5/60s, 10min lockout) |
| Exec host | Sandbox |
| Exec security | Allowlist: `cat`, `ls`, `head`, `wc`, `grep`, `find` |
| Credential leak | **Block** (silently strips credentials) |
| Prompt injection | **Block** |
| Tool timeout | 30 seconds |
| Tool memory | 256 MB |
| Endpoint access | Strict allowlist |
| Agent-to-agent | Disabled |
| Cross-context DMs | Disabled |
| Audit logging | Full with sensitive data redaction |

### SOC 2 Hardened

Designed for SOC 2 Trust Service Criteria compliance.

| Setting | Value |
|---------|-------|
| Network binding | Loopback only |
| Authentication | Token with rate limiting (10/60s, 5min lockout) |
| Exec host | Sandbox |
| Tool profile | Coding (read, write, execute) |
| Tool deny list | `message_broadcast` |
| Credential leak | **Warn** |
| Prompt injection | **Review** (queue for human review) |
| Endpoint access | Domain-based allowlist |
| Tool timeout | 60 seconds |
| Tool memory | 512 MB |
| Loop detection | Enabled |

### HIPAA

For healthcare environments subject to HIPAA regulations.

| Setting | Value |
|---------|-------|
| Network binding | Loopback only |
| Authentication | Password with mandatory TLS (auto-generated certs) |
| Exec host | Sandbox |
| Exec security | Deny all (blocks all command execution) |
| Tool profile | Minimal (essential tools only) |
| Credential leak | **Block** |
| Prompt injection | **Review** |
| Endpoint access | Strict allowlist |
| Cross-context DMs | Disabled |
| Tool timeout | 30 seconds |
| Tool memory | 256 MB |

### Standard (default)

Balanced defaults for most deployments. This is the default for QuickStart mode
and the Personal use mode baseline.

| Setting | Value |
|---------|-------|
| Network binding | Loopback only |
| Authentication | Token with rate limiting (10/60s, 5min lockout) |
| Exec host | Sandbox |
| Tool profile | Coding |
| Credential leak | **Warn** |
| Prompt injection | **Warn** |
| Endpoint access | Domain-based allowlist |
| Tool timeout | 120 seconds |
| Tool memory | 512 MB |
| Loop detection | Enabled |

### Development

Relaxed settings for local development and testing. **Not for production.**

| Setting | Value |
|---------|-------|
| Network binding | Loopback only |
| Authentication | None |
| Exec host | Gateway (runs directly on host) |
| Exec security | Full (unrestricted) |
| Tool profile | Full (all tools) |
| Credential leak | **Off** |
| Prompt injection | **Off** |
| Endpoint access | Unrestricted |
| Tool timeout | 300 seconds |
| Tool memory | 1024 MB |
| Loop detection | Disabled |

<Warning>
The Development profile disables all security controls. Use only on fully
trusted machines for local development. Never deploy to production.
</Warning>

## Enterprise customization options

When "Customize individual settings" is selected in Enterprise mode, the wizard
walks through these categories:

### Network security
- Gateway binding (loopback, LAN, auto, tailnet, custom)
- Authentication method (token, password, trusted-proxy, none)
- TLS configuration (auto-generate, custom cert, off)
- Rate limiting thresholds

### Exec sandbox
- Host environment (sandbox, node, gateway)
- Security mode (deny, allowlist, full)
- Allowlisted binaries (customizable list)

### Tool policies
- Tool profile (minimal, coding, messaging, full)
- Elevated exec permissions
- Agent-to-agent communication
- Loop detection (enabled/disabled + thresholds)

### Channel security
- Cross-context messaging (DMs between channels)
- Broadcast rules

### Prompt injection defense
- Mode: block, review, warn, off
- Custom detection patterns

### Credential leak detection
- Mode: block, warn, review, off
- Custom patterns for sensitive data

### Resource constraints
- Exec timeout (seconds)
- Memory limits (MB)
- Loop detection thresholds (max iterations, cooldown)

## Admin profile

Enterprise mode optionally configures an administrator profile with:

### SSO integration
- Admin email address (validated against RFC 5321)
- Organization name
- SSO provider selection

### Access control lists (ACL)
Pre-built role-based access control matrix with four roles:

| Role | Scopes |
|------|--------|
| **Admin** | `*` (all permissions) |
| **Operator** | config:read, config:write, agents:manage, sessions:manage, gateway:manage |
| **Developer** | config:read, agents:read, sessions:read, sessions:write, tools:execute |
| **Viewer** | config:read, agents:read, sessions:read |

### Device trust
- Minimum device trust score threshold
- OS age policy (maxOsAgeDays)
- Required compliance checks

## OWASP coverage

After security configuration, the wizard evaluates coverage against two OWASP
frameworks and displays a summary:

### OWASP Top 10 for LLM Applications (2025)

| ID | Risk | Typical mitigations |
|----|------|-------------------|
| LLM01 | Prompt Injection | Exec sandbox allowlist, prompt injection defense |
| LLM02 | Sensitive Information Disclosure | Credential leak detection, log redaction |
| LLM03 | Supply Chain Vulnerabilities | Skill trust verification, manifest validation |
| LLM04 | Data and Model Poisoning | Input validation, endpoint allowlists |
| LLM05 | Improper Output Handling | Structured output validation, output sanitization |
| LLM06 | Excessive Agency | Tool profiles, deny lists, loop detection |
| LLM07 | System Prompt Leakage | Prompt injection defense modes |
| LLM08 | Vector and Embedding Weaknesses | Endpoint access controls |
| LLM09 | Misinformation | Human review workflows |
| LLM10 | Unbounded Consumption | Timeouts, memory limits, rate limiting |

### OWASP Top 10 for Agentic Applications

| ID | Risk | Typical mitigations |
|----|------|-------------------|
| AG01 | Excessive Permissions | Tool profiles, minimal permissions |
| AG02 | Uncontrolled Autonomous Actions | Loop detection, exec security |
| AG03 | Vulnerable Tool Integration | Skill trust, sandbox isolation |
| AG04 | Inadequate Logging | Audit trail, HMAC chain integrity |
| AG05 | Cross-Agent Contamination | Agent-to-agent isolation |
| AG06 | Multi-Agent Coordination Failure | Broadcast controls |
| AG07 | Memory Manipulation | Session security, context isolation |
| AG08 | Insufficient Access Controls | ACL, authentication, rate limiting |
| AG09 | Insecure Communication | TLS, endpoint allowlists |
| AG10 | Blind Trust in Agent Outputs | Human review, output validation |

### Coverage indicators

The wizard displays each risk with a coverage indicator:

- **[OK]** — Green: mitigated by current configuration
- **[!!]** — Yellow: partially mitigated, consider strengthening
- **[XX]** — Red: not covered, action recommended

## Security audit

The inline security audit runs after profile selection and checks for:

- Missing authentication on non-loopback bindings
- Overly permissive exec sandbox settings
- Disabled credential leak detection
- Missing rate limiting
- Audit trail configuration gaps

Critical findings can be auto-fixed by accepting the wizard's recommendations.

## Applying profiles after onboarding

Compliance profiles can be re-applied at any time:

```bash
openclaw configure --section security
```

Or directly edit `~/.openclaw/openclaw.json` using the profile settings documented
above as reference.

## Related docs

- [Onboarding Wizard (CLI)](/start/wizard)
- [Enterprise Providers](/start/enterprise-providers)
- [Threat Model](/security/THREAT-MODEL-ATLAS)
- [Security README](/security/README)

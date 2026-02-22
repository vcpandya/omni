# OWASP Coverage Mapping

Omni maps its security controls to the **OWASP Top 10 for LLM Applications 2025** and the **OWASP Agentic AI Top 10**.

## LLM Top 10 2025

| # | Vulnerability | Omni Controls |
|---|---------------|---------------|
| LLM01 | Prompt Injection | LLM audit interceptor, sandbox isolation, input validation |
| LLM02 | Sensitive Information Disclosure | Data exfiltration scanning, credential detection, PII filtering |
| LLM03 | Supply Chain | Skill trust verification, content hashing, quarantine |
| LLM04 | Data and Model Poisoning | Audit trail, integrity verification |
| LLM05 | Improper Output Handling | Response scanning, sandbox output filtering |
| LLM06 | Excessive Agency | Tool allowlists/denylists, sandbox mode, approval flows |
| LLM07 | System Prompt Leakage | Prompt injection detection, system prompt protection |
| LLM08 | Vector and Embedding Weaknesses | N/A (no vector DB exposure) |
| LLM09 | Misinformation | N/A (delegated to model provider) |
| LLM10 | Unbounded Consumption | Token budget zones, usage tracking, rate limiting |

## Agentic AI Top 10

| # | Risk | Omni Controls |
|---|------|---------------|
| AG01 | Unauthorized Actions | RBAC, scope-based authorization, approval flows |
| AG02 | Data Leakage | Audit trail, data exfiltration scanning |
| AG03 | Insecure Tool Use | Tool allowlists, sandbox isolation |
| AG04 | Privilege Escalation | Scope enforcement, elevated access controls |
| AG05 | Identity Spoofing | Device trust, SSO, pairing codes |

## Related

- [Compliance profiles](onboarding-security.md)
- [LLM audit](llm-audit.md)
- [Security guide](https://docs.openclaw.ai/gateway/security)

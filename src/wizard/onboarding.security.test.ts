import { describe, expect, it, vi } from "vitest";
import type { WizardPrompter, WizardProgress } from "./prompts.js";

// Mock the security audit module
vi.mock("../security/audit.js", () => ({
  runSecurityAudit: vi.fn(async () => ({
    ts: Date.now(),
    summary: { critical: 0, warn: 1, info: 2 },
    findings: [
      { checkId: "test.warn", severity: "warn", title: "Test warning", detail: "detail" },
      { checkId: "test.info1", severity: "info", title: "Test info 1", detail: "detail" },
      { checkId: "test.info2", severity: "info", title: "Test info 2", detail: "detail" },
    ],
  })),
}));

vi.mock("../security/fix.js", () => ({
  fixSecurityFootguns: vi.fn(async () => {}),
}));

function createMockPrompter(answers: unknown[]): WizardPrompter {
  let answerIdx = 0;
  const progress: WizardProgress = {
    update: vi.fn(),
    stop: vi.fn(),
  };

  return {
    intro: vi.fn(async () => {}),
    outro: vi.fn(async () => {}),
    note: vi.fn(async () => {}),
    select: vi.fn(async () => answers[answerIdx++]) as WizardPrompter["select"],
    multiselect: vi.fn(async () => answers[answerIdx++] as unknown[]) as WizardPrompter["multiselect"],
    text: vi.fn(async () => String(answers[answerIdx++])),
    confirm: vi.fn(async () => answers[answerIdx++] as boolean),
    progress: vi.fn(() => progress),
  };
}

describe("onboarding.security", () => {
  it("quickstart flow applies standard profile silently", async () => {
    const { promptSecurityConfig } = await import("./onboarding.security.js");
    const prompter = createMockPrompter([]);
    const result = await promptSecurityConfig({
      config: {},
      prompter,
      flow: "quickstart",
    });

    // Should have applied Standard profile
    expect(result.gateway?.bind).toBe("loopback");
    expect(result.gateway?.auth?.mode).toBe("token");
    expect(result.tools?.profile).toBe("coding");
    expect(result.tools?.exec?.host).toBe("sandbox");
    expect(result.logging?.redactSensitive).toBe("tools");

    // Should have shown a note, not prompted for selection
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Standard security profile"),
      "Enterprise Security",
    );
    expect(prompter.select).not.toHaveBeenCalled();
  });

  it("advanced flow with standard profile and no customization", async () => {
    const { promptSecurityConfig } = await import("./onboarding.security.js");
    const prompter = createMockPrompter([
      "enterprise",  // usage mode
      "standard",    // profile selection
      false,         // don't customize
      false,         // skip admin profile
      true,          // run audit
      // audit runs, shows note, no critical → no auto-fix prompt
    ]);

    const result = await promptSecurityConfig({
      config: {},
      prompter,
      flow: "advanced",
    });

    expect(result.gateway?.auth?.mode).toBe("token");
    expect(result.tools?.profile).toBe("coding");
    expect(result.tools?.exec?.host).toBe("sandbox");
    // Note was shown for intro and profile applied
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Omni supports enterprise compliance profiles"),
      "Enterprise Security",
    );
  });

  it("advanced flow with zero-trust profile", async () => {
    const { promptSecurityConfig } = await import("./onboarding.security.js");
    const prompter = createMockPrompter([
      "enterprise",  // usage mode
      "zero-trust",  // profile selection
      false,         // don't customize
      false,         // skip admin profile
      false,         // skip audit
    ]);

    const result = await promptSecurityConfig({
      config: {},
      prompter,
      flow: "advanced",
    });

    expect(result.tools?.profile).toBe("minimal");
    expect(result.tools?.elevated?.enabled).toBe(false);
    expect(result.tools?.agentToAgent?.enabled).toBe(false);
    expect(result.gateway?.auth?.rateLimit?.maxAttempts).toBe(5);
  });

  it("development profile shows security warning", async () => {
    const { promptSecurityConfig } = await import("./onboarding.security.js");
    const prompter = createMockPrompter([
      "enterprise",   // usage mode
      "development",  // profile selection
      false,          // don't customize
      false,          // skip admin profile
      false,          // skip audit
    ]);

    await promptSecurityConfig({
      config: {},
      prompter,
      flow: "advanced",
    });

    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("WARNING: Development profile"),
      "Security Warning",
    );
  });

  it("shows OWASP coverage summary at the end", async () => {
    const { promptSecurityConfig } = await import("./onboarding.security.js");
    const prompter = createMockPrompter([
      "enterprise",  // usage mode
      "standard",    // profile selection
      false,         // don't customize
      false,         // skip admin profile
      false,         // skip audit
    ]);

    await promptSecurityConfig({
      config: {},
      prompter,
      flow: "advanced",
    });

    // Last note should be OWASP coverage
    const noteCalls = (prompter.note as ReturnType<typeof vi.fn>).mock.calls;
    const lastNote = noteCalls[noteCalls.length - 1];
    expect(lastNote[0]).toContain("OWASP Coverage:");
    expect(lastNote[1]).toBe("OWASP Coverage");
  });

  it("advanced flow with customization walks through all sub-sections", async () => {
    const { promptSecurityConfig } = await import("./onboarding.security.js");
    const prompter = createMockPrompter([
      "enterprise",   // usage mode
      "standard",     // profile selection
      true,           // customize
      // Network security
      "loopback",     // bind
      "token",        // auth
      true,           // rate limit
      "10",           // max attempts
      false,          // TLS
      // Exec sandbox
      "sandbox",      // host
      "allowlist",    // security mode
      "cat, ls",      // safe bins
      // Tool policies
      "coding",       // profile
      false,          // elevated
      false,          // a2a
      true,           // loop detection
      // Channel security
      true,           // cross-context within
      false,          // cross-context across
      true,           // broadcast
      // Prompt injection
      "tools",        // redaction
      false,          // custom patterns
      // Credential leak
      "warn",         // level
      // Resource constraints
      "120",          // timeout
      "30000",        // background
      "30",           // circuit breaker
      // Admin profile
      false,          // skip admin profile
      // Audit
      false,          // skip audit
    ]);

    const result = await promptSecurityConfig({
      config: {},
      prompter,
      flow: "advanced",
    });

    // Verify customized settings were applied
    expect(result.gateway?.bind).toBe("loopback");
    expect(result.gateway?.auth?.mode).toBe("token");
    expect(result.tools?.exec?.host).toBe("sandbox");
    expect(result.tools?.exec?.security).toBe("allowlist");
    expect(result.tools?.exec?.safeBins).toEqual(["cat", "ls"]);
    expect(result.tools?.profile).toBe("coding");
    expect(result.tools?.elevated?.enabled).toBe(false);
    expect(result.tools?.agentToAgent?.enabled).toBe(false);
    expect(result.tools?.loopDetection?.enabled).toBe(true);
    expect(result.tools?.message?.crossContext?.allowWithinProvider).toBe(true);
    expect(result.tools?.message?.crossContext?.allowAcrossProviders).toBe(false);
    expect(result.logging?.redactSensitive).toBe("tools");
    expect(result.tools?.exec?.timeoutSec).toBe(120);
    expect(result.tools?.exec?.backgroundMs).toBe(30_000);
    expect(result.tools?.loopDetection?.globalCircuitBreakerThreshold).toBe(30);
  });

  it("credential leak detection block adds default patterns", async () => {
    const { promptSecurityConfig } = await import("./onboarding.security.js");
    const prompter = createMockPrompter([
      "enterprise",   // usage mode
      "standard",     // profile
      true,           // customize
      // Network
      "loopback", "token", true, "10", false,
      // Exec
      "sandbox", "allowlist", "cat",
      // Tool policies
      "coding", true, false, true,
      // Channel
      true, false, true,
      // Prompt injection
      "tools", false,
      // Credential leak — BLOCK
      "block",
      // Resource constraints
      "120", "30000", "30",
      // Admin profile
      false,          // skip admin profile
      // Audit
      false,
    ]);

    const result = await promptSecurityConfig({
      config: {},
      prompter,
      flow: "advanced",
    });

    // Should have added default credential patterns
    expect(result.logging?.redactPatterns).toBeDefined();
    expect(result.logging!.redactPatterns!.length).toBeGreaterThan(0);
    expect(result.logging!.redactPatterns!.some((p) => p.includes("AKIA"))).toBe(true);
  });
});

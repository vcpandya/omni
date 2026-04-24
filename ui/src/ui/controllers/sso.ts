// ── SSO Controller — status + dry-run test ──────────────────────

import type { GatewayBrowserClient } from "../gateway.ts";

// ── Types ───────────────────────────────────────────────────────

export type SsoStatusUI = {
  configured: boolean;
  type: "saml" | "oidc" | "none";
  displayName?: string;
  autoProvision: boolean;
  enforced: boolean;
};

export type SsoTestResultUI = {
  dryRun: true;
  mappedAttributes: {
    email?: string;
    displayName?: string;
    groups?: string[];
  };
  validation: { valid: boolean; reason?: string };
  wouldProvision: boolean;
};

export type SsoState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  status: SsoStatusUI | null;
  lastRefreshAt: number | null;
  /** Raw-attribute JSON text editor contents (free-form for dry-run). */
  testDraft: string;
  testing: boolean;
  testError: string | null;
  testResult: SsoTestResultUI | null;
};

const DEFAULT_TEST_DRAFT = JSON.stringify(
  {
    mail: "alice@example.com",
    displayName: "Alice Doe",
    memberOf: ["engineering", "sec-ops"],
  },
  null,
  2,
);

export function makeSsoState(): SsoState {
  return {
    client: null,
    connected: false,
    loading: false,
    error: null,
    status: null,
    lastRefreshAt: null,
    testDraft: DEFAULT_TEST_DRAFT,
    testing: false,
    testError: null,
    testResult: null,
  };
}

// ── Load ────────────────────────────────────────────────────────

export async function loadSsoStatus(state: SsoState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.loading = true;
  state.error = null;
  try {
    const res = await state.client.request<SsoStatusUI>("sso.status", {});
    state.status = res;
    state.lastRefreshAt = Date.now();
  } catch (err) {
    state.error = String(err);
  } finally {
    state.loading = false;
  }
}

// ── Dry-run test ────────────────────────────────────────────────

export async function runSsoTest(state: SsoState): Promise<boolean> {
  if (!state.client) {
    return false;
  }
  let rawAttributes: Record<string, unknown>;
  try {
    rawAttributes = JSON.parse(state.testDraft);
    if (
      typeof rawAttributes !== "object" ||
      rawAttributes === null ||
      Array.isArray(rawAttributes)
    ) {
      throw new Error("Expected a JSON object");
    }
  } catch (err) {
    state.testError = `Invalid JSON: ${String(err instanceof Error ? err.message : err)}`;
    state.testResult = null;
    return false;
  }
  state.testing = true;
  state.testError = null;
  try {
    const res = await state.client.request<SsoTestResultUI>("sso.test", { rawAttributes });
    state.testResult = res;
    return true;
  } catch (err) {
    state.testError = String(err);
    state.testResult = null;
    return false;
  } finally {
    state.testing = false;
  }
}

export function setSsoTestDraft(state: SsoState, next: string): void {
  state.testDraft = next;
}

export function resetSsoTest(state: SsoState): void {
  state.testDraft = DEFAULT_TEST_DRAFT;
  state.testError = null;
  state.testResult = null;
}

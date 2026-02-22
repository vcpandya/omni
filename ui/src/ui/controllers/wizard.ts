import type { GatewayBrowserClient } from "../gateway.ts";

// ---------------------------------------------------------------------------
// Types — mirror src/wizard/session.ts WizardStep for the browser
// ---------------------------------------------------------------------------

export type WizardStepOption = {
  value: unknown;
  label: string;
  hint?: string;
};

export type WizardStep = {
  id: string;
  type: "note" | "select" | "text" | "confirm" | "multiselect" | "progress" | "action";
  title?: string;
  message?: string;
  options?: WizardStepOption[];
  initialValue?: unknown;
  placeholder?: string;
  sensitive?: boolean;
  executor?: "gateway" | "client";
  metadata?: Record<string, unknown>;
};

export type WizardSessionStatus = "running" | "done" | "cancelled" | "error";

export type WizardNextResult = {
  done: boolean;
  step?: WizardStep;
  status: WizardSessionStatus;
  error?: string;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type WizardState = {
  client: GatewayBrowserClient | null;
  connected: boolean;

  wizardActive: boolean;
  wizardSessionId: string | null;
  wizardStep: WizardStep | null;
  wizardStepIndex: number;
  wizardTotalSteps: number;
  wizardHistory: WizardStep[];
  wizardStatus: WizardSessionStatus;
  wizardError: string | null;
  wizardLoading: boolean;
  wizardSelectedValue: unknown;
};

/** Step labels for the sidebar indicator. */
export const WIZARD_STEP_LABELS = [
  "Welcome",
  "Workspace",
  "AI Provider",
  "Model",
  "Gateway",
  "Security",
  "Channels",
  "Skills",
  "Review",
] as const;

// ---------------------------------------------------------------------------
// Provider card metadata for rich provider selection
// ---------------------------------------------------------------------------

export type ProviderCardMeta = {
  icon?: string;
  category?: string;
  badge?: string;
  description?: string;
};

export const PROVIDER_CARD_META: Record<string, ProviderCardMeta> = {
  "azure-openai": { icon: "azure", category: "Enterprise Cloud", badge: "enterprise", description: "Azure endpoint + deployment" },
  "bedrock-aws": { icon: "aws", category: "Enterprise Cloud", badge: "enterprise", description: "AWS credentials + model discovery" },
  "vertex-gcloud": { icon: "gcp", category: "Enterprise Cloud", badge: "enterprise", description: "gcloud ADC + Gemini models" },
  openai: { icon: "openai", category: "Enterprise Cloud", badge: "popular", description: "Codex OAuth + API key" },
  anthropic: { icon: "anthropic", category: "Enterprise Cloud", badge: "popular", description: "Claude models" },
  google: { icon: "google", category: "API Providers", description: "Gemini API" },
  xai: { category: "API Providers", description: "Grok models" },
  openrouter: { category: "API Providers", description: "Multi-provider router" },
  together: { category: "API Providers", description: "Open models" },
  huggingface: { category: "API Providers", description: "Inference API" },
  copilot: { category: "Community", description: "GitHub integration" },
  moonshot: { category: "Community", description: "Kimi K2.5" },
  minimax: { category: "Community", description: "M2.5 models" },
  vllm: { category: "Self-Hosted", description: "OpenAI-compatible server" },
  litellm: { category: "Self-Hosted", description: "100+ provider gateway" },
  custom: { category: "Self-Hosted", description: "Any compatible endpoint" },
};

// ---------------------------------------------------------------------------
// Admin profile setup metadata for rich wizard cards
// ---------------------------------------------------------------------------

export type AdminSetupCardMeta = {
  icon?: string;
  description: string;
  badge?: string;
};

export const ADMIN_SETUP_META: Record<string, AdminSetupCardMeta> = {
  "admin-profile": { icon: "shield", description: "First admin account with full control", badge: "required" },
  sso: { icon: "globe", description: "SAML/OIDC corporate identity provider", badge: "enterprise" },
  "access-control": { icon: "layers", description: "Role-based permission matrix", badge: "enterprise" },
  "group-policy": { icon: "layers", description: "SSO group → role mappings" },
  "device-push": { icon: "layers", description: "Push configs to managed devices" },
};

// ---------------------------------------------------------------------------
// Step descriptions for the sidebar
// ---------------------------------------------------------------------------

export const WIZARD_STEP_DESCRIPTIONS: Record<string, string> = {
  Welcome: "Get started",
  Workspace: "Project directory",
  "AI Provider": "Authentication",
  Model: "Default model",
  Gateway: "Port & binding",
  Security: "Compliance profile",
  Channels: "Discord, Slack, etc.",
  Skills: "Hooks & extensions",
  Review: "Launch configuration",
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function startWizard(state: WizardState): Promise<void> {
  if (!state.client || !state.connected) return;
  state.wizardLoading = true;
  state.wizardError = null;
  try {
    const result = await state.client.request<WizardNextResult & { sessionId?: string }>(
      "wizard.start",
      { mode: "local" },
    );
    state.wizardSessionId = result.sessionId ?? null;
    state.wizardStep = result.step ?? null;
    state.wizardStatus = result.status;
    state.wizardActive = true;
    state.wizardStepIndex = 0;
    state.wizardHistory = [];
    state.wizardSelectedValue = null;
  } catch (err) {
    state.wizardError = err instanceof Error ? err.message : String(err);
  } finally {
    state.wizardLoading = false;
  }
}

export async function answerWizardStep(
  state: WizardState,
  stepId: string,
  value: unknown,
): Promise<void> {
  if (!state.client || !state.wizardSessionId) return;
  state.wizardLoading = true;
  state.wizardError = null;
  try {
    const result = await state.client.request<WizardNextResult>(
      "wizard.next",
      {
        sessionId: state.wizardSessionId,
        answer: { stepId, value },
      },
    );
    if (result.step) {
      // Push current step to history for back navigation
      if (state.wizardStep) {
        state.wizardHistory = [...state.wizardHistory, state.wizardStep];
      }
      state.wizardStep = result.step;
      state.wizardStepIndex++;
      state.wizardSelectedValue = null;
    }
    if (result.done) {
      state.wizardActive = false;
    }
    state.wizardStatus = result.status;
    if (result.error) {
      state.wizardError = result.error;
    }
  } catch (err) {
    state.wizardError = err instanceof Error ? err.message : String(err);
  } finally {
    state.wizardLoading = false;
  }
}

export function goBackWizard(state: WizardState): void {
  if (state.wizardHistory.length === 0) return;
  const prev = state.wizardHistory[state.wizardHistory.length - 1];
  state.wizardHistory = state.wizardHistory.slice(0, -1);
  state.wizardStep = prev;
  state.wizardStepIndex = Math.max(0, state.wizardStepIndex - 1);
  state.wizardSelectedValue = null;
}

export async function cancelWizard(state: WizardState): Promise<void> {
  if (!state.client || !state.wizardSessionId) return;
  try {
    await state.client.request("wizard.cancel", {
      sessionId: state.wizardSessionId,
    });
  } catch {
    // Ignore errors during cancellation
  }
  state.wizardActive = false;
  state.wizardSessionId = null;
  state.wizardStep = null;
  state.wizardHistory = [];
  state.wizardStepIndex = 0;
  state.wizardSelectedValue = null;
}

/**
 * Estimate which sidebar step index we're on based on step title/message heuristics.
 */
export function estimateSidebarIndex(step: WizardStep | null, rawIndex: number): number {
  if (!step) return 0;
  const msg = (step.title ?? step.message ?? "").toLowerCase();
  if (msg.includes("welcome") || msg.includes("onboarding")) return 0;
  if (msg.includes("workspace")) return 1;
  if (msg.includes("auth") || msg.includes("provider") || msg.includes("api key")) return 2;
  if (msg.includes("model")) return 3;
  if (msg.includes("gateway") || msg.includes("port") || msg.includes("bind")) return 4;
  if (msg.includes("security") || msg.includes("compliance") || msg.includes("owasp")) return 5;
  if (msg.includes("channel")) return 6;
  if (msg.includes("skill") || msg.includes("hook")) return 7;
  if (msg.includes("review") || msg.includes("launch") || msg.includes("hatch")) return 8;
  // Fallback: map raw index to rough range
  return Math.min(Math.floor(rawIndex / 3), WIZARD_STEP_LABELS.length - 1);
}

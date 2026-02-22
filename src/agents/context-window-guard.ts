import type { OpenClawConfig } from "../config/config.js";
import type { TokenBudgetConfig } from "../config/types.memory.js";
import { allocateBudget, type BudgetAllocation } from "./token-budget.js";

export const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000;
export const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000;

export type ContextWindowSource = "model" | "modelsConfig" | "agentContextTokens" | "default";

export type ContextWindowInfo = {
  tokens: number;
  source: ContextWindowSource;
  /** Token budget allocation (present when tokenBudget config is enabled). */
  budget?: BudgetAllocation;
};

function normalizePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const int = Math.floor(value);
  return int > 0 ? int : null;
}

export function resolveContextWindowInfo(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  modelId: string;
  modelContextWindow?: number;
  defaultTokens: number;
}): ContextWindowInfo {
  const fromModelsConfig = (() => {
    const providers = params.cfg?.models?.providers as
      | Record<string, { models?: Array<{ id?: string; contextWindow?: number }> }>
      | undefined;
    const providerEntry = providers?.[params.provider];
    const models = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
    const match = models.find((m) => m?.id === params.modelId);
    return normalizePositiveInt(match?.contextWindow);
  })();
  const fromModel = normalizePositiveInt(params.modelContextWindow);
  const baseInfo = fromModelsConfig
    ? { tokens: fromModelsConfig, source: "modelsConfig" as const }
    : fromModel
      ? { tokens: fromModel, source: "model" as const }
      : { tokens: Math.floor(params.defaultTokens), source: "default" as const };

  const capTokens = normalizePositiveInt(params.cfg?.agents?.defaults?.contextTokens);
  const resolved = capTokens && capTokens < baseInfo.tokens
    ? { tokens: capTokens, source: "agentContextTokens" as const }
    : baseInfo;

  // Optionally compute zone-based token budget allocation
  const budgetCfg = resolveTokenBudgetConfig(params.cfg);
  if (budgetCfg?.enabled) {
    return {
      ...resolved,
      budget: allocateBudget(resolved.tokens, budgetCfg),
    };
  }

  return resolved;
}

/**
 * Resolve token budget configuration from OpenClawConfig.
 * Returns null when the token budget system is disabled or absent.
 */
export function resolveTokenBudgetConfig(
  cfg: OpenClawConfig | undefined,
): TokenBudgetConfig | null {
  const raw = (cfg?.agents?.defaults as Record<string, unknown> | undefined)
    ?.tokenBudget as TokenBudgetConfig | undefined;
  if (!raw || raw.enabled !== true) {
    return null;
  }
  return raw;
}

export type ContextWindowGuardResult = ContextWindowInfo & {
  shouldWarn: boolean;
  shouldBlock: boolean;
};

export function evaluateContextWindowGuard(params: {
  info: ContextWindowInfo;
  warnBelowTokens?: number;
  hardMinTokens?: number;
}): ContextWindowGuardResult {
  const warnBelow = Math.max(
    1,
    Math.floor(params.warnBelowTokens ?? CONTEXT_WINDOW_WARN_BELOW_TOKENS),
  );
  const hardMin = Math.max(1, Math.floor(params.hardMinTokens ?? CONTEXT_WINDOW_HARD_MIN_TOKENS));
  const tokens = Math.max(0, Math.floor(params.info.tokens));
  return {
    ...params.info,
    tokens,
    shouldWarn: tokens > 0 && tokens < warnBelow,
    shouldBlock: tokens > 0 && tokens < hardMin,
  };
}

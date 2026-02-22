/**
 * Token Budget Allocator — zone-based context window partitioning.
 *
 * Divides the resolved context window into five zones:
 *   system  → system instructions (10–15%)
 *   tools   → tool descriptions   (15–20%)
 *   memory  → RAG / knowledge     (30–40%)
 *   history → conversation turns   (20–30%)
 *   reserve → safety buffer        (10–15%)
 *
 * Opt-in via `agents.defaults.tokenBudget`.
 * When disabled, the existing compaction pipeline runs unchanged.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BudgetZone = "system" | "tools" | "memory" | "history" | "reserve";

export interface ZoneSpec {
  /** Minimum token share (0–1). Floor guarantee. */
  min: number;
  /** Maximum token share (0–1). Hard ceiling. */
  max: number;
  /** Preferred token share (0–1). Target when headroom allows. */
  preferred: number;
}

export interface TokenBudgetConfig {
  enabled?: boolean;
  /** Per-zone overrides (shares are 0-1 fractions). */
  zones?: Partial<Record<BudgetZone, Partial<ZoneSpec>>>;
  /** Enable dynamic tool context filtering. */
  dynamicToolFiltering?: boolean;
  /** Trigger compaction when total usage exceeds this share (0-1). Default 0.85. */
  compactionThreshold?: number;
}

export interface ZoneAllocation {
  zone: BudgetZone;
  tokens: number;
  min: number;
  max: number;
}

export interface BudgetAllocation {
  contextWindow: number;
  zones: Record<BudgetZone, ZoneAllocation>;
  compactionThreshold: number;
}

export interface ZoneUsageReport {
  zone: BudgetZone;
  allocated: number;
  actual: number;
  overBudget: boolean;
  utilization: number; // 0-1
}

export interface BudgetUsageReport {
  contextWindow: number;
  totalAllocated: number;
  totalActual: number;
  zones: Record<BudgetZone, ZoneUsageReport>;
  shouldCompact: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_ZONE_SPECS: Record<BudgetZone, ZoneSpec> = {
  system:  { min: 0.08, max: 0.15, preferred: 0.12 },
  tools:   { min: 0.10, max: 0.20, preferred: 0.17 },
  memory:  { min: 0.15, max: 0.40, preferred: 0.30 },
  history: { min: 0.15, max: 0.35, preferred: 0.26 },
  reserve: { min: 0.08, max: 0.15, preferred: 0.15 },
};

const ZONE_ORDER: readonly BudgetZone[] = [
  "system",
  "reserve",
  "tools",
  "memory",
  "history",
] as const;

const DEFAULT_COMPACTION_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function mergeZoneSpec(base: ZoneSpec, overrides?: Partial<ZoneSpec>): ZoneSpec {
  if (!overrides) return base;
  return {
    min: clamp(overrides.min ?? base.min, 0, 1),
    max: clamp(overrides.max ?? base.max, 0, 1),
    preferred: clamp(overrides.preferred ?? base.preferred, 0, 1),
  };
}

// ---------------------------------------------------------------------------
// Allocator
// ---------------------------------------------------------------------------

/**
 * Allocate a context window into zone budgets.
 *
 * Strategy (two-pass):
 *   1. Give every zone its `min` tokens.
 *   2. Distribute remaining tokens proportional to `preferred - min`,
 *      capped at each zone's `max`.
 *
 * If total minimums exceed the context window the allocator distributes
 * proportionally to preferred shares (best-effort degradation).
 */
export function allocateBudget(
  contextWindow: number,
  config?: TokenBudgetConfig,
): BudgetAllocation {
  const specs: Record<BudgetZone, ZoneSpec> = {} as Record<BudgetZone, ZoneSpec>;
  for (const zone of ZONE_ORDER) {
    specs[zone] = mergeZoneSpec(
      DEFAULT_ZONE_SPECS[zone],
      config?.zones?.[zone],
    );
  }

  const total = Math.max(0, Math.floor(contextWindow));
  const compactionThreshold = clamp(
    config?.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD,
    0.5,
    0.99,
  );

  // --- Pass 1: allocate minimums ---
  let minimumTotal = 0;
  for (const zone of ZONE_ORDER) {
    minimumTotal += Math.floor(specs[zone].min * total);
  }

  // Degradation mode: if minimums > total, distribute proportional to preferred
  if (minimumTotal > total) {
    const prefSum = ZONE_ORDER.reduce((s, z) => s + specs[z].preferred, 0);
    const result: Record<BudgetZone, ZoneAllocation> = {} as Record<BudgetZone, ZoneAllocation>;
    let assigned = 0;
    for (let i = 0; i < ZONE_ORDER.length; i++) {
      const zone = ZONE_ORDER[i];
      const share = prefSum > 0 ? specs[zone].preferred / prefSum : 1 / ZONE_ORDER.length;
      const tokens =
        i === ZONE_ORDER.length - 1
          ? total - assigned // give remainder to last zone
          : Math.floor(share * total);
      assigned += tokens;
      result[zone] = {
        zone,
        tokens: Math.max(0, tokens),
        min: Math.floor(specs[zone].min * total),
        max: Math.floor(specs[zone].max * total),
      };
    }
    return { contextWindow: total, zones: result, compactionThreshold };
  }

  // --- Pass 2: distribute surplus proportional to (preferred - min) ---
  const surplus = total - minimumTotal;
  const wants: Record<BudgetZone, number> = {} as Record<BudgetZone, number>;
  let wantSum = 0;
  for (const zone of ZONE_ORDER) {
    const preferredTokens = Math.floor(specs[zone].preferred * total);
    const minTokens = Math.floor(specs[zone].min * total);
    wants[zone] = Math.max(0, preferredTokens - minTokens);
    wantSum += wants[zone];
  }

  const result: Record<BudgetZone, ZoneAllocation> = {} as Record<BudgetZone, ZoneAllocation>;
  let remaining = surplus;
  for (let i = 0; i < ZONE_ORDER.length; i++) {
    const zone = ZONE_ORDER[i];
    const minTokens = Math.floor(specs[zone].min * total);
    const maxTokens = Math.floor(specs[zone].max * total);

    let extra: number;
    if (i === ZONE_ORDER.length - 1) {
      extra = remaining; // last zone absorbs remainder
    } else {
      const share = wantSum > 0 ? wants[zone] / wantSum : 0;
      extra = Math.floor(share * surplus);
    }

    const tokens = clamp(minTokens + extra, minTokens, maxTokens);
    remaining -= tokens - minTokens;

    result[zone] = { zone, tokens, min: minTokens, max: maxTokens };
  }

  return { contextWindow: total, zones: result, compactionThreshold };
}

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

export function createUsageReport(
  allocation: BudgetAllocation,
  actual: Partial<Record<BudgetZone, number>>,
): BudgetUsageReport {
  let totalAllocated = 0;
  let totalActual = 0;
  const zones: Record<BudgetZone, ZoneUsageReport> = {} as Record<
    BudgetZone,
    ZoneUsageReport
  >;

  for (const zone of ZONE_ORDER) {
    const allocated = allocation.zones[zone].tokens;
    const used = Math.max(0, actual[zone] ?? 0);
    totalAllocated += allocated;
    totalActual += used;
    zones[zone] = {
      zone,
      allocated,
      actual: used,
      overBudget: used > allocated,
      utilization: allocated > 0 ? used / allocated : 0,
    };
  }

  return {
    contextWindow: allocation.contextWindow,
    totalAllocated,
    totalActual,
    zones,
    shouldCompact:
      totalActual > allocation.contextWindow * allocation.compactionThreshold,
  };
}

// ---------------------------------------------------------------------------
// Tool relevance scoring (for dynamic tool filtering)
// ---------------------------------------------------------------------------

export interface ToolRelevanceEntry {
  name: string;
  /** Number of tokens the tool description consumes. */
  descriptionTokens: number;
  /** Whether the tool was used in the last N turns. */
  recentlyUsed: boolean;
  /** Whether the tool is always included (pinned). */
  pinned: boolean;
  /** Keyword overlap score with current user message (0-1). */
  relevance: number;
}

/**
 * Select tools that fit within a token budget, prioritising pinned,
 * recently-used, and high-relevance tools.
 */
export function selectToolsByBudget(
  tools: ToolRelevanceEntry[],
  budgetTokens: number,
): string[] {
  // Sort: pinned first, recently-used second, then by relevance desc
  const sorted = [...tools].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.recentlyUsed !== b.recentlyUsed) return a.recentlyUsed ? -1 : 1;
    return b.relevance - a.relevance;
  });

  const selected: string[] = [];
  let remaining = budgetTokens;

  for (const tool of sorted) {
    if (tool.descriptionTokens <= remaining) {
      selected.push(tool.name);
      remaining -= tool.descriptionTokens;
    } else if (tool.pinned || tool.recentlyUsed) {
      // Always include pinned/recent even if over budget (hard include)
      selected.push(tool.name);
      remaining -= tool.descriptionTokens;
    }
  }

  return selected;
}

/**
 * Compute keyword overlap between a user message and a tool name+description.
 * Returns a score between 0 and 1.
 */
export function computeToolRelevance(
  userMessage: string,
  toolName: string,
  toolDescription: string,
): number {
  const msgTokens = tokenize(userMessage);
  if (msgTokens.size === 0) return 0;

  const toolTokens = tokenize(`${toolName} ${toolDescription}`);
  if (toolTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of msgTokens) {
    if (toolTokens.has(token)) overlap++;
  }

  return overlap / msgTokens.size;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "and", "but", "or",
  "not", "no", "nor", "so", "yet", "both", "each", "few", "more",
  "most", "other", "some", "such", "than", "too", "very", "just",
  "about", "up", "out", "if", "then", "that", "this", "it", "its",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "they",
  "them", "what", "which", "who", "how", "when", "where", "why",
]);

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const words = text.toLowerCase().split(/[^a-z0-9_]+/);
  for (const word of words) {
    if (word.length > 1 && !STOP_WORDS.has(word)) {
      tokens.add(word);
    }
  }
  return tokens;
}

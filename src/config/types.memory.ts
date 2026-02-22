import type { SessionSendPolicyConfig } from "./types.base.js";

export type MemoryBackend = "builtin" | "qmd";
export type MemoryCitationsMode = "auto" | "on" | "off";
export type MemoryQmdSearchMode = "query" | "search" | "vsearch";

export type MemoryConfig = {
  backend?: MemoryBackend;
  citations?: MemoryCitationsMode;
  qmd?: MemoryQmdConfig;
  graph?: GraphMemoryConfig;
};

// ---------------------------------------------------------------------------
// Graph Memory Config
// ---------------------------------------------------------------------------

export type GraphExtractionMode = "heuristic" | "llm" | "hybrid";

export type GraphMemoryConfig = {
  enabled?: boolean;
  /** Entity extraction mode. Default: "heuristic". */
  extractionMode?: GraphExtractionMode;
  /** LLM model for extraction (only used in "llm" or "hybrid" mode). */
  llmModel?: string;
  /** Max entities extracted per chunk. Default: 20. */
  maxEntities?: number;
  /** Min mentions before a node survives pruning. Default: 2. */
  minMentionCount?: number;
  /** Confidence threshold for relationships (0-1). Default: 0.6. */
  relationshipConfidence?: number;
  /** Search configuration. */
  search?: {
    /** Max traversal depth (1-3). Default: 2. */
    maxDepth?: number;
    /** Max nodes visited per search. Default: 50. */
    maxNodes?: number;
    /** Search timeout in ms. Default: 2000. */
    timeoutMs?: number;
    /** Weight of graph boost in merged score. Default: 0.3. */
    graphWeight?: number;
  };
  /** Maintenance schedules. */
  maintenance?: {
    /** Days without reinforcement before edge weight decays. Default: 90. */
    edgeDecayDays?: number;
    /** Days of inactivity before pruning eligible. Default: 120. */
    pruneAfterDays?: number;
    /** Name similarity threshold for entity merging (0-1). Default: 0.85. */
    mergeThreshold?: number;
  };
};

// ---------------------------------------------------------------------------
// Token Budget Config
// ---------------------------------------------------------------------------

export type BudgetZoneName = "system" | "tools" | "memory" | "history" | "reserve";

export type ZoneSpecConfig = {
  min?: number;
  max?: number;
  preferred?: number;
};

export type TokenBudgetConfig = {
  enabled?: boolean;
  /** Per-zone token share overrides (values are 0-1 fractions). */
  zones?: Partial<Record<BudgetZoneName, ZoneSpecConfig>>;
  /** Enable dynamic tool context filtering. Default: false. */
  dynamicToolFiltering?: boolean;
  /** Trigger compaction when total usage exceeds this share (0-1). Default: 0.85. */
  compactionThreshold?: number;
};

// ---------------------------------------------------------------------------
// Semantic Cache Config
// ---------------------------------------------------------------------------

export type SemanticCacheConfig = {
  enabled?: boolean;
  /** Cosine similarity threshold for cache hits (0-1). Default: 0.92. */
  similarityThreshold?: number;
  /** TTL in ms. Default: 86400000 (24 hours). */
  ttlMs?: number;
  /** Max cached entries, LRU eviction. Default: 1000. */
  maxEntries?: number;
  /** Models to exclude from caching. */
  excludeModels?: string[];
};

export type MemoryQmdConfig = {
  command?: string;
  searchMode?: MemoryQmdSearchMode;
  includeDefaultMemory?: boolean;
  paths?: MemoryQmdIndexPath[];
  sessions?: MemoryQmdSessionConfig;
  update?: MemoryQmdUpdateConfig;
  limits?: MemoryQmdLimitsConfig;
  scope?: SessionSendPolicyConfig;
};

export type MemoryQmdIndexPath = {
  path: string;
  name?: string;
  pattern?: string;
};

export type MemoryQmdSessionConfig = {
  enabled?: boolean;
  exportDir?: string;
  retentionDays?: number;
};

export type MemoryQmdUpdateConfig = {
  interval?: string;
  debounceMs?: number;
  onBoot?: boolean;
  waitForBootSync?: boolean;
  embedInterval?: string;
  commandTimeoutMs?: number;
  updateTimeoutMs?: number;
  embedTimeoutMs?: number;
};

export type MemoryQmdLimitsConfig = {
  maxResults?: number;
  maxSnippetChars?: number;
  maxInjectedChars?: number;
  timeoutMs?: number;
};

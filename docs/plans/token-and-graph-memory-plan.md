# Plan: Enhanced Token Management & Graph-Based Memory

## Design Philosophy

**Additive, opt-in enhancements** — the current SQLite + hybrid search memory system
and the existing compaction/summarization pipeline remain the default. New capabilities
are layered on top with graceful fallback chains:

```
Graph Memory → Vector+FTS Hybrid (current) → FTS-only → raw file search
Token Budget → Compaction → Summarization → Overflow retry (current)
```

If any enhanced layer fails, the system falls through to the proven current behavior.

---

## Part A: Token Budget Manager

### Problem
- Current token estimation uses a crude 4-chars-per-token heuristic
- No explicit token budget allocation across context zones
- No semantic caching of LLM responses across sessions
- Tool context loaded statically (all tools described regardless of relevance)
- No prompt compression for RAG-injected memory results
- Context rot research shows performance degrades significantly beyond ~30K tokens

### A1. Token Budget Allocator

**New file:** `src/agents/token-budget.ts`

A budget allocator that partitions the resolved context window into zones:

```
┌─────────────────────────────────────────────┐
│ System Instructions        10-15% (static)  │
│ Tool Descriptions          15-20% (dynamic) │
│ Memory / Knowledge         30-40% (RAG)     │
│ Conversation History       20-30% (sliding) │
│ Reserve Buffer             10-15% (safety)  │
└─────────────────────────────────────────────┘
```

**Implementation:**
- `TokenBudget` class with zone-based allocation
- Each zone has a `min`, `max`, and `preferred` token count
- `allocate(contextWindow: number)` → returns per-zone budgets
- `reportUsage(zone, actualTokens)` → tracks actual vs budgeted
- Compaction triggers when any zone exceeds its max
- Config: `agents.defaults.tokenBudget` (optional, disabled = current behavior)

**Fallback:** If disabled or allocation fails, current behavior unchanged.

### A2. Dynamic Tool Context Filtering

**Modified file:** `src/agents/pi-embedded-runner/tool-result-context-guard.ts`

Currently all tool descriptions are injected into every prompt. Add relevance-based
filtering:

- Score tool relevance against the current user message (keyword overlap + usage history)
- Include top-N tools that fit within the tool zone budget
- Always include recently-used tools (last 3 turns) and pinned tools
- Config: `agents.defaults.tokenBudget.dynamicToolFiltering: boolean` (default: false)

**Fallback:** If disabled, all tools included as today.

### A3. Semantic Response Cache

**New file:** `src/agents/semantic-cache.ts`

Cross-session cache for LLM responses to semantically similar queries:

- On each LLM call, embed the prompt (reuse memory embedding provider)
- Check cache for similar prompts above threshold (default 0.92 cosine similarity)
- On hit: return cached response, skip LLM call
- On miss: call LLM, store response + prompt embedding in cache
- Storage: SQLite table in the agent's memory database
- TTL: configurable (default 24 hours), LRU eviction at max entries
- Config: `agents.defaults.semanticCache` (optional, disabled by default)

**Schema:**
```sql
CREATE TABLE semantic_cache (
  id TEXT PRIMARY KEY,
  prompt_hash TEXT NOT NULL,
  prompt_embedding BLOB NOT NULL,
  response TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_hit_at INTEGER NOT NULL,
  hit_count INTEGER DEFAULT 0
);
```

**Fallback:** If disabled or cache miss, normal LLM call proceeds.

### A4. Incremental History Summarization

**Modified file:** `src/agents/compaction.ts`

Enhance the existing `summarizeInStages` with incremental summarization:

- After every N turns (configurable, default 5), summarize the oldest unsummarized
  block into a ~200-token digest
- Maintain a rolling summary chain: `[summary_1] [summary_2] ... [recent_verbatim]`
- Recent turns (last 3-5) always kept verbatim
- Summaries stored in session metadata (not re-generated on reload)
- Config: `agents.defaults.compaction.incremental: boolean` (default: false)

**Fallback:** If disabled, current 2-part summarization on overflow continues.

### A5. Memory Result Compression

**New file:** `src/memory/result-compression.ts`

Before injecting memory search results into the prompt, compress them:

- Extract key facts from each result snippet (via lightweight LLM call or heuristic)
- Deduplicate overlapping facts across results
- Format as dense bullet points instead of raw chunks
- Target compression ratio: 3:1 to 5:1
- Config: `agents.defaults.memorySearch.query.compression: boolean` (default: false)

**Fallback:** If disabled, raw snippets injected as today.

---

## Part B: Graph-Based Memory

### Problem
- Current memory is chunk-based (flat): no entity relationships, no temporal reasoning
- Cannot answer "who worked on X with Y last month?" without full-text scanning
- No knowledge graph to connect concepts, people, projects across sessions
- Session memory is append-only JSONL with no structured extraction

### B1. Graph Memory Backend

**New file:** `src/memory/graph/graph-store.ts`

A graph layer that runs **alongside** (not replacing) the existing vector+FTS system:

**Architecture (inspired by Mem0g):**
```
Message Input
    │
    ├──→ Existing Pipeline (unchanged)
    │    ├── Chunk → Embed → SQLite + sqlite-vec
    │    └── FTS5 index
    │
    └──→ Graph Pipeline (new, optional)
         ├── Entity Extraction (LLM or heuristic)
         ├── Relationship Generation (LLM or pattern-based)
         ├── Node/Edge Storage (SQLite graph tables)
         └── Graph Query (traversal + scoring)
```

**Storage — SQLite-based (no external dependencies):**

```sql
-- Entity nodes
CREATE TABLE graph_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,           -- person, project, concept, tool, file, date
  embedding BLOB,               -- entity embedding for semantic lookup
  properties TEXT,              -- JSON metadata
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  mention_count INTEGER DEFAULT 1
);

-- Relationship edges (directed, labeled)
CREATE TABLE graph_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES graph_nodes(id),
  target_id TEXT NOT NULL REFERENCES graph_nodes(id),
  relation TEXT NOT NULL,       -- "works_on", "mentioned_with", "depends_on", etc.
  weight REAL DEFAULT 1.0,
  properties TEXT,              -- JSON metadata
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(source_id, target_id, relation)
);

-- Link graph entities back to memory chunks
CREATE TABLE graph_chunk_refs (
  node_id TEXT NOT NULL REFERENCES graph_nodes(id),
  chunk_id TEXT NOT NULL,       -- references chunks.id in main schema
  PRIMARY KEY (node_id, chunk_id)
);

-- Indexes
CREATE INDEX idx_edges_source ON graph_edges(source_id);
CREATE INDEX idx_edges_target ON graph_edges(target_id);
CREATE INDEX idx_edges_relation ON graph_edges(relation);
CREATE INDEX idx_nodes_type ON graph_nodes(type);
CREATE INDEX idx_nodes_name ON graph_nodes(name);
```

**Fallback:** If graph backend disabled or fails, vector+FTS search returns results
as today. Graph results are merged only when available.

### B2. Entity Extraction Pipeline

**New file:** `src/memory/graph/entity-extractor.ts`

Two extraction modes (configurable):

**Mode 1: Heuristic (fast, no LLM cost)**
- Named Entity Recognition via regex patterns:
  - `@mentions`, `#tags`, file paths, URLs, email addresses
  - CamelCase/PascalCase identifiers (class names, function names)
  - Date patterns (ISO 8601, natural language dates)
  - Quoted strings as potential concepts
- Relationship inference from co-occurrence within same chunk
- Suitable for: development, low-cost deployments

**Mode 2: LLM-assisted (higher quality, costs tokens)**
- Structured output call to extract entities + relationships:
  ```json
  {
    "entities": [
      { "name": "UserAuth", "type": "concept", "aliases": ["authentication"] }
    ],
    "relationships": [
      { "source": "UserAuth", "relation": "implemented_in", "target": "auth.ts" }
    ]
  }
  ```
- Uses the structured output JSON Schema pattern (already added to the codebase)
- Batched: process N chunks per LLM call to reduce overhead
- Suitable for: enterprise, high-value knowledge bases

**Config:**
```typescript
memory.graph?: {
  enabled?: boolean;              // default: false
  extractionMode?: 'heuristic' | 'llm' | 'hybrid';  // default: 'heuristic'
  llmModel?: string;              // model for extraction (default: budget-tier)
  maxEntities?: number;           // cap per chunk (default: 20)
  minMentionCount?: number;       // prune low-frequency nodes (default: 2)
  relationshipConfidence?: number; // threshold 0-1 (default: 0.6)
}
```

**Fallback:** If extraction fails on a chunk, that chunk is still indexed via
the existing vector+FTS pipeline. Only graph enrichment is skipped.

### B3. Graph-Aware Search

**New file:** `src/memory/graph/graph-search.ts`

Extends the existing `MemorySearchManager` interface:

**Query Flow:**
```
User Query
    │
    ├──→ Vector + FTS Search (existing, runs always)
    │    └── Returns: scored chunk results
    │
    └──→ Graph Search (new, runs in parallel if enabled)
         ├── Extract entities from query
         ├── Find matching nodes (name similarity + embedding)
         ├── Traverse 1-2 hops for related entities
         ├── Retrieve chunks linked via graph_chunk_refs
         └── Returns: graph-enriched results with relationship context
    │
    └──→ Merge & Re-rank
         ├── Union results by chunk ID
         ├── Boost chunks that appear in both result sets
         ├── Add relationship context as metadata
         └── Final ranking: base_score * (1 + graph_boost * 0.3)
```

**Graph boost factors:**
- Direct entity match: +0.3
- 1-hop relationship: +0.15
- 2-hop relationship: +0.05
- Temporal recency bonus: +0.1 (entity seen in last 7 days)

**Fallback:** If graph search fails or times out (default 2s), only vector+FTS
results are returned. The merge step gracefully handles empty graph results.

### B4. Graph Maintenance

**New file:** `src/memory/graph/graph-maintenance.ts`

Background maintenance tasks:

- **Entity Merging:** Deduplicate nodes with similar names/embeddings
  (cosine > 0.95) — merge properties, sum mention counts
- **Edge Decay:** Reduce edge weights for relationships not reinforced
  over configurable period (default: 90 days, halve weight)
- **Pruning:** Remove nodes with mention_count < threshold and no recent edges
- **Statistics:** Expose node/edge counts, top entities, relationship distribution
- Runs on sync interval (same as existing memory sync) or on-demand

### B5. Memory Tool Enhancement

**Modified file:** `src/agents/tools/memory-tool.ts`

Add optional graph-aware capabilities to the existing memory tools:

```typescript
// Enhanced memory_search - adds relationship context when graph enabled
memory_search:
  - Existing: query, maxResults, minScore
  - New optional: includeRelationships (boolean, default: true if graph enabled)
  - Returns: results[] now include optional `relationships` field

// New tool (only registered when graph enabled)
memory_graph_query:
  - Input: entity (string), depth (1-3), relationFilter? (string[])
  - Returns: nodes[], edges[], relatedChunks[]
  - Purpose: Let agent explicitly explore entity relationships
```

**Fallback:** If graph not enabled, `memory_search` works exactly as today.
`memory_graph_query` tool is simply not registered.

---

## Part C: Configuration & Fallback Chain

### C1. Config Schema Additions

**Modified file:** `src/config/types.memory.ts` and `src/config/types.tools.ts`

```typescript
// Memory config additions
memory?: {
  backend?: 'builtin' | 'qmd';       // existing
  graph?: GraphMemoryConfig;           // NEW
  citations?: 'auto' | 'on' | 'off'; // existing
};

// Agent defaults additions
agents.defaults?: {
  tokenBudget?: TokenBudgetConfig;     // NEW
  semanticCache?: SemanticCacheConfig; // NEW
  // existing fields unchanged
};
```

### C2. Fallback Chain Design

Every enhancement follows the same pattern:

```
Enhanced Feature (opt-in)
    │
    ├── Success → Use enhanced result
    │
    └── Failure/Timeout/Disabled
         │
         └── Current Behavior (always available, unchanged)
```

Specific chains:

| Feature | Primary | Fallback 1 | Fallback 2 |
|---------|---------|------------|------------|
| Memory Search | Graph + Vector + FTS | Vector + FTS (current) | FTS-only |
| Token Management | Budget Allocator | Compaction (current) | Overflow retry |
| Response Cache | Semantic Cache | Direct LLM call | Retry with smaller context |
| Entity Extraction | LLM-assisted | Heuristic | Skip (chunk-only indexing) |
| History Management | Incremental Summary | 2-part Summary (current) | Drop oldest |
| Tool Filtering | Dynamic relevance | All tools (current) | — |

---

## Implementation Order

### Phase 1: Token Budget Foundation (4 files)
1. `src/agents/token-budget.ts` — Budget allocator with zone-based allocation
2. Modify `src/agents/compaction.ts` — Add incremental summarization option
3. Modify `src/agents/context-window-guard.ts` — Integrate budget allocator
4. Modify `src/agents/pi-settings.ts` — Add tokenBudget config resolution

### Phase 2: Graph Memory Core (5 files)
5. `src/memory/graph/graph-store.ts` — SQLite graph schema + CRUD operations
6. `src/memory/graph/entity-extractor.ts` — Heuristic + LLM extraction modes
7. `src/memory/graph/graph-search.ts` — Graph traversal + result scoring
8. `src/memory/graph/graph-maintenance.ts` — Merge, decay, prune
9. Modify `src/config/types.memory.ts` — Add GraphMemoryConfig type

### Phase 3: Integration & Search Merge (4 files)
10. Modify `src/memory/manager.ts` — Initialize graph store during sync
11. Modify `src/memory/manager-search.ts` — Merge graph results with vector+FTS
12. Modify `src/agents/tools/memory-tool.ts` — Add memory_graph_query tool
13. `src/memory/graph/graph-merge.ts` — Result merging and boost logic

### Phase 4: Advanced Token Optimization (3 files)
14. `src/agents/semantic-cache.ts` — Semantic response cache
15. `src/memory/result-compression.ts` — Memory result compression
16. Modify `src/agents/pi-embedded-runner/tool-result-context-guard.ts` — Dynamic tool filtering

### Phase 5: Tests & Documentation (4 files)
17. `src/agents/token-budget.test.ts` — Budget allocation, zone enforcement, fallback
18. `src/memory/graph/graph-store.test.ts` — CRUD, entity merge, edge decay, pruning
19. `src/memory/graph/graph-search.test.ts` — Search merge, boost scoring, fallback
20. `src/agents/semantic-cache.test.ts` — Cache hit/miss, TTL, eviction

**Total: ~20 files (8 new, 8 modified, 4 test files)**

---

## Security Considerations

- **Graph Entity Extraction:** Sanitize entity names (max 200 chars, strip control chars)
- **Semantic Cache:** Never cache responses containing credentials or PII markers
- **LLM Extraction Calls:** Use budget-tier models, enforce max_tokens limits
- **SQLite Graph Tables:** Same file permissions as existing memory database
- **Graph Traversal:** Depth-limited (max 3 hops) to prevent DoS on large graphs
- **Entity Embedding Storage:** Same encryption-at-rest as existing embeddings

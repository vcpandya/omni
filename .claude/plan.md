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

Currently all tool descriptions are injected into every prompt. Add relevance-based filtering:

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

**Architecture (inspired by Mem0g + Loop/RLM hypergraph store):**
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
CREATE TABLE graph_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,           -- person, project, concept, tool, file, date
  embedding BLOB,
  properties TEXT,              -- JSON metadata
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  mention_count INTEGER DEFAULT 1
);

CREATE TABLE graph_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES graph_nodes(id),
  target_id TEXT NOT NULL REFERENCES graph_nodes(id),
  relation TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  properties TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(source_id, target_id, relation)
);

CREATE TABLE graph_chunk_refs (
  node_id TEXT NOT NULL REFERENCES graph_nodes(id),
  chunk_id TEXT NOT NULL,
  PRIMARY KEY (node_id, chunk_id)
);
```

**Fallback:** If graph backend disabled or fails, vector+FTS search returns results
as today. Graph results are merged only when available.

### B2. Entity Extraction Pipeline

**New file:** `src/memory/graph/entity-extractor.ts`

Two extraction modes (configurable):

**Mode 1: Heuristic (fast, no LLM cost)**
- NER via regex: @mentions, #tags, file paths, URLs, emails, CamelCase identifiers, dates
- Relationship inference from co-occurrence within same chunk

**Mode 2: LLM-assisted (higher quality, costs tokens)**
- Structured output JSON Schema for entity + relationship extraction
- Batched: N chunks per LLM call
- Uses budget-tier model

**Mode 3: Hybrid (default when graph enabled)**
- Heuristic first pass, LLM refinement for ambiguous entities

**Fallback:** If extraction fails, chunk is still indexed via existing pipeline.

### B3. Graph-Aware Search

**New file:** `src/memory/graph/graph-search.ts`

Runs **in parallel** with existing vector+FTS search:

```
Query → [Vector+FTS (always)] + [Graph Search (if enabled)]
                    ↓                        ↓
              chunk results          graph-enriched results
                    ↓                        ↓
                    └────── Merge & Re-rank ──┘
```

Graph boost factors: direct match +0.3, 1-hop +0.15, 2-hop +0.05, recency +0.1

**Fallback:** If graph search fails/times out (2s), only vector+FTS results returned.

### B4. Graph Maintenance

**New file:** `src/memory/graph/graph-maintenance.ts`

- Entity merging (cosine > 0.95 dedup)
- Edge decay (halve weight after 90 days without reinforcement)
- Pruning (remove low-mention nodes with no recent edges)
- Runs on existing sync interval

### B5. Memory Tool Enhancement

**Modified file:** `src/agents/tools/memory-tool.ts`

- `memory_search` gains optional `relationships` in results when graph enabled
- New `memory_graph_query` tool (only registered when graph enabled)

---

## Part C: Fallback Chain Summary

| Feature | Primary | Fallback 1 | Fallback 2 |
|---------|---------|------------|------------|
| Memory Search | Graph + Vector + FTS | Vector + FTS (current) | FTS-only |
| Token Management | Budget Allocator | Compaction (current) | Overflow retry |
| Response Cache | Semantic Cache | Direct LLM call | Retry with smaller context |
| Entity Extraction | LLM-assisted | Heuristic | Skip (chunk-only) |
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
5. `src/memory/graph/graph-store.ts` — SQLite graph schema + CRUD
6. `src/memory/graph/entity-extractor.ts` — Heuristic + LLM extraction
7. `src/memory/graph/graph-search.ts` — Graph traversal + scoring
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

### Phase 5: Tests (4 files)
17. `src/agents/token-budget.test.ts`
18. `src/memory/graph/graph-store.test.ts`
19. `src/memory/graph/graph-search.test.ts`
20. `src/agents/semantic-cache.test.ts`

**Total: ~20 files (8 new, 8 modified, 4 test files)**

---

## Security Considerations

- Entity names sanitized (max 200 chars, strip control chars)
- Semantic cache never stores responses with credential/PII markers
- LLM extraction uses budget-tier models with max_tokens limits
- Graph traversal depth-limited (max 3 hops)
- SQLite graph tables use same file permissions as existing memory DB

## Research Sources

- [Loop/RLM](https://github.com/rand/loop) — Hypergraph knowledge store, recursive decomposition
- [Mem0 Paper](https://arxiv.org/abs/2504.19413) — Dual-store vector+graph, 91% lower latency
- [Context Rot](https://research.trychroma.com/context-rot) — Performance degrades non-linearly with input length
- [Token Budget-Aware Reasoning](https://arxiv.org/abs/2412.18547) — 68% token reduction maintaining accuracy
- [Context Engineering](https://www.getmaxim.ai/articles/context-engineering-for-ai-agents-production-optimization-strategies/) — Zone-based budget allocation, 60-80% cost reduction

# Semantic Cache

Omni includes a cross-session LLM response cache that matches queries by exact hash and cosine similarity.

## How It Works

1. **Exact match** — SHA-256 hash of the prompt is checked first for an instant cache hit.
2. **Semantic match** — if no exact match, the prompt embedding is compared against cached entries using cosine similarity.
3. **Cache hit** — if similarity exceeds the threshold, the cached response is returned without an LLM call.

## Features

- **Cross-session** — cache entries are shared across all sessions.
- **LRU eviction** — least recently used entries are evicted when the cache reaches capacity.
- **Configurable TTL** — entries expire after a configurable time-to-live.
- **Similarity threshold** — tune how close a match must be (default: 0.92).

## Configuration

```json5
{
  agent: {
    semanticCache: {
      enabled: true,
      maxEntries: 1000,
      ttlMs: 3600000,       // 1 hour
      similarityThreshold: 0.92,
    },
  },
}
```

## Related

- [Token budget](token-budget.md)
- [Memory](memory.md)
- [Models](models.md)

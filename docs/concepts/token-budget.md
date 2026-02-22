# Token Budget

Omni uses zone-based context window partitioning to manage token allocation across different parts of a prompt.

## Zones

| Zone | Description | Default |
|------|-------------|---------|
| `system` | System prompt, AGENTS.md, SOUL.md, TOOLS.md | 20% |
| `tools` | Tool definitions and schemas | 15% |
| `memory` | Long-term memory (vector, FTS, graph) | 15% |
| `history` | Conversation history | 40% |
| `reserve` | Buffer for model response | 10% |

## How It Works

Each zone has `min`, `max`, and `preferred` token allocations. The budget manager:

1. Allocates minimum tokens to each zone.
2. Distributes remaining tokens based on preferred ratios.
3. Respects maximum caps per zone.
4. Triggers compaction when history exceeds its allocation.

## Configuration

```json5
{
  agent: {
    tokenBudget: {
      system: { min: 1000, preferred: 4000, max: 8000 },
      tools: { min: 500, preferred: 3000, max: 6000 },
      memory: { min: 500, preferred: 3000, max: 6000 },
      history: { min: 2000, preferred: 8000, max: 16000 },
      reserve: { min: 1000, preferred: 2000, max: 4000 },
    },
  },
}
```

## Related

- [Session pruning](session-pruning.md)
- [Compaction](compaction.md)
- [Context](context.md)

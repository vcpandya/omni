# Graph Memory

Omni includes a SQLite-backed knowledge graph that complements vector and full-text search memory with entity-aware recall.

## How It Works

The graph memory system extracts entities and relationships from conversations and stores them in a local SQLite database. This enables:

- **Entity extraction** — identifies people, places, concepts, and their properties.
- **Relationship tracking** — stores connections between entities with typed edges.
- **Subgraph search** — traverses the graph to find related entities within N hops.
- **Time-based decay** — edge weights decay over time, surfacing recent relationships.

## Architecture

```
Conversation → Entity Extraction → SQLite Graph DB
                                      ↓
                    Subgraph Query ← Memory Recall
```

The graph works alongside:
- **Vector memory** — for semantic similarity search.
- **FTS memory** — for keyword-based search.
- **Graph memory** — for relationship-aware recall.

## Configuration

```json5
{
  memory: {
    graph: {
      enabled: true,
      maxEntities: 10000,
      decayFactor: 0.95,
      maxHops: 3,
    },
  },
}
```

## Related

- [Memory](memory.md)
- [Semantic cache](semantic-cache.md)
- [Token budget](token-budget.md)

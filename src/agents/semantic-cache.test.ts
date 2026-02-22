import { describe, it, expect, beforeEach } from "vitest";
import {
  SemanticCache,
  promptHash,
  cosineSimilarity,
  type CacheDb,
  type CacheStatement,
} from "./semantic-cache.js";

// ---------------------------------------------------------------------------
// In-memory cache store mock
// ---------------------------------------------------------------------------

function createMockCacheDb(): CacheDb {
  const rows = new Map<string, Record<string, unknown>>();

  const mockStatement = (sql: string): CacheStatement => {
    const sqlLower = sql.trim().toLowerCase();

    return {
      run(...params: unknown[]) {
        if (sqlLower.includes("insert") && sqlLower.includes("semantic_cache")) {
          const id = params[0] as string;
          rows.set(id, {
            id,
            prompt_hash: params[1],
            prompt_embedding: params[2],
            response: params[3],
            model: params[4],
            created_at: params[5],
            last_hit_at: params[6],
            hit_count: 0,
          });
          return { changes: 1 };
        }

        if (sqlLower.includes("update") && sqlLower.includes("semantic_cache")) {
          const id = params[params.length - 1] as string;
          const row = rows.get(id);
          if (row) {
            row.last_hit_at = params[0];
            row.hit_count = (row.hit_count as number) + 1;
            return { changes: 1 };
          }
          return { changes: 0 };
        }

        if (sqlLower.includes("delete") && sqlLower.includes("semantic_cache")) {
          if (sqlLower.includes("created_at <")) {
            const cutoff = params[0] as number;
            let changes = 0;
            for (const [id, row] of [...rows]) {
              if ((row.created_at as number) < cutoff) {
                rows.delete(id);
                changes++;
              }
            }
            return { changes };
          }
          if (sqlLower.includes("where id in")) {
            const limit = params[0] as number;
            const sorted = [...rows.entries()].sort(
              (a, b) => (a[1].last_hit_at as number) - (b[1].last_hit_at as number),
            );
            let changes = 0;
            for (let i = 0; i < Math.min(limit, sorted.length); i++) {
              rows.delete(sorted[i][0]);
              changes++;
            }
            return { changes };
          }
          // clear all
          const size = rows.size;
          rows.clear();
          return { changes: size };
        }

        return { changes: 0 };
      },

      get(...params: unknown[]) {
        // Stats query (has both COUNT and SUM) — must come before simple COUNT
        if (sqlLower.includes("sum(hit_count)")) {
          let total = 0;
          let totalHits = 0;
          let oldest = Infinity;
          for (const [, row] of rows) {
            total++;
            totalHits += row.hit_count as number;
            oldest = Math.min(oldest, row.created_at as number);
          }
          return {
            total,
            total_hits: totalHits,
            avg_hits: total > 0 ? totalHits / total : 0,
            oldest: total > 0 ? oldest : 0,
          };
        }

        if (sqlLower.includes("count(*)")) {
          return { c: rows.size };
        }

        if (sqlLower.includes("prompt_hash = ?")) {
          const hash = params[0] as string;
          const model = params[1] as string;
          const cutoff = params[2] as number;
          for (const [, row] of rows) {
            if (
              row.prompt_hash === hash &&
              row.model === model &&
              (row.created_at as number) > cutoff
            ) {
              return row;
            }
          }
          return undefined;
        }

        return undefined;
      },

      all(...params: unknown[]) {
        if (sqlLower.includes("semantic_cache") && sqlLower.includes("model = ?")) {
          const model = params[0] as string;
          const cutoff = params[1] as number;
          return [...rows.values()]
            .filter(
              (r) => r.model === model && (r.created_at as number) > cutoff,
            )
            .sort((a, b) => (b.last_hit_at as number) - (a.last_hit_at as number))
            .slice(0, 200);
        }
        return [];
      },
    };
  };

  return {
    exec(sql: string) {
      if (sql.toLowerCase().includes("delete") && sql.toLowerCase().includes("semantic_cache")) {
        rows.clear();
      }
    },
    prepare: mockStatement,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("promptHash", () => {
  it("produces consistent hash", () => {
    expect(promptHash("hello")).toBe(promptHash("hello"));
  });

  it("differs for different inputs", () => {
    expect(promptHash("hello")).not.toBe(promptHash("world"));
  });
});

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const v = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it("returns -1.0 for opposite vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity(new Float32Array(0), new Float32Array(0))).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe("SemanticCache", () => {
  let db: CacheDb;
  let cache: SemanticCache;

  beforeEach(() => {
    db = createMockCacheDb();
    cache = new SemanticCache(db, {
      similarityThreshold: 0.9,
      ttlMs: 60_000, // 1 minute for testing
      maxEntries: 5,
    });
    cache.initialize();
  });

  describe("store and lookup", () => {
    it("stores and retrieves by exact hash", () => {
      const hash = promptHash("test prompt");
      const emb = new Float32Array([1, 0, 0]);
      cache.store(hash, emb, "test response", "gpt-4");

      const result = cache.lookup(hash, null, "gpt-4");
      expect(result.hit).toBe(true);
      if (result.hit) {
        expect(result.response).toBe("test response");
        expect(result.similarity).toBe(1.0);
      }
    });

    it("returns miss for unknown hash", () => {
      const result = cache.lookup(promptHash("unknown"), null, "gpt-4");
      expect(result.hit).toBe(false);
    });

    it("returns miss for excluded model", () => {
      const cacheExclude = new SemanticCache(db, {
        excludeModels: ["gpt-4"],
      });
      cacheExclude.initialize();

      const hash = promptHash("test");
      const emb = new Float32Array([1, 0, 0]);
      cacheExclude.store(hash, emb, "test response", "gpt-4");

      const result = cacheExclude.lookup(hash, null, "gpt-4");
      expect(result.hit).toBe(false);
    });

    it("does not cache sensitive content", () => {
      const hash = promptHash("test");
      const emb = new Float32Array([1, 0, 0]);
      const stored = cache.store(hash, emb, "Your API key is sk-abc123", "gpt-4");
      expect(stored).toBe(false);
    });

    it("does not cache responses with passwords", () => {
      const hash = promptHash("test");
      const emb = new Float32Array([1, 0, 0]);
      const stored = cache.store(hash, emb, "The password is secret123", "gpt-4");
      expect(stored).toBe(false);
    });

    it("does not cache Bearer tokens", () => {
      const hash = promptHash("test");
      const emb = new Float32Array([1, 0, 0]);
      const stored = cache.store(
        hash, emb, "Auth header: Bearer eyJhbGciOiJIUzI1NiJ9.abc", "gpt-4",
      );
      expect(stored).toBe(false);
    });

    it("scopes cache by model", () => {
      const hash = promptHash("test prompt");
      const emb = new Float32Array([1, 0, 0]);
      cache.store(hash, emb, "gpt4 response", "gpt-4");

      // Same hash but different model → miss
      const result = cache.lookup(hash, null, "claude-3");
      expect(result.hit).toBe(false);
    });
  });

  describe("stats", () => {
    it("returns zero stats for empty cache", () => {
      const stats = cache.stats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.totalHits).toBe(0);
    });

    it("tracks entries after store", () => {
      cache.store(promptHash("a"), new Float32Array([1, 0, 0]), "resp-a", "gpt-4");
      cache.store(promptHash("b"), new Float32Array([0, 1, 0]), "resp-b", "gpt-4");
      const stats = cache.stats();
      expect(stats.totalEntries).toBe(2);
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      cache.store(promptHash("a"), new Float32Array([1, 0, 0]), "resp-a", "gpt-4");
      cache.store(promptHash("b"), new Float32Array([0, 1, 0]), "resp-b", "gpt-4");
      cache.clear();
      const stats = cache.stats();
      expect(stats.totalEntries).toBe(0);
    });
  });
});

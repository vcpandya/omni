/**
 * Semantic Response Cache — cross-session LLM response caching.
 *
 * On each LLM call:
 *   1. Hash the prompt → check exact-match cache
 *   2. If miss, embed the prompt → cosine search cached embeddings
 *   3. If semantic hit (>= threshold), return cached response
 *   4. If miss, call LLM, store (prompt_hash, embedding, response)
 *
 * Opt-in via `agents.defaults.semanticCache`.
 * When disabled, LLM calls proceed normally.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SemanticCacheConfig {
  enabled?: boolean;
  /** Cosine similarity threshold for cache hits (0-1). Default: 0.92. */
  similarityThreshold?: number;
  /** TTL in ms. Default: 24 hours. */
  ttlMs?: number;
  /** Max cached entries. Default: 1000. LRU eviction. */
  maxEntries?: number;
  /** Models to exclude from caching (e.g., creative tasks). */
  excludeModels?: string[];
  /** Never cache responses containing these patterns. */
  sensitivePatterns?: string[];
}

export interface CacheEntry {
  id: string;
  promptHash: string;
  promptEmbedding: Float32Array;
  response: string;
  model: string;
  createdAt: number;
  lastHitAt: number;
  hitCount: number;
}

export interface CacheHitResult {
  hit: true;
  response: string;
  similarity: number;
  entryId: string;
  hitCount: number;
}

export interface CacheMissResult {
  hit: false;
}

export type CacheLookupResult = CacheHitResult | CacheMissResult;

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

export const SEMANTIC_CACHE_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS semantic_cache (
  id TEXT PRIMARY KEY,
  prompt_hash TEXT NOT NULL,
  prompt_embedding BLOB NOT NULL,
  response TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_hit_at INTEGER NOT NULL,
  hit_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_semantic_cache_hash ON semantic_cache(prompt_hash);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_model ON semantic_cache(model);
CREATE INDEX IF NOT EXISTS idx_semantic_cache_lru ON semantic_cache(last_hit_at);
`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SIMILARITY_THRESHOLD = 0.92;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000; // 24 hours
const DEFAULT_MAX_ENTRIES = 1_000;

const DEFAULT_SENSITIVE_PATTERNS = [
  /api[\s_-]?key/i,
  /secret/i,
  /password/i,
  /\bauth[\s_-]?token\b/i,
  /credential/i,
  /private[\s_-]?key/i,
  /-----BEGIN/,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/,
];

// ---------------------------------------------------------------------------
// Minimal DB interface (same pattern as graph-store)
// ---------------------------------------------------------------------------

export interface CacheDb {
  exec(sql: string): void;
  prepare(sql: string): CacheStatement;
}

export interface CacheStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// SemanticCache class
// ---------------------------------------------------------------------------

export class SemanticCache {
  private db: CacheDb;
  private config: Required<
    Pick<SemanticCacheConfig, "similarityThreshold" | "ttlMs" | "maxEntries">
  >;
  private sensitivePatterns: RegExp[];
  private excludeModels: Set<string>;

  constructor(db: CacheDb, config?: SemanticCacheConfig) {
    this.db = db;
    this.config = {
      similarityThreshold: config?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD,
      ttlMs: config?.ttlMs ?? DEFAULT_TTL_MS,
      maxEntries: config?.maxEntries ?? DEFAULT_MAX_ENTRIES,
    };
    this.sensitivePatterns = [
      ...DEFAULT_SENSITIVE_PATTERNS,
      ...(config?.sensitivePatterns?.map((p) => new RegExp(p, "i")) ?? []),
    ];
    this.excludeModels = new Set(config?.excludeModels ?? []);
  }

  /** Create tables if needed. */
  initialize(): void {
    this.db.exec(SEMANTIC_CACHE_SCHEMA_DDL);
  }

  /**
   * Look up a cached response for a prompt.
   *
   * Strategy:
   *   1. Exact hash match (fastest)
   *   2. Semantic similarity search (embedding cosine)
   */
  lookup(
    promptHash: string,
    promptEmbedding: Float32Array | null,
    model: string,
  ): CacheLookupResult {
    if (this.excludeModels.has(model)) return { hit: false };

    const now = Date.now();
    const ttlCutoff = now - this.config.ttlMs;

    // 1. Exact hash match
    const exactRow = this.db.prepare(
      "SELECT * FROM semantic_cache WHERE prompt_hash = ? AND model = ? AND created_at > ?",
    ).get(promptHash, model, ttlCutoff) as Record<string, unknown> | undefined;

    if (exactRow) {
      this.db.prepare(
        "UPDATE semantic_cache SET last_hit_at = ?, hit_count = hit_count + 1 WHERE id = ?",
      ).run(now, exactRow.id);
      return {
        hit: true,
        response: exactRow.response as string,
        similarity: 1.0,
        entryId: exactRow.id as string,
        hitCount: (exactRow.hit_count as number) + 1,
      };
    }

    // 2. Semantic similarity search
    if (!promptEmbedding) return { hit: false };

    const candidates = this.db.prepare(
      "SELECT * FROM semantic_cache WHERE model = ? AND created_at > ? ORDER BY last_hit_at DESC LIMIT 200",
    ).all(model, ttlCutoff) as Array<Record<string, unknown>>;

    let bestSimilarity = 0;
    let bestRow: Record<string, unknown> | null = null;

    for (const row of candidates) {
      const cached = bufferToFloat32(row.prompt_embedding as Buffer);
      if (!cached) continue;
      const sim = cosineSimilarity(promptEmbedding, cached);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestRow = row;
      }
    }

    if (bestRow && bestSimilarity >= this.config.similarityThreshold) {
      this.db.prepare(
        "UPDATE semantic_cache SET last_hit_at = ?, hit_count = hit_count + 1 WHERE id = ?",
      ).run(now, bestRow.id);
      return {
        hit: true,
        response: bestRow.response as string,
        similarity: bestSimilarity,
        entryId: bestRow.id as string,
        hitCount: (bestRow.hit_count as number) + 1,
      };
    }

    return { hit: false };
  }

  /**
   * Store a new response in the cache.
   * Returns false if the response contains sensitive patterns.
   */
  store(
    promptHash: string,
    promptEmbedding: Float32Array,
    response: string,
    model: string,
  ): boolean {
    if (this.excludeModels.has(model)) return false;

    // Check for sensitive content
    if (this.containsSensitiveContent(response)) return false;

    const now = Date.now();
    const id = createHash("sha256")
      .update(`${promptHash}:${model}:${now}`)
      .digest("hex")
      .slice(0, 24);

    const embBlob = Buffer.from(promptEmbedding.buffer);

    this.db.prepare(`
      INSERT OR REPLACE INTO semantic_cache
        (id, prompt_hash, prompt_embedding, response, model, created_at, last_hit_at, hit_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(id, promptHash, embBlob, response, model, now, now);

    // Enforce max entries (LRU eviction)
    this.evictIfNeeded();

    return true;
  }

  /** Evict oldest entries if cache exceeds maxEntries. */
  private evictIfNeeded(): void {
    const countRow = this.db.prepare(
      "SELECT COUNT(*) as c FROM semantic_cache",
    ).get() as { c: number };

    if (countRow.c > this.config.maxEntries) {
      const excess = countRow.c - this.config.maxEntries;
      this.db.prepare(`
        DELETE FROM semantic_cache WHERE id IN (
          SELECT id FROM semantic_cache ORDER BY last_hit_at ASC LIMIT ?
        )
      `).run(excess);
    }
  }

  /** Prune all expired entries. */
  pruneExpired(): number {
    const cutoff = Date.now() - this.config.ttlMs;
    const { changes } = this.db.prepare(
      "DELETE FROM semantic_cache WHERE created_at < ?",
    ).run(cutoff);
    return changes;
  }

  /** Get cache statistics. */
  stats(): {
    totalEntries: number;
    totalHits: number;
    avgHitCount: number;
    oldestEntryAge: number;
  } {
    const row = this.db.prepare(`
      SELECT COUNT(*) as total,
             COALESCE(SUM(hit_count), 0) as total_hits,
             COALESCE(AVG(hit_count), 0) as avg_hits,
             COALESCE(MIN(created_at), 0) as oldest
      FROM semantic_cache
    `).get() as { total: number; total_hits: number; avg_hits: number; oldest: number };

    return {
      totalEntries: row.total,
      totalHits: row.total_hits,
      avgHitCount: row.avg_hits,
      oldestEntryAge: row.oldest > 0 ? Date.now() - row.oldest : 0,
    };
  }

  /** Clear the entire cache. */
  clear(): void {
    this.db.exec("DELETE FROM semantic_cache");
  }

  private containsSensitiveContent(text: string): boolean {
    for (const pattern of this.sensitivePatterns) {
      if (pattern.test(text)) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function promptHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function bufferToFloat32(buf: Buffer | Uint8Array | unknown): Float32Array | null {
  if (buf instanceof Buffer || buf instanceof Uint8Array) {
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }
  return null;
}

/**
 * Cosine similarity between two Float32Arrays.
 * Assumes L2-normalized vectors (dot product = cosine similarity).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

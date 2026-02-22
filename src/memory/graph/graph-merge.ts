/**
 * Graph Merge — merges graph search results with existing vector+FTS results.
 *
 * Strategy:
 *   - Union by chunk ID
 *   - Boost chunks that appear in both result sets
 *   - Annotate with relationship context from graph
 *   - Final ranking: base_score * (1 + graph_boost * graphWeight)
 */

import type { GraphSearchResult, GraphRelationshipContext } from "./graph-search.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BaseSearchResult {
  /** Chunk identifier. */
  chunkId: string;
  /** Base score from vector+FTS hybrid search (0-1). */
  score: number;
  /** Original fields passed through. */
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  source: "memory" | "sessions";
}

export interface MergedSearchResult extends BaseSearchResult {
  /** Final merged score. */
  mergedScore: number;
  /** Graph boost applied (0 if no graph match). */
  graphBoost: number;
  /** Relationship context from graph (empty if no graph match). */
  relationships: GraphRelationshipContext[];
  /** Entities that matched from graph search. */
  matchedEntities: string[];
}

export interface MergeConfig {
  /** Weight of graph boost in final score. Default: 0.3. */
  graphWeight?: number;
  /** Maximum results after merge. Default: 10. */
  maxResults?: number;
  /** Bonus for appearing in BOTH vector+FTS and graph results. Default: 0.1. */
  overlapBonus?: number;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

const DEFAULT_GRAPH_WEIGHT = 0.3;
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_OVERLAP_BONUS = 0.1;

/**
 * Merge base (vector+FTS) results with graph search results.
 *
 * If graphResults is empty or null, base results pass through unchanged
 * (with mergedScore = score, empty relationships).
 */
export function mergeResults(
  baseResults: BaseSearchResult[],
  graphResults: GraphSearchResult[] | null,
  config?: MergeConfig,
): MergedSearchResult[] {
  const graphWeight = config?.graphWeight ?? DEFAULT_GRAPH_WEIGHT;
  const maxResults = config?.maxResults ?? DEFAULT_MAX_RESULTS;
  const overlapBonus = config?.overlapBonus ?? DEFAULT_OVERLAP_BONUS;

  // Index graph results by chunkId
  const graphMap = new Map<string, GraphSearchResult>();
  if (graphResults) {
    for (const gr of graphResults) {
      // Keep highest boost if duplicate chunkIds
      const existing = graphMap.get(gr.chunkId);
      if (!existing || gr.boost > existing.boost) {
        graphMap.set(gr.chunkId, gr);
      }
    }
  }

  // Build merged results from base results
  const merged = new Map<string, MergedSearchResult>();

  for (const base of baseResults) {
    const graphHit = graphMap.get(base.chunkId);
    const graphBoost = graphHit?.boost ?? 0;
    const bonus = graphHit ? overlapBonus : 0;
    const mergedScore = base.score * (1 + graphBoost * graphWeight) + bonus;

    merged.set(base.chunkId, {
      ...base,
      mergedScore,
      graphBoost,
      relationships: graphHit?.relationships ?? [],
      matchedEntities: graphHit?.matchedEntities ?? [],
    });

    // Remove from graphMap so we know what's graph-only
    graphMap.delete(base.chunkId);
  }

  // Add graph-only results (chunks found by graph but not by vector+FTS).
  // These get a base score of 0 + graph boost (usually lower ranked).
  for (const [chunkId, gr] of graphMap) {
    const mergedScore = gr.boost * graphWeight;
    merged.set(chunkId, {
      chunkId,
      score: 0,
      path: "",
      startLine: 0,
      endLine: 0,
      snippet: "",
      source: "memory",
      mergedScore,
      graphBoost: gr.boost,
      relationships: gr.relationships,
      matchedEntities: gr.matchedEntities,
    });
  }

  // Sort by mergedScore descending and limit
  return [...merged.values()]
    .sort((a, b) => b.mergedScore - a.mergedScore)
    .slice(0, maxResults);
}

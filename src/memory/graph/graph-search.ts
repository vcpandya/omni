/**
 * Graph-Aware Search — runs in parallel with existing vector+FTS search.
 *
 * Flow:
 *   1. Extract entities from query (heuristic)
 *   2. Find matching graph nodes (name similarity)
 *   3. Traverse 1-2 hops for related entities
 *   4. Retrieve chunks linked via graph_chunk_refs
 *   5. Return graph-enriched results with relationship context
 */

import type { GraphStore, GraphNode, GraphEdge } from "./graph-store.js";
import { extractEntitiesHeuristic } from "./entity-extractor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphSearchResult {
  chunkId: string;
  /** Graph boost score (additive to vector+FTS score). */
  boost: number;
  /** Graph context: relationship paths that led to this chunk. */
  relationships: GraphRelationshipContext[];
  /** Entities that matched the query. */
  matchedEntities: string[];
}

export interface GraphRelationshipContext {
  source: string;
  relation: string;
  target: string;
  depth: number;
  weight: number;
}

export interface GraphSearchConfig {
  /** Max traversal depth (1-3). Default: 2. */
  maxDepth?: number;
  /** Max nodes to visit during traversal. Default: 50. */
  maxNodes?: number;
  /** Timeout in ms. Default: 2000. */
  timeoutMs?: number;
  /** Boost factors per depth. */
  boosts?: {
    directMatch?: number;   // default: 0.3
    oneHop?: number;        // default: 0.15
    twoHop?: number;        // default: 0.05
    recencyBonus?: number;  // default: 0.1 (if entity seen in last 7 days)
  };
  /** Recency window in ms. Default: 7 days. */
  recencyWindowMs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_NODES = 50;
const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_BOOSTS = {
  directMatch: 0.3,
  oneHop: 0.15,
  twoHop: 0.05,
  recencyBonus: 0.1,
};
const DEFAULT_RECENCY_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days

// ---------------------------------------------------------------------------
// Graph Search
// ---------------------------------------------------------------------------

/**
 * Search the knowledge graph for chunks related to a query.
 * Returns an array of chunk IDs with boost scores and relationship context.
 *
 * Safe to call even if the graph is empty — returns [].
 */
export function searchGraph(
  store: GraphStore,
  query: string,
  config?: GraphSearchConfig,
): GraphSearchResult[] {
  const maxDepth = Math.min(3, Math.max(1, config?.maxDepth ?? DEFAULT_MAX_DEPTH));
  const maxNodes = Math.max(1, config?.maxNodes ?? DEFAULT_MAX_NODES);
  const boosts = { ...DEFAULT_BOOSTS, ...config?.boosts };
  const recencyMs = config?.recencyWindowMs ?? DEFAULT_RECENCY_MS;
  const now = Date.now();

  // 1. Extract entities from query (heuristic — fast, no LLM cost)
  const extraction = extractEntitiesHeuristic(query, 10);
  const queryTerms = extractSearchTerms(query);

  // 2. Find matching graph nodes
  const matchedNodes: Array<{ node: GraphNode; depth: 0 }> = [];

  // Match extracted entities
  for (const entity of extraction.entities) {
    const found = store.findNodesByName(entity.name, 3);
    for (const node of found) {
      matchedNodes.push({ node, depth: 0 });
    }
  }

  // Also try raw search terms for broader recall
  for (const term of queryTerms) {
    if (term.length >= 3) {
      const found = store.searchNodes(term, 5);
      for (const node of found) {
        if (!matchedNodes.some((m) => m.node.id === node.id)) {
          matchedNodes.push({ node, depth: 0 });
        }
      }
    }
  }

  if (matchedNodes.length === 0) return [];

  // 3. Traverse graph and collect all relevant nodes
  const visitedNodes = new Map<string, { node: GraphNode; depth: number }>();
  const allEdges: GraphEdge[] = [];

  for (const { node } of matchedNodes) {
    const traversal = store.traverse(node.id, maxDepth, maxNodes);
    for (const tNode of traversal.nodes) {
      const existing = visitedNodes.get(tNode.id);
      if (!existing || tNode.depth < existing.depth) {
        visitedNodes.set(tNode.id, { node: tNode, depth: tNode.depth });
      }
    }
    for (const edge of traversal.edges) {
      allEdges.push(edge);
    }
  }

  // 4. Collect chunks for all visited nodes and compute boosts
  const chunkMap = new Map<
    string,
    { boost: number; relationships: GraphRelationshipContext[]; entities: Set<string> }
  >();

  const matchedEntityNames = new Set(matchedNodes.map((m) => m.node.name));

  for (const [, { node, depth }] of visitedNodes) {
    const chunkIds = store.getChunksForNode(node.id);

    // Compute boost based on depth
    let depthBoost: number;
    if (depth === 0) {
      depthBoost = boosts.directMatch;
    } else if (depth === 1) {
      depthBoost = boosts.oneHop;
    } else {
      depthBoost = boosts.twoHop;
    }

    // Recency bonus
    if (now - node.lastSeenAt < recencyMs) {
      depthBoost += boosts.recencyBonus;
    }

    for (const chunkId of chunkIds) {
      const existing = chunkMap.get(chunkId);
      if (existing) {
        existing.boost = Math.max(existing.boost, depthBoost);
        existing.entities.add(node.name);
      } else {
        chunkMap.set(chunkId, {
          boost: depthBoost,
          relationships: [],
          entities: new Set([node.name]),
        });
      }
    }
  }

  // 5. Annotate relationship context
  for (const edge of allEdges) {
    const sourceInfo = visitedNodes.get(edge.sourceId);
    const targetInfo = visitedNodes.get(edge.targetId);
    if (!sourceInfo || !targetInfo) continue;

    const depth = Math.min(sourceInfo.depth, targetInfo.depth) + 1;
    const ctx: GraphRelationshipContext = {
      source: sourceInfo.node.name,
      relation: edge.relation,
      target: targetInfo.node.name,
      depth,
      weight: edge.weight,
    };

    // Add context to any chunks linked to either endpoint
    for (const nodeId of [edge.sourceId, edge.targetId]) {
      const chunkIds = store.getChunksForNode(nodeId);
      for (const chunkId of chunkIds) {
        const entry = chunkMap.get(chunkId);
        if (entry && entry.relationships.length < 10) {
          entry.relationships.push(ctx);
        }
      }
    }
  }

  // 6. Build results, sorted by boost desc
  const results: GraphSearchResult[] = [];
  for (const [chunkId, entry] of chunkMap) {
    results.push({
      chunkId,
      boost: entry.boost,
      relationships: deduplicateRelationships(entry.relationships),
      matchedEntities: [...entry.entities].filter((e) => matchedEntityNames.has(e)),
    });
  }

  results.sort((a, b) => b.boost - a.boost);
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "to", "of", "in", "for", "on",
  "with", "at", "by", "from", "as", "and", "but", "or", "not", "no",
  "so", "if", "then", "that", "this", "it", "its", "what", "which",
  "who", "how", "when", "where", "why", "about", "up", "out",
]);

function extractSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function deduplicateRelationships(
  rels: GraphRelationshipContext[],
): GraphRelationshipContext[] {
  const seen = new Set<string>();
  const result: GraphRelationshipContext[] = [];
  for (const r of rels) {
    const key = `${r.source}|${r.relation}|${r.target}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(r);
    }
  }
  return result;
}

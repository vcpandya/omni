/**
 * Graph Maintenance — background tasks for knowledge graph health.
 *
 *   - Entity merging:  deduplicate similar nodes (name similarity)
 *   - Edge decay:      halve weight for stale relationships
 *   - Pruning:         remove low-mention nodes with no recent edges
 *   - Stats:           summary of graph health
 */

import type { GraphStore, GraphNode } from "./graph-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaintenanceConfig {
  /** Days without reinforcement before edge weight decays. Default: 90. */
  edgeDecayDays?: number;
  /** Days without activity before a node is eligible for pruning. Default: 120. */
  pruneAfterDays?: number;
  /** Minimum mention count to survive pruning. Default: 2. */
  minMentionCount?: number;
  /** Name similarity threshold for merging (0-1). Default: 0.85. */
  mergeThreshold?: number;
  /** Max nodes to process per maintenance run. Default: 500. */
  batchSize?: number;
}

export interface MaintenanceReport {
  mergedNodes: number;
  decayedEdges: number;
  prunedNodes: number;
  prunedEdges: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_EDGE_DECAY_DAYS = 90;
const DEFAULT_PRUNE_AFTER_DAYS = 120;
const DEFAULT_MIN_MENTION_COUNT = 2;
const DEFAULT_MERGE_THRESHOLD = 0.85;
const DEFAULT_BATCH_SIZE = 500;
const MS_PER_DAY = 24 * 60 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Maintenance Runner
// ---------------------------------------------------------------------------

/**
 * Run all maintenance tasks on the graph store.
 * Safe to call frequently — operations are idempotent.
 */
export function runGraphMaintenance(
  store: GraphStore,
  config?: MaintenanceConfig,
): MaintenanceReport {
  const start = Date.now();
  const cfg = {
    edgeDecayDays: config?.edgeDecayDays ?? DEFAULT_EDGE_DECAY_DAYS,
    pruneAfterDays: config?.pruneAfterDays ?? DEFAULT_PRUNE_AFTER_DAYS,
    minMentionCount: config?.minMentionCount ?? DEFAULT_MIN_MENTION_COUNT,
    mergeThreshold: config?.mergeThreshold ?? DEFAULT_MERGE_THRESHOLD,
    batchSize: config?.batchSize ?? DEFAULT_BATCH_SIZE,
  };

  const mergedNodes = mergeEntities(store, cfg.mergeThreshold, cfg.batchSize);
  const decayedEdges = decayEdges(store, cfg.edgeDecayDays);
  const { prunedNodes, prunedEdges } = pruneGraph(
    store,
    cfg.pruneAfterDays,
    cfg.minMentionCount,
  );

  return {
    mergedNodes,
    decayedEdges,
    prunedNodes,
    prunedEdges,
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Entity Merging
// ---------------------------------------------------------------------------

/**
 * Merge nodes with very similar names.
 * Uses normalized Levenshtein distance for name comparison.
 */
function mergeEntities(
  store: GraphStore,
  threshold: number,
  batchSize: number,
): number {
  const stats = store.stats();
  if (stats.nodeCount < 2) return 0;

  // Get all nodes grouped by type (only merge within same type)
  let merged = 0;
  for (const { type } of stats.topNodeTypes) {
    const nodes = store.findNodesByType(type as any, batchSize);
    if (nodes.length < 2) continue;

    // Compare pairs: O(n^2) but bounded by batchSize
    const mergedIds = new Set<string>();
    for (let i = 0; i < nodes.length; i++) {
      if (mergedIds.has(nodes[i].id)) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        if (mergedIds.has(nodes[j].id)) continue;

        const similarity = nameSimilarity(nodes[i].name, nodes[j].name);
        if (similarity >= threshold) {
          // Keep the node with higher mention count
          const [keep, remove] =
            nodes[i].mentionCount >= nodes[j].mentionCount
              ? [nodes[i], nodes[j]]
              : [nodes[j], nodes[i]];

          mergeNodeInto(store, keep, remove);
          mergedIds.add(remove.id);
          merged++;
        }
      }
    }
  }

  return merged;
}

function mergeNodeInto(store: GraphStore, keep: GraphNode, remove: GraphNode): void {
  // Move chunk refs from remove → keep
  const chunks = store.getChunksForNode(remove.id);
  for (const chunkId of chunks) {
    store.linkNodeToChunk(keep.id, chunkId);
  }

  // Move edges: retarget edges pointing to/from removed node to kept node
  const outEdges = store.getEdgesFrom(remove.id);
  for (const edge of outEdges) {
    if (edge.targetId !== keep.id) {
      store.upsertEdge(keep.id, edge.targetId, edge.relation, edge.weight * 0.5);
    }
  }
  const inEdges = store.getEdgesTo(remove.id);
  for (const edge of inEdges) {
    if (edge.sourceId !== keep.id) {
      store.upsertEdge(edge.sourceId, keep.id, edge.relation, edge.weight * 0.5);
    }
  }

  // Delete the merged node (CASCADE deletes its edges and chunk refs)
  store.deleteNode(remove.id);
}

// ---------------------------------------------------------------------------
// Edge Decay
// ---------------------------------------------------------------------------

/**
 * Halve weight of edges not reinforced within decayDays.
 * Edges with weight below 0.01 are deleted.
 */
function decayEdges(store: GraphStore, decayDays: number): number {
  const cutoff = Date.now() - decayDays * MS_PER_DAY;
  const stats = store.stats();
  if (stats.edgeCount === 0) return 0;

  // We need direct SQL access — use the store's traversal to find stale edges.
  // Since GraphStore doesn't expose raw SQL, we traverse all top nodes
  // and check edges. For large graphs this would need pagination.
  let decayed = 0;

  for (const { type } of stats.topNodeTypes) {
    const nodes = store.findNodesByType(type as any, 100);
    for (const node of nodes) {
      const edges = store.getEdgesFrom(node.id, 100);
      for (const edge of edges) {
        if (edge.lastSeenAt < cutoff) {
          const newWeight = edge.weight * 0.5;
          if (newWeight < 0.01) {
            store.deleteEdge(edge.sourceId, edge.targetId, edge.relation);
          } else {
            // Re-upsert with halved weight is handled by the weight accumulation
            // in upsertEdge — but here we want to SET, not accumulate.
            // We'll delete and re-create with exact weight.
            store.deleteEdge(edge.sourceId, edge.targetId, edge.relation);
            store.upsertEdge(
              edge.sourceId,
              edge.targetId,
              edge.relation,
              newWeight,
              edge.properties,
            );
          }
          decayed++;
        }
      }
    }
  }

  return decayed;
}

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

/**
 * Remove nodes with low mention count and no recent activity.
 */
function pruneGraph(
  store: GraphStore,
  pruneAfterDays: number,
  minMentionCount: number,
): { prunedNodes: number; prunedEdges: number } {
  const cutoff = Date.now() - pruneAfterDays * MS_PER_DAY;
  const stats = store.stats();
  let prunedNodes = 0;
  let prunedEdges = 0;

  for (const { type } of stats.topNodeTypes) {
    const nodes = store.findNodesByType(type as any, 500);
    for (const node of nodes) {
      if (node.mentionCount >= minMentionCount) continue;
      if (node.lastSeenAt >= cutoff) continue;

      // Check if node has any recent edges
      const outEdges = store.getEdgesFrom(node.id, 5);
      const inEdges = store.getEdgesTo(node.id, 5);
      const hasRecentEdges = [...outEdges, ...inEdges].some(
        (e) => e.lastSeenAt >= cutoff,
      );
      if (hasRecentEdges) continue;

      // Safe to prune
      prunedEdges += outEdges.length + inEdges.length;
      store.deleteNode(node.id); // CASCADE deletes edges and chunk refs
      prunedNodes++;
    }
  }

  return { prunedNodes, prunedEdges };
}

// ---------------------------------------------------------------------------
// Name Similarity (normalized Levenshtein)
// ---------------------------------------------------------------------------

/**
 * Compute normalized similarity between two strings.
 * Returns 0.0 (completely different) to 1.0 (identical).
 * Case-insensitive comparison.
 */
export function nameSimilarity(a: string, b: string): number {
  const sa = a.toLowerCase().trim();
  const sb = b.toLowerCase().trim();
  if (sa === sb) return 1;
  if (sa.length === 0 || sb.length === 0) return 0;

  const maxLen = Math.max(sa.length, sb.length);
  const dist = levenshteinDistance(sa, sb);
  return 1 - dist / maxLen;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Single-row DP to save memory
  const prev = new Uint16Array(n + 1);
  const curr = new Uint16Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev.set(curr);
  }

  return prev[n];
}

/**
 * Graph Memory Store — SQLite-backed knowledge graph that runs alongside
 * the existing vector+FTS memory pipeline.
 *
 * Tables: graph_nodes, graph_edges, graph_chunk_refs
 * All operations are opt-in; when disabled the existing pipeline is unchanged.
 */

import { createHash, randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GraphNodeType =
  | "person"
  | "project"
  | "concept"
  | "tool"
  | "file"
  | "date"
  | "organization"
  | "url"
  | "tag"
  | "unknown";

export interface GraphNode {
  id: string;
  name: string;
  type: GraphNodeType;
  embedding: Float32Array | null;
  properties: Record<string, unknown>;
  firstSeenAt: number;
  lastSeenAt: number;
  mentionCount: number;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  weight: number;
  properties: Record<string, unknown>;
  createdAt: number;
  lastSeenAt: number;
}

export interface GraphChunkRef {
  nodeId: string;
  chunkId: string;
}

export interface GraphMemoryConfig {
  enabled?: boolean;
  extractionMode?: "heuristic" | "llm" | "hybrid";
  llmModel?: string;
  maxEntities?: number;
  minMentionCount?: number;
  relationshipConfidence?: number;
  maintenance?: {
    edgeDecayDays?: number;
    pruneAfterDays?: number;
    mergeThreshold?: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NODE_NAME_LENGTH = 200;
const MAX_PROPERTIES_LENGTH = 8_192;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

export const GRAPH_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'unknown',
  embedding BLOB,
  properties TEXT DEFAULT '{}',
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  mention_count INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  properties TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(source_id, target_id, relation)
);

CREATE TABLE IF NOT EXISTS graph_chunk_refs (
  node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL,
  PRIMARY KEY (node_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_relation ON graph_edges(relation);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(type);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_name ON graph_nodes(name COLLATE NOCASE);
`;

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

export function sanitizeNodeName(raw: string): string {
  return raw
    .replace(CONTROL_CHAR_RE, "")
    .trim()
    .slice(0, MAX_NODE_NAME_LENGTH);
}

function safeProperties(props: unknown): string {
  if (props == null || typeof props !== "object" || Array.isArray(props)) {
    return "{}";
  }
  const json = JSON.stringify(props);
  if (json.length > MAX_PROPERTIES_LENGTH) return "{}";
  return json;
}

export function nodeId(name: string, type: GraphNodeType): string {
  return createHash("sha256")
    .update(`${type}:${name.toLowerCase().trim()}`)
    .digest("hex")
    .slice(0, 24);
}

// ---------------------------------------------------------------------------
// GraphStore class (operates on any SQLite-compatible db handle)
// ---------------------------------------------------------------------------

/**
 * Minimal database interface matching better-sqlite3 synchronous API.
 * The real db handle is injected to avoid tying this module to a specific driver.
 */
export interface GraphDb {
  exec(sql: string): void;
  prepare(sql: string): GraphStatement;
}

export interface GraphStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
}

export class GraphStore {
  private db: GraphDb;

  constructor(db: GraphDb) {
    this.db = db;
  }

  /** Create tables and indexes if they don't exist. */
  initialize(): void {
    this.db.exec(GRAPH_SCHEMA_DDL);
  }

  // -------------------------------------------------------------------------
  // Nodes
  // -------------------------------------------------------------------------

  upsertNode(
    name: string,
    type: GraphNodeType,
    properties?: Record<string, unknown>,
    embedding?: Float32Array | null,
  ): GraphNode {
    const safeName = sanitizeNodeName(name);
    if (!safeName) throw new Error("graph: empty node name after sanitization");

    const id = nodeId(safeName, type);
    const now = Date.now();
    const propsJson = safeProperties(properties);
    const embBlob = embedding ? Buffer.from(embedding.buffer) : null;

    const existing = this.db.prepare(
      "SELECT mention_count, first_seen_at, properties FROM graph_nodes WHERE id = ?",
    ).get(id) as { mention_count: number; first_seen_at: number; properties: string } | undefined;

    if (existing) {
      // Merge properties
      let merged = propsJson;
      try {
        const old = JSON.parse(existing.properties ?? "{}");
        const incoming = JSON.parse(propsJson);
        merged = safeProperties({ ...old, ...incoming });
      } catch {
        // keep incoming
      }

      this.db.prepare(`
        UPDATE graph_nodes
        SET last_seen_at = ?, mention_count = mention_count + 1,
            properties = ?, embedding = COALESCE(?, embedding)
        WHERE id = ?
      `).run(now, merged, embBlob, id);

      return {
        id,
        name: safeName,
        type,
        embedding: embedding ?? null,
        properties: JSON.parse(merged),
        firstSeenAt: existing.first_seen_at,
        lastSeenAt: now,
        mentionCount: existing.mention_count + 1,
      };
    }

    this.db.prepare(`
      INSERT INTO graph_nodes (id, name, type, embedding, properties, first_seen_at, last_seen_at, mention_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(id, safeName, type, embBlob, propsJson, now, now);

    return {
      id,
      name: safeName,
      type,
      embedding: embedding ?? null,
      properties: properties ?? {},
      firstSeenAt: now,
      lastSeenAt: now,
      mentionCount: 1,
    };
  }

  getNode(id: string): GraphNode | null {
    const row = this.db.prepare(
      "SELECT * FROM graph_nodes WHERE id = ?",
    ).get(id) as Record<string, unknown> | undefined;
    return row ? rowToNode(row) : null;
  }

  findNodesByName(name: string, limit = 10): GraphNode[] {
    const rows = this.db.prepare(
      "SELECT * FROM graph_nodes WHERE name = ? COLLATE NOCASE ORDER BY mention_count DESC LIMIT ?",
    ).all(name, limit);
    return rows.map(rowToNode);
  }

  findNodesByType(type: GraphNodeType, limit = 50): GraphNode[] {
    const rows = this.db.prepare(
      "SELECT * FROM graph_nodes WHERE type = ? ORDER BY mention_count DESC LIMIT ?",
    ).all(type, limit);
    return rows.map(rowToNode);
  }

  searchNodes(query: string, limit = 10): GraphNode[] {
    const pattern = `%${query.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    const rows = this.db.prepare(
      "SELECT * FROM graph_nodes WHERE name LIKE ? ESCAPE '\\' ORDER BY mention_count DESC LIMIT ?",
    ).all(pattern, limit);
    return rows.map(rowToNode);
  }

  deleteNode(id: string): boolean {
    const { changes } = this.db.prepare("DELETE FROM graph_nodes WHERE id = ?").run(id);
    return changes > 0;
  }

  // -------------------------------------------------------------------------
  // Edges
  // -------------------------------------------------------------------------

  upsertEdge(
    sourceId: string,
    targetId: string,
    relation: string,
    weight = 1.0,
    properties?: Record<string, unknown>,
  ): GraphEdge {
    const now = Date.now();
    const id = createHash("sha256")
      .update(`${sourceId}:${relation}:${targetId}`)
      .digest("hex")
      .slice(0, 24);
    const propsJson = safeProperties(properties);

    const existing = this.db.prepare(
      "SELECT weight, created_at FROM graph_edges WHERE source_id = ? AND target_id = ? AND relation = ?",
    ).get(sourceId, targetId, relation) as { weight: number; created_at: number } | undefined;

    if (existing) {
      const newWeight = Math.min(10, existing.weight + weight * 0.1);
      this.db.prepare(`
        UPDATE graph_edges SET weight = ?, last_seen_at = ?, properties = ?
        WHERE source_id = ? AND target_id = ? AND relation = ?
      `).run(newWeight, now, propsJson, sourceId, targetId, relation);

      return {
        id,
        sourceId,
        targetId,
        relation,
        weight: newWeight,
        properties: properties ?? {},
        createdAt: existing.created_at,
        lastSeenAt: now,
      };
    }

    this.db.prepare(`
      INSERT INTO graph_edges (id, source_id, target_id, relation, weight, properties, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, sourceId, targetId, relation, weight, propsJson, now, now);

    return {
      id,
      sourceId,
      targetId,
      relation,
      weight,
      properties: properties ?? {},
      createdAt: now,
      lastSeenAt: now,
    };
  }

  getEdgesFrom(nodeId: string, limit = 50): GraphEdge[] {
    return this.db.prepare(
      "SELECT * FROM graph_edges WHERE source_id = ? ORDER BY weight DESC LIMIT ?",
    ).all(nodeId, limit).map(rowToEdge);
  }

  getEdgesTo(nodeId: string, limit = 50): GraphEdge[] {
    return this.db.prepare(
      "SELECT * FROM graph_edges WHERE target_id = ? ORDER BY weight DESC LIMIT ?",
    ).all(nodeId, limit).map(rowToEdge);
  }

  getEdgesBetween(sourceId: string, targetId: string): GraphEdge[] {
    return this.db.prepare(
      "SELECT * FROM graph_edges WHERE source_id = ? AND target_id = ?",
    ).all(sourceId, targetId).map(rowToEdge);
  }

  deleteEdge(sourceId: string, targetId: string, relation: string): boolean {
    const { changes } = this.db.prepare(
      "DELETE FROM graph_edges WHERE source_id = ? AND target_id = ? AND relation = ?",
    ).run(sourceId, targetId, relation);
    return changes > 0;
  }

  // -------------------------------------------------------------------------
  // Traversal
  // -------------------------------------------------------------------------

  /**
   * BFS traversal from a start node up to `maxDepth` hops.
   * Returns nodes and edges visited, depth-annotated.
   */
  traverse(
    startNodeId: string,
    maxDepth = 2,
    maxNodes = 50,
  ): { nodes: Array<GraphNode & { depth: number }>; edges: GraphEdge[] } {
    const visited = new Set<string>();
    const resultNodes: Array<GraphNode & { depth: number }> = [];
    const resultEdges: GraphEdge[] = [];
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: startNodeId, depth: 0 }];

    while (queue.length > 0 && resultNodes.length < maxNodes) {
      const current = queue.shift()!;
      if (visited.has(current.nodeId)) continue;
      visited.add(current.nodeId);

      const node = this.getNode(current.nodeId);
      if (!node) continue;
      resultNodes.push({ ...node, depth: current.depth });

      if (current.depth < maxDepth) {
        const outEdges = this.getEdgesFrom(current.nodeId, 20);
        const inEdges = this.getEdgesTo(current.nodeId, 20);

        for (const edge of outEdges) {
          resultEdges.push(edge);
          if (!visited.has(edge.targetId)) {
            queue.push({ nodeId: edge.targetId, depth: current.depth + 1 });
          }
        }
        for (const edge of inEdges) {
          resultEdges.push(edge);
          if (!visited.has(edge.sourceId)) {
            queue.push({ nodeId: edge.sourceId, depth: current.depth + 1 });
          }
        }
      }
    }

    return { nodes: resultNodes, edges: resultEdges };
  }

  // -------------------------------------------------------------------------
  // Chunk References
  // -------------------------------------------------------------------------

  linkNodeToChunk(nodeId: string, chunkId: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO graph_chunk_refs (node_id, chunk_id) VALUES (?, ?)
    `).run(nodeId, chunkId);
  }

  getChunksForNode(nodeId: string): string[] {
    return this.db.prepare(
      "SELECT chunk_id FROM graph_chunk_refs WHERE node_id = ?",
    ).all(nodeId).map((r) => r.chunk_id as string);
  }

  getNodesForChunk(chunkId: string): GraphNode[] {
    const rows = this.db.prepare(`
      SELECT n.* FROM graph_nodes n
      INNER JOIN graph_chunk_refs r ON r.node_id = n.id
      WHERE r.chunk_id = ?
    `).all(chunkId);
    return rows.map(rowToNode);
  }

  unlinkChunk(chunkId: string): number {
    const { changes } = this.db.prepare(
      "DELETE FROM graph_chunk_refs WHERE chunk_id = ?",
    ).run(chunkId);
    return changes;
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  stats(): {
    nodeCount: number;
    edgeCount: number;
    chunkRefCount: number;
    topNodeTypes: Array<{ type: string; count: number }>;
    topRelations: Array<{ relation: string; count: number }>;
  } {
    const nodeCount =
      (this.db.prepare("SELECT COUNT(*) as c FROM graph_nodes").get() as { c: number }).c;
    const edgeCount =
      (this.db.prepare("SELECT COUNT(*) as c FROM graph_edges").get() as { c: number }).c;
    const chunkRefCount =
      (this.db.prepare("SELECT COUNT(*) as c FROM graph_chunk_refs").get() as { c: number }).c;

    const topNodeTypes = this.db.prepare(
      "SELECT type, COUNT(*) as count FROM graph_nodes GROUP BY type ORDER BY count DESC LIMIT 10",
    ).all() as Array<{ type: string; count: number }>;

    const topRelations = this.db.prepare(
      "SELECT relation, COUNT(*) as count FROM graph_edges GROUP BY relation ORDER BY count DESC LIMIT 10",
    ).all() as Array<{ relation: string; count: number }>;

    return { nodeCount, edgeCount, chunkRefCount, topNodeTypes, topRelations };
  }
}

// ---------------------------------------------------------------------------
// Row → domain conversions
// ---------------------------------------------------------------------------

function rowToNode(row: Record<string, unknown>): GraphNode {
  let embedding: Float32Array | null = null;
  if (row.embedding instanceof Buffer || row.embedding instanceof Uint8Array) {
    embedding = new Float32Array(
      (row.embedding as Buffer).buffer,
      (row.embedding as Buffer).byteOffset,
      (row.embedding as Buffer).byteLength / 4,
    );
  }

  let properties: Record<string, unknown> = {};
  try {
    properties = JSON.parse((row.properties as string) ?? "{}");
  } catch {
    // keep empty
  }

  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as GraphNodeType,
    embedding,
    properties,
    firstSeenAt: row.first_seen_at as number,
    lastSeenAt: row.last_seen_at as number,
    mentionCount: row.mention_count as number,
  };
}

function rowToEdge(row: Record<string, unknown>): GraphEdge {
  let properties: Record<string, unknown> = {};
  try {
    properties = JSON.parse((row.properties as string) ?? "{}");
  } catch {
    // keep empty
  }

  return {
    id: row.id as string,
    sourceId: row.source_id as string,
    targetId: row.target_id as string,
    relation: row.relation as string,
    weight: row.weight as number,
    properties,
    createdAt: row.created_at as number,
    lastSeenAt: row.last_seen_at as number,
  };
}

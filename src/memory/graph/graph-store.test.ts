import { describe, it, expect, beforeEach } from "vitest";
import {
  GraphStore,
  sanitizeNodeName,
  nodeId,
  type GraphDb,
  type GraphStatement,
} from "./graph-store.js";

// ---------------------------------------------------------------------------
// In-memory SQLite mock (table-based, good enough for unit tests)
// ---------------------------------------------------------------------------

function createMockDb(): GraphDb {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();

  function getTable(name: string): Map<string, Record<string, unknown>> {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  }

  const mockStatement = (sql: string): GraphStatement => {
    const sqlLower = sql.trim().toLowerCase();

    return {
      run(...params: unknown[]) {
        // INSERT into graph_nodes
        if (sqlLower.includes("insert") && sqlLower.includes("graph_nodes")) {
          const table = getTable("graph_nodes");
          const id = params[0] as string;
          const row: Record<string, unknown> = {
            id,
            name: params[1],
            type: params[2],
            embedding: params[3],
            properties: params[4],
            first_seen_at: params[5],
            last_seen_at: params[6],
            mention_count: 1,
          };
          table.set(id, row);
          return { changes: 1 };
        }

        // UPDATE graph_nodes
        if (sqlLower.includes("update") && sqlLower.includes("graph_nodes")) {
          const table = getTable("graph_nodes");
          const id = params[params.length - 1] as string;
          const existing = table.get(id);
          if (existing) {
            existing.last_seen_at = params[0];
            existing.mention_count = (existing.mention_count as number) + 1;
            existing.properties = params[1];
            if (params[2] != null) existing.embedding = params[2];
            return { changes: 1 };
          }
          return { changes: 0 };
        }

        // DELETE from graph_nodes
        if (sqlLower.includes("delete") && sqlLower.includes("graph_nodes")) {
          const table = getTable("graph_nodes");
          const id = params[0] as string;
          const had = table.has(id);
          table.delete(id);
          // CASCADE: delete edges and chunk refs
          const edges = getTable("graph_edges");
          for (const [eid, edge] of [...edges]) {
            if (edge.source_id === id || edge.target_id === id) edges.delete(eid);
          }
          const refs = getTable("graph_chunk_refs");
          for (const [key, ref] of [...refs]) {
            if (ref.node_id === id) refs.delete(key);
          }
          return { changes: had ? 1 : 0 };
        }

        // INSERT into graph_edges
        if (sqlLower.includes("insert") && sqlLower.includes("graph_edges")) {
          const table = getTable("graph_edges");
          const id = params[0] as string;
          table.set(id, {
            id,
            source_id: params[1],
            target_id: params[2],
            relation: params[3],
            weight: params[4],
            properties: params[5],
            created_at: params[6],
            last_seen_at: params[7],
          });
          return { changes: 1 };
        }

        // UPDATE graph_edges
        if (sqlLower.includes("update") && sqlLower.includes("graph_edges")) {
          const table = getTable("graph_edges");
          for (const [, edge] of table) {
            if (
              edge.source_id === params[3] &&
              edge.target_id === params[4] &&
              edge.relation === params[5]
            ) {
              edge.weight = params[0];
              edge.last_seen_at = params[1];
              edge.properties = params[2];
              return { changes: 1 };
            }
          }
          return { changes: 0 };
        }

        // DELETE from graph_edges
        if (sqlLower.includes("delete") && sqlLower.includes("graph_edges")) {
          const table = getTable("graph_edges");
          for (const [eid, edge] of [...table]) {
            if (
              edge.source_id === params[0] &&
              edge.target_id === params[1] &&
              edge.relation === params[2]
            ) {
              table.delete(eid);
              return { changes: 1 };
            }
          }
          return { changes: 0 };
        }

        // INSERT into graph_chunk_refs
        if (sqlLower.includes("insert") && sqlLower.includes("graph_chunk_refs")) {
          const table = getTable("graph_chunk_refs");
          const key = `${params[0]}:${params[1]}`;
          table.set(key, { node_id: params[0], chunk_id: params[1] });
          return { changes: 1 };
        }

        // DELETE from graph_chunk_refs
        if (sqlLower.includes("delete") && sqlLower.includes("graph_chunk_refs")) {
          const table = getTable("graph_chunk_refs");
          let changes = 0;
          for (const [key, ref] of [...table]) {
            if (ref.chunk_id === params[0]) {
              table.delete(key);
              changes++;
            }
          }
          return { changes };
        }

        return { changes: 0 };
      },

      get(...params: unknown[]) {
        // SELECT from graph_nodes
        if (sqlLower.includes("graph_nodes") && sqlLower.includes("select")) {
          if (sqlLower.includes("count(*)")) {
            return { c: getTable("graph_nodes").size };
          }
          const table = getTable("graph_nodes");
          const id = params[0] as string;
          const row = table.get(id);
          if (row) return { ...row };
          return undefined;
        }

        // SELECT from graph_edges
        if (sqlLower.includes("graph_edges") && sqlLower.includes("select")) {
          if (sqlLower.includes("count(*)")) {
            return { c: getTable("graph_edges").size };
          }
          const table = getTable("graph_edges");
          for (const [, edge] of table) {
            if (
              edge.source_id === params[0] &&
              edge.target_id === params[1] &&
              edge.relation === params[2]
            ) {
              return edge;
            }
          }
          return undefined;
        }

        // SELECT count from graph_chunk_refs
        if (sqlLower.includes("graph_chunk_refs") && sqlLower.includes("count(*)")) {
          return { c: getTable("graph_chunk_refs").size };
        }

        // semantic_cache
        if (sqlLower.includes("semantic_cache")) {
          if (sqlLower.includes("count(*)")) return { c: 0 };
          return undefined;
        }

        return undefined;
      },

      all(...params: unknown[]) {
        // SELECT from graph_nodes by name (LIKE or COLLATE NOCASE)
        if (sqlLower.includes("graph_nodes") && sqlLower.includes("select")) {
          const table = getTable("graph_nodes");
          const rows = [...table.values()];
          const limit = params[params.length - 1] as number;

          if (sqlLower.includes("name like")) {
            const pattern = (params[0] as string).replace(/%/g, "").toLowerCase();
            return rows
              .filter((r) => (r.name as string).toLowerCase().includes(pattern))
              .slice(0, limit);
          }
          if (sqlLower.includes("name =")) {
            return rows
              .filter((r) => (r.name as string).toLowerCase() === (params[0] as string).toLowerCase())
              .slice(0, limit);
          }
          if (sqlLower.includes("type =")) {
            return rows
              .filter((r) => r.type === params[0])
              .slice(0, limit);
          }
          return rows.slice(0, limit);
        }

        // SELECT from graph_edges
        if (sqlLower.includes("graph_edges") && sqlLower.includes("select")) {
          const table = getTable("graph_edges");
          const rows = [...table.values()];
          const limit = params[params.length - 1] as number;

          if (sqlLower.includes("source_id = ? and target_id = ?")) {
            return rows.filter(
              (r) => r.source_id === params[0] && r.target_id === params[1],
            );
          }
          if (sqlLower.includes("source_id =")) {
            return rows
              .filter((r) => r.source_id === params[0])
              .slice(0, limit);
          }
          if (sqlLower.includes("target_id =")) {
            return rows
              .filter((r) => r.target_id === params[0])
              .slice(0, limit);
          }

          if (sqlLower.includes("group by type")) {
            const grouped = new Map<string, number>();
            for (const r of rows) {
              grouped.set(r.type as string, (grouped.get(r.type as string) ?? 0) + 1);
            }
            return [...grouped].map(([type, count]) => ({ type, count }));
          }

          if (sqlLower.includes("group by relation")) {
            const grouped = new Map<string, number>();
            for (const r of rows) {
              grouped.set(r.relation as string, (grouped.get(r.relation as string) ?? 0) + 1);
            }
            return [...grouped].map(([relation, count]) => ({ relation, count }));
          }

          return rows.slice(0, limit);
        }

        // SELECT from graph_chunk_refs
        if (sqlLower.includes("graph_chunk_refs")) {
          const table = getTable("graph_chunk_refs");
          const rows = [...table.values()];
          if (sqlLower.includes("node_id =") || sqlLower.includes("r.chunk_id")) {
            const nodeIdParam = params[0] as string;
            return rows.filter((r) => r.node_id === nodeIdParam);
          }
          return rows;
        }

        // stats queries for graph_nodes grouped by type
        if (sqlLower.includes("group by type")) {
          const table = getTable("graph_nodes");
          const grouped = new Map<string, number>();
          for (const [, r] of table) {
            grouped.set(r.type as string, (grouped.get(r.type as string) ?? 0) + 1);
          }
          return [...grouped].map(([type, count]) => ({ type, count }));
        }

        return [];
      },
    };
  };

  return {
    exec(_sql: string) {
      // DDL — no-op in mock
    },
    prepare: mockStatement,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sanitizeNodeName", () => {
  it("strips control characters", () => {
    expect(sanitizeNodeName("hello\x00world\x07")).toBe("helloworld");
  });

  it("trims whitespace", () => {
    expect(sanitizeNodeName("  foo  ")).toBe("foo");
  });

  it("truncates to 200 characters", () => {
    const long = "a".repeat(300);
    expect(sanitizeNodeName(long)).toHaveLength(200);
  });
});

describe("nodeId", () => {
  it("produces consistent IDs for same name+type", () => {
    expect(nodeId("UserAuth", "concept")).toBe(nodeId("UserAuth", "concept"));
  });

  it("is case-insensitive", () => {
    expect(nodeId("UserAuth", "concept")).toBe(nodeId("userauth", "concept"));
  });

  it("differs by type", () => {
    expect(nodeId("auth", "concept")).not.toBe(nodeId("auth", "file"));
  });
});

describe("GraphStore", () => {
  let db: GraphDb;
  let store: GraphStore;

  beforeEach(() => {
    db = createMockDb();
    store = new GraphStore(db);
    store.initialize();
  });

  describe("nodes", () => {
    it("creates a new node", () => {
      const node = store.upsertNode("UserAuth", "concept");
      expect(node.name).toBe("UserAuth");
      expect(node.type).toBe("concept");
      expect(node.mentionCount).toBe(1);
    });

    it("increments mention count on duplicate upsert", () => {
      store.upsertNode("UserAuth", "concept");
      const node = store.upsertNode("UserAuth", "concept");
      expect(node.mentionCount).toBe(2);
    });

    it("retrieves a node by ID", () => {
      const created = store.upsertNode("auth.ts", "file");
      const retrieved = store.getNode(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("auth.ts");
    });

    it("finds nodes by name (case-insensitive)", () => {
      store.upsertNode("UserAuth", "concept");
      const results = store.findNodesByName("userauth");
      expect(results).toHaveLength(1);
    });

    it("finds nodes by type", () => {
      store.upsertNode("alice", "person");
      store.upsertNode("bob", "person");
      store.upsertNode("auth.ts", "file");
      const people = store.findNodesByType("person");
      expect(people).toHaveLength(2);
    });

    it("searches nodes by partial name", () => {
      store.upsertNode("UserAuthService", "concept");
      store.upsertNode("UserProfile", "concept");
      const results = store.searchNodes("Auth");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("UserAuthService");
    });

    it("deletes a node and cascades", () => {
      const node = store.upsertNode("temp", "concept");
      store.linkNodeToChunk(node.id, "chunk-1");
      expect(store.deleteNode(node.id)).toBe(true);
      expect(store.getNode(node.id)).toBeNull();
    });

    it("rejects empty names after sanitization", () => {
      expect(() => store.upsertNode("\x00\x01", "concept")).toThrow(
        "graph: empty node name after sanitization",
      );
    });

    it("merges properties on upsert", () => {
      store.upsertNode("auth", "concept", { role: "backend" });
      const updated = store.upsertNode("auth", "concept", { lang: "typescript" });
      expect(updated.properties).toEqual({ role: "backend", lang: "typescript" });
    });
  });

  describe("edges", () => {
    it("creates an edge between nodes", () => {
      const a = store.upsertNode("alice", "person");
      const b = store.upsertNode("project-x", "project");
      const edge = store.upsertEdge(a.id, b.id, "works_on");
      expect(edge.relation).toBe("works_on");
      expect(edge.weight).toBe(1.0);
    });

    it("accumulates weight on repeated upsert", () => {
      const a = store.upsertNode("alice", "person");
      const b = store.upsertNode("project-x", "project");
      store.upsertEdge(a.id, b.id, "works_on", 1.0);
      const edge = store.upsertEdge(a.id, b.id, "works_on", 1.0);
      expect(edge.weight).toBeGreaterThan(1.0);
    });

    it("retrieves outbound edges", () => {
      const a = store.upsertNode("alice", "person");
      const b = store.upsertNode("project-x", "project");
      const c = store.upsertNode("project-y", "project");
      store.upsertEdge(a.id, b.id, "works_on");
      store.upsertEdge(a.id, c.id, "manages");
      const edges = store.getEdgesFrom(a.id);
      expect(edges).toHaveLength(2);
    });

    it("retrieves inbound edges", () => {
      const a = store.upsertNode("alice", "person");
      const b = store.upsertNode("project-x", "project");
      store.upsertEdge(a.id, b.id, "works_on");
      const edges = store.getEdgesTo(b.id);
      expect(edges).toHaveLength(1);
    });

    it("deletes a specific edge", () => {
      const a = store.upsertNode("alice", "person");
      const b = store.upsertNode("project-x", "project");
      store.upsertEdge(a.id, b.id, "works_on");
      expect(store.deleteEdge(a.id, b.id, "works_on")).toBe(true);
      expect(store.getEdgesFrom(a.id)).toHaveLength(0);
    });
  });

  describe("chunk refs", () => {
    it("links a node to a chunk", () => {
      const node = store.upsertNode("auth", "concept");
      store.linkNodeToChunk(node.id, "chunk-42");
      const chunks = store.getChunksForNode(node.id);
      expect(chunks).toContain("chunk-42");
    });

    it("unlinks chunks", () => {
      const node = store.upsertNode("auth", "concept");
      store.linkNodeToChunk(node.id, "chunk-42");
      store.linkNodeToChunk(node.id, "chunk-43");
      const removed = store.unlinkChunk("chunk-42");
      expect(removed).toBe(1);
    });
  });

  describe("traversal", () => {
    it("traverses a simple graph", () => {
      const alice = store.upsertNode("alice", "person");
      const proj = store.upsertNode("project-x", "project");
      const auth = store.upsertNode("auth.ts", "file");
      store.upsertEdge(alice.id, proj.id, "works_on");
      store.upsertEdge(proj.id, auth.id, "contains");

      const result = store.traverse(alice.id, 2);
      expect(result.nodes).toHaveLength(3);
      // Edges collected from both directions at each node: may include duplicates
      expect(result.edges.length).toBeGreaterThanOrEqual(2);
      // Verify the two canonical edges exist
      const relations = result.edges.map((e) => e.relation);
      expect(relations).toContain("works_on");
      expect(relations).toContain("contains");
    });

    it("respects max depth", () => {
      const a = store.upsertNode("a", "concept");
      const b = store.upsertNode("b", "concept");
      const c = store.upsertNode("c", "concept");
      store.upsertEdge(a.id, b.id, "related");
      store.upsertEdge(b.id, c.id, "related");

      const depth1 = store.traverse(a.id, 1);
      expect(depth1.nodes.some((n) => n.name === "c")).toBe(false);

      const depth2 = store.traverse(a.id, 2);
      expect(depth2.nodes.some((n) => n.name === "c")).toBe(true);
    });

    it("respects max nodes", () => {
      const root = store.upsertNode("root", "concept");
      for (let i = 0; i < 10; i++) {
        const child = store.upsertNode(`child-${i}`, "concept");
        store.upsertEdge(root.id, child.id, "has");
      }
      const result = store.traverse(root.id, 1, 5);
      expect(result.nodes.length).toBeLessThanOrEqual(5);
    });
  });

  describe("stats", () => {
    it("returns correct counts", () => {
      store.upsertNode("alice", "person");
      store.upsertNode("bob", "person");
      store.upsertNode("auth.ts", "file");
      const alice = store.upsertNode("alice", "person"); // dupe → increment count
      const bob = store.findNodesByName("bob")[0];
      store.upsertEdge(alice.id, bob.id, "knows");

      const s = store.stats();
      expect(s.nodeCount).toBe(3);
      expect(s.edgeCount).toBe(1);
    });
  });
});

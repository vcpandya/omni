import { describe, it, expect } from "vitest";
import {
  extractEntitiesHeuristic,
  parseLlmExtractionResponse,
  mergeExtractionResults,
} from "./entity-extractor.js";
import { mergeResults, type BaseSearchResult } from "./graph-merge.js";
import type { GraphSearchResult } from "./graph-search.js";
import { nameSimilarity } from "./graph-maintenance.js";

// ---------------------------------------------------------------------------
// Entity Extractor Tests
// ---------------------------------------------------------------------------

describe("extractEntitiesHeuristic", () => {
  it("extracts @mentions as person entities", () => {
    const result = extractEntitiesHeuristic("Reviewed by @alice and @bob");
    const names = result.entities.map((e) => e.name);
    expect(names).toContain("alice");
    expect(names).toContain("bob");
    expect(result.entities.find((e) => e.name === "alice")?.type).toBe("person");
  });

  it("extracts #tags", () => {
    const result = extractEntitiesHeuristic("Fixed #bug-123 in #release-v2");
    const names = result.entities.map((e) => e.name);
    expect(names).toContain("bug-123");
    expect(names).toContain("release-v2");
  });

  it("extracts file paths", () => {
    const result = extractEntitiesHeuristic("Modified ./src/auth.ts and ./lib/utils.js");
    const files = result.entities.filter((e) => e.type === "file");
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts URLs", () => {
    const result = extractEntitiesHeuristic("See https://example.com/docs for details");
    const urls = result.entities.filter((e) => e.type === "url");
    expect(urls.length).toBe(1);
  });

  it("extracts ISO dates", () => {
    const result = extractEntitiesHeuristic("Deployed on 2024-03-15T10:30");
    const dates = result.entities.filter((e) => e.type === "date");
    expect(dates.length).toBe(1);
  });

  it("extracts CamelCase identifiers", () => {
    const result = extractEntitiesHeuristic("The UserAuthService handles tokens via TokenManager");
    const concepts = result.entities.filter((e) => e.type === "concept");
    const names = concepts.map((e) => e.name);
    expect(names).toContain("UserAuthService");
    expect(names).toContain("TokenManager");
  });

  it("infers co-occurrence relationships", () => {
    const result = extractEntitiesHeuristic("@alice works on ./src/auth.ts");
    expect(result.relationships.length).toBeGreaterThan(0);
    const rel = result.relationships[0];
    expect(rel.source).toBeTruthy();
    expect(rel.target).toBeTruthy();
    expect(rel.relation).toBeTruthy();
  });

  it("respects maxEntities limit", () => {
    const text = Array.from({ length: 30 }, (_, i) => `@user${i}`).join(" ");
    const result = extractEntitiesHeuristic(text, 5);
    expect(result.entities.length).toBeLessThanOrEqual(5);
  });

  it("increases confidence on repeated mentions", () => {
    const result = extractEntitiesHeuristic("@alice said @alice should review @alice's code");
    const alice = result.entities.find((e) => e.name === "alice");
    expect(alice).toBeDefined();
    expect(alice!.confidence).toBeGreaterThan(0.7);
  });

  it("returns mode: heuristic", () => {
    const result = extractEntitiesHeuristic("test");
    expect(result.mode).toBe("heuristic");
  });
});

describe("parseLlmExtractionResponse", () => {
  it("parses valid JSON response", () => {
    const json = JSON.stringify({
      entities: [
        { name: "UserAuth", type: "concept", confidence: 0.9 },
        { name: "alice", type: "person", confidence: 0.85 },
      ],
      relationships: [
        { source: "alice", target: "UserAuth", relation: "works_on", confidence: 0.8 },
      ],
    });
    const result = parseLlmExtractionResponse(json);
    expect(result).not.toBeNull();
    expect(result!.entities).toHaveLength(2);
    expect(result!.relationships).toHaveLength(1);
    expect(result!.mode).toBe("llm");
  });

  it("handles markdown-wrapped JSON", () => {
    const json = "```json\n" + JSON.stringify({
      entities: [{ name: "Test", type: "concept", confidence: 0.9 }],
      relationships: [],
    }) + "\n```";
    const result = parseLlmExtractionResponse(json);
    expect(result).not.toBeNull();
    expect(result!.entities).toHaveLength(1);
  });

  it("handles JSON with surrounding text", () => {
    const json = "Here are the results:\n" + JSON.stringify({
      entities: [{ name: "Test", type: "concept", confidence: 0.9 }],
      relationships: [],
    }) + "\nDone.";
    const result = parseLlmExtractionResponse(json);
    expect(result).not.toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseLlmExtractionResponse("not json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseLlmExtractionResponse("")).toBeNull();
  });

  it("clamps confidence to 0-1", () => {
    const json = JSON.stringify({
      entities: [{ name: "Test", type: "concept", confidence: 5.0 }],
      relationships: [],
    });
    const result = parseLlmExtractionResponse(json);
    expect(result!.entities[0].confidence).toBe(1);
  });

  it("defaults unknown types to 'unknown'", () => {
    const json = JSON.stringify({
      entities: [{ name: "Test", type: "invalid_type", confidence: 0.9 }],
      relationships: [],
    });
    const result = parseLlmExtractionResponse(json);
    expect(result!.entities[0].type).toBe("unknown");
  });

  it("limits entities to 20 and relationships to 30", () => {
    const entities = Array.from({ length: 25 }, (_, i) => ({
      name: `Entity${i}`, type: "concept", confidence: 0.9,
    }));
    const relationships = Array.from({ length: 35 }, (_, i) => ({
      source: `E${i}`, target: `E${i + 1}`, relation: "related", confidence: 0.8,
    }));
    const json = JSON.stringify({ entities, relationships });
    const result = parseLlmExtractionResponse(json);
    expect(result!.entities.length).toBeLessThanOrEqual(20);
    expect(result!.relationships.length).toBeLessThanOrEqual(30);
  });
});

describe("mergeExtractionResults", () => {
  it("merges heuristic and LLM results with LLM priority", () => {
    const heuristic = extractEntitiesHeuristic("@alice works on UserAuth");
    const llm = parseLlmExtractionResponse(JSON.stringify({
      entities: [
        { name: "alice", type: "person", confidence: 0.95, aliases: ["alice-dev"] },
      ],
      relationships: [
        { source: "alice", target: "UserAuth", relation: "maintains", confidence: 0.9 },
      ],
    }));

    const merged = mergeExtractionResults(heuristic, llm!);
    expect(merged.mode).toBe("hybrid");

    // LLM entity should take priority
    const alice = merged.entities.find((e) => e.name === "alice");
    expect(alice?.confidence).toBe(0.95);
  });

  it("deduplicates relationships", () => {
    const a = {
      entities: [{ name: "A", type: "concept" as const, confidence: 0.7 }],
      relationships: [
        { source: "A", target: "B", relation: "related", confidence: 0.5 },
      ],
      mode: "heuristic" as const,
    };
    const b = {
      entities: [{ name: "B", type: "concept" as const, confidence: 0.8 }],
      relationships: [
        { source: "A", target: "B", relation: "related", confidence: 0.8 },
      ],
      mode: "llm" as const,
    };
    const merged = mergeExtractionResults(a, b);
    // Should only have one "A→related→B" relationship
    const relCount = merged.relationships.filter(
      (r) => r.source === "A" && r.target === "B" && r.relation === "related",
    ).length;
    expect(relCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Graph Merge Tests
// ---------------------------------------------------------------------------

describe("mergeResults", () => {
  const baseResults: BaseSearchResult[] = [
    { chunkId: "c1", score: 0.9, path: "memory/a.md", startLine: 1, endLine: 10, snippet: "auth system", source: "memory" },
    { chunkId: "c2", score: 0.7, path: "memory/b.md", startLine: 1, endLine: 5, snippet: "user profile", source: "memory" },
    { chunkId: "c3", score: 0.5, path: "memory/c.md", startLine: 1, endLine: 3, snippet: "config", source: "memory" },
  ];

  it("passes through base results when no graph results", () => {
    const merged = mergeResults(baseResults, null);
    expect(merged).toHaveLength(3);
    expect(merged[0].mergedScore).toBe(0.9);
    expect(merged[0].graphBoost).toBe(0);
    expect(merged[0].relationships).toEqual([]);
  });

  it("passes through base results with empty graph results", () => {
    const merged = mergeResults(baseResults, []);
    expect(merged).toHaveLength(3);
    expect(merged[0].chunkId).toBe("c1");
  });

  it("boosts chunks that appear in both result sets", () => {
    const graphResults: GraphSearchResult[] = [
      { chunkId: "c2", boost: 0.3, relationships: [], matchedEntities: ["auth"] },
    ];
    const merged = mergeResults(baseResults, graphResults);

    const c1 = merged.find((r) => r.chunkId === "c1")!;
    const c2 = merged.find((r) => r.chunkId === "c2")!;

    // c2 should be boosted above its base score
    expect(c2.mergedScore).toBeGreaterThan(c2.score);
    expect(c2.graphBoost).toBe(0.3);
  });

  it("adds graph-only chunks with lower scores", () => {
    const graphResults: GraphSearchResult[] = [
      { chunkId: "c4", boost: 0.3, relationships: [], matchedEntities: ["new-entity"] },
    ];
    const merged = mergeResults(baseResults, graphResults);
    const c4 = merged.find((r) => r.chunkId === "c4");
    expect(c4).toBeDefined();
    expect(c4!.score).toBe(0); // no base score
    expect(c4!.mergedScore).toBeGreaterThan(0); // but has graph boost
  });

  it("respects maxResults limit", () => {
    const graphResults: GraphSearchResult[] = Array.from({ length: 20 }, (_, i) => ({
      chunkId: `gc${i}`,
      boost: 0.3,
      relationships: [],
      matchedEntities: [],
    }));
    const merged = mergeResults(baseResults, graphResults, { maxResults: 5 });
    expect(merged).toHaveLength(5);
  });

  it("includes relationship context in merged results", () => {
    const graphResults: GraphSearchResult[] = [
      {
        chunkId: "c1",
        boost: 0.3,
        relationships: [
          { source: "alice", relation: "works_on", target: "auth", depth: 1, weight: 1.0 },
        ],
        matchedEntities: ["alice"],
      },
    ];
    const merged = mergeResults(baseResults, graphResults);
    const c1 = merged.find((r) => r.chunkId === "c1")!;
    expect(c1.relationships).toHaveLength(1);
    expect(c1.matchedEntities).toContain("alice");
  });

  it("sorts by mergedScore descending", () => {
    const graphResults: GraphSearchResult[] = [
      { chunkId: "c3", boost: 0.5, relationships: [], matchedEntities: [] }, // big boost on low scorer
    ];
    const merged = mergeResults(baseResults, graphResults);
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i - 1].mergedScore).toBeGreaterThanOrEqual(merged[i].mergedScore);
    }
  });
});

// ---------------------------------------------------------------------------
// Name Similarity Tests
// ---------------------------------------------------------------------------

describe("nameSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(nameSimilarity("hello", "hello")).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(nameSimilarity("UserAuth", "userauth")).toBe(1);
  });

  it("returns 0 for empty strings", () => {
    expect(nameSimilarity("", "hello")).toBe(0);
    expect(nameSimilarity("hello", "")).toBe(0);
  });

  it("returns high similarity for close names", () => {
    expect(nameSimilarity("UserAuth", "UserAuths")).toBeGreaterThan(0.8);
  });

  it("returns low similarity for different names", () => {
    expect(nameSimilarity("UserAuth", "DatabasePool")).toBeLessThan(0.5);
  });
});

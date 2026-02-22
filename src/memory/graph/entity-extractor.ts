/**
 * Entity Extraction Pipeline for Graph Memory.
 *
 * Three modes:
 *   heuristic — regex-based NER, zero LLM cost
 *   llm       — structured-output LLM calls for high-quality extraction
 *   hybrid    — heuristic first pass, LLM refinement for ambiguous entities
 */

import type { GraphNodeType } from "./graph-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedEntity {
  name: string;
  type: GraphNodeType;
  aliases?: string[];
  /** Confidence 0-1 (heuristic defaults to 0.7, LLM returns its own). */
  confidence: number;
}

export interface ExtractedRelationship {
  source: string;
  target: string;
  relation: string;
  confidence: number;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  mode: "heuristic" | "llm" | "hybrid";
}

// ---------------------------------------------------------------------------
// JSON Schema for LLM structured output
// ---------------------------------------------------------------------------

export const ENTITY_EXTRACTION_SCHEMA = {
  name: "entity_extraction",
  strict: true,
  schema: {
    type: "object" as const,
    properties: {
      entities: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            name: { type: "string" as const, maxLength: 200 },
            type: {
              type: "string" as const,
              enum: [
                "person", "project", "concept", "tool", "file",
                "date", "organization", "url", "tag", "unknown",
              ],
            },
            aliases: {
              type: "array" as const,
              items: { type: "string" as const, maxLength: 100 },
              maxItems: 5,
            },
            confidence: { type: "number" as const, minimum: 0, maximum: 1 },
          },
          required: ["name", "type", "confidence"],
          additionalProperties: false,
        },
        maxItems: 20,
      },
      relationships: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            source: { type: "string" as const, maxLength: 200 },
            target: { type: "string" as const, maxLength: 200 },
            relation: { type: "string" as const, maxLength: 100 },
            confidence: { type: "number" as const, minimum: 0, maximum: 1 },
          },
          required: ["source", "target", "relation", "confidence"],
          additionalProperties: false,
        },
        maxItems: 30,
      },
    },
    required: ["entities", "relationships"],
    additionalProperties: false,
  },
} as const;

export const EXTRACTION_SYSTEM_PROMPT = `You are an entity extraction system. Given a text chunk, extract:
1. Named entities (people, projects, concepts, tools, files, dates, organizations, URLs, tags)
2. Relationships between entities (e.g., "works_on", "depends_on", "mentioned_with", "implemented_in")

Rules:
- Entity names should be normalized (trim whitespace, consistent casing)
- Merge obvious duplicates (e.g., "auth.ts" and "src/auth.ts" are the same file)
- Assign confidence based on how clearly the entity/relationship is stated
- Return ONLY valid JSON matching the required schema`;

// ---------------------------------------------------------------------------
// Heuristic Patterns
// ---------------------------------------------------------------------------

const PATTERNS: Array<{ pattern: RegExp; type: GraphNodeType; group?: number }> = [
  // @mentions
  { pattern: /@([a-zA-Z][\w.-]{1,38})/g, type: "person", group: 1 },
  // #tags
  { pattern: /#([a-zA-Z][\w-]{1,49})/g, type: "tag", group: 1 },
  // File paths (Unix and Windows style)
  { pattern: /(?:^|[\s(`"'])([.~]?\/[\w./-]{3,120}(?:\.\w{1,10})?)/gm, type: "file", group: 1 },
  { pattern: /(?:^|[\s(`"'])([A-Z]:\\[\w.\\ -]{3,120})/gm, type: "file", group: 1 },
  // URLs
  { pattern: /https?:\/\/[^\s)"']{5,200}/g, type: "url" },
  // Email addresses → person
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, type: "person" },
  // ISO dates
  { pattern: /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?/g, type: "date" },
  // CamelCase/PascalCase identifiers (likely class/function names → concept)
  { pattern: /\b([A-Z][a-z]+(?:[A-Z][a-z]+){1,6})\b/g, type: "concept", group: 1 },
  // SCREAMING_SNAKE_CASE constants → concept
  { pattern: /\b([A-Z][A-Z0-9_]{3,40})\b/g, type: "concept", group: 1 },
];

// ---------------------------------------------------------------------------
// Heuristic Extraction
// ---------------------------------------------------------------------------

export function extractEntitiesHeuristic(
  text: string,
  maxEntities = 20,
): ExtractionResult {
  const entityMap = new Map<string, ExtractedEntity>();

  for (const { pattern, type, group } of PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = group != null ? match[group] : match[0];
      if (!raw) continue;
      const name = raw.trim();
      if (name.length < 2 || name.length > 200) continue;

      const key = `${type}:${name.toLowerCase()}`;
      const existing = entityMap.get(key);
      if (existing) {
        existing.confidence = Math.min(1, existing.confidence + 0.05);
      } else if (entityMap.size < maxEntities) {
        entityMap.set(key, { name, type, confidence: 0.7 });
      }
    }
  }

  // Infer co-occurrence relationships
  const entities = [...entityMap.values()];
  const relationships: ExtractedRelationship[] = [];

  // Create "mentioned_with" edges for entities found in the same chunk
  for (let i = 0; i < entities.length && relationships.length < 30; i++) {
    for (let j = i + 1; j < entities.length && relationships.length < 30; j++) {
      const a = entities[i];
      const b = entities[j];
      // Only relate entities of different types (e.g., person↔project, file↔concept)
      if (a.type !== b.type) {
        relationships.push({
          source: a.name,
          target: b.name,
          relation: inferRelation(a.type, b.type),
          confidence: 0.5,
        });
      }
    }
  }

  return { entities, relationships, mode: "heuristic" };
}

function inferRelation(sourceType: GraphNodeType, targetType: GraphNodeType): string {
  if (sourceType === "person" && targetType === "project") return "works_on";
  if (sourceType === "person" && targetType === "file") return "authored";
  if (sourceType === "file" && targetType === "concept") return "implements";
  if (sourceType === "concept" && targetType === "file") return "implemented_in";
  if (sourceType === "file" && targetType === "file") return "related_to";
  if (sourceType === "project" && targetType === "concept") return "contains";
  return "mentioned_with";
}

// ---------------------------------------------------------------------------
// LLM Extraction Result Parser
// ---------------------------------------------------------------------------

const VALID_TYPES = new Set<GraphNodeType>([
  "person", "project", "concept", "tool", "file",
  "date", "organization", "url", "tag", "unknown",
]);

/**
 * Parse and validate a raw LLM response into an ExtractionResult.
 * Returns null if the response is not valid JSON or fails validation.
 */
export function parseLlmExtractionResponse(raw: string): ExtractionResult | null {
  let text = raw.trim();

  // Strip markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Try extracting JSON object from surrounding text
    const braceStart = text.indexOf("{");
    const braceEnd = text.lastIndexOf("}");
    if (braceStart >= 0 && braceEnd > braceStart) {
      try {
        parsed = JSON.parse(text.slice(braceStart, braceEnd + 1));
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  // Validate entities
  const rawEntities = Array.isArray(obj.entities) ? obj.entities : [];
  const entities: ExtractedEntity[] = [];
  for (const e of rawEntities.slice(0, 20)) {
    if (typeof e !== "object" || e === null) continue;
    const ent = e as Record<string, unknown>;
    if (typeof ent.name !== "string" || !ent.name.trim()) continue;
    const type = VALID_TYPES.has(ent.type as GraphNodeType)
      ? (ent.type as GraphNodeType)
      : "unknown";
    const confidence =
      typeof ent.confidence === "number"
        ? Math.max(0, Math.min(1, ent.confidence))
        : 0.8;
    const aliases = Array.isArray(ent.aliases)
      ? (ent.aliases as unknown[])
          .filter((a): a is string => typeof a === "string")
          .slice(0, 5)
      : undefined;

    entities.push({
      name: ent.name.trim().slice(0, 200),
      type,
      confidence,
      ...(aliases?.length ? { aliases } : {}),
    });
  }

  // Validate relationships
  const rawRels = Array.isArray(obj.relationships) ? obj.relationships : [];
  const relationships: ExtractedRelationship[] = [];
  for (const r of rawRels.slice(0, 30)) {
    if (typeof r !== "object" || r === null) continue;
    const rel = r as Record<string, unknown>;
    if (
      typeof rel.source !== "string" ||
      typeof rel.target !== "string" ||
      typeof rel.relation !== "string"
    )
      continue;
    if (!rel.source.trim() || !rel.target.trim() || !rel.relation.trim()) continue;

    relationships.push({
      source: rel.source.trim().slice(0, 200),
      target: rel.target.trim().slice(0, 200),
      relation: rel.relation.trim().slice(0, 100),
      confidence:
        typeof rel.confidence === "number"
          ? Math.max(0, Math.min(1, rel.confidence))
          : 0.7,
    });
  }

  return { entities, relationships, mode: "llm" };
}

// ---------------------------------------------------------------------------
// Hybrid Extraction (heuristic + LLM merge)
// ---------------------------------------------------------------------------

/**
 * Merge heuristic and LLM results. LLM results take priority for
 * entities with the same name; heuristic fills gaps.
 */
export function mergeExtractionResults(
  heuristic: ExtractionResult,
  llm: ExtractionResult,
): ExtractionResult {
  const entityMap = new Map<string, ExtractedEntity>();

  // LLM entities first (higher priority)
  for (const e of llm.entities) {
    entityMap.set(e.name.toLowerCase(), e);
  }
  // Fill in heuristic entities not already present
  for (const e of heuristic.entities) {
    const key = e.name.toLowerCase();
    if (!entityMap.has(key)) {
      entityMap.set(key, e);
    }
  }

  // Merge relationships: deduplicate by (source, target, relation)
  const relSet = new Set<string>();
  const relationships: ExtractedRelationship[] = [];
  for (const r of [...llm.relationships, ...heuristic.relationships]) {
    const key = `${r.source.toLowerCase()}|${r.relation.toLowerCase()}|${r.target.toLowerCase()}`;
    if (!relSet.has(key)) {
      relSet.add(key);
      relationships.push(r);
    }
  }

  return {
    entities: [...entityMap.values()].slice(0, 20),
    relationships: relationships.slice(0, 30),
    mode: "hybrid",
  };
}

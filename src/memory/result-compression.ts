/**
 * Memory Result Compression — compress search results before prompt injection.
 *
 * Strategies:
 *   1. Fact extraction:  strip boilerplate, extract key facts as bullets
 *   2. Deduplication:    remove overlapping content across results
 *   3. Dense formatting: compact bullets instead of raw chunk text
 *
 * Opt-in via `agents.defaults.memorySearch.query.compression`.
 * When disabled, raw snippets are injected as today.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemorySnippet {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  source: "memory" | "sessions";
}

export interface CompressedResult {
  /** Dense bullet-point summary of all snippets. */
  compressed: string;
  /** Original snippet count. */
  originalCount: number;
  /** Token estimate of original text. */
  originalTokens: number;
  /** Token estimate of compressed text. */
  compressedTokens: number;
  /** Compression ratio (original / compressed). */
  ratio: number;
  /** Per-snippet citations for traceability. */
  citations: Array<{ path: string; startLine: number; endLine: number }>;
}

export interface CompressionConfig {
  /** Target compression ratio (e.g., 3 = 3:1). Default: 3. */
  targetRatio?: number;
  /** Max output tokens for compressed text. Default: 800. */
  maxOutputTokens?: number;
  /** Min snippet length to attempt compression (shorter kept verbatim). Default: 100 chars. */
  minSnippetLength?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TARGET_RATIO = 3;
const DEFAULT_MAX_OUTPUT_TOKENS = 800;
const DEFAULT_MIN_SNIPPET_LENGTH = 100;
const CHARS_PER_TOKEN = 4; // conservative estimate

// ---------------------------------------------------------------------------
// Heuristic Compression (no LLM cost)
// ---------------------------------------------------------------------------

/**
 * Compress memory search results into a dense summary.
 * Uses heuristic extraction — no LLM calls.
 */
export function compressResults(
  snippets: MemorySnippet[],
  config?: CompressionConfig,
): CompressedResult {
  const targetRatio = config?.targetRatio ?? DEFAULT_TARGET_RATIO;
  const maxOutputTokens = config?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const minSnippetLength = config?.minSnippetLength ?? DEFAULT_MIN_SNIPPET_LENGTH;

  if (snippets.length === 0) {
    return {
      compressed: "",
      originalCount: 0,
      originalTokens: 0,
      compressedTokens: 0,
      ratio: 1,
      citations: [],
    };
  }

  const originalText = snippets.map((s) => s.snippet).join("\n\n");
  const originalTokens = Math.ceil(originalText.length / CHARS_PER_TOKEN);
  const tokenBudget = Math.min(
    maxOutputTokens,
    Math.ceil(originalTokens / targetRatio),
  );
  const charBudget = tokenBudget * CHARS_PER_TOKEN;

  // Extract facts from each snippet
  const allFacts: Array<{ fact: string; path: string; startLine: number; endLine: number }> = [];

  for (const snippet of snippets) {
    if (snippet.snippet.length < minSnippetLength) {
      // Short snippets kept as-is
      allFacts.push({
        fact: snippet.snippet.trim(),
        path: snippet.path,
        startLine: snippet.startLine,
        endLine: snippet.endLine,
      });
      continue;
    }

    const facts = extractFacts(snippet.snippet);
    for (const fact of facts) {
      allFacts.push({
        fact,
        path: snippet.path,
        startLine: snippet.startLine,
        endLine: snippet.endLine,
      });
    }
  }

  // Deduplicate facts
  const deduped = deduplicateFacts(allFacts.map((f) => f.fact));
  const dedupedFacts = allFacts.filter((_, i) => deduped.has(i));

  // Build compressed output within budget
  const lines: string[] = [];
  let currentChars = 0;

  for (const { fact } of dedupedFacts) {
    const line = `- ${fact}`;
    if (currentChars + line.length > charBudget && lines.length > 0) break;
    lines.push(line);
    currentChars += line.length + 1; // +1 for newline
  }

  const compressed = lines.join("\n");
  const compressedTokens = Math.ceil(compressed.length / CHARS_PER_TOKEN);

  return {
    compressed,
    originalCount: snippets.length,
    originalTokens,
    compressedTokens,
    ratio: compressedTokens > 0 ? originalTokens / compressedTokens : 1,
    citations: snippets.map((s) => ({
      path: s.path,
      startLine: s.startLine,
      endLine: s.endLine,
    })),
  };
}

// ---------------------------------------------------------------------------
// Fact Extraction (heuristic)
// ---------------------------------------------------------------------------

/**
 * Extract key facts from a text chunk.
 * Heuristic approach:
 *   - Split into sentences
 *   - Remove boilerplate/filler
 *   - Keep sentences with information density markers
 */
function extractFacts(text: string): string[] {
  // Split into lines and sentences
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const facts: string[] = [];

  for (const line of lines) {
    // Skip likely boilerplate
    if (isBoilerplate(line)) continue;

    // Split long lines into sentences
    const sentences = line.split(/(?<=[.!?])\s+/).filter((s) => s.length > 10);

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length < 10) continue;
      if (isBoilerplate(trimmed)) continue;

      // Normalize whitespace
      const normalized = trimmed.replace(/\s+/g, " ");
      // Cap sentence length
      facts.push(normalized.length > 200 ? normalized.slice(0, 197) + "..." : normalized);
    }
  }

  return facts;
}

/**
 * Detect boilerplate lines that add little information.
 */
function isBoilerplate(line: string): boolean {
  const lower = line.toLowerCase().trim();
  if (lower.length < 5) return true;

  // Common markdown/doc boilerplate
  if (lower.startsWith("---")) return true;
  if (lower.startsWith("```")) return true;
  if (/^#+\s*$/.test(lower)) return true; // empty heading
  if (/^(note|tip|warning|info|caution):?\s*$/i.test(lower)) return true;

  // Filler phrases
  const fillers = [
    "as mentioned above",
    "as described below",
    "see also",
    "for more information",
    "please refer to",
    "table of contents",
    "click here",
  ];
  return fillers.some((f) => lower.includes(f));
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Identify unique facts by detecting near-duplicates.
 * Returns indices of facts to keep.
 *
 * Uses Jaccard similarity on word sets.
 */
function deduplicateFacts(facts: string[]): Set<number> {
  const keep = new Set<number>();
  const tokenSets: Set<string>[] = facts.map((f) => {
    const words = f.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    return new Set(words);
  });

  for (let i = 0; i < facts.length; i++) {
    let isDuplicate = false;
    for (const keptIdx of keep) {
      const similarity = jaccardSimilarity(tokenSets[i], tokenSets[keptIdx]);
      if (similarity > 0.7) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      keep.add(i);
    }
  }

  return keep;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

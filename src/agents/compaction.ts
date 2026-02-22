import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { estimateTokens, generateSummary } from "@mariozechner/pi-coding-agent";
import { retryAsync } from "../infra/retry.js";
import { DEFAULT_CONTEXT_TOKENS } from "./defaults.js";
import { repairToolUseResultPairing, stripToolResultDetails } from "./session-transcript-repair.js";

export const BASE_CHUNK_RATIO = 0.4;
export const MIN_CHUNK_RATIO = 0.15;
export const SAFETY_MARGIN = 1.2; // 20% buffer for estimateTokens() inaccuracy
const DEFAULT_SUMMARY_FALLBACK = "No prior history.";
const DEFAULT_PARTS = 2;
const MERGE_SUMMARIES_INSTRUCTIONS =
  "Merge these partial summaries into a single cohesive summary. Preserve decisions," +
  " TODOs, open questions, and any constraints.";

export function estimateMessagesTokens(messages: AgentMessage[]): number {
  // SECURITY: toolResult.details can contain untrusted/verbose payloads; never include in LLM-facing compaction.
  const safe = stripToolResultDetails(messages);
  return safe.reduce((sum, message) => sum + estimateTokens(message), 0);
}

function normalizeParts(parts: number, messageCount: number): number {
  if (!Number.isFinite(parts) || parts <= 1) {
    return 1;
  }
  return Math.min(Math.max(1, Math.floor(parts)), Math.max(1, messageCount));
}

export function splitMessagesByTokenShare(
  messages: AgentMessage[],
  parts = DEFAULT_PARTS,
): AgentMessage[][] {
  if (messages.length === 0) {
    return [];
  }
  const normalizedParts = normalizeParts(parts, messages.length);
  if (normalizedParts <= 1) {
    return [messages];
  }

  const totalTokens = estimateMessagesTokens(messages);
  const targetTokens = totalTokens / normalizedParts;
  const chunks: AgentMessage[][] = [];
  let current: AgentMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = estimateTokens(message);
    if (
      chunks.length < normalizedParts - 1 &&
      current.length > 0 &&
      currentTokens + messageTokens > targetTokens
    ) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(message);
    currentTokens += messageTokens;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

// Overhead reserved for summarization prompt, system prompt, previous summary,
// and serialization wrappers (<conversation> tags, instructions, etc.).
// generateSummary uses reasoning: "high" which also consumes context budget.
export const SUMMARIZATION_OVERHEAD_TOKENS = 4096;

export function chunkMessagesByMaxTokens(
  messages: AgentMessage[],
  maxTokens: number,
): AgentMessage[][] {
  if (messages.length === 0) {
    return [];
  }

  // Apply safety margin to compensate for estimateTokens() underestimation
  // (chars/4 heuristic misses multi-byte chars, special tokens, code tokens, etc.)
  const effectiveMax = Math.max(1, Math.floor(maxTokens / SAFETY_MARGIN));

  const chunks: AgentMessage[][] = [];
  let currentChunk: AgentMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = estimateTokens(message);
    if (currentChunk.length > 0 && currentTokens + messageTokens > effectiveMax) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }

    currentChunk.push(message);
    currentTokens += messageTokens;

    if (messageTokens > effectiveMax) {
      // Split oversized messages to avoid unbounded chunk growth.
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Compute adaptive chunk ratio based on average message size.
 * When messages are large, we use smaller chunks to avoid exceeding model limits.
 */
export function computeAdaptiveChunkRatio(messages: AgentMessage[], contextWindow: number): number {
  if (messages.length === 0) {
    return BASE_CHUNK_RATIO;
  }

  const totalTokens = estimateMessagesTokens(messages);
  const avgTokens = totalTokens / messages.length;

  // Apply safety margin to account for estimation inaccuracy
  const safeAvgTokens = avgTokens * SAFETY_MARGIN;
  const avgRatio = safeAvgTokens / contextWindow;

  // If average message is > 10% of context, reduce chunk ratio
  if (avgRatio > 0.1) {
    const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO);
    return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction);
  }

  return BASE_CHUNK_RATIO;
}

/**
 * Check if a single message is too large to summarize.
 * If single message > 50% of context, it can't be summarized safely.
 */
export function isOversizedForSummary(msg: AgentMessage, contextWindow: number): boolean {
  const tokens = estimateTokens(msg) * SAFETY_MARGIN;
  return tokens > contextWindow * 0.5;
}

async function summarizeChunks(params: {
  messages: AgentMessage[];
  model: NonNullable<ExtensionContext["model"]>;
  apiKey: string;
  signal: AbortSignal;
  reserveTokens: number;
  maxChunkTokens: number;
  customInstructions?: string;
  previousSummary?: string;
}): Promise<string> {
  if (params.messages.length === 0) {
    return params.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  // SECURITY: never feed toolResult.details into summarization prompts.
  const safeMessages = stripToolResultDetails(params.messages);
  const chunks = chunkMessagesByMaxTokens(safeMessages, params.maxChunkTokens);
  let summary = params.previousSummary;

  for (const chunk of chunks) {
    summary = await retryAsync(
      () =>
        generateSummary(
          chunk,
          params.model,
          params.reserveTokens,
          params.apiKey,
          params.signal,
          params.customInstructions,
          summary,
        ),
      {
        attempts: 3,
        minDelayMs: 500,
        maxDelayMs: 5000,
        jitter: 0.2,
        label: "compaction/generateSummary",
        shouldRetry: (err) => !(err instanceof Error && err.name === "AbortError"),
      },
    );
  }

  return summary ?? DEFAULT_SUMMARY_FALLBACK;
}

/**
 * Summarize with progressive fallback for handling oversized messages.
 * If full summarization fails, tries partial summarization excluding oversized messages.
 */
export async function summarizeWithFallback(params: {
  messages: AgentMessage[];
  model: NonNullable<ExtensionContext["model"]>;
  apiKey: string;
  signal: AbortSignal;
  reserveTokens: number;
  maxChunkTokens: number;
  contextWindow: number;
  customInstructions?: string;
  previousSummary?: string;
}): Promise<string> {
  const { messages, contextWindow } = params;

  if (messages.length === 0) {
    return params.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  // Try full summarization first
  try {
    return await summarizeChunks(params);
  } catch (fullError) {
    console.warn(
      `Full summarization failed, trying partial: ${
        fullError instanceof Error ? fullError.message : String(fullError)
      }`,
    );
  }

  // Fallback 1: Summarize only small messages, note oversized ones
  const smallMessages: AgentMessage[] = [];
  const oversizedNotes: string[] = [];

  for (const msg of messages) {
    if (isOversizedForSummary(msg, contextWindow)) {
      const role = (msg as { role?: string }).role ?? "message";
      const tokens = estimateTokens(msg);
      oversizedNotes.push(
        `[Large ${role} (~${Math.round(tokens / 1000)}K tokens) omitted from summary]`,
      );
    } else {
      smallMessages.push(msg);
    }
  }

  if (smallMessages.length > 0) {
    try {
      const partialSummary = await summarizeChunks({
        ...params,
        messages: smallMessages,
      });
      const notes = oversizedNotes.length > 0 ? `\n\n${oversizedNotes.join("\n")}` : "";
      return partialSummary + notes;
    } catch (partialError) {
      console.warn(
        `Partial summarization also failed: ${
          partialError instanceof Error ? partialError.message : String(partialError)
        }`,
      );
    }
  }

  // Final fallback: Just note what was there
  return (
    `Context contained ${messages.length} messages (${oversizedNotes.length} oversized). ` +
    `Summary unavailable due to size limits.`
  );
}

export async function summarizeInStages(params: {
  messages: AgentMessage[];
  model: NonNullable<ExtensionContext["model"]>;
  apiKey: string;
  signal: AbortSignal;
  reserveTokens: number;
  maxChunkTokens: number;
  contextWindow: number;
  customInstructions?: string;
  previousSummary?: string;
  parts?: number;
  minMessagesForSplit?: number;
}): Promise<string> {
  const { messages } = params;
  if (messages.length === 0) {
    return params.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  const minMessagesForSplit = Math.max(2, params.minMessagesForSplit ?? 4);
  const parts = normalizeParts(params.parts ?? DEFAULT_PARTS, messages.length);
  const totalTokens = estimateMessagesTokens(messages);

  if (parts <= 1 || messages.length < minMessagesForSplit || totalTokens <= params.maxChunkTokens) {
    return summarizeWithFallback(params);
  }

  const splits = splitMessagesByTokenShare(messages, parts).filter((chunk) => chunk.length > 0);
  if (splits.length <= 1) {
    return summarizeWithFallback(params);
  }

  const partialSummaries: string[] = [];
  for (const chunk of splits) {
    partialSummaries.push(
      await summarizeWithFallback({
        ...params,
        messages: chunk,
        previousSummary: undefined,
      }),
    );
  }

  if (partialSummaries.length === 1) {
    return partialSummaries[0];
  }

  const summaryMessages: AgentMessage[] = partialSummaries.map((summary) => ({
    role: "user",
    content: summary,
    timestamp: Date.now(),
  }));

  const mergeInstructions = params.customInstructions
    ? `${MERGE_SUMMARIES_INSTRUCTIONS}\n\nAdditional focus:\n${params.customInstructions}`
    : MERGE_SUMMARIES_INSTRUCTIONS;

  return summarizeWithFallback({
    ...params,
    messages: summaryMessages,
    customInstructions: mergeInstructions,
  });
}

export function pruneHistoryForContextShare(params: {
  messages: AgentMessage[];
  maxContextTokens: number;
  maxHistoryShare?: number;
  parts?: number;
}): {
  messages: AgentMessage[];
  droppedMessagesList: AgentMessage[];
  droppedChunks: number;
  droppedMessages: number;
  droppedTokens: number;
  keptTokens: number;
  budgetTokens: number;
} {
  const maxHistoryShare = params.maxHistoryShare ?? 0.5;
  const budgetTokens = Math.max(1, Math.floor(params.maxContextTokens * maxHistoryShare));
  let keptMessages = params.messages;
  const allDroppedMessages: AgentMessage[] = [];
  let droppedChunks = 0;
  let droppedMessages = 0;
  let droppedTokens = 0;

  const parts = normalizeParts(params.parts ?? DEFAULT_PARTS, keptMessages.length);

  while (keptMessages.length > 0 && estimateMessagesTokens(keptMessages) > budgetTokens) {
    const chunks = splitMessagesByTokenShare(keptMessages, parts);
    if (chunks.length <= 1) {
      break;
    }
    const [dropped, ...rest] = chunks;
    const flatRest = rest.flat();

    // After dropping a chunk, repair tool_use/tool_result pairing to handle
    // orphaned tool_results (whose tool_use was in the dropped chunk).
    // repairToolUseResultPairing drops orphaned tool_results, preventing
    // "unexpected tool_use_id" errors from Anthropic's API.
    const repairReport = repairToolUseResultPairing(flatRest);
    const repairedKept = repairReport.messages;

    // Track orphaned tool_results as dropped (they were in kept but their tool_use was dropped)
    const orphanedCount = repairReport.droppedOrphanCount;

    droppedChunks += 1;
    droppedMessages += dropped.length + orphanedCount;
    droppedTokens += estimateMessagesTokens(dropped);
    // Note: We don't have the actual orphaned messages to add to droppedMessagesList
    // since repairToolUseResultPairing doesn't return them. This is acceptable since
    // the dropped messages are used for summarization, and orphaned tool_results
    // without their tool_use context aren't useful for summarization anyway.
    allDroppedMessages.push(...dropped);
    keptMessages = repairedKept;
  }

  return {
    messages: keptMessages,
    droppedMessagesList: allDroppedMessages,
    droppedChunks,
    droppedMessages,
    droppedTokens,
    keptTokens: estimateMessagesTokens(keptMessages),
    budgetTokens,
  };
}

export function resolveContextWindowTokens(model?: ExtensionContext["model"]): number {
  return Math.max(1, Math.floor(model?.contextWindow ?? DEFAULT_CONTEXT_TOKENS));
}

// ---------------------------------------------------------------------------
// Incremental Summarization (opt-in via agents.defaults.compaction.incremental)
// ---------------------------------------------------------------------------

/** A single digest in the rolling summary chain. */
export interface SummaryDigest {
  /** Zero-based index in the chain. */
  index: number;
  /** Approximate token count of this digest. */
  tokens: number;
  /** The summary text. */
  text: string;
  /** Number of original messages this digest covers. */
  messageCount: number;
}

export interface IncrementalSummaryState {
  /** Ordered chain of digests (oldest first). */
  digests: SummaryDigest[];
  /** Index into the original messages array: messages[0..cursor) are summarized. */
  cursor: number;
}

const DEFAULT_INCREMENTAL_BLOCK_SIZE = 5; // summarize every N turns
const DEFAULT_VERBATIM_KEEP = 5; // keep last N turns verbatim
const DEFAULT_DIGEST_TARGET_TOKENS = 200;

/**
 * Build an incremental summary state from a message history.
 * Splits messages into blocks of `blockSize`, summarizes each into a ~200-token
 * digest, and keeps the last `verbatimKeep` messages verbatim.
 *
 * Returns the updated state plus the messages that should be included in the
 * context (summaries + verbatim recent turns).
 */
export async function buildIncrementalSummary(params: {
  messages: AgentMessage[];
  state: IncrementalSummaryState;
  model: NonNullable<ExtensionContext["model"]>;
  apiKey: string;
  signal: AbortSignal;
  contextWindow: number;
  blockSize?: number;
  verbatimKeep?: number;
  digestTargetTokens?: number;
  customInstructions?: string;
}): Promise<{
  state: IncrementalSummaryState;
  contextMessages: AgentMessage[];
}> {
  const blockSize = Math.max(1, params.blockSize ?? DEFAULT_INCREMENTAL_BLOCK_SIZE);
  const verbatimKeep = Math.max(1, params.verbatimKeep ?? DEFAULT_VERBATIM_KEEP);
  const digestTarget = Math.max(50, params.digestTargetTokens ?? DEFAULT_DIGEST_TARGET_TOKENS);
  const { messages, state } = params;

  if (messages.length === 0) {
    return { state, contextMessages: [] };
  }

  // How many messages from the tail to keep verbatim
  const verbatimStart = Math.max(0, messages.length - verbatimKeep);

  // Only summarize messages between state.cursor and verbatimStart
  const summarizableEnd = verbatimStart;
  let cursor = state.cursor;
  const digests = [...state.digests];

  while (cursor + blockSize <= summarizableEnd) {
    const block = messages.slice(cursor, cursor + blockSize);
    const maxChunkTokens = Math.max(
      digestTarget * 2,
      Math.floor(params.contextWindow * 0.3),
    );

    let digestText: string;
    try {
      digestText = await summarizeWithFallback({
        messages: block,
        model: params.model,
        apiKey: params.apiKey,
        signal: params.signal,
        reserveTokens: digestTarget,
        maxChunkTokens,
        contextWindow: params.contextWindow,
        customInstructions:
          `Summarize in ~${digestTarget} tokens. Focus on decisions, facts, and outcomes.` +
          (params.customInstructions ? `\n${params.customInstructions}` : ""),
      });
    } catch {
      // If summarization fails, stop here — keep remaining messages verbatim
      break;
    }

    digests.push({
      index: digests.length,
      tokens: estimateMessagesTokens([{ role: "user", content: digestText, timestamp: Date.now() }]),
      text: digestText,
      messageCount: block.length,
    });
    cursor += blockSize;
  }

  // Build context: summary digests as a system-like message + verbatim recent
  const contextMessages: AgentMessage[] = [];

  if (digests.length > 0) {
    const summaryText = digests.map(
      (d, i) => `[Summary ${i + 1}/${digests.length}]\n${d.text}`,
    ).join("\n\n");
    contextMessages.push({
      role: "user",
      content: `[Prior conversation summary]\n\n${summaryText}`,
      timestamp: Date.now(),
    } as AgentMessage);
  }

  // Add any unsummarized messages between cursor and verbatimStart
  if (cursor < verbatimStart) {
    contextMessages.push(...messages.slice(cursor, verbatimStart));
  }

  // Add verbatim recent messages
  contextMessages.push(...messages.slice(verbatimStart));

  return {
    state: { digests, cursor },
    contextMessages,
  };
}

/** Create an empty incremental summary state. */
export function createEmptyIncrementalState(): IncrementalSummaryState {
  return { digests: [], cursor: 0 };
}

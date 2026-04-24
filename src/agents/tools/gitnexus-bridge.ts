// ── GitNexus Code Intelligence Bridge ────────────────────────────
//
// Auto-detects GitNexus availability and bridges its MCP tools into
// the Pi agent's tool set. Treats GitNexus as an optional external
// tool — never bundles or forks it.

import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { emitCodeIntelEvent } from "../../security/audit-trail-emitters.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const log = createSubsystemLogger("tools/gitnexus");

// ── Registry ────────────────────────────────────────────────────

type GitNexusRegistryEntry = {
  path: string;
  name?: string;
  lastIndexed?: string;
  symbolCount?: number;
};

type GitNexusRegistry = {
  repos?: GitNexusRegistryEntry[];
};

let registryCache: GitNexusRegistry | null = null;
let registryCacheTs = 0;
const REGISTRY_CACHE_TTL_MS = 30_000;

async function loadRegistry(): Promise<GitNexusRegistry | null> {
  const now = Date.now();
  if (registryCache && now - registryCacheTs < REGISTRY_CACHE_TTL_MS) {
    return registryCache;
  }
  try {
    const registryPath = path.join(homedir(), ".gitnexus", "registry.json");
    const raw = await readFile(registryPath, "utf-8");
    registryCache = JSON.parse(raw) as GitNexusRegistry;
    registryCacheTs = now;
    return registryCache;
  } catch {
    registryCache = null;
    registryCacheTs = now;
    return null;
  }
}

function isWorkspaceIndexed(registry: GitNexusRegistry, workspaceDir: string): boolean {
  if (!registry.repos?.length) {
    return false;
  }
  const normalized = path.resolve(workspaceDir).replace(/\\/g, "/");
  return registry.repos.some((repo) => {
    const repoPath = path.resolve(repo.path).replace(/\\/g, "/");
    return repoPath === normalized;
  });
}

// ── Binary Detection ────────────────────────────────────────────

let binAvailable: boolean | null = null;

async function isGitNexusBinAvailable(): Promise<boolean> {
  if (binAvailable !== null) {
    return binAvailable;
  }
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn("gitnexus", ["--version"], {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
        shell: true,
      });
      let exited = false;
      child.on("error", () => {
        if (!exited) {
          exited = true;
          binAvailable = false;
          resolve(false);
        }
      });
      child.on("close", (code) => {
        if (!exited) {
          exited = true;
          binAvailable = code === 0;
          resolve(binAvailable);
        }
      });
    } catch {
      binAvailable = false;
      resolve(false);
    }
  });
}

// ── MCP Process Management ──────────────────────────────────────

let mcpProcess: ChildProcess | null = null;
let mcpRequestId = 0;
let mcpBuffer = "";
const mcpPendingRequests = new Map<
  number,
  { resolve: (result: unknown) => void; reject: (err: Error) => void }
>();

function ensureMcpProcess(): ChildProcess {
  if (mcpProcess && !mcpProcess.killed) {
    return mcpProcess;
  }
  mcpProcess = spawn("gitnexus", ["mcp"], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });
  mcpBuffer = "";

  mcpProcess.stdout?.on("data", (chunk: Buffer) => {
    mcpBuffer += chunk.toString("utf-8");
    // MCP stdio transport: newline-delimited JSON
    let newlineIdx: number;
    while ((newlineIdx = mcpBuffer.indexOf("\n")) !== -1) {
      const line = mcpBuffer.slice(0, newlineIdx).trim();
      mcpBuffer = mcpBuffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
        if (msg.id !== undefined && mcpPendingRequests.has(msg.id)) {
          const pending = mcpPendingRequests.get(msg.id)!;
          mcpPendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(
              new Error(
                typeof msg.error === "object" && msg.error !== null
                  ? (msg.error as { message?: string }).message ?? JSON.stringify(msg.error)
                  : String(msg.error),
              ),
            );
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch {
        // ignore non-JSON lines (startup banners, etc.)
      }
    }
  });

  mcpProcess.on("exit", () => {
    // Reject all pending requests
    for (const [id, pending] of mcpPendingRequests) {
      pending.reject(new Error("GitNexus MCP process exited unexpectedly"));
      mcpPendingRequests.delete(id);
    }
    mcpProcess = null;
  });

  mcpProcess.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8").trim();
    if (text) {
      log.debug(`gitnexus stderr: ${text}`);
    }
  });

  return mcpProcess;
}

async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<unknown> {
  const proc = ensureMcpProcess();
  const id = ++mcpRequestId;
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });

  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      mcpPendingRequests.delete(id);
      reject(new Error(`GitNexus MCP call timed out after ${timeoutMs}ms: ${toolName}`));
    }, timeoutMs);

    mcpPendingRequests.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });

    proc.stdin?.write(request + "\n", (err) => {
      if (err) {
        clearTimeout(timer);
        mcpPendingRequests.delete(id);
        reject(new Error(`Failed to write to GitNexus MCP: ${err.message}`));
      }
    });
  });
}

// ── Cleanup ─────────────────────────────────────────────────────

export function shutdownGitNexusMcp(): void {
  if (mcpProcess && !mcpProcess.killed) {
    mcpProcess.kill();
    mcpProcess = null;
  }
}

// ── Status Check ────────────────────────────────────────────────

export type GitNexusStatus = {
  available: boolean;
  indexed: boolean;
  repos: GitNexusRegistryEntry[];
};

export async function getGitNexusStatus(workspaceDir: string): Promise<GitNexusStatus> {
  const available = await isGitNexusBinAvailable();
  if (!available) {
    return { available: false, indexed: false, repos: [] };
  }
  const registry = await loadRegistry();
  if (!registry) {
    return { available: true, indexed: false, repos: [] };
  }
  return {
    available: true,
    indexed: isWorkspaceIndexed(registry, workspaceDir),
    repos: registry.repos ?? [],
  };
}

// ── Tool Definitions ────────────────────────────────────────────

const GITNEXUS_ACTIONS = [
  "status",
  "query",
  "context",
  "impact",
  "detect_changes",
  "rename",
  "list_repos",
  "index",
] as const;

const GitNexusToolSchema = Type.Object({
  action: stringEnum(GITNEXUS_ACTIONS),
  // query
  pattern: Type.Optional(Type.String({ description: "Symbol name or search pattern" })),
  symbolType: Type.Optional(
    Type.String({ description: "Filter by symbol type: function, class, method, etc." }),
  ),
  // context, impact, rename
  symbol: Type.Optional(Type.String({ description: "Symbol name for context/impact/rename" })),
  // rename
  newName: Type.Optional(Type.String({ description: "New name for rename action" })),
  // repo override
  repo: Type.Optional(
    Type.String({ description: "Repository path (defaults to current workspace)" }),
  ),
});

export function createGitNexusTool(opts: {
  workspaceDir: string;
  agentId?: string;
  sessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Code Intelligence",
    name: "code_intel",
    description:
      "Code intelligence powered by GitNexus. Analyze impact before changes, query symbol context (callers/callees), detect structural changes, and perform coordinated renames. Use 'status' to check availability, 'impact' before multi-file edits, 'context' to understand a symbol, 'detect_changes' after edits.",
    parameters: GitNexusToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const repo = readStringParam(params, "repo") ?? opts.workspaceDir;

      if (action === "status") {
        const status = await getGitNexusStatus(repo);
        return jsonResult(status);
      }

      // All other actions require GitNexus to be available
      const available = await isGitNexusBinAvailable();
      if (!available) {
        return jsonResult({
          error: "GitNexus is not installed. Install with: npm install -g gitnexus",
          available: false,
        });
      }

      const registry = await loadRegistry();
      const indexed = registry ? isWorkspaceIndexed(registry, repo) : false;

      if (action === "index") {
        if (indexed) {
          return jsonResult({
            message: "Workspace is already indexed. Re-indexing...",
            repo,
          });
        }
        // Spawn gitnexus analyze as a detached background task
        const child = spawn("gitnexus", ["analyze", "--path", repo], {
          stdio: "ignore",
          detached: true,
          shell: true,
        });
        child.unref();
        // Invalidate cache so next status check picks up the new index
        registryCache = null;
        registryCacheTs = 0;
        emitCodeIntelEvent(
          { actorId: opts.agentId ?? "agent", connId: opts.sessionKey },
          "code-intel.indexed",
          { repo, background: true },
        );
        return jsonResult({
          message:
            "GitNexus indexing started in background. Use action='status' to check progress.",
          repo,
        });
      }

      if (!indexed) {
        return jsonResult({
          error:
            "Workspace is not indexed. Run action='index' first, or manually: gitnexus analyze",
          available: true,
          indexed: false,
          repo,
        });
      }

      const actor = { actorId: opts.agentId ?? "agent", connId: opts.sessionKey };

      if (action === "query") {
        const pattern = readStringParam(params, "pattern", { required: true });
        const symbolType = readStringParam(params, "symbolType");
        const mcpArgs: Record<string, unknown> = { pattern, repo };
        if (symbolType) mcpArgs.symbolType = symbolType;
        const result = await callMcpTool("query", mcpArgs);
        emitCodeIntelEvent(actor, "code-intel.query", { pattern, symbolType, repo });
        return jsonResult(result);
      }

      if (action === "context") {
        const symbol = readStringParam(params, "symbol", { required: true });
        const result = await callMcpTool("context", { symbol, repo });
        return jsonResult(result);
      }

      if (action === "impact") {
        const symbol = readStringParam(params, "symbol", { required: true });
        const result = await callMcpTool("impact", { symbol, repo });
        emitCodeIntelEvent(actor, "code-intel.impact_checked", { symbol, repo });
        return jsonResult(result);
      }

      if (action === "detect_changes") {
        const result = await callMcpTool("detect_changes", { repo });
        return jsonResult(result);
      }

      if (action === "rename") {
        const symbol = readStringParam(params, "symbol", { required: true });
        const newName = readStringParam(params, "newName", { required: true });
        const result = await callMcpTool("rename", { old: symbol, new: newName, repo });
        emitCodeIntelEvent(actor, "code-intel.rename_executed", {
          oldName: symbol,
          newName,
          repo,
        });
        return jsonResult(result);
      }

      if (action === "list_repos") {
        const result = await callMcpTool("list_repos", {});
        return jsonResult(result);
      }

      throw new Error(`Unknown code_intel action: ${action}`);
    },
  };
}

// ── Conditional Tool Creation ───────────────────────────────────

/**
 * Returns the GitNexus code_intel tool if the binary is available,
 * or an empty array if not. Safe to spread into a tool list.
 */
export async function createGitNexusToolsIfAvailable(opts: {
  workspaceDir: string;
  agentId?: string;
  sessionKey?: string;
}): Promise<AnyAgentTool[]> {
  try {
    const available = await isGitNexusBinAvailable();
    if (!available) {
      return [];
    }
    log.info("GitNexus detected — code intelligence tool enabled");
    return [createGitNexusTool(opts)];
  } catch (err) {
    log.debug(`GitNexus detection failed: ${String(err)}`);
    return [];
  }
}

/** Synchronous version that returns the tool unconditionally (availability checked at call time). */
export function createGitNexusToolSync(opts: {
  workspaceDir: string;
  agentId?: string;
  sessionKey?: string;
}): AnyAgentTool {
  return createGitNexusTool(opts);
}

// ── Impact Analysis Helper (for before-tool-call hook) ──────────

/**
 * Run impact analysis on symbols found in the given file path.
 * Returns null if GitNexus is unavailable or workspace is not indexed.
 * Used by the before-tool-call hook for impact-aware editing.
 */
export async function runImpactAnalysisForFile(
  filePath: string,
  workspaceDir: string,
): Promise<{ available: boolean; impact?: unknown } | null> {
  const available = await isGitNexusBinAvailable();
  if (!available) return null;

  const registry = await loadRegistry();
  if (!registry || !isWorkspaceIndexed(registry, workspaceDir)) return null;

  try {
    const result = await callMcpTool("detect_changes", { repo: workspaceDir, file: filePath });
    return { available: true, impact: result };
  } catch (err) {
    log.debug(`Impact analysis failed for ${filePath}: ${String(err)}`);
    return null;
  }
}

// ── PageIndex Hierarchical Document Retrieval Bridge ────────────
//
// Auto-detects PageIndex availability and bridges its CLI into
// the Pi agent's tool set. Treats PageIndex as an optional external
// tool — never bundles or forks it.
//
// Unlike GitNexus (which uses a persistent MCP server), PageIndex
// is CLI-based: generate index → query index. Simpler lifecycle.

import { execFile, spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { emitCodeIntelEvent } from "../../security/audit-trail-emitters.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const log = createSubsystemLogger("tools/pageindex");
const execFileAsync = promisify(execFile);

// ── Binary Detection ────────────────────────────────────────────

let binAvailable: boolean | null = null;
let binCommand: string[] | null = null;

async function tryCommand(cmd: string, args: string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(cmd, args, {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
        shell: true,
      });
      let exited = false;
      child.on("error", () => {
        if (!exited) {
          exited = true;
          resolve(false);
        }
      });
      child.on("close", (code) => {
        if (!exited) {
          exited = true;
          resolve(code === 0);
        }
      });
    } catch {
      resolve(false);
    }
  });
}

async function detectPageIndexBin(): Promise<string[] | null> {
  if (binCommand !== null) return binCommand;
  if (binAvailable === false) return null;

  // Try direct binary first
  if (await tryCommand("pageindex", ["--version"])) {
    binAvailable = true;
    binCommand = ["pageindex"];
    return binCommand;
  }

  // Try python module
  if (await tryCommand("python", ["-m", "pageindex", "--version"])) {
    binAvailable = true;
    binCommand = ["python", "-m", "pageindex"];
    return binCommand;
  }

  // Try python3 module
  if (await tryCommand("python3", ["-m", "pageindex", "--version"])) {
    binAvailable = true;
    binCommand = ["python3", "-m", "pageindex"];
    return binCommand;
  }

  binAvailable = false;
  binCommand = null;
  return null;
}

async function isPageIndexBinAvailable(): Promise<boolean> {
  const cmd = await detectPageIndexBin();
  return cmd !== null;
}

// ── CLI Invocation ──────────────────────────────────────────────

async function runPageIndexCli(
  args: string[],
  timeoutMs = 120_000,
): Promise<{ stdout: string; stderr: string }> {
  const cmd = await detectPageIndexBin();
  if (!cmd) {
    throw new Error("PageIndex is not installed");
  }

  const [executable, ...prefix] = cmd;
  const fullArgs = [...prefix, ...args];

  const result = await execFileAsync(executable, fullArgs, {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024, // 10 MB
    shell: true,
  });

  return { stdout: result.stdout, stderr: result.stderr };
}

function parseJsonOutput(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    // Return raw text if not JSON
    return { raw: stdout.trim() };
  }
}

// ── Index Discovery ─────────────────────────────────────────────

async function findTreeIndexes(workspaceDir: string): Promise<string[]> {
  const indexes: string[] = [];
  try {
    const entries = await readdir(workspaceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".tree.json")) {
        indexes.push(path.join(workspaceDir, entry.name));
      }
    }
  } catch {
    // Directory may not exist or be unreadable
  }
  return indexes;
}

// ── Status Check ────────────────────────────────────────────────

export type PageIndexStatus = {
  available: boolean;
  command: string[] | null;
  indexes: string[];
};

export async function getPageIndexStatus(workspaceDir: string): Promise<PageIndexStatus> {
  const cmd = await detectPageIndexBin();
  if (!cmd) {
    return { available: false, command: null, indexes: [] };
  }
  const indexes = await findTreeIndexes(workspaceDir);
  return { available: true, command: cmd, indexes };
}

// ── Tool Definitions ────────────────────────────────────────────

const PAGEINDEX_ACTIONS = [
  "status",
  "index",
  "retrieve",
  "tree",
  "list_indexes",
] as const;

const PageIndexToolSchema = Type.Object({
  action: stringEnum(PAGEINDEX_ACTIONS),
  // index action: path to document
  document: Type.Optional(
    Type.String({ description: "Path to document to index (PDF, markdown, text)" }),
  ),
  // retrieve action: query and index file
  query: Type.Optional(
    Type.String({ description: "Natural language query for reasoning retrieval" }),
  ),
  indexFile: Type.Optional(
    Type.String({ description: "Path to .tree.json index file (defaults to auto-detect)" }),
  ),
});

export function createPageIndexTool(opts: {
  workspaceDir: string;
  agentId?: string;
  sessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Document Retrieval",
    name: "page_index",
    description:
      "Hierarchical document retrieval powered by PageIndex. Build tree indexes of documents (PDF, markdown) and perform reasoning-based retrieval to find relevant sections. Use 'status' to check availability, 'index' to generate a tree index, 'retrieve' to query with natural language, 'tree' to view document structure.",
    parameters: PageIndexToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      if (action === "status") {
        const status = await getPageIndexStatus(opts.workspaceDir);
        return jsonResult(status);
      }

      if (action === "list_indexes") {
        const indexes = await findTreeIndexes(opts.workspaceDir);
        return jsonResult({ indexes, count: indexes.length });
      }

      // All other actions require PageIndex to be available
      const available = await isPageIndexBinAvailable();
      if (!available) {
        return jsonResult({
          error: "PageIndex is not installed. Install with: pip install pageindex",
          available: false,
        });
      }

      const actor = { actorId: opts.agentId ?? "agent", connId: opts.sessionKey };

      if (action === "index") {
        const document = readStringParam(params, "document", { required: true });
        // Resolve relative paths against workspace
        const docPath = path.isAbsolute(document)
          ? document
          : path.resolve(opts.workspaceDir, document);

        // Verify document exists
        try {
          await stat(docPath);
        } catch {
          return jsonResult({ error: `Document not found: ${docPath}` });
        }

        const outputPath = docPath + ".tree.json";
        try {
          const { stdout } = await runPageIndexCli([
            "index",
            "--input",
            docPath,
            "--output",
            outputPath,
            "--format",
            "json",
          ]);
          emitCodeIntelEvent(actor, "code-intel.pageindex_generated", {
            document: docPath,
            output: outputPath,
          });
          return jsonResult({
            message: "Document indexed successfully",
            document: docPath,
            indexFile: outputPath,
            details: parseJsonOutput(stdout),
          });
        } catch (err) {
          return jsonResult({
            error: `Indexing failed: ${String(err)}`,
            document: docPath,
          });
        }
      }

      if (action === "retrieve") {
        const query = readStringParam(params, "query", { required: true });
        let indexFile = readStringParam(params, "indexFile");

        // Auto-detect index file if not specified
        if (!indexFile) {
          const indexes = await findTreeIndexes(opts.workspaceDir);
          if (indexes.length === 0) {
            return jsonResult({
              error: "No indexed documents found. Run action='index' on a document first.",
            });
          }
          if (indexes.length === 1) {
            indexFile = indexes[0];
          } else {
            return jsonResult({
              error:
                "Multiple indexes found. Specify indexFile parameter.",
              availableIndexes: indexes,
            });
          }
        }

        try {
          const { stdout } = await runPageIndexCli([
            "retrieve",
            "--index",
            indexFile,
            "--query",
            query,
            "--format",
            "json",
          ]);
          emitCodeIntelEvent(actor, "code-intel.pageindex_retrieved", {
            query,
            indexFile,
          });
          return jsonResult(parseJsonOutput(stdout));
        } catch (err) {
          return jsonResult({
            error: `Retrieval failed: ${String(err)}`,
            query,
            indexFile,
          });
        }
      }

      if (action === "tree") {
        let indexFile = readStringParam(params, "indexFile");

        if (!indexFile) {
          const indexes = await findTreeIndexes(opts.workspaceDir);
          if (indexes.length === 0) {
            return jsonResult({
              error: "No indexed documents found. Run action='index' on a document first.",
            });
          }
          if (indexes.length === 1) {
            indexFile = indexes[0];
          } else {
            return jsonResult({
              error:
                "Multiple indexes found. Specify indexFile parameter.",
              availableIndexes: indexes,
            });
          }
        }

        try {
          const { stdout } = await runPageIndexCli([
            "tree",
            "--index",
            indexFile,
            "--format",
            "json",
          ]);
          return jsonResult(parseJsonOutput(stdout));
        } catch (err) {
          return jsonResult({
            error: `Tree view failed: ${String(err)}`,
            indexFile,
          });
        }
      }

      throw new Error(`Unknown page_index action: ${action}`);
    },
  };
}

// ── Conditional Tool Creation ───────────────────────────────────

/** Synchronous version that returns the tool unconditionally (availability checked at call time). */
export function createPageIndexToolSync(opts: {
  workspaceDir: string;
  agentId?: string;
  sessionKey?: string;
}): AnyAgentTool {
  return createPageIndexTool(opts);
}

/**
 * Returns the PageIndex page_index tool if the binary is available,
 * or an empty array if not. Safe to spread into a tool list.
 */
export async function createPageIndexToolsIfAvailable(opts: {
  workspaceDir: string;
  agentId?: string;
  sessionKey?: string;
}): Promise<AnyAgentTool[]> {
  try {
    const available = await isPageIndexBinAvailable();
    if (!available) {
      return [];
    }
    log.info("PageIndex detected — document retrieval tool enabled");
    return [createPageIndexTool(opts)];
  } catch (err) {
    log.debug(`PageIndex detection failed: ${String(err)}`);
    return [];
  }
}

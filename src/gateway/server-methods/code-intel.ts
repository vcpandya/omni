// ── Code Intelligence Gateway Handlers ──────────────────────────
//
// Exposes GitNexus code intelligence to the Control UI and fleet
// management via gateway methods.

import {
  getGitNexusStatus,
  type GitNexusStatus,
} from "../../agents/tools/gitnexus-bridge.js";
import {
  getPageIndexStatus,
  type PageIndexStatus,
} from "../../agents/tools/pageindex-bridge.js";
import { emitCodeIntelEvent } from "../../security/audit-trail-emitters.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const codeIntelHandlers: GatewayRequestHandlers = {
  "code-intel.status": async ({ params, respond }) => {
    const p = params as { workspaceDir?: string };
    const workspaceDir = p.workspaceDir ?? process.cwd();
    try {
      const status: GitNexusStatus = await getGitNexusStatus(workspaceDir);
      respond(true, { status }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `code-intel status failed: ${String(err)}`),
      );
    }
  },

  "code-intel.index": async ({ params, respond, context }) => {
    const p = params as { workspaceDir?: string };
    const workspaceDir = p.workspaceDir ?? process.cwd();
    try {
      const status = await getGitNexusStatus(workspaceDir);
      if (!status.available) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            "GitNexus is not installed. Install with: npm install -g gitnexus",
          ),
        );
        return;
      }
      // Spawn indexing in background via the bridge
      const { spawn } = await import("node:child_process");
      const child = spawn("gitnexus", ["analyze", "--path", workspaceDir], {
        stdio: "ignore",
        detached: true,
        shell: true,
      });
      child.unref();
      emitCodeIntelEvent({ actorId: "operator" }, "code-intel.indexed", {
        workspaceDir,
        triggeredBy: "gateway",
      });
      context.logGateway.info(`code-intel index started for ${workspaceDir}`);
      respond(true, { indexing: true, workspaceDir }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `code-intel index failed: ${String(err)}`),
      );
    }
  },

  "code-intel.query": async ({ params, respond }) => {
    const p = params as {
      pattern?: string;
      symbolType?: string;
      workspaceDir?: string;
    };
    if (!p.pattern) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "pattern is required"),
      );
      return;
    }
    const workspaceDir = p.workspaceDir ?? process.cwd();
    try {
      const status = await getGitNexusStatus(workspaceDir);
      if (!status.available) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "GitNexus is not installed"),
        );
        return;
      }
      if (!status.indexed) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Workspace is not indexed"),
        );
        return;
      }
      // Use the bridge's MCP call
      const { createGitNexusTool } = await import("../../agents/tools/gitnexus-bridge.js");
      const tool = createGitNexusTool({ workspaceDir });
      const result = await tool.execute!("gateway-query", {
        action: "query",
        pattern: p.pattern,
        symbolType: p.symbolType,
        repo: workspaceDir,
      });
      respond(true, { result: result?.details ?? result }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `code-intel query failed: ${String(err)}`),
      );
    }
  },

  "code-intel.impact": async ({ params, respond }) => {
    const p = params as {
      symbol?: string;
      workspaceDir?: string;
    };
    if (!p.symbol) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "symbol is required"),
      );
      return;
    }
    const workspaceDir = p.workspaceDir ?? process.cwd();
    try {
      const status = await getGitNexusStatus(workspaceDir);
      if (!status.available || !status.indexed) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            !status.available ? "GitNexus is not installed" : "Workspace is not indexed",
          ),
        );
        return;
      }
      const { createGitNexusTool } = await import("../../agents/tools/gitnexus-bridge.js");
      const tool = createGitNexusTool({ workspaceDir });
      const result = await tool.execute!("gateway-impact", {
        action: "impact",
        symbol: p.symbol,
        repo: workspaceDir,
      });
      emitCodeIntelEvent({ actorId: "operator" }, "code-intel.impact_checked", {
        symbol: p.symbol,
        workspaceDir,
        triggeredBy: "gateway",
      });
      respond(true, { result: result?.details ?? result }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `code-intel impact failed: ${String(err)}`),
      );
    }
  },

  "code-intel.drift": async ({ params, respond }) => {
    const p = params as {
      workspaceDir?: string;
    };
    const workspaceDir = p.workspaceDir ?? process.cwd();
    try {
      const status = await getGitNexusStatus(workspaceDir);
      if (!status.available || !status.indexed) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            !status.available ? "GitNexus is not installed" : "Workspace is not indexed",
          ),
        );
        return;
      }
      const { createGitNexusTool } = await import("../../agents/tools/gitnexus-bridge.js");
      const tool = createGitNexusTool({ workspaceDir });
      const result = await tool.execute!("gateway-drift", {
        action: "detect_changes",
        repo: workspaceDir,
      });
      emitCodeIntelEvent({ actorId: "operator" }, "code-intel.drift_detected", {
        workspaceDir,
        triggeredBy: "gateway",
      });
      respond(true, { result: result?.details ?? result }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `code-intel drift failed: ${String(err)}`),
      );
    }
  },

  // ── PageIndex Handlers ──────────────────────────────────────────

  "code-intel.pageindex.status": async ({ params, respond }) => {
    const p = params as { workspaceDir?: string };
    const workspaceDir = p.workspaceDir ?? process.cwd();
    try {
      const status: PageIndexStatus = await getPageIndexStatus(workspaceDir);
      respond(true, { status }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `pageindex status failed: ${String(err)}`),
      );
    }
  },

  "code-intel.pageindex.index": async ({ params, respond, context }) => {
    const p = params as { document?: string; workspaceDir?: string };
    const workspaceDir = p.workspaceDir ?? process.cwd();
    if (!p.document) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "document path is required"),
      );
      return;
    }
    try {
      const status = await getPageIndexStatus(workspaceDir);
      if (!status.available) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            "PageIndex is not installed. Install with: pip install pageindex",
          ),
        );
        return;
      }
      const { createPageIndexTool } = await import("../../agents/tools/pageindex-bridge.js");
      const tool = createPageIndexTool({ workspaceDir });
      const result = await tool.execute!("gateway-pageindex-index", {
        action: "index",
        document: p.document,
      });
      emitCodeIntelEvent({ actorId: "operator" }, "code-intel.pageindex_generated", {
        document: p.document,
        workspaceDir,
        triggeredBy: "gateway",
      });
      context.logGateway.info(`pageindex index started for ${p.document}`);
      respond(true, { result: result?.details ?? result }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `pageindex index failed: ${String(err)}`),
      );
    }
  },
};

// ── Diagnostic Trace Context ──────────────────────────────────────
//
// Lightweight W3C-Trace-Context-compatible carrier. Zero external deps;
// designed so any OTEL collector (Splunk, Datadog, Honeycomb, Jaeger)
// can correlate audit events with distributed spans without forcing
// OpenTelemetry SDK state into the core path.
//
// Adapted from upstream OpenClaw diagnostics (PR #70924), tailored for
// Omni's audit trail: every audit event may carry the active trace so
// enterprise SIEMs can pivot from a `tool.blocked` event to the full
// request span chain.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

// ── Types ───────────────────────────────────────────────────────

export type TraceContext = {
  /** 32-char lowercase hex — W3C traceparent trace-id. */
  traceId: string;
  /** 16-char lowercase hex — W3C traceparent span-id. */
  spanId: string;
  /** 16-char lowercase hex — parent span, if any. */
  parentSpanId?: string;
  /** W3C trace flags byte (2-char hex). Default "01" = sampled. */
  flags?: string;
};

// ── ID Generation ───────────────────────────────────────────────

const INVALID_TRACE_ID = "0".repeat(32);
const INVALID_SPAN_ID = "0".repeat(16);

export function generateTraceId(): string {
  // Rejection-sample against W3C's all-zero invalid id (practically never hits).
  let id = randomBytes(16).toString("hex");
  if (id === INVALID_TRACE_ID) {
    id = randomBytes(16).toString("hex");
  }
  return id;
}

export function generateSpanId(): string {
  let id = randomBytes(8).toString("hex");
  if (id === INVALID_SPAN_ID) {
    id = randomBytes(8).toString("hex");
  }
  return id;
}

// ── Carrier (AsyncLocalStorage) ─────────────────────────────────

const storage = new AsyncLocalStorage<TraceContext>();

/** Returns the trace context active on the current async stack, if any. */
export function getCurrentTraceContext(): TraceContext | undefined {
  return storage.getStore();
}

/** Runs `fn` inside a scoped trace context. Nested calls create a child span. */
export function withTraceContext<T>(ctx: TraceContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Convenience: wraps `fn` in a fresh child span derived from the active context. */
export function withChildSpan<T>(fn: (ctx: TraceContext) => T): T {
  const parent = getCurrentTraceContext();
  const child: TraceContext = parent
    ? {
        traceId: parent.traceId,
        spanId: generateSpanId(),
        parentSpanId: parent.spanId,
        flags: parent.flags ?? "01",
      }
    : createTraceContext();
  return storage.run(child, () => fn(child));
}

export function createTraceContext(parent?: Partial<TraceContext>): TraceContext {
  return {
    traceId: parent?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: parent?.spanId,
    flags: parent?.flags ?? "01",
  };
}

// ── W3C traceparent Header Parse/Format ─────────────────────────
//
// Format: "00-<32hex traceId>-<16hex spanId>-<2hex flags>"
// Reference: https://www.w3.org/TR/trace-context/#traceparent-header

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function parseTraceparent(header: string | undefined): TraceContext | undefined {
  if (!header) {
    return undefined;
  }
  const match = TRACEPARENT_RE.exec(header.trim().toLowerCase());
  if (!match) {
    return undefined;
  }
  const [, , traceId, parentSpanId, flags] = match;
  if (traceId === INVALID_TRACE_ID || parentSpanId === INVALID_SPAN_ID) {
    return undefined;
  }
  // Incoming parent; we allocate a fresh child span for downstream use.
  return {
    traceId: traceId!,
    spanId: generateSpanId(),
    parentSpanId,
    flags,
  };
}

export function formatTraceparent(ctx: TraceContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-${ctx.flags ?? "01"}`;
}

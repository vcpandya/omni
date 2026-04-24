import { describe, it, expect } from "vitest";
import {
  createTraceContext,
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  getCurrentTraceContext,
  parseTraceparent,
  withChildSpan,
  withTraceContext,
} from "./trace-context.js";

describe("trace-context — id generation", () => {
  it("generates 32-char hex trace ids", () => {
    const id = generateTraceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates 16-char hex span ids", () => {
    const id = generateSpanId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces distinct ids on repeated calls", () => {
    const ids = new Set(Array.from({ length: 64 }, () => generateTraceId()));
    expect(ids.size).toBe(64);
  });
});

describe("trace-context — createTraceContext", () => {
  it("defaults to fresh traceId and sampled flags", () => {
    const ctx = createTraceContext();
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(ctx.parentSpanId).toBeUndefined();
    expect(ctx.flags).toBe("01");
  });

  it("inherits traceId from parent, records parent span", () => {
    const parent = createTraceContext();
    const child = createTraceContext(parent);
    expect(child.traceId).toBe(parent.traceId);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.spanId).not.toBe(parent.spanId);
  });
});

describe("trace-context — AsyncLocalStorage carrier", () => {
  it("returns undefined when no scope is active", () => {
    expect(getCurrentTraceContext()).toBeUndefined();
  });

  it("scopes context inside withTraceContext", () => {
    const ctx = createTraceContext();
    const seen = withTraceContext(ctx, () => getCurrentTraceContext());
    expect(seen).toEqual(ctx);
    // Context should not leak out of the scope.
    expect(getCurrentTraceContext()).toBeUndefined();
  });

  it("withChildSpan derives a child from the active parent", () => {
    const parent = createTraceContext();
    const childFromHelper = withTraceContext(parent, () =>
      withChildSpan((child) => {
        expect(getCurrentTraceContext()).toEqual(child);
        return child;
      }),
    );
    expect(childFromHelper.traceId).toBe(parent.traceId);
    expect(childFromHelper.parentSpanId).toBe(parent.spanId);
    expect(childFromHelper.spanId).not.toBe(parent.spanId);
  });

  it("withChildSpan starts a fresh trace when no parent is active", () => {
    const orphan = withChildSpan((ctx) => ctx);
    expect(orphan.parentSpanId).toBeUndefined();
    expect(orphan.traceId).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("trace-context — W3C traceparent header", () => {
  it("parses a valid traceparent and allocates a child span", () => {
    const header = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const ctx = parseTraceparent(header);
    expect(ctx).toBeDefined();
    expect(ctx!.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(ctx!.parentSpanId).toBe("00f067aa0ba902b7");
    expect(ctx!.flags).toBe("01");
    // New span allocated for downstream use (not the incoming parent).
    expect(ctx!.spanId).not.toBe("00f067aa0ba902b7");
  });

  it("returns undefined for malformed headers", () => {
    expect(parseTraceparent(undefined)).toBeUndefined();
    expect(parseTraceparent("")).toBeUndefined();
    expect(parseTraceparent("not-a-traceparent")).toBeUndefined();
    expect(parseTraceparent("00-short-00f067aa0ba902b7-01")).toBeUndefined();
  });

  it("rejects W3C invalid all-zero ids", () => {
    const allZeroTrace = `00-${"0".repeat(32)}-00f067aa0ba902b7-01`;
    const allZeroSpan = `00-4bf92f3577b34da6a3ce929d0e0e4736-${"0".repeat(16)}-01`;
    expect(parseTraceparent(allZeroTrace)).toBeUndefined();
    expect(parseTraceparent(allZeroSpan)).toBeUndefined();
  });

  it("formatTraceparent round-trips with parseTraceparent", () => {
    const ctx = createTraceContext();
    const header = formatTraceparent(ctx);
    expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const reparsed = parseTraceparent(header);
    expect(reparsed!.traceId).toBe(ctx.traceId);
    expect(reparsed!.parentSpanId).toBe(ctx.spanId);
  });
});

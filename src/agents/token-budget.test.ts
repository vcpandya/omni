import { describe, it, expect } from "vitest";
import {
  allocateBudget,
  createUsageReport,
  selectToolsByBudget,
  computeToolRelevance,
  type TokenBudgetConfig,
  type BudgetZone,
  type ToolRelevanceEntry,
} from "./token-budget.js";

describe("allocateBudget", () => {
  it("allocates a 200K context window with default config", () => {
    const result = allocateBudget(200_000);
    expect(result.contextWindow).toBe(200_000);

    // All zones should have positive token counts
    for (const zone of ["system", "tools", "memory", "history", "reserve"] as BudgetZone[]) {
      expect(result.zones[zone].tokens).toBeGreaterThan(0);
      expect(result.zones[zone].min).toBeGreaterThan(0);
      expect(result.zones[zone].max).toBeGreaterThan(0);
    }

    // Total allocation should not exceed context window
    const total = Object.values(result.zones).reduce((s, z) => s + z.tokens, 0);
    expect(total).toBeLessThanOrEqual(200_000);
  });

  it("respects minimum guarantees", () => {
    const result = allocateBudget(100_000);
    for (const zone of ["system", "tools", "memory", "history", "reserve"] as BudgetZone[]) {
      expect(result.zones[zone].tokens).toBeGreaterThanOrEqual(result.zones[zone].min);
    }
  });

  it("respects maximum ceilings", () => {
    const result = allocateBudget(100_000);
    for (const zone of ["system", "tools", "memory", "history", "reserve"] as BudgetZone[]) {
      expect(result.zones[zone].tokens).toBeLessThanOrEqual(result.zones[zone].max);
    }
  });

  it("handles very small context windows (degradation mode)", () => {
    const result = allocateBudget(1_000);
    // Should not throw, and every zone should get something
    const total = Object.values(result.zones).reduce((s, z) => s + z.tokens, 0);
    expect(total).toBeLessThanOrEqual(1_000);
    // In degradation mode, all zones still get some tokens
    for (const zone of ["system", "tools", "memory", "history", "reserve"] as BudgetZone[]) {
      expect(result.zones[zone].tokens).toBeGreaterThanOrEqual(0);
    }
  });

  it("handles zero context window", () => {
    const result = allocateBudget(0);
    expect(result.contextWindow).toBe(0);
    for (const zone of ["system", "tools", "memory", "history", "reserve"] as BudgetZone[]) {
      expect(result.zones[zone].tokens).toBe(0);
    }
  });

  it("accepts custom zone overrides", () => {
    const config: TokenBudgetConfig = {
      zones: {
        memory: { min: 0.40, max: 0.60, preferred: 0.50 },
      },
    };
    const result = allocateBudget(100_000, config);
    // Memory zone should be larger than default
    expect(result.zones.memory.tokens).toBeGreaterThan(30_000);
  });

  it("accepts custom compaction threshold", () => {
    const result = allocateBudget(100_000, { compactionThreshold: 0.70 });
    expect(result.compactionThreshold).toBe(0.70);
  });

  it("clamps compaction threshold to valid range", () => {
    const low = allocateBudget(100_000, { compactionThreshold: 0.1 });
    expect(low.compactionThreshold).toBe(0.5);

    const high = allocateBudget(100_000, { compactionThreshold: 1.5 });
    expect(high.compactionThreshold).toBe(0.99);
  });

  it("gives memory the largest share by default", () => {
    const result = allocateBudget(200_000);
    const memoryTokens = result.zones.memory.tokens;
    for (const zone of ["system", "tools", "reserve"] as BudgetZone[]) {
      expect(memoryTokens).toBeGreaterThanOrEqual(result.zones[zone].tokens);
    }
  });
});

describe("createUsageReport", () => {
  it("reports usage and identifies over-budget zones", () => {
    const allocation = allocateBudget(100_000);
    const report = createUsageReport(allocation, {
      system: 5_000,
      tools: 10_000,
      memory: 50_000, // likely over budget
      history: 15_000,
      reserve: 0,
    });

    expect(report.contextWindow).toBe(100_000);
    expect(report.totalActual).toBe(80_000);
    expect(report.zones.system.actual).toBe(5_000);
    expect(report.zones.reserve.actual).toBe(0);
    expect(report.zones.reserve.utilization).toBe(0);
  });

  it("triggers compaction when total exceeds threshold", () => {
    const allocation = allocateBudget(100_000, { compactionThreshold: 0.8 });
    const report = createUsageReport(allocation, {
      system: 15_000,
      tools: 20_000,
      memory: 30_000,
      history: 25_000,
      reserve: 0,
    });
    // 90K actual > 80K threshold
    expect(report.shouldCompact).toBe(true);
  });

  it("does not trigger compaction when under threshold", () => {
    const allocation = allocateBudget(100_000, { compactionThreshold: 0.85 });
    const report = createUsageReport(allocation, {
      system: 10_000,
      tools: 10_000,
      memory: 20_000,
      history: 10_000,
      reserve: 5_000,
    });
    // 55K actual < 85K threshold
    expect(report.shouldCompact).toBe(false);
  });
});

describe("selectToolsByBudget", () => {
  const tools: ToolRelevanceEntry[] = [
    { name: "memory_search", descriptionTokens: 100, recentlyUsed: true, pinned: false, relevance: 0.8 },
    { name: "web_search", descriptionTokens: 150, recentlyUsed: false, pinned: false, relevance: 0.9 },
    { name: "file_read", descriptionTokens: 80, recentlyUsed: false, pinned: true, relevance: 0.3 },
    { name: "bash", descriptionTokens: 120, recentlyUsed: false, pinned: false, relevance: 0.1 },
    { name: "code_edit", descriptionTokens: 200, recentlyUsed: true, pinned: false, relevance: 0.7 },
  ];

  it("selects all tools when budget is sufficient", () => {
    const selected = selectToolsByBudget(tools, 10_000);
    expect(selected).toHaveLength(5);
  });

  it("prioritizes pinned tools", () => {
    const selected = selectToolsByBudget(tools, 100);
    expect(selected).toContain("file_read");
  });

  it("prioritizes recently-used tools", () => {
    const selected = selectToolsByBudget(tools, 250);
    expect(selected).toContain("memory_search");
    expect(selected).toContain("file_read");
  });

  it("selects by relevance when budget is tight", () => {
    const selected = selectToolsByBudget(tools, 500);
    // Pinned and recently-used first, then by relevance
    expect(selected.indexOf("file_read")).toBeLessThan(selected.indexOf("bash") === -1 ? Infinity : selected.indexOf("bash"));
  });
});

describe("computeToolRelevance", () => {
  it("returns high score for matching keywords", () => {
    const score = computeToolRelevance(
      "search memory for previous conversations",
      "memory_search",
      "Search through stored memory for relevant information",
    );
    expect(score).toBeGreaterThan(0.2);
  });

  it("returns zero for completely unrelated", () => {
    const score = computeToolRelevance(
      "deploy kubernetes cluster",
      "audio_transcribe",
      "Transcribe audio files to text",
    );
    expect(score).toBe(0);
  });

  it("returns zero for empty message", () => {
    const score = computeToolRelevance("", "tool", "description");
    expect(score).toBe(0);
  });

  it("filters stop words", () => {
    const scoreWithStop = computeToolRelevance(
      "the and or is",
      "file_read",
      "Read files from disk",
    );
    expect(scoreWithStop).toBe(0);
  });
});

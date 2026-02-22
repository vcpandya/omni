import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadRemoteRegistry,
  computeAgentConfigHash,
  listRemoteAgents,
  getRemoteAgent,
  registerRemoteAgent,
  removeRemoteAgent,
  pushAgentConfig,
  pullAgentState,
  diffAgentConfig,
  detectDrift,
} from "./remote-registry.js";

describe("remote-registry", () => {
  let registryPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "remote-reg-test-"));
    registryPath = join(dir, "remote-agents.json");
  });

  afterEach(() => {
    try {
      rmSync(registryPath, { force: true });
      rmSync(registryPath + ".tmp", { force: true });
    } catch { /* ignore */ }
  });

  // ── Hashing ──────────────────────────────────────────────────

  it("computes deterministic config hash", () => {
    const config = { model: "opus", name: "default", workspace: "/ws" };
    const hash1 = computeAgentConfigHash(config);
    const hash2 = computeAgentConfigHash({ workspace: "/ws", model: "opus", name: "default" });
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("produces different hashes for different configs", () => {
    const hash1 = computeAgentConfigHash({ model: "opus" });
    const hash2 = computeAgentConfigHash({ model: "sonnet" });
    expect(hash1).not.toBe(hash2);
  });

  // ── Registry CRUD ────────────────────────────────────────────

  it("returns empty registry when file does not exist", () => {
    const manifest = loadRemoteRegistry(registryPath);
    expect(manifest.version).toBe(1);
    expect(Object.keys(manifest.entries)).toHaveLength(0);
  });

  it("registers and retrieves a remote agent", () => {
    const entry = registerRemoteAgent(
      { agentId: "default", deviceId: "dev-1", name: "Default", workspace: "/ws" },
      { model: "opus" },
      registryPath,
    );
    expect(entry.agentId).toBe("default");
    expect(entry.status).toBe("synced");
    expect(entry.configHash).toHaveLength(64);

    const retrieved = getRemoteAgent("dev-1", "default", registryPath);
    expect(retrieved?.configHash).toBe(entry.configHash);
  });

  it("lists remote agents with filter", () => {
    registerRemoteAgent(
      { agentId: "a1", deviceId: "d1", name: "Agent1", workspace: "/ws1" },
      { model: "opus" },
      registryPath,
    );
    registerRemoteAgent(
      { agentId: "a2", deviceId: "d2", name: "Agent2", workspace: "/ws2" },
      { model: "sonnet" },
      registryPath,
    );

    const all = listRemoteAgents(undefined, registryPath);
    expect(all).toHaveLength(2);

    const filtered = listRemoteAgents({ deviceId: "d1" }, registryPath);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.agentId).toBe("a1");
  });

  it("removes a remote agent", () => {
    registerRemoteAgent(
      { agentId: "rem", deviceId: "d1", name: "Remove", workspace: "/ws" },
      { model: "opus" },
      registryPath,
    );
    const removed = removeRemoteAgent("d1", "rem", registryPath);
    expect(removed).toBe(true);

    const list = listRemoteAgents(undefined, registryPath);
    expect(list).toHaveLength(0);
  });

  it("returns false when removing non-existent agent", () => {
    const removed = removeRemoteAgent("d1", "nope", registryPath);
    expect(removed).toBe(false);
  });

  // ── Push/Pull ────────────────────────────────────────────────

  it("pushes agent config to multiple devices", () => {
    const results = pushAgentConfig(
      "default",
      ["d1", "d2", "d3"],
      { model: "opus", skills: ["web"] },
      registryPath,
    );
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === "success")).toBe(true);
    expect(results[0]?.direction).toBe("push");

    const entries = listRemoteAgents(undefined, registryPath);
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.status === "pending")).toBe(true);
  });

  it("pulls agent state from device", () => {
    const result = pullAgentState(
      "default",
      "d1",
      { model: "sonnet", skills: ["code"] },
      registryPath,
    );
    expect(result.status).toBe("success");
    expect(result.direction).toBe("pull");

    const entry = getRemoteAgent("d1", "default", registryPath);
    expect(entry?.status).toBe("synced");
  });

  // ── Diff ─────────────────────────────────────────────────────

  it("diffs agent configs between devices", () => {
    const sourceConfig = { model: "opus", skills: ["web"], workspace: "/ws" };
    const targetConfig = { model: "sonnet", skills: ["web"], workspace: "/ws" };

    const diff = diffAgentConfig(sourceConfig, targetConfig, {
      agentId: "default",
      sourceDeviceId: "d1",
      targetDeviceId: "d2",
    });
    expect(diff.match).toBe(false);
    expect(diff.fields).toHaveLength(1);
    expect(diff.fields[0]?.field).toBe("model");
  });

  it("reports match when configs are identical", () => {
    const config = { model: "opus" };
    const diff = diffAgentConfig(config, config, {
      agentId: "default",
      sourceDeviceId: "d1",
      targetDeviceId: "d2",
    });
    expect(diff.match).toBe(true);
    expect(diff.fields).toHaveLength(0);
  });

  // ── Drift Detection ──────────────────────────────────────────

  it("detects drift when same agent has different hashes on different devices", () => {
    registerRemoteAgent(
      { agentId: "shared", deviceId: "d1", name: "Shared", workspace: "/ws" },
      { model: "opus" },
      registryPath,
    );
    registerRemoteAgent(
      { agentId: "shared", deviceId: "d2", name: "Shared", workspace: "/ws" },
      { model: "sonnet" },
      registryPath,
    );

    const drifted = detectDrift(registryPath);
    expect(drifted.length).toBeGreaterThan(0);
    expect(drifted[0]?.status).toBe("diverged");
  });

  it("reports no drift when configs match", () => {
    const config = { model: "opus" };
    registerRemoteAgent(
      { agentId: "same", deviceId: "d1", name: "Same", workspace: "/ws" },
      config,
      registryPath,
    );
    registerRemoteAgent(
      { agentId: "same", deviceId: "d2", name: "Same", workspace: "/ws" },
      config,
      registryPath,
    );

    const drifted = detectDrift(registryPath);
    expect(drifted).toHaveLength(0);
  });
});

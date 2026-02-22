// ── Remote Agent Registry — Fleet-wide agent config management ──

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
  RemoteAgentEntry,
  RemoteRegistryManifest,
  RemoteAgentFilter,
  AgentSyncResult,
  AgentDiffField,
  AgentDiffResult,
  RegisterRemoteAgentParams,
} from "./remote-registry.types.js";

// ── Paths ──────────────────────────────────────────────────────

const REGISTRY_FILENAME = "remote-agents.json";

function resolveRegistryPath(): string {
  return join(homedir(), ".openclaw", REGISTRY_FILENAME);
}

// ── I/O ────────────────────────────────────────────────────────

export function loadRemoteRegistry(registryPath?: string): RemoteRegistryManifest {
  const path = registryPath ?? resolveRegistryPath();
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as RemoteRegistryManifest;
    if (parsed.version !== 1) {
      return { version: 1, updatedAt: Date.now(), entries: {} };
    }
    return parsed;
  } catch {
    return { version: 1, updatedAt: Date.now(), entries: {} };
  }
}

export function saveRemoteRegistry(
  manifest: RemoteRegistryManifest,
  registryPath?: string,
): void {
  const path = registryPath ?? resolveRegistryPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmpPath = path + ".tmp";
  const json = JSON.stringify(manifest, null, 2);
  writeFileSync(tmpPath, json, { mode: 0o600 });
  renameSync(tmpPath, path);
}

// ── Hashing ────────────────────────────────────────────────────

export function computeAgentConfigHash(
  agentConfig: Record<string, unknown>,
): string {
  const sorted = JSON.stringify(agentConfig, Object.keys(agentConfig).sort());
  return createHash("sha256").update(sorted).digest("hex");
}

// ── Registry Key ───────────────────────────────────────────────

function registryKey(deviceId: string, agentId: string): string {
  return `${deviceId}:${agentId}`;
}

// ── CRUD Operations ────────────────────────────────────────────

export function listRemoteAgents(
  filter?: RemoteAgentFilter,
  registryPath?: string,
): RemoteAgentEntry[] {
  const manifest = loadRemoteRegistry(registryPath);
  let entries = Object.values(manifest.entries);
  if (filter?.deviceId) {
    entries = entries.filter((e) => e.deviceId === filter.deviceId);
  }
  if (filter?.status) {
    entries = entries.filter((e) => e.status === filter.status);
  }
  if (filter?.agentId) {
    entries = entries.filter((e) => e.agentId === filter.agentId);
  }
  return entries.sort((a, b) => a.lastSyncAt - b.lastSyncAt);
}

export function getRemoteAgent(
  deviceId: string,
  agentId: string,
  registryPath?: string,
): RemoteAgentEntry | undefined {
  const manifest = loadRemoteRegistry(registryPath);
  return manifest.entries[registryKey(deviceId, agentId)];
}

export function registerRemoteAgent(
  params: RegisterRemoteAgentParams,
  agentConfig: Record<string, unknown>,
  registryPath?: string,
): RemoteAgentEntry {
  const manifest = loadRemoteRegistry(registryPath);
  const now = Date.now();
  const hash = computeAgentConfigHash(agentConfig);
  const key = registryKey(params.deviceId, params.agentId);

  const entry: RemoteAgentEntry = {
    agentId: params.agentId,
    deviceId: params.deviceId,
    deviceName: params.deviceName,
    name: params.name,
    model: params.model,
    workspace: params.workspace,
    configHash: hash,
    status: "synced",
    lastSyncAt: now,
    lastCheckedAt: now,
  };

  manifest.entries[key] = entry;
  manifest.updatedAt = now;
  saveRemoteRegistry(manifest, registryPath);
  return entry;
}

export function removeRemoteAgent(
  deviceId: string,
  agentId: string,
  registryPath?: string,
): boolean {
  const manifest = loadRemoteRegistry(registryPath);
  const key = registryKey(deviceId, agentId);
  if (!manifest.entries[key]) return false;
  delete manifest.entries[key];
  manifest.updatedAt = Date.now();
  saveRemoteRegistry(manifest, registryPath);
  return true;
}

// ── Sync Operations ────────────────────────────────────────────

export function pushAgentConfig(
  agentId: string,
  targetDeviceIds: string[],
  agentConfig: Record<string, unknown>,
  registryPath?: string,
): AgentSyncResult[] {
  const manifest = loadRemoteRegistry(registryPath);
  const now = Date.now();
  const newHash = computeAgentConfigHash(agentConfig);
  const results: AgentSyncResult[] = [];

  for (const deviceId of targetDeviceIds) {
    const key = registryKey(deviceId, agentId);
    const existing = manifest.entries[key];
    const previousHash = existing?.configHash;

    // In a full implementation, this would push via the device token channel.
    // For now, we update the registry to reflect the push intent.
    manifest.entries[key] = {
      agentId,
      deviceId,
      deviceName: existing?.deviceName,
      name: existing?.name ?? agentId,
      model: existing?.model,
      workspace: existing?.workspace ?? "",
      configHash: newHash,
      status: "pending",
      lastSyncAt: now,
      lastCheckedAt: now,
    };

    results.push({
      agentId,
      deviceId,
      direction: "push",
      status: "success",
      previousHash,
      newHash,
    });
  }

  manifest.updatedAt = now;
  saveRemoteRegistry(manifest, registryPath);
  return results;
}

export function pullAgentState(
  agentId: string,
  deviceId: string,
  remoteConfig: Record<string, unknown>,
  registryPath?: string,
): AgentSyncResult {
  const manifest = loadRemoteRegistry(registryPath);
  const now = Date.now();
  const key = registryKey(deviceId, agentId);
  const existing = manifest.entries[key];
  const previousHash = existing?.configHash;
  const newHash = computeAgentConfigHash(remoteConfig);

  manifest.entries[key] = {
    ...(existing ?? {
      agentId,
      deviceId,
      name: agentId,
      workspace: "",
    }),
    agentId,
    deviceId,
    configHash: newHash,
    status: "synced",
    lastSyncAt: now,
    lastCheckedAt: now,
  };

  manifest.updatedAt = now;
  saveRemoteRegistry(manifest, registryPath);
  return {
    agentId,
    deviceId,
    direction: "pull",
    status: "success",
    previousHash,
    newHash,
  };
}

export function syncAgent(
  agentId: string,
  deviceId: string,
  direction: "push" | "pull",
  agentConfig: Record<string, unknown>,
  registryPath?: string,
): AgentSyncResult {
  if (direction === "push") {
    const results = pushAgentConfig(agentId, [deviceId], agentConfig, registryPath);
    return results[0]!;
  }
  return pullAgentState(agentId, deviceId, agentConfig, registryPath);
}

// ── Diff & Drift Detection ─────────────────────────────────────

export function diffAgentConfig(
  sourceConfig: Record<string, unknown>,
  targetConfig: Record<string, unknown>,
  meta: { agentId: string; sourceDeviceId: string; targetDeviceId: string },
): AgentDiffResult {
  const sourceHash = computeAgentConfigHash(sourceConfig);
  const targetHash = computeAgentConfigHash(targetConfig);
  const fields: AgentDiffField[] = [];

  const allKeys = new Set([...Object.keys(sourceConfig), ...Object.keys(targetConfig)]);
  for (const key of allKeys) {
    const sourceVal = sourceConfig[key];
    const targetVal = targetConfig[key];
    if (JSON.stringify(sourceVal) !== JSON.stringify(targetVal)) {
      fields.push({ field: key, sourceValue: sourceVal, targetValue: targetVal });
    }
  }

  return {
    agentId: meta.agentId,
    sourceDeviceId: meta.sourceDeviceId,
    targetDeviceId: meta.targetDeviceId,
    sourceHash,
    targetHash,
    match: sourceHash === targetHash,
    fields,
  };
}

export function detectDrift(registryPath?: string): RemoteAgentEntry[] {
  const manifest = loadRemoteRegistry(registryPath);
  const now = Date.now();
  const drifted: RemoteAgentEntry[] = [];

  // Group entries by agentId, compare hashes across devices
  const byAgent = new Map<string, RemoteAgentEntry[]>();
  for (const entry of Object.values(manifest.entries)) {
    const group = byAgent.get(entry.agentId) ?? [];
    group.push(entry);
    byAgent.set(entry.agentId, group);
  }

  for (const [, entries] of byAgent) {
    if (entries.length < 2) continue;
    const referenceHash = entries[0]!.configHash;
    for (const entry of entries.slice(1)) {
      if (entry.configHash !== referenceHash) {
        entry.status = "diverged";
        entry.lastCheckedAt = now;
        const key = registryKey(entry.deviceId, entry.agentId);
        manifest.entries[key] = entry;
        drifted.push(entry);
      }
    }
  }

  if (drifted.length > 0) {
    manifest.updatedAt = now;
    saveRemoteRegistry(manifest, registryPath);
  }

  return drifted;
}

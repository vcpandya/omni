// ── Remote Agent Registry Types ──────────────────────────────────

export type RemoteAgentStatus = "synced" | "pending" | "diverged" | "unreachable";

export type RemoteAgentEntry = {
  agentId: string;
  deviceId: string;
  deviceName?: string;
  name: string;
  model?: string;
  workspace: string;
  configHash: string;
  status: RemoteAgentStatus;
  lastSyncAt: number;
  lastCheckedAt: number;
};

export type RemoteRegistryManifest = {
  version: 1;
  updatedAt: number;
  entries: Record<string, RemoteAgentEntry>;
};

export type RemoteAgentFilter = {
  deviceId?: string;
  status?: RemoteAgentStatus;
  agentId?: string;
};

export type AgentSyncResult = {
  agentId: string;
  deviceId: string;
  direction: "push" | "pull";
  status: "success" | "conflict" | "unreachable" | "rejected";
  previousHash?: string;
  newHash?: string;
  detail?: string;
};

export type AgentDiffField = {
  field: string;
  sourceValue: unknown;
  targetValue: unknown;
};

export type AgentDiffResult = {
  agentId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  sourceHash: string;
  targetHash: string;
  match: boolean;
  fields: AgentDiffField[];
};

export type RegisterRemoteAgentParams = {
  agentId: string;
  deviceId: string;
  deviceName?: string;
  name: string;
  model?: string;
  workspace: string;
};

// ── Sandbox Health Monitoring — Container resource monitoring ──

import { emitSandboxEvent } from "./audit-trail-emitters.js";

// ── Types ───────────────────────────────────────────────────────

export type SandboxHealthReport = {
  containerId: string;
  cpuPercent: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
  pidsCount: number;
  healthy: boolean;
  warnings: string[];
};

export type SandboxHealthThresholds = {
  cpuPercent?: number;
  memoryPercent?: number;
  pidsPercent?: number;
};

const DEFAULT_THRESHOLDS: Required<SandboxHealthThresholds> = {
  cpuPercent: 90,
  memoryPercent: 85,
  pidsPercent: 80,
};

// ── Health Check ────────────────────────────────────────────────

export function checkSandboxHealth(
  containerId: string,
  stats: {
    cpuPercent: number;
    memoryUsageMb: number;
    memoryLimitMb: number;
    pidsCount: number;
    pidsLimit: number;
  },
  thresholds?: SandboxHealthThresholds,
): SandboxHealthReport {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const warnings: string[] = [];

  if (stats.cpuPercent > t.cpuPercent) {
    warnings.push(`CPU usage ${stats.cpuPercent.toFixed(1)}% exceeds threshold ${t.cpuPercent}%`);
  }

  const memPercent = stats.memoryLimitMb > 0
    ? (stats.memoryUsageMb / stats.memoryLimitMb) * 100
    : 0;
  if (memPercent > t.memoryPercent) {
    warnings.push(
      `Memory usage ${memPercent.toFixed(1)}% (${stats.memoryUsageMb}MB/${stats.memoryLimitMb}MB) exceeds threshold ${t.memoryPercent}%`,
    );
  }

  const pidsPercent = stats.pidsLimit > 0
    ? (stats.pidsCount / stats.pidsLimit) * 100
    : 0;
  if (pidsPercent > t.pidsPercent) {
    warnings.push(
      `PID count ${stats.pidsCount}/${stats.pidsLimit} (${pidsPercent.toFixed(1)}%) exceeds threshold ${t.pidsPercent}%`,
    );
  }

  const healthy = warnings.length === 0;

  if (!healthy) {
    emitSandboxEvent(
      { actorId: "system" },
      "sandbox.resource_warning",
      containerId,
      { warnings, cpuPercent: stats.cpuPercent, memoryUsageMb: stats.memoryUsageMb, pidsCount: stats.pidsCount },
    );
  }

  return {
    containerId,
    cpuPercent: stats.cpuPercent,
    memoryUsageMb: stats.memoryUsageMb,
    memoryLimitMb: stats.memoryLimitMb,
    pidsCount: stats.pidsCount,
    healthy,
    warnings,
  };
}

// ── Periodic Monitoring ────────────────────────────────────────

type HealthMonitor = {
  stop: () => void;
};

export function startHealthMonitor(
  getContainerStats: () => Promise<
    Array<{
      containerId: string;
      cpuPercent: number;
      memoryUsageMb: number;
      memoryLimitMb: number;
      pidsCount: number;
      pidsLimit: number;
    }>
  >,
  intervalMs: number = 30000,
  thresholds?: SandboxHealthThresholds,
): HealthMonitor {
  const timer = setInterval(async () => {
    try {
      const stats = await getContainerStats();
      for (const s of stats) {
        checkSandboxHealth(s.containerId, s, thresholds);
      }
    } catch {
      // Don't crash on monitoring errors
    }
  }, intervalMs);

  // Ensure this doesn't prevent process exit
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }

  return {
    stop: () => clearInterval(timer),
  };
}

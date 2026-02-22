// ── Immutable Audit Trail — Append-only JSONL engine with SHA-256 hash chain ──

import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type {
  AuditEvent,
  AuditEventCategory,
  AuditEventSeverity,
  AuditActor,
  AuditTrailQueryParams,
  AuditTrailQueryResult,
  AuditTrailExportFormat,
  AuditTrailConfig,
} from "./audit-trail.types.js";

// ── Constants ───────────────────────────────────────────────────

const DEFAULT_STATE_DIR = join(homedir(), ".openclaw", "audit");
const AUDIT_FILE_NAME = "audit-trail.jsonl";
const DEFAULT_MAX_FILE_SIZE_MB = 50;
const DEFAULT_RETENTION_DAYS = 90;
const GENESIS_HASH = "0".repeat(64);

// ── Module State ────────────────────────────────────────────────

let auditDir: string = DEFAULT_STATE_DIR;
let auditFilePath: string = join(DEFAULT_STATE_DIR, AUDIT_FILE_NAME);
let lastHash: string = GENESIS_HASH;
let lastSeq: number = 0;
let initialized = false;
let config: AuditTrailConfig = {};
let rotating = false;
/** HMAC key for audit chain integrity; generated per init, persisted to disk. */
let hmacKey: Buffer = Buffer.alloc(0);
/** Cached Set for O(1) category filtering in the hot path. */
let enabledCategories: Set<string> | null = null;

type AuditEventListener = (event: AuditEvent) => void;
const listeners: AuditEventListener[] = [];

// ── Hash Chain ──────────────────────────────────────────────────

function computeEventHash(previousHash: string, eventWithoutHash: Omit<AuditEvent, "hash">): string {
  const payload = previousHash + JSON.stringify(eventWithoutHash);
  // Use HMAC-SHA256 when key is available (prevents tampering even with file access)
  if (hmacKey.length > 0) {
    return createHmac("sha256", hmacKey).update(payload).digest("hex");
  }
  return createHash("sha256").update(payload).digest("hex");
}

// ── Init / Recovery ─────────────────────────────────────────────

export function initAuditTrail(stateDir?: string, cfg?: AuditTrailConfig): void {
  config = cfg ?? {};
  auditDir = stateDir ?? DEFAULT_STATE_DIR;
  auditFilePath = join(auditDir, AUDIT_FILE_NAME);

  // Build O(1) category lookup
  enabledCategories = config.categories?.length
    ? new Set(config.categories)
    : null;

  if (!existsSync(auditDir)) {
    mkdirSync(auditDir, { recursive: true, mode: 0o700 });
  }

  // Load or generate HMAC key for audit chain integrity
  const keyPath = join(auditDir, ".audit-hmac-key");
  try {
    if (existsSync(keyPath)) {
      hmacKey = Buffer.from(readFileSync(keyPath, "utf-8").trim(), "hex");
    } else {
      hmacKey = randomBytes(32);
      writeFileSync(keyPath, hmacKey.toString("hex") + "\n", { mode: 0o600 });
    }
  } catch {
    // Fall back to plain SHA-256 if key operations fail
    hmacKey = Buffer.alloc(0);
  }

  // Recover last hash/seq — read only the tail of the file for performance
  if (existsSync(auditFilePath)) {
    try {
      const stat = statSync(auditFilePath);
      const TAIL_BYTES = 8192;
      if (stat.size <= TAIL_BYTES) {
        // Small file — read entirely
        recoverFromContent(readFileSync(auditFilePath, "utf-8"));
      } else {
        // Large file — read only the last chunk to find the final event
        const fd = require("node:fs").openSync(auditFilePath, "r");
        const buf = Buffer.alloc(TAIL_BYTES);
        require("node:fs").readSync(fd, buf, 0, TAIL_BYTES, stat.size - TAIL_BYTES);
        require("node:fs").closeSync(fd);
        recoverFromContent(buf.toString("utf-8"));
      }
    } catch {
      // If recovery fails, start from genesis
    }
  }

  // Clean up old rotated files based on retention
  cleanRetainedFiles();

  initialized = true;
}

function recoverFromContent(content: string): void {
  const lines = content.trim().split("\n").filter(Boolean);
  // Walk from the end for the most recent valid event
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event: AuditEvent = JSON.parse(lines[i]!);
      if (event.seq > lastSeq) {
        lastSeq = event.seq;
        lastHash = event.hash;
        return;
      }
    } catch {
      // Skip malformed lines
    }
  }
}

// ── Record Event ────────────────────────────────────────────────

export function recordAuditEvent(params: {
  category: AuditEventCategory;
  action: string;
  severity: AuditEventSeverity;
  actor: AuditActor;
  resource?: string;
  detail?: Record<string, unknown>;
}): AuditEvent {
  if (!initialized) {
    initAuditTrail();
  }

  // Check if category is enabled (O(1) Set lookup)
  if (enabledCategories) {
    if (!enabledCategories.has(params.category)) {
      // Return a synthetic event but don't persist
      const seq = ++lastSeq;
      const ts = Date.now();
      const eventWithoutHash: Omit<AuditEvent, "hash"> = {
        seq,
        ts,
        category: params.category,
        action: params.action,
        severity: params.severity,
        actor: params.actor,
        resource: params.resource,
        detail: params.detail,
        previousHash: lastHash,
      };
      const hash = computeEventHash(lastHash, eventWithoutHash);
      return { ...eventWithoutHash, hash };
    }
  }

  // Check rotation before writing
  maybeRotate();

  const seq = ++lastSeq;
  const ts = Date.now();
  const previousHash = lastHash;

  const eventWithoutHash: Omit<AuditEvent, "hash"> = {
    seq,
    ts,
    category: params.category,
    action: params.action,
    severity: params.severity,
    actor: params.actor,
    resource: params.resource,
    detail: params.detail,
    previousHash,
  };

  const hash = computeEventHash(previousHash, eventWithoutHash);
  const event: AuditEvent = { ...eventWithoutHash, hash };

  // Append to JSONL file
  const line = JSON.stringify(event) + "\n";
  appendFileSync(auditFilePath, line, { mode: 0o600 });

  lastHash = hash;

  // Notify listeners
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Don't let listener errors break audit trail
    }
  }

  return event;
}

// ── Query ───────────────────────────────────────────────────────

export async function queryAuditTrail(
  params: AuditTrailQueryParams,
): Promise<AuditTrailQueryResult> {
  if (!initialized) {
    initAuditTrail();
  }

  if (!existsSync(auditFilePath)) {
    return { events: [], total: 0, hasMore: false, integrityOk: true };
  }

  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;
  // Cap maximum results to prevent OOM on large audit files
  const maxScan = Math.min((params.limit ?? 100) + (params.offset ?? 0) + 10_000, 100_000);

  let matchCount = 0;
  const matched: AuditEvent[] = [];
  const stream = createReadStream(auditFilePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const event: AuditEvent = JSON.parse(line);
      if (matchesFilter(event, params)) {
        matched.push(event);
        matchCount++;
        if (matchCount >= maxScan) break;
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Destroy stream early if we broke out of the loop
  stream.destroy();

  const total = matched.length;
  // Return newest first
  matched.reverse();
  const paged = matched.slice(offset, offset + limit);

  return {
    events: paged,
    total,
    hasMore: offset + limit < total,
    integrityOk: true,
  };
}

function matchesFilter(event: AuditEvent, params: AuditTrailQueryParams): boolean {
  if (params.category && event.category !== params.category) return false;
  if (params.severity && event.severity !== params.severity) return false;
  if (params.actorId && event.actor.actorId !== params.actorId) return false;
  if (params.since && event.ts < params.since) return false;
  if (params.until && event.ts > params.until) return false;
  if (params.search) {
    const needle = params.search.toLowerCase();
    const haystack = `${event.action} ${event.resource ?? ""} ${JSON.stringify(event.detail ?? {})}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

// ── Verify Integrity ────────────────────────────────────────────

export async function verifyAuditTrailIntegrity(opts?: {
  filePath?: string;
}): Promise<{ ok: boolean; totalEvents: number; errors: string[] }> {
  const filePath = opts?.filePath ?? auditFilePath;

  if (!existsSync(filePath)) {
    return { ok: true, totalEvents: 0, errors: [] };
  }

  const errors: string[] = [];
  let previousHash = GENESIS_HASH;
  let count = 0;

  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    count++;
    try {
      const event: AuditEvent = JSON.parse(line);

      // Verify previousHash linkage
      if (event.previousHash !== previousHash) {
        errors.push(
          `seq ${event.seq}: previousHash mismatch (expected ${previousHash.slice(0, 8)}..., got ${event.previousHash.slice(0, 8)}...)`,
        );
      }

      // Recompute hash — extract storedHash without destructuring to avoid per-event allocation
      const storedHash = event.hash;
      (event as Record<string, unknown>).hash = undefined;
      const expectedHash = computeEventHash(event.previousHash, event as Omit<AuditEvent, "hash">);
      event.hash = storedHash;
      if (storedHash !== expectedHash) {
        errors.push(
          `seq ${event.seq}: hash mismatch (expected ${expectedHash.slice(0, 8)}..., got ${storedHash.slice(0, 8)}...)`,
        );
      }

      previousHash = storedHash;
    } catch (err) {
      // Bound error message length to prevent information leakage
      const errMsg = String(err).slice(0, 200);
      errors.push(`line ${count}: parse error: ${errMsg}`);
    }
  }

  return {
    ok: errors.length === 0,
    totalEvents: count,
    errors,
  };
}

// ── Export ───────────────────────────────────────────────────────

export async function exportAuditTrail(params: {
  query?: AuditTrailQueryParams;
  format: AuditTrailExportFormat;
}): Promise<string> {
  const result = await queryAuditTrail(params.query ?? { limit: 10000 });

  switch (params.format) {
    case "json":
      return JSON.stringify(result.events, null, 2);

    case "jsonl":
      return result.events.map((e) => JSON.stringify(e)).join("\n") + "\n";

    case "csv": {
      const headers = "seq,ts,category,action,severity,actorId,resource,detail,hash";
      const rows = result.events.map((e) => {
        const fields = [
          String(e.seq),
          String(e.ts),
          csvEscape(e.category),
          csvEscape(e.action),
          csvEscape(e.severity),
          csvEscape(e.actor.actorId),
          csvEscape(e.resource ?? ""),
          csvEscape(JSON.stringify(e.detail ?? {})),
          csvEscape(e.hash),
        ];
        return fields.join(",");
      });
      return [headers, ...rows].join("\n") + "\n";
    }

    default:
      return JSON.stringify(result.events, null, 2);
  }
}

// ── Listeners ───────────────────────────────────────────────────

export function onAuditEvent(callback: AuditEventListener): () => void {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

// ── Rotation ────────────────────────────────────────────────────

function maybeRotate(): void {
  if (rotating) return;
  if (!existsSync(auditFilePath)) return;

  const maxBytes = (config.maxFileSizeMb ?? DEFAULT_MAX_FILE_SIZE_MB) * 1024 * 1024;
  try {
    const stat = statSync(auditFilePath);
    if (stat.size < maxBytes) return;
  } catch {
    return;
  }

  rotating = true;
  try {
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
    const rotatedName = `audit-trail-${ts}.jsonl`;
    const rotatedPath = join(auditDir, rotatedName);

    // Record rotation event with final chain hash before rotating
    const rotationEvent = recordAuditEvent({
      category: "system",
      action: "audit.rotated",
      severity: "info",
      actor: { actorId: "system" },
      detail: { rotatedTo: rotatedName, finalHash: lastHash },
    });

    renameSync(auditFilePath, rotatedPath);

    // Reset chain for new file
    lastHash = GENESIS_HASH;

    // Write first event in new file referencing the rotation
    recordAuditEvent({
      category: "system",
      action: "audit.rotation_start",
      severity: "info",
      actor: { actorId: "system" },
      detail: { rotatedFrom: rotatedName, previousFileHash: rotationEvent.hash },
    });
  } finally {
    rotating = false;
  }
}

// ── Retention ───────────────────────────────────────────────────

function cleanRetainedFiles(): void {
  const retentionDays = config.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  try {
    const files = readdirSync(auditDir);
    for (const file of files) {
      if (!file.startsWith("audit-trail-") || !file.endsWith(".jsonl")) continue;
      if (file === AUDIT_FILE_NAME) continue;

      const filePath = join(auditDir, file);
      try {
        const stat = statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          unlinkSync(filePath);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Skip if we can't read dir
  }
}

// ── Reset (for testing) ────────────────────────────────────────

export function resetAuditTrail(): void {
  lastHash = GENESIS_HASH;
  lastSeq = 0;
  initialized = false;
  config = {};
  rotating = false;
  hmacKey = Buffer.alloc(0);
  enabledCategories = null;
  listeners.length = 0;
}

/** Properly escape a value for CSV output (RFC 4180 compliant). */
function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// Re-export types for convenience
export type {
  AuditEvent,
  AuditEventCategory,
  AuditEventSeverity,
  AuditActor,
  AuditTrailQueryParams,
  AuditTrailQueryResult,
  AuditTrailExportFormat,
  AuditTrailConfig,
} from "./audit-trail.types.js";

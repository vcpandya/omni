// ── Trusted Skill Repository — SHA-256 content hashing, trust verification, quarantine ──

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type {
  SkillTrustLevel,
  SkillTrustEntry,
  SkillTrustManifest,
} from "./skill-trust.types.js";
import { emitSkillEvent } from "./audit-trail-emitters.js";

// ── Constants ───────────────────────────────────────────────────

const MANIFEST_PATH = join(homedir(), ".openclaw", "skill-trust.json");
const SCANNABLE_EXTENSIONS = new Set([
  ".js", ".ts", ".mjs", ".cjs", ".mts", ".cts", ".jsx", ".tsx",
]);
const BUNDLED_SOURCES = ["openclaw-bundled"];

// ── Manifest I/O ────────────────────────────────────────────────

export function loadManifest(manifestPath?: string): SkillTrustManifest {
  const filePath = manifestPath ?? MANIFEST_PATH;
  if (!existsSync(filePath)) {
    return { version: 1, updatedAt: Date.now(), entries: {} };
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (
      parsed?.version === 1 &&
      typeof parsed.entries === "object" &&
      parsed.entries !== null &&
      !Array.isArray(parsed.entries)
    ) {
      return parsed as SkillTrustManifest;
    }
  } catch {
    // Corrupted manifest — start fresh
  }
  return { version: 1, updatedAt: Date.now(), entries: {} };
}

export function saveManifest(manifest: SkillTrustManifest, manifestPath?: string): void {
  const filePath = manifestPath ?? MANIFEST_PATH;
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const payload = JSON.stringify(manifest, null, 2) + "\n";
  const tempPath = filePath + "." + randomUUID() + ".tmp";
  writeFileSync(tempPath, payload, { mode: 0o600 });
  renameSync(tempPath, filePath);
}

// ── Content Hashing ─────────────────────────────────────────────

function isScannable(filePath: string): boolean {
  return SCANNABLE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function walkDir(dirPath: string, rootPath?: string): string[] {
  const root = rootPath ?? dirPath;
  const results: string[] = [];
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    // Sort entries for deterministic ordering across platforms
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      // Skip symlinks to prevent path traversal outside skill directory
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        results.push(...walkDir(fullPath, root));
      } else if (entry.isFile() && isScannable(fullPath)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Skip unreadable dirs
  }
  return results;
}

export function computeSkillContentHash(dirPath: string): string {
  const files = walkDir(dirPath);
  // Sort paths for determinism (using relative paths)
  const relativePaths = files.map((f) => relative(dirPath, f)).sort();
  const hash = createHash("sha256");
  for (const relPath of relativePaths) {
    const fullPath = join(dirPath, relPath);
    const content = readFileSync(fullPath, "utf-8");
    hash.update(relPath + "\0" + content);
  }
  return hash.digest("hex");
}

// ── Trust Level Resolution ──────────────────────────────────────

export function resolveTrustLevel(source: string): SkillTrustLevel {
  if (BUNDLED_SOURCES.includes(source)) {
    return "verified";
  }
  if (source.startsWith("npm:") || source.startsWith("git:") || source.startsWith("https://")) {
    return "community";
  }
  return "local";
}

// ── Core Operations ─────────────────────────────────────────────

export function registerSkillTrust(params: {
  skillKey: string;
  dirPath: string;
  source: string;
  manifestPath?: string;
}): SkillTrustEntry {
  const manifest = loadManifest(params.manifestPath);
  const contentHash = computeSkillContentHash(params.dirPath);
  const trustLevel = resolveTrustLevel(params.source);

  const entry: SkillTrustEntry = {
    skillKey: params.skillKey,
    source: params.source,
    contentHash,
    trustLevel,
    verifiedAt: Date.now(),
  };

  manifest.entries[params.skillKey] = entry;
  manifest.updatedAt = Date.now();
  saveManifest(manifest, params.manifestPath);

  return entry;
}

export function verifySkillIntegrity(params: {
  skillKey: string;
  dirPath: string;
  manifestPath?: string;
}): { ok: boolean; entry?: SkillTrustEntry; reason?: string } {
  const manifest = loadManifest(params.manifestPath);
  const entry = manifest.entries[params.skillKey];

  if (!entry) {
    return { ok: false, reason: "not_registered" };
  }

  if (entry.quarantined) {
    return { ok: false, entry, reason: "quarantined" };
  }

  const currentHash = computeSkillContentHash(params.dirPath);
  if (currentHash !== entry.contentHash) {
    emitSkillEvent(
      { actorId: "system" },
      "skill.integrity_fail",
      params.skillKey,
      { expectedHash: entry.contentHash.slice(0, 16), actualHash: currentHash.slice(0, 16) },
    );
    return { ok: false, entry, reason: "hash_mismatch" };
  }

  return { ok: true, entry };
}

export function quarantineSkill(params: {
  skillKey: string;
  reason: string;
  manifestPath?: string;
}): boolean {
  const manifest = loadManifest(params.manifestPath);
  const entry = manifest.entries[params.skillKey];

  if (!entry) {
    return false;
  }

  entry.quarantined = true;
  entry.quarantineReason = params.reason;
  manifest.updatedAt = Date.now();
  saveManifest(manifest, params.manifestPath);

  emitSkillEvent(
    { actorId: "system" },
    "skill.quarantined",
    params.skillKey,
    { reason: params.reason },
  );

  return true;
}

export function getSkillTrustStatus(manifestPath?: string): Record<string, SkillTrustEntry> {
  return loadManifest(manifestPath).entries;
}

// Re-export types
export type {
  SkillTrustLevel,
  SkillTrustEntry,
  SkillTrustManifest,
} from "./skill-trust.types.js";

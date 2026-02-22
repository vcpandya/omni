// ── Operator Store — CRUD persistence for operator/user records ──

import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { resolveEffectiveScopesForRole } from "./admin-profile.js";
import type { AccessControlMatrix, AdminProfile, GroupPolicyConfig } from "../config/types.admin.js";
import type { AccessControlRole } from "../config/types.admin.js";
import type { OperatorScope } from "../gateway/method-scopes.js";
import type {
  OperatorRecord,
  OperatorStore,
  CreateOperatorParams,
  UpdateOperatorParams,
  OperatorFilter,
} from "./operator-store.types.js";

// ── Paths ──────────────────────────────────────────────────────

const STORE_FILENAME = "operators.json";

function resolveStorePath(): string {
  return join(homedir(), ".openclaw", STORE_FILENAME);
}

// ── I/O ────────────────────────────────────────────────────────

export function loadOperatorStore(storePath?: string): OperatorStore {
  const path = storePath ?? resolveStorePath();
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as OperatorStore;
    if (parsed.version !== 1) {
      return { version: 1, updatedAt: Date.now(), operators: {} };
    }
    return parsed;
  } catch {
    return { version: 1, updatedAt: Date.now(), operators: {} };
  }
}

export function saveOperatorStore(store: OperatorStore, storePath?: string): void {
  const path = storePath ?? resolveStorePath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmpPath = path + ".tmp";
  const json = JSON.stringify(store, null, 2);
  writeFileSync(tmpPath, json, { mode: 0o600 });
  renameSync(tmpPath, path);
}

// ── Email validation ───────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: string): { valid: true } | { valid: false; error: string } {
  const trimmed = email.trim();
  if (!trimmed) return { valid: false, error: "Email is required." };
  if (!EMAIL_RE.test(trimmed)) return { valid: false, error: "Invalid email format." };
  if (trimmed.length > 320) return { valid: false, error: "Email too long." };
  return { valid: true };
}

// ── CRUD Operations ────────────────────────────────────────────

export function listOperators(
  filter?: OperatorFilter,
  storePath?: string,
): OperatorRecord[] {
  const store = loadOperatorStore(storePath);
  let records = Object.values(store.operators);
  if (filter?.role) {
    records = records.filter((r) => r.role === filter.role);
  }
  if (filter?.disabled !== undefined) {
    records = records.filter((r) => (r.disabled ?? false) === filter.disabled);
  }
  return records.sort((a, b) => a.createdAt - b.createdAt);
}

export function getOperator(id: string, storePath?: string): OperatorRecord | undefined {
  const store = loadOperatorStore(storePath);
  return store.operators[id];
}

export function getOperatorByEmail(email: string, storePath?: string): OperatorRecord | undefined {
  const store = loadOperatorStore(storePath);
  const normalizedEmail = email.trim().toLowerCase();
  return Object.values(store.operators).find(
    (r) => r.email.toLowerCase() === normalizedEmail,
  );
}

export function createOperator(
  params: CreateOperatorParams,
  acl?: AccessControlMatrix,
  groupPolicy?: GroupPolicyConfig,
  storePath?: string,
): { ok: true; operator: OperatorRecord } | { ok: false; error: string } {
  const emailCheck = validateEmail(params.email);
  if (!emailCheck.valid) return { ok: false, error: emailCheck.error };

  const store = loadOperatorStore(storePath);
  const normalizedEmail = params.email.trim().toLowerCase();

  // Check for duplicate email
  const existing = Object.values(store.operators).find(
    (r) => r.email.toLowerCase() === normalizedEmail,
  );
  if (existing) {
    return { ok: false, error: `Operator with email "${params.email}" already exists.` };
  }

  const scopes = params.scopes ?? resolveEffectiveScopesForRole(
    params.role,
    acl,
    groupPolicy,
    params.groupMembership,
  );

  const now = Date.now();
  const operator: OperatorRecord = {
    id: randomUUID(),
    email: params.email.trim(),
    displayName: params.displayName,
    role: params.role,
    scopes,
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy,
    ssoSubject: params.ssoSubject,
    groupMembership: params.groupMembership,
    disabled: false,
  };

  store.operators[operator.id] = operator;
  store.updatedAt = now;
  saveOperatorStore(store, storePath);
  return { ok: true, operator };
}

export function updateOperator(
  id: string,
  patch: UpdateOperatorParams,
  acl?: AccessControlMatrix,
  groupPolicy?: GroupPolicyConfig,
  storePath?: string,
): { ok: true; operator: OperatorRecord } | { ok: false; error: string } {
  const store = loadOperatorStore(storePath);
  const existing = store.operators[id];
  if (!existing) {
    return { ok: false, error: `Operator "${id}" not found.` };
  }

  const now = Date.now();
  const updated: OperatorRecord = { ...existing, updatedAt: now };

  if (patch.displayName !== undefined) updated.displayName = patch.displayName;
  if (patch.disabled !== undefined) updated.disabled = patch.disabled;
  if (patch.groupMembership !== undefined) updated.groupMembership = patch.groupMembership;

  if (patch.role !== undefined) {
    updated.role = patch.role;
    // Recompute scopes when role changes (unless explicit scopes given)
    if (!patch.scopes) {
      updated.scopes = resolveEffectiveScopesForRole(
        patch.role,
        acl,
        groupPolicy,
        updated.groupMembership,
      );
    }
  }
  if (patch.scopes !== undefined) {
    updated.scopes = patch.scopes;
  }

  store.operators[id] = updated;
  store.updatedAt = now;
  saveOperatorStore(store, storePath);
  return { ok: true, operator: updated };
}

export function deleteOperator(
  id: string,
  actorId: string,
  storePath?: string,
): { ok: true; deletedId: string } | { ok: false; error: string } {
  const store = loadOperatorStore(storePath);
  const existing = store.operators[id];
  if (!existing) {
    return { ok: false, error: `Operator "${id}" not found.` };
  }
  // Prevent self-deletion
  const actor = Object.values(store.operators).find(
    (r) => r.id === actorId || r.email.toLowerCase() === actorId.toLowerCase(),
  );
  if (actor && actor.id === id) {
    return { ok: false, error: "Cannot delete your own operator account." };
  }

  delete store.operators[id];
  store.updatedAt = Date.now();
  saveOperatorStore(store, storePath);
  return { ok: true, deletedId: id };
}

// ── Invite Flow ────────────────────────────────────────────────

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function createInviteToken(
  email: string,
  role: AccessControlRole,
  createdBy: string,
  storePath?: string,
): { ok: true; token: string; expiresAt: number } | { ok: false; error: string } {
  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) return { ok: false, error: emailCheck.error };

  const store = loadOperatorStore(storePath);
  const normalizedEmail = email.trim().toLowerCase();

  // Check if operator already exists
  const existing = Object.values(store.operators).find(
    (r) => r.email.toLowerCase() === normalizedEmail,
  );
  if (existing) {
    return { ok: false, error: `Operator with email "${email}" already exists.` };
  }

  const token = createHash("sha256")
    .update(randomUUID() + Date.now().toString())
    .digest("hex")
    .slice(0, 32);

  const now = Date.now();
  const expiresAt = now + INVITE_TTL_MS;

  const operator: OperatorRecord = {
    id: randomUUID(),
    email: email.trim(),
    role,
    scopes: [],
    createdAt: now,
    updatedAt: now,
    createdBy,
    disabled: true, // Disabled until invite is redeemed
    inviteToken: token,
    inviteExpiresAt: expiresAt,
  };

  store.operators[operator.id] = operator;
  store.updatedAt = now;
  saveOperatorStore(store, storePath);
  return { ok: true, token, expiresAt };
}

export function redeemInvite(
  token: string,
  displayName?: string,
  acl?: AccessControlMatrix,
  groupPolicy?: GroupPolicyConfig,
  storePath?: string,
): { ok: true; operator: OperatorRecord } | { ok: false; error: string } {
  const store = loadOperatorStore(storePath);
  const entry = Object.values(store.operators).find(
    (r) => r.inviteToken === token,
  );

  if (!entry) {
    return { ok: false, error: "Invalid invite token." };
  }
  if (entry.inviteExpiresAt && entry.inviteExpiresAt < Date.now()) {
    return { ok: false, error: "Invite token has expired." };
  }

  const now = Date.now();
  const scopes = resolveEffectiveScopesForRole(entry.role, acl, groupPolicy);

  const updated: OperatorRecord = {
    ...entry,
    displayName: displayName ?? entry.displayName,
    scopes,
    disabled: false,
    inviteToken: undefined,
    inviteExpiresAt: undefined,
    updatedAt: now,
    lastLoginAt: now,
  };

  store.operators[updated.id] = updated;
  store.updatedAt = now;
  saveOperatorStore(store, storePath);
  return { ok: true, operator: updated };
}

// ── Login Tracking ─────────────────────────────────────────────

export function recordOperatorLogin(id: string, storePath?: string): void {
  const store = loadOperatorStore(storePath);
  const existing = store.operators[id];
  if (!existing) return;
  existing.lastLoginAt = Date.now();
  existing.updatedAt = Date.now();
  store.updatedAt = Date.now();
  saveOperatorStore(store, storePath);
}

// ── Admin Seeding ──────────────────────────────────────────────

export function seedAdminOperator(
  adminProfile: AdminProfile,
  storePath?: string,
): OperatorRecord {
  const store = loadOperatorStore(storePath);
  const normalizedEmail = adminProfile.email.trim().toLowerCase();

  // Idempotent: return existing if already seeded
  const existing = Object.values(store.operators).find(
    (r) => r.email.toLowerCase() === normalizedEmail && r.role === "admin",
  );
  if (existing) return existing;

  const now = Date.now();
  const operator: OperatorRecord = {
    id: randomUUID(),
    email: adminProfile.email.trim(),
    displayName: adminProfile.displayName,
    role: "admin",
    scopes: adminProfile.scopes,
    createdAt: adminProfile.createdAt ?? now,
    updatedAt: now,
    createdBy: "system",
    disabled: false,
  };

  store.operators[operator.id] = operator;
  store.updatedAt = now;
  saveOperatorStore(store, storePath);
  return operator;
}

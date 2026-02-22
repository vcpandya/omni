import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadOperatorStore,
  saveOperatorStore,
  listOperators,
  getOperator,
  getOperatorByEmail,
  createOperator,
  updateOperator,
  deleteOperator,
  createInviteToken,
  redeemInvite,
  seedAdminOperator,
} from "./operator-store.js";
import type { AdminProfile } from "../config/types.admin.js";

describe("operator-store", () => {
  let storePath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "op-store-test-"));
    storePath = join(dir, "operators.json");
  });

  afterEach(() => {
    try {
      rmSync(storePath, { force: true });
      rmSync(storePath + ".tmp", { force: true });
    } catch { /* ignore */ }
  });

  // ── Load/Save ────────────────────────────────────────────────

  it("returns empty store when file does not exist", () => {
    const store = loadOperatorStore(storePath);
    expect(store.version).toBe(1);
    expect(Object.keys(store.operators)).toHaveLength(0);
  });

  it("round-trips store through save/load", () => {
    const store = loadOperatorStore(storePath);
    store.operators["test-id"] = {
      id: "test-id",
      email: "test@example.com",
      role: "viewer",
      scopes: ["operator.read"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: "admin",
    };
    saveOperatorStore(store, storePath);
    const loaded = loadOperatorStore(storePath);
    expect(loaded.operators["test-id"]?.email).toBe("test@example.com");
  });

  // ── CRUD ─────────────────────────────────────────────────────

  it("creates an operator", () => {
    const result = createOperator(
      {
        email: "alice@corp.com",
        displayName: "Alice",
        role: "operator",
        createdBy: "admin",
      },
      undefined,
      undefined,
      storePath,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operator.email).toBe("alice@corp.com");
      expect(result.operator.role).toBe("operator");
      expect(result.operator.disabled).toBe(false);
    }
  });

  it("rejects duplicate email", () => {
    createOperator(
      { email: "bob@corp.com", role: "viewer", createdBy: "admin" },
      undefined,
      undefined,
      storePath,
    );
    const dupe = createOperator(
      { email: "BOB@corp.com", role: "admin", createdBy: "admin" },
      undefined,
      undefined,
      storePath,
    );
    expect(dupe.ok).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = createOperator(
      { email: "not-an-email", role: "viewer", createdBy: "admin" },
      undefined,
      undefined,
      storePath,
    );
    expect(result.ok).toBe(false);
  });

  it("lists operators with role filter", () => {
    createOperator({ email: "a@x.com", role: "admin", createdBy: "s" }, undefined, undefined, storePath);
    createOperator({ email: "b@x.com", role: "viewer", createdBy: "s" }, undefined, undefined, storePath);
    createOperator({ email: "c@x.com", role: "viewer", createdBy: "s" }, undefined, undefined, storePath);

    const all = listOperators(undefined, storePath);
    expect(all).toHaveLength(3);

    const viewers = listOperators({ role: "viewer" }, storePath);
    expect(viewers).toHaveLength(2);
  });

  it("gets operator by id and email", () => {
    const result = createOperator(
      { email: "get@test.com", role: "operator", createdBy: "s" },
      undefined,
      undefined,
      storePath,
    );
    if (!result.ok) throw new Error("create failed");

    const byId = getOperator(result.operator.id, storePath);
    expect(byId?.email).toBe("get@test.com");

    const byEmail = getOperatorByEmail("GET@test.com", storePath);
    expect(byEmail?.id).toBe(result.operator.id);
  });

  it("updates operator role and scopes", () => {
    const created = createOperator(
      { email: "upd@test.com", role: "viewer", createdBy: "s" },
      undefined,
      undefined,
      storePath,
    );
    if (!created.ok) throw new Error("create failed");

    const updated = updateOperator(
      created.operator.id,
      { role: "operator" },
      undefined,
      undefined,
      storePath,
    );
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.operator.role).toBe("operator");
    }
  });

  it("deletes operator", () => {
    const a = createOperator({ email: "del@test.com", role: "viewer", createdBy: "s" }, undefined, undefined, storePath);
    const b = createOperator({ email: "admin@test.com", role: "admin", createdBy: "s" }, undefined, undefined, storePath);
    if (!a.ok || !b.ok) throw new Error("create failed");

    const result = deleteOperator(a.operator.id, b.operator.id, storePath);
    expect(result.ok).toBe(true);

    const list = listOperators(undefined, storePath);
    expect(list).toHaveLength(1);
  });

  it("prevents self-deletion", () => {
    const admin = createOperator(
      { email: "self@test.com", role: "admin", createdBy: "s" },
      undefined,
      undefined,
      storePath,
    );
    if (!admin.ok) throw new Error("create failed");

    const result = deleteOperator(admin.operator.id, admin.operator.id, storePath);
    expect(result.ok).toBe(false);
  });

  // ── Invite Flow ──────────────────────────────────────────────

  it("creates and redeems invite token", () => {
    const invite = createInviteToken("new@corp.com", "operator", "admin", storePath);
    expect(invite.ok).toBe(true);
    if (!invite.ok) throw new Error("invite failed");

    const redeem = redeemInvite(invite.token, "New User", undefined, undefined, storePath);
    expect(redeem.ok).toBe(true);
    if (redeem.ok) {
      expect(redeem.operator.email).toBe("new@corp.com");
      expect(redeem.operator.displayName).toBe("New User");
      expect(redeem.operator.disabled).toBe(false);
      expect(redeem.operator.inviteToken).toBeUndefined();
    }
  });

  it("rejects invalid invite token", () => {
    const result = redeemInvite("nonexistent-token", undefined, undefined, undefined, storePath);
    expect(result.ok).toBe(false);
  });

  // ── Admin Seeding ────────────────────────────────────────────

  it("seeds admin operator from AdminProfile", () => {
    const profile: AdminProfile = {
      email: "admin@enterprise.com",
      displayName: "Enterprise Admin",
      role: "admin",
      scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.pairing"],
      createdAt: Date.now(),
      canConfigureSso: true,
      canManageGroupPolicy: true,
      canPushToDevices: true,
    };
    const operator = seedAdminOperator(profile, storePath);
    expect(operator.email).toBe("admin@enterprise.com");
    expect(operator.role).toBe("admin");

    // Idempotent: calling again returns same operator
    const again = seedAdminOperator(profile, storePath);
    expect(again.id).toBe(operator.id);
  });
});

// ── Operators Controller — RBAC admin state + RPC loaders ──────────
//
// Mirrors the `activity.ts` controller pattern: a plain `OperatorsState`
// object mutated through pure async functions that wrap gateway RPCs. The
// view is kept a read-only projection; all network calls live here.

import type { GatewayBrowserClient } from "../gateway.ts";

// ── Types ───────────────────────────────────────────────────────

export type OperatorRole = "admin" | "operator" | "viewer" | "auditor";

export type OperatorRecordUI = {
  id: string;
  email: string;
  displayName?: string;
  role: OperatorRole;
  scopes: string[];
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  createdBy: string;
  ssoSubject?: string;
  disabled?: boolean;
};

export type InviteDraft = {
  email: string;
  role: OperatorRole;
};

export type OperatorFormDraft = {
  /** `null` → create mode; operator id → edit mode */
  editingId: string | null;
  email: string;
  displayName: string;
  role: OperatorRole;
  disabled: boolean;
};

export type IssuedInvite = {
  email: string;
  token: string;
  expiresAt: number;
  copiedAt?: number;
};

export type OperatorsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  /** The operator id the current session is authenticated as; used to guard self-delete. */
  selfOperatorId: string | null;
  loading: boolean;
  error: string | null;
  operators: OperatorRecordUI[];
  roleFilter: OperatorRole | "all";
  showDisabled: boolean;
  search: string;
  formOpen: boolean;
  formDraft: OperatorFormDraft | null;
  formSubmitting: boolean;
  formError: string | null;
  inviteOpen: boolean;
  inviteDraft: InviteDraft;
  inviteSubmitting: boolean;
  inviteError: string | null;
  lastIssuedInvite: IssuedInvite | null;
};

export const OPERATOR_ROLES: OperatorRole[] = ["admin", "operator", "viewer", "auditor"];

export const DEFAULT_FORM_DRAFT: OperatorFormDraft = {
  editingId: null,
  email: "",
  displayName: "",
  role: "operator",
  disabled: false,
};

export const DEFAULT_INVITE_DRAFT: InviteDraft = {
  email: "",
  role: "operator",
};

export function makeOperatorsState(): OperatorsState {
  return {
    client: null,
    connected: false,
    selfOperatorId: null,
    loading: false,
    error: null,
    operators: [],
    roleFilter: "all",
    showDisabled: false,
    search: "",
    formOpen: false,
    formDraft: null,
    formSubmitting: false,
    formError: null,
    inviteOpen: false,
    inviteDraft: { ...DEFAULT_INVITE_DRAFT },
    inviteSubmitting: false,
    inviteError: null,
    lastIssuedInvite: null,
  };
}

// ── Load ────────────────────────────────────────────────────────

export async function loadOperators(state: OperatorsState): Promise<void> {
  if (!state.client) {
    return;
  }
  state.loading = true;
  state.error = null;
  try {
    const params: Record<string, unknown> = {};
    if (state.roleFilter !== "all") {
      params.role = state.roleFilter;
    }
    const result = await state.client.request<{ operators: OperatorRecordUI[] }>(
      "operators.list",
      params,
    );
    state.operators = result.operators;
  } catch (err) {
    state.error = String(err);
  } finally {
    state.loading = false;
  }
}

// ── Derived ─────────────────────────────────────────────────────

export function visibleOperators(state: OperatorsState): OperatorRecordUI[] {
  const q = state.search.trim().toLowerCase();
  return state.operators.filter((op) => {
    if (!state.showDisabled && op.disabled) {
      return false;
    }
    if (!q) {
      return true;
    }
    const haystack = `${op.email} ${op.displayName ?? ""} ${op.id}`.toLowerCase();
    return haystack.includes(q);
  });
}

export function operatorCounts(state: OperatorsState): {
  total: number;
  active: number;
  admins: number;
  disabled: number;
} {
  const total = state.operators.length;
  const active = state.operators.filter((op) => !op.disabled).length;
  const admins = state.operators.filter((op) => op.role === "admin").length;
  const disabled = state.operators.filter((op) => op.disabled).length;
  return { total, active, admins, disabled };
}

// ── Form: create / edit ─────────────────────────────────────────

export function openCreateForm(state: OperatorsState): void {
  state.formDraft = { ...DEFAULT_FORM_DRAFT };
  state.formOpen = true;
  state.formError = null;
}

export function openEditForm(state: OperatorsState, op: OperatorRecordUI): void {
  state.formDraft = {
    editingId: op.id,
    email: op.email,
    displayName: op.displayName ?? "",
    role: op.role,
    disabled: Boolean(op.disabled),
  };
  state.formOpen = true;
  state.formError = null;
}

export function closeForm(state: OperatorsState): void {
  state.formOpen = false;
  state.formDraft = null;
  state.formError = null;
  state.formSubmitting = false;
}

export async function submitForm(state: OperatorsState): Promise<boolean> {
  if (!state.client || !state.formDraft) {
    return false;
  }
  const draft = state.formDraft;

  // Client-side validation — gateway validates again, but fast feedback matters.
  if (!draft.email.trim() && !draft.editingId) {
    state.formError = "Email is required";
    return false;
  }
  if (!OPERATOR_ROLES.includes(draft.role)) {
    state.formError = "Select a role";
    return false;
  }

  state.formSubmitting = true;
  state.formError = null;

  try {
    if (draft.editingId) {
      await state.client.request<{ operator: OperatorRecordUI }>("operators.update", {
        id: draft.editingId,
        displayName: draft.displayName.trim() || undefined,
        role: draft.role,
        disabled: draft.disabled,
      });
    } else {
      await state.client.request<{ operator: OperatorRecordUI }>("operators.create", {
        email: draft.email.trim(),
        displayName: draft.displayName.trim() || undefined,
        role: draft.role,
      });
    }
    closeForm(state);
    await loadOperators(state);
    return true;
  } catch (err) {
    state.formError = String(err);
    return false;
  } finally {
    state.formSubmitting = false;
  }
}

// ── Delete (with self-guard) ────────────────────────────────────

export async function deleteOperator(
  state: OperatorsState,
  op: OperatorRecordUI,
): Promise<boolean> {
  if (!state.client) {
    return false;
  }
  // Gateway also guards against self-deletion, but a clearer UI error is nicer.
  if (op.id === state.selfOperatorId) {
    state.error = "Cannot delete yourself";
    return false;
  }
  try {
    await state.client.request<{ deletedId: string }>("operators.delete", { id: op.id });
    await loadOperators(state);
    return true;
  } catch (err) {
    state.error = String(err);
    return false;
  }
}

// ── Invite flow ─────────────────────────────────────────────────

export function openInvite(state: OperatorsState): void {
  state.inviteDraft = { ...DEFAULT_INVITE_DRAFT };
  state.inviteOpen = true;
  state.inviteError = null;
  state.lastIssuedInvite = null;
}

export function closeInvite(state: OperatorsState): void {
  state.inviteOpen = false;
  state.inviteError = null;
  state.inviteSubmitting = false;
}

export async function submitInvite(state: OperatorsState): Promise<boolean> {
  if (!state.client) {
    return false;
  }
  const { email, role } = state.inviteDraft;
  if (!email.trim()) {
    state.inviteError = "Email is required";
    return false;
  }
  state.inviteSubmitting = true;
  state.inviteError = null;
  try {
    const result = await state.client.request<{ token: string; expiresAt: number }>(
      "operators.invite",
      { email: email.trim(), role },
    );
    state.lastIssuedInvite = {
      email: email.trim(),
      token: result.token,
      expiresAt: result.expiresAt,
    };
    return true;
  } catch (err) {
    state.inviteError = String(err);
    return false;
  } finally {
    state.inviteSubmitting = false;
  }
}

export function markInviteCopied(state: OperatorsState): void {
  if (state.lastIssuedInvite) {
    state.lastIssuedInvite = { ...state.lastIssuedInvite, copiedAt: Date.now() };
  }
}

// ── Filters ─────────────────────────────────────────────────────

export async function setRoleFilter(
  state: OperatorsState,
  role: OperatorRole | "all",
): Promise<void> {
  state.roleFilter = role;
  await loadOperators(state);
}

export function setSearch(state: OperatorsState, q: string): void {
  state.search = q;
}

export function setShowDisabled(state: OperatorsState, show: boolean): void {
  state.showDisabled = show;
}

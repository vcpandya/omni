// ── Operator Store Types ─────────────────────────────────────────

import type { AccessControlRole } from "../config/types.admin.js";
import type { OperatorScope } from "../gateway/method-scopes.js";

export type OperatorRecord = {
  id: string;
  email: string;
  displayName?: string;
  role: AccessControlRole;
  scopes: OperatorScope[];
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
  createdBy: string;
  ssoSubject?: string;
  groupMembership?: string[];
  disabled?: boolean;
  inviteToken?: string;
  inviteExpiresAt?: number;
};

export type OperatorStore = {
  version: 1;
  updatedAt: number;
  operators: Record<string, OperatorRecord>;
};

export type CreateOperatorParams = {
  email: string;
  displayName?: string;
  role: AccessControlRole;
  scopes?: OperatorScope[];
  createdBy: string;
  ssoSubject?: string;
  groupMembership?: string[];
};

export type UpdateOperatorParams = {
  displayName?: string;
  role?: AccessControlRole;
  scopes?: OperatorScope[];
  disabled?: boolean;
  groupMembership?: string[];
};

export type OperatorFilter = {
  role?: AccessControlRole;
  disabled?: boolean;
};

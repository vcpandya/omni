// ── Operators View — RBAC admin UI ──────────────────────────────

import { html, nothing, type TemplateResult } from "lit";
import type {
  InviteDraft,
  OperatorFormDraft,
  OperatorRecordUI,
  OperatorRole,
  OperatorsState,
} from "../controllers/operators.ts";
import {
  OPERATOR_ROLES,
  closeForm,
  closeInvite,
  deleteOperator,
  loadOperators,
  markInviteCopied,
  openCreateForm,
  openEditForm,
  openInvite,
  operatorCounts,
  setRoleFilter,
  setSearch,
  setShowDisabled,
  submitForm,
  submitInvite,
  visibleOperators,
} from "../controllers/operators.ts";

// ── Props ───────────────────────────────────────────────────────

export type OperatorsProps = OperatorsState & {
  onChange: () => void;
};

// ── Main ────────────────────────────────────────────────────────

export function renderOperators(props: OperatorsProps): TemplateResult {
  return html`
    <div class="operators">
      ${renderOperatorsHeader(props)}
      ${renderOperatorsStats(props)}
      ${renderOperatorsFilters(props)}
      ${
        props.loading && props.operators.length === 0
          ? html`
              <div class="operators-loading"><span class="activity-spinner"></span> Loading operators…</div>
            `
          : renderOperatorsTable(props)
      }
      ${
        props.error ? html`<div class="operators-error" role="alert">${props.error}</div>` : nothing
      }
      ${props.formOpen ? renderOperatorForm(props) : nothing}
      ${props.inviteOpen ? renderInviteModal(props) : nothing}
    </div>
  `;
}

// ── Header ──────────────────────────────────────────────────────

function renderOperatorsHeader(props: OperatorsProps): TemplateResult {
  return html`
    <div class="operators-header">
      <div class="operators-header__left">
        <h2 class="operators-title">Operators</h2>
        <span class="operators-header__subtitle">
          Role-based access control · invite flow
        </span>
      </div>
      <div class="operators-header__right">
        <button
          class="btn btn--sm"
          @click=${() => {
            openInvite(props);
            props.onChange();
          }}
        >
          Invite operator
        </button>
        <button
          class="btn btn--sm btn--primary"
          @click=${() => {
            openCreateForm(props);
            props.onChange();
          }}
        >
          New operator
        </button>
        <button
          class="btn btn--sm"
          @click=${async () => {
            await loadOperators(props);
            props.onChange();
          }}
        >
          Refresh
        </button>
      </div>
    </div>
  `;
}

// ── Stats ───────────────────────────────────────────────────────

function renderOperatorsStats(props: OperatorsProps): TemplateResult {
  const counts = operatorCounts(props);
  return html`
    <div class="operators-stats">
      <div class="operators-stat card">
        <div class="operators-stat__value">${counts.total}</div>
        <div class="operators-stat__label">Total</div>
      </div>
      <div class="operators-stat card">
        <div class="operators-stat__value">${counts.active}</div>
        <div class="operators-stat__label">Active</div>
      </div>
      <div class="operators-stat card">
        <div class="operators-stat__value operators-stat__value--admin">${counts.admins}</div>
        <div class="operators-stat__label">Admins</div>
      </div>
      <div class="operators-stat card">
        <div class="operators-stat__value ${counts.disabled > 0 ? "operators-stat__value--muted" : ""}">
          ${counts.disabled}
        </div>
        <div class="operators-stat__label">Disabled</div>
      </div>
    </div>
  `;
}

// ── Filters ─────────────────────────────────────────────────────

function renderOperatorsFilters(props: OperatorsProps): TemplateResult {
  return html`
    <div class="operators-filters">
      <input
        type="search"
        class="operators-search"
        placeholder="Search email, name, id…"
        .value=${props.search}
        @input=${(e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          setSearch(props, v);
          props.onChange();
        }}
      />
      <div class="operators-filter-group" role="group" aria-label="Role filter">
        ${(["all", ...OPERATOR_ROLES] as const).map(
          (role) => html`
            <button
              class="operators-filter-chip ${
                props.roleFilter === role ? "operators-filter-chip--active" : ""
              }"
              @click=${async () => {
                await setRoleFilter(props, role);
                props.onChange();
              }}
            >
              ${role === "all" ? "All" : capitalize(role)}
            </button>
          `,
        )}
      </div>
      <label class="operators-toggle">
        <input
          type="checkbox"
          .checked=${props.showDisabled}
          @change=${(e: Event) => {
            setShowDisabled(props, (e.target as HTMLInputElement).checked);
            props.onChange();
          }}
        />
        <span>Show disabled</span>
      </label>
    </div>
  `;
}

// ── Table ───────────────────────────────────────────────────────

function renderOperatorsTable(props: OperatorsProps): TemplateResult {
  const rows = visibleOperators(props);
  if (rows.length === 0) {
    return html`
      <div class="operators-empty card">
        <div class="operators-empty__title">No operators match your filters</div>
        <div class="operators-empty__hint">
          Try clearing the search or switching role filter to "All".
        </div>
      </div>
    `;
  }
  return html`
    <div class="operators-table card">
      <div class="operators-row operators-row--head" role="row">
        <div class="operators-cell operators-cell--email">Email</div>
        <div class="operators-cell">Name</div>
        <div class="operators-cell">Role</div>
        <div class="operators-cell">Scopes</div>
        <div class="operators-cell">Last login</div>
        <div class="operators-cell operators-cell--actions">Actions</div>
      </div>
      ${rows.map((op) => renderOperatorRow(op, props))}
    </div>
  `;
}

function renderOperatorRow(op: OperatorRecordUI, props: OperatorsProps): TemplateResult {
  const isSelf = op.id === props.selfOperatorId;
  return html`
    <div class="operators-row ${op.disabled ? "operators-row--disabled" : ""}" role="row">
      <div class="operators-cell operators-cell--email">
        <span class="operators-email">${op.email}</span>
        ${
          op.ssoSubject
            ? html`<span class="operators-badge operators-badge--sso" title="SSO subject: ${op.ssoSubject}">SSO</span>`
            : nothing
        }
        ${
          op.disabled
            ? html`
                <span class="operators-badge operators-badge--disabled">Disabled</span>
              `
            : nothing
        }
        ${
          isSelf
            ? html`
                <span class="operators-badge operators-badge--self">You</span>
              `
            : nothing
        }
      </div>
      <div class="operators-cell">${
        op.displayName ??
        html`
          <span class="operators-muted">—</span>
        `
      }</div>
      <div class="operators-cell">
        <span class="operators-role operators-role--${op.role}">${op.role}</span>
      </div>
      <div class="operators-cell operators-cell--scopes">
        ${
          op.scopes.length > 0
            ? op.scopes.map((s) => html`<code class="operators-scope">${formatScope(s)}</code>`)
            : html`
                <span class="operators-muted">—</span>
              `
        }
      </div>
      <div class="operators-cell operators-muted">
        ${op.lastLoginAt ? formatRelativeTime(op.lastLoginAt) : "Never"}
      </div>
      <div class="operators-cell operators-cell--actions">
        <button
          class="btn btn--xs"
          @click=${() => {
            openEditForm(props, op);
            props.onChange();
          }}
        >
          Edit
        </button>
        <button
          class="btn btn--xs btn--danger"
          ?disabled=${isSelf}
          title=${isSelf ? "You cannot delete your own account" : "Remove this operator"}
          @click=${async () => {
            const confirmed = window.confirm(
              `Delete operator "${op.email}"? This cannot be undone.`,
            );
            if (!confirmed) {
              return;
            }
            await deleteOperator(props, op);
            props.onChange();
          }}
        >
          Delete
        </button>
      </div>
    </div>
  `;
}

// ── Form modal ──────────────────────────────────────────────────

function renderOperatorForm(props: OperatorsProps): TemplateResult {
  const draft = props.formDraft;
  if (!draft) {
    return html``;
  }
  const isEdit = draft.editingId !== null;
  return html`
    <div
      class="modal-backdrop"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) {
          closeForm(props);
          props.onChange();
        }
      }}
    >
      <div
        class="modal card"
        role="dialog"
        aria-modal="true"
        aria-label=${isEdit ? "Edit operator" : "Create operator"}
      >
        <div class="modal__header">
          <h3 class="modal__title">${isEdit ? "Edit operator" : "New operator"}</h3>
          <button
            class="modal__close"
            aria-label="Close"
            @click=${() => {
              closeForm(props);
              props.onChange();
            }}
          >
            ×
          </button>
        </div>
        <form
          class="modal__body"
          @submit=${async (e: Event) => {
            e.preventDefault();
            const ok = await submitForm(props);
            props.onChange();
            if (!ok) {
              return;
            }
          }}
        >
          <label class="field">
            <span class="field__label">Email</span>
            <input
              class="field__input"
              type="email"
              required
              ?disabled=${isEdit}
              .value=${draft.email}
              @input=${(e: Event) => updateFormDraft(props, "email", (e.target as HTMLInputElement).value)}
            />
            ${
              isEdit
                ? html`
                    <span class="field__hint">Email is immutable after creation.</span>
                  `
                : nothing
            }
          </label>
          <label class="field">
            <span class="field__label">Display name</span>
            <input
              class="field__input"
              type="text"
              .value=${draft.displayName}
              @input=${(e: Event) =>
                updateFormDraft(props, "displayName", (e.target as HTMLInputElement).value)}
            />
          </label>
          <fieldset class="field">
            <legend class="field__label">Role</legend>
            <div class="role-grid">
              ${OPERATOR_ROLES.map(
                (role) => html`
                  <label class="role-card ${draft.role === role ? "role-card--active" : ""}">
                    <input
                      type="radio"
                      name="role"
                      .checked=${draft.role === role}
                      @change=${() => updateFormDraft(props, "role", role)}
                    />
                    <span class="role-card__title">${capitalize(role)}</span>
                    <span class="role-card__desc">${roleDescription(role)}</span>
                  </label>
                `,
              )}
            </div>
          </fieldset>
          ${
            isEdit
              ? html`
                <label class="field field--inline">
                  <input
                    type="checkbox"
                    .checked=${draft.disabled}
                    @change=${(e: Event) =>
                      updateFormDraft(props, "disabled", (e.target as HTMLInputElement).checked)}
                  />
                  <span>Disable this operator (cannot sign in)</span>
                </label>
              `
              : nothing
          }
          ${
            props.formError
              ? html`<div class="modal__error" role="alert">${props.formError}</div>`
              : nothing
          }
          <div class="modal__actions">
            <button
              type="button"
              class="btn"
              @click=${() => {
                closeForm(props);
                props.onChange();
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              class="btn btn--primary"
              ?disabled=${props.formSubmitting}
            >
              ${props.formSubmitting ? "Saving…" : isEdit ? "Save changes" : "Create operator"}
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function updateFormDraft<K extends keyof OperatorFormDraft>(
  props: OperatorsProps,
  key: K,
  value: OperatorFormDraft[K],
): void {
  if (!props.formDraft) {
    return;
  }
  props.formDraft = { ...props.formDraft, [key]: value };
  props.onChange();
}

// ── Invite modal ────────────────────────────────────────────────

function renderInviteModal(props: OperatorsProps): TemplateResult {
  const issued = props.lastIssuedInvite;
  return html`
    <div
      class="modal-backdrop"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) {
          closeInvite(props);
          props.onChange();
        }
      }}
    >
      <div class="modal card" role="dialog" aria-modal="true" aria-label="Invite operator">
        <div class="modal__header">
          <h3 class="modal__title">${issued ? "Invite issued" : "Invite operator"}</h3>
          <button
            class="modal__close"
            aria-label="Close"
            @click=${() => {
              closeInvite(props);
              props.onChange();
            }}
          >
            ×
          </button>
        </div>
        <div class="modal__body">
          ${issued ? renderIssuedInvite(issued, props) : renderInviteForm(props.inviteDraft, props)}
        </div>
      </div>
    </div>
  `;
}

function renderInviteForm(draft: InviteDraft, props: OperatorsProps): TemplateResult {
  return html`
    <form
      @submit=${async (e: Event) => {
        e.preventDefault();
        await submitInvite(props);
        props.onChange();
      }}
    >
      <label class="field">
        <span class="field__label">Invitee email</span>
        <input
          class="field__input"
          type="email"
          required
          .value=${draft.email}
          @input=${(e: Event) => updateInviteDraft(props, "email", (e.target as HTMLInputElement).value)}
        />
      </label>
      <fieldset class="field">
        <legend class="field__label">Role to grant</legend>
        <div class="role-grid">
          ${OPERATOR_ROLES.map(
            (role) => html`
              <label class="role-card ${draft.role === role ? "role-card--active" : ""}">
                <input
                  type="radio"
                  name="invite-role"
                  .checked=${draft.role === role}
                  @change=${() => updateInviteDraft(props, "role", role)}
                />
                <span class="role-card__title">${capitalize(role)}</span>
                <span class="role-card__desc">${roleDescription(role)}</span>
              </label>
            `,
          )}
        </div>
      </fieldset>
      ${
        props.inviteError
          ? html`<div class="modal__error" role="alert">${props.inviteError}</div>`
          : nothing
      }
      <div class="modal__actions">
        <button
          type="button"
          class="btn"
          @click=${() => {
            closeInvite(props);
            props.onChange();
          }}
        >
          Cancel
        </button>
        <button type="submit" class="btn btn--primary" ?disabled=${props.inviteSubmitting}>
          ${props.inviteSubmitting ? "Issuing…" : "Issue invite"}
        </button>
      </div>
    </form>
  `;
}

function renderIssuedInvite(
  issued: NonNullable<OperatorsState["lastIssuedInvite"]>,
  props: OperatorsProps,
): TemplateResult {
  const expiresIn = issued.expiresAt - Date.now();
  const days = Math.max(0, Math.round(expiresIn / (1000 * 60 * 60 * 24)));
  return html`
    <p class="invite-issued__lede">
      Send this link to <strong>${issued.email}</strong>. It expires in
      <strong>${days} day${days === 1 ? "" : "s"}</strong> and can be redeemed once.
    </p>
    <div class="invite-token">
      <code class="invite-token__value">${issued.token}</code>
      <button
        class="btn btn--sm"
        @click=${async () => {
          try {
            await navigator.clipboard.writeText(issued.token);
            markInviteCopied(props);
            props.onChange();
          } catch {
            // Fallback: ignore; user can triple-click the code block
          }
        }}
      >
        ${issued.copiedAt ? "Copied" : "Copy"}
      </button>
    </div>
    <p class="invite-issued__hint">
      Treat this token like a password — anyone with it can claim the account
      until it's redeemed or expires.
    </p>
    <div class="modal__actions">
      <button
        class="btn btn--primary"
        @click=${async () => {
          closeInvite(props);
          await loadOperators(props);
          props.onChange();
        }}
      >
        Done
      </button>
    </div>
  `;
}

function updateInviteDraft<K extends keyof InviteDraft>(
  props: OperatorsProps,
  key: K,
  value: InviteDraft[K],
): void {
  props.inviteDraft = { ...props.inviteDraft, [key]: value };
  props.onChange();
}

// ── Helpers ─────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function roleDescription(role: OperatorRole): string {
  switch (role) {
    case "admin":
      return "Full control — manage operators, fleet, policies.";
    case "operator":
      return "Read + write + approvals + pairing.";
    case "viewer":
      return "Read-only access to dashboards and events.";
    case "auditor":
      return "Read-only access for compliance review.";
  }
}

function formatScope(scope: string): string {
  // "operator.admin" → "admin"
  return scope.replace(/^operator\./, "");
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return new Date(ts).toLocaleDateString();
}

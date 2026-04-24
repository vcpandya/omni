// ── Fleet Overview View ────────────────────────────────────────
//
// Surfaces: trust-posture dashboard, recent operations list, and a
// bulk-ops panel (policy push, token rotate, remote wipe).

import { html, nothing, type TemplateResult } from "lit";
import type {
  DeviceTrustLevel,
  FleetOperationResultStatus,
  FleetOperationStatus,
  FleetOperationType,
  FleetOperationUI,
  FleetState,
} from "../controllers/fleet.ts";
import {
  loadFleet,
  operationSuccessRate,
  selectOperation,
  setBulkOpField,
  submitBulkOp,
  trustDistributionPct,
} from "../controllers/fleet.ts";

// ── Props ───────────────────────────────────────────────────────

export type FleetProps = FleetState & {
  onChange: () => void;
};

// ── Main ────────────────────────────────────────────────────────

export function renderFleet(props: FleetProps): TemplateResult {
  return html`
    <div class="fleet">
      ${renderFleetHeader(props)}
      ${
        props.loading && !props.overview
          ? html`
              <div class="fleet-loading"><span class="activity-spinner"></span> Loading fleet…</div>
            `
          : html`
            ${renderOverviewCards(props)}
            ${renderTrustDistribution(props)}
            ${renderBulkOpsPanel(props)}
            ${renderRecentOperations(props)}
          `
      }
      ${props.error ? html`<div class="fleet-error" role="alert">${props.error}</div>` : nothing}
      ${props.selectedOperationId ? renderOperationDetail(props) : nothing}
    </div>
  `;
}

// ── Header ──────────────────────────────────────────────────────

function renderFleetHeader(props: FleetProps): TemplateResult {
  const last = props.lastRefreshAt ? formatRelativeTime(props.lastRefreshAt) : "never";
  return html`
    <div class="fleet-header">
      <div class="fleet-header__left">
        <h2 class="fleet-title">Fleet</h2>
        <span class="fleet-header__subtitle">
          Trust posture · recent operations
        </span>
      </div>
      <div class="fleet-header__right">
        <span class="fleet-stale" aria-live="polite">
          Updated ${last}
        </span>
        <button
          class="btn btn--sm"
          @click=${async () => {
            await loadFleet(props);
            props.onChange();
          }}
        >
          Refresh
        </button>
      </div>
    </div>
  `;
}

// ── Overview stat cards ─────────────────────────────────────────

function renderOverviewCards(props: FleetProps): TemplateResult {
  const o = props.overview;
  const hasData = o !== null;
  return html`
    <div class="fleet-stats">
      <div class="fleet-stat card">
        <div class="fleet-stat__value">${hasData ? o.totalDevices : "—"}</div>
        <div class="fleet-stat__label">Devices</div>
      </div>
      <div class="fleet-stat card">
        <div class="fleet-stat__value">${hasData ? o.totalAgents : "—"}</div>
        <div class="fleet-stat__label">Agents</div>
      </div>
      <div class="fleet-stat card">
        <div
          class="fleet-stat__value ${
            hasData && o.activeOperations > 0 ? "fleet-stat__value--active" : ""
          }"
        >
          ${hasData ? o.activeOperations : "—"}
        </div>
        <div class="fleet-stat__label">Active ops</div>
      </div>
      <div class="fleet-stat card">
        <div class="fleet-stat__value">
          ${hasData && o.lastReportAt ? formatRelativeTime(o.lastReportAt) : "—"}
        </div>
        <div class="fleet-stat__label">Last report</div>
      </div>
    </div>
  `;
}

// ── Trust distribution bar ──────────────────────────────────────

function renderTrustDistribution(props: FleetProps): TemplateResult {
  const counts = props.overview?.byTrustLevel;
  const pct = trustDistributionPct(props);
  const total = counts ? counts.high + counts.medium + counts.low + counts.untrusted : 0;
  if (!counts || total === 0) {
    return html`
      <div class="fleet-trust card">
        <div class="fleet-trust__title">Trust distribution</div>
        <div class="fleet-trust__empty">
          No devices reporting. Trust posture will appear once devices pair.
        </div>
      </div>
    `;
  }
  return html`
    <div class="fleet-trust card">
      <div class="fleet-trust__header">
        <div class="fleet-trust__title">Trust distribution</div>
        <div class="fleet-trust__total">${total} device${total === 1 ? "" : "s"}</div>
      </div>
      <div class="fleet-trust__bar" role="img" aria-label="Trust level distribution">
        ${(["high", "medium", "low", "untrusted"] as const).map((level) =>
          pct[level] > 0
            ? html`<span
                class="fleet-trust__segment fleet-trust__segment--${level}"
                style="flex: ${pct[level]} 1 0;"
                title="${capitalize(level)}: ${counts[level]} (${pct[level]}%)"
              ></span>`
            : nothing,
        )}
      </div>
      <div class="fleet-trust__legend">
        ${(["high", "medium", "low", "untrusted"] as const).map(
          (level) => html`
            <div class="fleet-trust__legend-item">
              <span class="fleet-trust__dot fleet-trust__dot--${level}"></span>
              <span class="fleet-trust__legend-label">${capitalize(level)}</span>
              <span class="fleet-trust__legend-count">${counts[level]}</span>
            </div>
          `,
        )}
      </div>
    </div>
  `;
}

// ── Bulk-ops panel ──────────────────────────────────────────────
//
// Three forms share a single target-device-ids input. Destructive ops (wipe)
// require an explicit confirmation checkbox before the submit button enables.

function renderBulkOpsPanel(props: FleetProps): TemplateResult {
  const busy = props.bulkOpSubmitting;
  const targetCount = parseTargetCount(props.bulkOp.targetIds);
  return html`
    <div class="fleet-bulk card">
      <div class="fleet-bulk__header">
        <div class="fleet-bulk__title">Bulk operations</div>
        <div class="fleet-bulk__subtitle">
          Target one or more devices by id, then run an operation.
          ${
            targetCount > 0
              ? html`<span class="fleet-bulk__count">${targetCount} device${targetCount === 1 ? "" : "s"} selected</span>`
              : nothing
          }
        </div>
      </div>
      <label class="fleet-bulk__field">
        <span class="fleet-bulk__label">Target device ids</span>
        <textarea
          class="fleet-bulk__input"
          rows="2"
          placeholder="device-abc, device-xyz…"
          spellcheck="false"
          ?disabled=${busy !== null}
          .value=${props.bulkOp.targetIds}
          @input=${(e: Event) => {
            setBulkOpField(props, "targetIds", (e.target as HTMLTextAreaElement).value);
            props.onChange();
          }}
        ></textarea>
        <span class="fleet-bulk__hint">Comma- or whitespace-separated. Paste from fleet.overview.</span>
      </label>

      ${renderBulkAction(props, {
        op: "policy-push",
        title: "Policy push",
        desc: "Push selected policy fields to target devices.",
        danger: false,
        extra: html`
          <label class="fleet-bulk__subfield">
            <span class="fleet-bulk__sublabel">Fields</span>
            <input
              class="fleet-bulk__input fleet-bulk__input--small"
              type="text"
              placeholder="security,compliance"
              ?disabled=${busy !== null}
              .value=${props.bulkOp.pushFields}
              @input=${(e: Event) => {
                setBulkOpField(props, "pushFields", (e.target as HTMLInputElement).value);
                props.onChange();
              }}
            />
          </label>
        `,
      })}
      ${renderBulkAction(props, {
        op: "token-rotate",
        title: "Rotate tokens",
        desc: "Issue new device tokens; previous tokens stop working at next handshake.",
        danger: false,
      })}
      ${renderBulkAction(props, {
        op: "wipe",
        title: "Remote wipe",
        desc: "Force a device wipe. Cannot be undone — gateway also requires an explicit confirm flag.",
        danger: true,
        extra: html`
          <label class="fleet-bulk__confirm">
            <input
              type="checkbox"
              .checked=${props.bulkOp.wipeConfirmed}
              ?disabled=${busy !== null}
              @change=${(e: Event) => {
                setBulkOpField(props, "wipeConfirmed", (e.target as HTMLInputElement).checked);
                props.onChange();
              }}
            />
            <span>Yes, wipe these devices. I understand this is irreversible.</span>
          </label>
        `,
      })}

      ${
        props.bulkOpError
          ? html`<div class="fleet-bulk__error" role="alert">${props.bulkOpError}</div>`
          : nothing
      }
      ${
        props.bulkOpLastResult
          ? html`<div class="fleet-bulk__success">
            Operation <code>${props.bulkOpLastResult.id}</code> submitted —
            ${opStatusLabel(props.bulkOpLastResult.status)}.
            <button
              class="fleet-bulk__link"
              @click=${() => {
                selectOperation(props, props.bulkOpLastResult!.id);
                props.onChange();
              }}
            >View details</button>
          </div>`
          : nothing
      }
    </div>
  `;
}

type BulkActionSpec = {
  op: FleetOperationType;
  title: string;
  desc: string;
  danger: boolean;
  extra?: TemplateResult;
};

function renderBulkAction(props: FleetProps, spec: BulkActionSpec): TemplateResult {
  const submitting = props.bulkOpSubmitting === spec.op;
  const anyBusy = props.bulkOpSubmitting !== null;
  const disabled = anyBusy || (spec.op === "wipe" && !props.bulkOp.wipeConfirmed);
  return html`
    <div class="fleet-bulk-action ${spec.danger ? "fleet-bulk-action--danger" : ""}">
      <div class="fleet-bulk-action__copy">
        <div class="fleet-bulk-action__title">${spec.title}</div>
        <div class="fleet-bulk-action__desc">${spec.desc}</div>
        ${spec.extra ?? nothing}
      </div>
      <button
        class="btn ${spec.danger ? "btn--danger" : "btn--primary"}"
        ?disabled=${disabled}
        @click=${async () => {
          await submitBulkOp(props, spec.op);
          props.onChange();
        }}
      >
        ${submitting ? "Running…" : "Run"}
      </button>
    </div>
  `;
}

function parseTargetCount(raw: string): number {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

// ── Recent ops table ────────────────────────────────────────────

function renderRecentOperations(props: FleetProps): TemplateResult {
  if (props.operations.length === 0) {
    return html`
      <div class="fleet-ops card">
        <div class="fleet-ops__header">
          <div class="fleet-ops__title">Recent operations</div>
        </div>
        <div class="fleet-ops__empty">
          No bulk operations yet. Policy push, token rotation, and remote wipe actions will appear here.
        </div>
      </div>
    `;
  }
  return html`
    <div class="fleet-ops card">
      <div class="fleet-ops__header">
        <div class="fleet-ops__title">Recent operations</div>
        <div class="fleet-ops__count">${props.operations.length} shown</div>
      </div>
      <div class="fleet-ops__list">
        ${props.operations.map((op) => renderOperationRow(op, props))}
      </div>
    </div>
  `;
}

function renderOperationRow(op: FleetOperationUI, props: FleetProps): TemplateResult {
  const rate = operationSuccessRate(op);
  return html`
    <button
      class="fleet-op-row"
      @click=${() => {
        selectOperation(props, op.id);
        props.onChange();
      }}
    >
      <div class="fleet-op-row__lead">
        <span class="fleet-op-row__type">${opTypeLabel(op.type)}</span>
        <span class="fleet-op-row__status fleet-op-row__status--${op.status}">
          ${opStatusLabel(op.status)}
        </span>
      </div>
      <div class="fleet-op-row__meta">
        <span>${op.targetDeviceIds.length} device${op.targetDeviceIds.length === 1 ? "" : "s"}</span>
        <span class="fleet-op-row__divider">·</span>
        <span>${rate.success}/${rate.total} succeeded</span>
        <span class="fleet-op-row__divider">·</span>
        <span>by ${op.initiatedBy}</span>
        <span class="fleet-op-row__divider">·</span>
        <span>${formatRelativeTime(op.initiatedAt)}</span>
      </div>
    </button>
  `;
}

// ── Operation detail slide-out ──────────────────────────────────

function renderOperationDetail(props: FleetProps): TemplateResult {
  const op = props.operations.find((o) => o.id === props.selectedOperationId);
  if (!op) {
    return html`
      <div
        class="modal-backdrop"
        @click=${() => {
          selectOperation(props, null);
          props.onChange();
        }}
      >
        <div class="modal card">
          <div class="modal__body">Operation not found.</div>
        </div>
      </div>
    `;
  }
  const rate = operationSuccessRate(op);
  return html`
    <div
      class="modal-backdrop"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) {
          selectOperation(props, null);
          props.onChange();
        }
      }}
    >
      <div
        class="modal card"
        role="dialog"
        aria-modal="true"
        aria-label="Operation ${op.id}"
      >
        <div class="modal__header">
          <div>
            <h3 class="modal__title">${opTypeLabel(op.type)}</h3>
            <div class="fleet-op-detail__id">${op.id}</div>
          </div>
          <button
            class="modal__close"
            aria-label="Close"
            @click=${() => {
              selectOperation(props, null);
              props.onChange();
            }}
          >
            ×
          </button>
        </div>
        <div class="modal__body">
          <div class="fleet-op-detail__summary">
            <div class="fleet-op-detail__summary-item">
              <span class="fleet-op-detail__summary-label">Status</span>
              <span class="fleet-op-row__status fleet-op-row__status--${op.status}">
                ${opStatusLabel(op.status)}
              </span>
            </div>
            <div class="fleet-op-detail__summary-item">
              <span class="fleet-op-detail__summary-label">Success</span>
              <span class="fleet-op-detail__summary-value">${rate.pct}%</span>
            </div>
            <div class="fleet-op-detail__summary-item">
              <span class="fleet-op-detail__summary-label">Targets</span>
              <span class="fleet-op-detail__summary-value">${op.targetDeviceIds.length}</span>
            </div>
            <div class="fleet-op-detail__summary-item">
              <span class="fleet-op-detail__summary-label">Initiated</span>
              <span class="fleet-op-detail__summary-value">${formatRelativeTime(op.initiatedAt)}</span>
            </div>
          </div>
          <div class="fleet-op-detail__results">
            <div class="fleet-op-detail__results-title">Per-device results</div>
            ${
              op.results.length === 0
                ? html`
                    <div class="fleet-op-detail__empty">No per-device results yet.</div>
                  `
                : html`
                  <div class="fleet-op-detail__results-list">
                    ${op.results.map(
                      (r) => html`
                        <div class="fleet-op-detail__result">
                          <span class="fleet-op-detail__result-status fleet-op-detail__result-status--${r.status}">
                            ${opResultStatusLabel(r.status)}
                          </span>
                          <code class="fleet-op-detail__result-id">${r.deviceId}</code>
                          ${
                            r.detail
                              ? html`<span class="fleet-op-detail__result-detail">${r.detail}</span>`
                              : nothing
                          }
                        </div>
                      `,
                    )}
                  </div>
                `
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Helpers ─────────────────────────────────────────────────────

function opTypeLabel(t: FleetOperationType): string {
  switch (t) {
    case "policy-push":
      return "Policy push";
    case "token-rotate":
      return "Token rotation";
    case "wipe":
      return "Remote wipe";
    case "agent-sync":
      return "Agent sync";
  }
}

function opStatusLabel(s: FleetOperationStatus): string {
  switch (s) {
    case "pending":
      return "Pending";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "partial_failure":
      return "Partial failure";
  }
}

function opResultStatusLabel(s: FleetOperationResultStatus): string {
  switch (s) {
    case "success":
      return "OK";
    case "failure":
      return "FAIL";
    case "skipped":
      return "SKIP";
    case "unreachable":
      return "UNREACHABLE";
  }
}

function capitalize(s: DeviceTrustLevel): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

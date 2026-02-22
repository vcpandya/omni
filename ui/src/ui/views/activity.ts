// ── Visual Security Activity Timeline — Renderer ────────────────

import { html, nothing, type TemplateResult } from "lit";
import type { AuditEventUI, ActivityFilters, ActivityState } from "../controllers/activity.ts";
import { loadActivity, loadMoreActivity, verifyIntegrity, exportActivity, subscribeActivityStream } from "../controllers/activity.ts";
import { icons } from "../icons.ts";

// ── Category Colors ─────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  auth: "#6366f1",
  approval: "#f59e0b",
  config: "#8b5cf6",
  tool: "#ef4444",
  skill: "#10b981",
  sandbox: "#3b82f6",
  device: "#ec4899",
  system: "#6b7280",
};

const ALL_CATEGORIES = ["auth", "approval", "config", "tool", "skill", "sandbox", "device", "system"];
const ALL_SEVERITIES = ["info", "warn", "critical"];

// ── Main Render ─────────────────────────────────────────────────

export type ActivityProps = ActivityState & {
  onRefresh: () => void;
  onLoadMore: () => void;
  onFilterChange: (filters: ActivityFilters) => void;
  onToggleEventExpand: (seq: number) => void;
  onVerify: () => void;
  onExport: (format: "json" | "csv" | "jsonl") => void;
  onToggleStream: () => void;
};

export function renderActivity(props: ActivityProps): TemplateResult {
  return html`
    <div class="activity">
      ${renderActivityHeader(props)}
      ${renderActivityStats(props)}
      ${renderActivityFilters(props)}
      ${props.activityLoading && props.activityEvents.length === 0
        ? html`<div class="activity-loading"><span class="activity-spinner"></span> Loading events…</div>`
        : renderActivityTimeline(props)}
      ${renderActivityFooter(props)}
    </div>
  `;
}

// ── Header ──────────────────────────────────────────────────────

function renderActivityHeader(props: ActivityProps): TemplateResult {
  return html`
    <div class="activity-header">
      <div class="activity-header__left">
        <span class="activity-integrity ${props.activityIntegrityOk === true ? "ok" : props.activityIntegrityOk === false ? "fail" : ""}">
          ${props.activityIntegrityOk === true
            ? html`<span class="statusDot ok"></span> Chain Verified`
            : props.activityIntegrityOk === false
              ? html`<span class="statusDot danger"></span> Chain Compromised`
              : html`<span class="statusDot"></span> Unverified`}
        </span>
        ${props.activityStreaming
          ? html`<span class="activity-streaming"><span class="activity-streaming__dot"></span> Live</span>`
          : nothing}
      </div>
      <div class="activity-header__right">
        <button class="btn btn--sm" @click=${() => props.onToggleStream()}>
          ${props.activityStreaming ? "Stop Stream" : "Start Stream"}
        </button>
        <button class="btn btn--sm" @click=${() => props.onVerify()}>
          ${icons.shield} Verify
        </button>
        <button class="btn btn--sm" @click=${() => props.onExport("json")}>
          Export
        </button>
        <button class="btn btn--sm" @click=${() => props.onRefresh()}>
          Refresh
        </button>
      </div>
    </div>
  `;
}

// ── Stats ───────────────────────────────────────────────────────

function renderActivityStats(props: ActivityProps): TemplateResult {
  return html`
    <div class="activity-stats">
      <div class="activity-stat card">
        <div class="activity-stat__value">${props.activityTotal}</div>
        <div class="activity-stat__label">Total Events</div>
      </div>
      <div class="activity-stat card">
        <div class="activity-stat__value">${props.activityStatsToday}</div>
        <div class="activity-stat__label">Today</div>
      </div>
      <div class="activity-stat card">
        <div class="activity-stat__value activity-stat__value--critical">${props.activityStatsCritical}</div>
        <div class="activity-stat__label">Critical</div>
      </div>
      <div class="activity-stat card">
        <div class="activity-stat__value ${props.activityIntegrityOk === true ? "activity-stat__value--ok" : ""}">
          ${props.activityIntegrityOk === true ? "OK" : props.activityIntegrityOk === false ? "FAIL" : "—"}
        </div>
        <div class="activity-stat__label">Chain Status</div>
      </div>
    </div>
  `;
}

// ── Filters ─────────────────────────────────────────────────────

function renderActivityFilters(props: ActivityProps): TemplateResult {
  const { activityFilters: filters } = props;

  return html`
    <div class="activity-filters">
      <div class="activity-filters__row">
        <span class="activity-filters__label">Category:</span>
        ${ALL_CATEGORIES.map((cat) => {
          const active = filters.categories.has(cat);
          return html`
            <button
              class="chip ${active ? "chip--active" : ""}"
              style="--chip-color: ${CATEGORY_COLORS[cat] ?? "#6b7280"}"
              @click=${() => {
                const next = new Set(filters.categories);
                if (active) next.delete(cat); else next.add(cat);
                props.onFilterChange({ ...filters, categories: next });
              }}
            >${cat}</button>
          `;
        })}
      </div>
      <div class="activity-filters__row">
        <span class="activity-filters__label">Severity:</span>
        ${ALL_SEVERITIES.map((sev) => {
          const active = filters.severities.has(sev);
          return html`
            <button
              class="chip ${active ? "chip--active" : ""} chip--${sev}"
              @click=${() => {
                const next = new Set(filters.severities);
                if (active) next.delete(sev); else next.add(sev);
                props.onFilterChange({ ...filters, severities: next });
              }}
            >${sev}</button>
          `;
        })}
      </div>
      <div class="activity-filters__row">
        <input
          class="activity-search"
          type="text"
          placeholder="Search events…"
          .value=${filters.search}
          @input=${(e: InputEvent) => {
            const target = e.target as HTMLInputElement;
            props.onFilterChange({ ...filters, search: target.value });
          }}
        />
      </div>
    </div>
  `;
}

// ── Timeline ────────────────────────────────────────────────────

function renderActivityTimeline(props: ActivityProps): TemplateResult {
  if (props.activityEvents.length === 0) {
    return html`
      <div class="activity-empty">
        <p>No security events recorded yet.</p>
        <p class="muted">Events will appear here as they occur across the gateway.</p>
      </div>
    `;
  }

  return html`
    <div class="activity-timeline">
      ${props.activityEvents.map((event) => renderActivityEvent(event, props))}
    </div>
  `;
}

function renderActivityEvent(event: AuditEventUI, props: ActivityProps): TemplateResult {
  const time = new Date(event.ts);
  const timeStr = time.toLocaleTimeString();
  const dateStr = time.toLocaleDateString();
  const categoryColor = CATEGORY_COLORS[event.category] ?? "#6b7280";

  return html`
    <div class="activity-event severity-${event.severity} ${event.expanded ? "activity-event--expanded" : ""}">
      <div class="activity-event-dot" style="background: ${event.severity === "critical" ? "var(--danger)" : event.severity === "warn" ? "var(--warn)" : "var(--accent)"}"></div>
      <div class="activity-event-card" @click=${() => props.onToggleEventExpand(event.seq)}>
        <div class="activity-event-header">
          <span class="chip" style="--chip-color: ${categoryColor}">${event.category}</span>
          <span class="activity-event-action">${event.action}</span>
          <span class="activity-event-time">${timeStr} · ${dateStr}</span>
        </div>
        <div class="activity-event-meta">
          <span class="muted">Actor: ${event.actor.actorId}</span>
          ${event.resource ? html`<span class="muted">· Resource: ${event.resource}</span>` : nothing}
          ${event.actor.clientIp ? html`<span class="muted">· IP: ${event.actor.clientIp}</span>` : nothing}
        </div>
        ${event.expanded && event.detail
          ? html`
            <details class="activity-event-detail" open>
              <summary>Detail</summary>
              <pre class="mono">${JSON.stringify(event.detail, null, 2)}</pre>
            </details>
          `
          : nothing}
      </div>
    </div>
  `;
}

// ── Footer ──────────────────────────────────────────────────────

function renderActivityFooter(props: ActivityProps): TemplateResult {
  return html`
    <div class="activity-footer">
      ${props.activityHasMore
        ? html`<button class="btn btn--sm" @click=${() => props.onLoadMore()} ?disabled=${props.activityLoading}>
            ${props.activityLoading ? "Loading…" : "Load More"}
          </button>`
        : html`<span class="muted">All events loaded</span>`}
      ${props.activityStreaming
        ? html`<span class="activity-streaming"><span class="activity-streaming__dot"></span> Streaming live events</span>`
        : nothing}
    </div>
  `;
}

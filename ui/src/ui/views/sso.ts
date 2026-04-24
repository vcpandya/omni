// ── SSO View — status + dry-run attribute mapper ──────────────

import { html, nothing, type TemplateResult } from "lit";
import type { SsoState } from "../controllers/sso.ts";
import { loadSsoStatus, resetSsoTest, runSsoTest, setSsoTestDraft } from "../controllers/sso.ts";

export type SsoProps = SsoState & {
  onChange: () => void;
};

export function renderSso(props: SsoProps): TemplateResult {
  return html`
    <div class="sso">
      ${renderSsoHeader(props)}
      ${
        props.loading && !props.status
          ? html`
              <div class="sso-loading"><span class="activity-spinner"></span> Loading SSO status…</div>
            `
          : html`
            ${renderSsoStatusCard(props)}
            ${renderSsoTestCard(props)}
          `
      }
      ${props.error ? html`<div class="sso-error" role="alert">${props.error}</div>` : nothing}
    </div>
  `;
}

// ── Header ──────────────────────────────────────────────────────

function renderSsoHeader(props: SsoProps): TemplateResult {
  const last = props.lastRefreshAt ? formatRelativeTime(props.lastRefreshAt) : "never";
  return html`
    <div class="sso-header">
      <div class="sso-header__left">
        <h2 class="sso-title">Single Sign-On</h2>
        <span class="sso-header__subtitle">
          Provider status · attribute mapping · dry-run
        </span>
      </div>
      <div class="sso-header__right">
        <span class="sso-stale">Updated ${last}</span>
        <button
          class="btn btn--sm"
          @click=${async () => {
            await loadSsoStatus(props);
            props.onChange();
          }}
        >
          Refresh
        </button>
      </div>
    </div>
  `;
}

// ── Status card ────────────────────────────────────────────────

function renderSsoStatusCard(props: SsoProps): TemplateResult {
  const s = props.status;
  if (!s) {
    return html`
      <div class="sso-status card">
        <div class="sso-status__title">Status</div>
        <div class="sso-status__empty">No status data yet — click Refresh.</div>
      </div>
    `;
  }
  const configured = s.configured && s.type !== "none";
  return html`
    <div class="sso-status card">
      <div class="sso-status__row">
        <div class="sso-status__main">
          <div class="sso-status__badge sso-status__badge--${configured ? "on" : "off"}">
            ${configured ? "Configured" : "Not configured"}
          </div>
          <div class="sso-status__provider">
            ${
              configured
                ? html`<strong>${s.displayName ?? capitalize(s.type)}</strong>
                  <span class="sso-status__protocol">${s.type.toUpperCase()}</span>`
                : html`
                    <span class="sso-status__protocol">No IdP connected</span>
                  `
            }
          </div>
        </div>
        <div class="sso-status__flags">
          <div class="sso-status__flag">
            <span class="sso-status__flag-label">Auto-provision</span>
            <span class="sso-status__flag-value sso-status__flag-value--${s.autoProvision ? "on" : "off"}">
              ${s.autoProvision ? "On" : "Off"}
            </span>
          </div>
          <div class="sso-status__flag">
            <span class="sso-status__flag-label">Enforced</span>
            <span class="sso-status__flag-value sso-status__flag-value--${s.enforced ? "on" : "off"}">
              ${s.enforced ? "Required" : "Optional"}
            </span>
          </div>
        </div>
      </div>
      ${
        !configured
          ? html`
              <div class="sso-status__hint">
                Add a <code>security.enterprise.sso</code> block to your config to enable SAML or OIDC. The
                dry-run below will become active once a provider is configured.
              </div>
            `
          : nothing
      }
    </div>
  `;
}

// ── Dry-run test card ──────────────────────────────────────────

function renderSsoTestCard(props: SsoProps): TemplateResult {
  const result = props.testResult;
  const canTest = Boolean(props.status?.configured);
  return html`
    <div class="sso-test card">
      <div class="sso-test__header">
        <div>
          <div class="sso-test__title">Attribute mapping dry-run</div>
          <div class="sso-test__subtitle">
            Paste IdP attribute JSON and see how Omni would map it — no operator is created.
          </div>
        </div>
        <button
          class="sso-test__reset"
          @click=${() => {
            resetSsoTest(props);
            props.onChange();
          }}
        >
          Reset
        </button>
      </div>
      <textarea
        class="sso-test__editor ${props.testError ? "sso-test__editor--invalid" : ""}"
        spellcheck="false"
        .value=${props.testDraft}
        @input=${(e: Event) => {
          setSsoTestDraft(props, (e.target as HTMLTextAreaElement).value);
          props.onChange();
        }}
      ></textarea>
      ${
        props.testError
          ? html`<div class="sso-test__error" role="alert">${props.testError}</div>`
          : nothing
      }
      <div class="sso-test__actions">
        <button
          class="btn btn--primary"
          ?disabled=${!canTest || props.testing}
          title=${canTest ? "" : "SSO must be configured before dry-run is available"}
          @click=${async () => {
            await runSsoTest(props);
            props.onChange();
          }}
        >
          ${props.testing ? "Running…" : "Run dry-run"}
        </button>
      </div>
      ${result ? renderSsoResult(result) : nothing}
    </div>
  `;
}

function renderSsoResult(result: NonNullable<SsoState["testResult"]>): TemplateResult {
  const mapped = result.mappedAttributes;
  return html`
    <div class="sso-result">
      <div class="sso-result__row">
        <span class="sso-result__label">Validation</span>
        <span
          class="sso-result__pill sso-result__pill--${result.validation.valid ? "ok" : "fail"}"
        >
          ${result.validation.valid ? "VALID" : "INVALID"}
        </span>
        ${
          result.validation.reason
            ? html`<span class="sso-result__reason">${result.validation.reason}</span>`
            : nothing
        }
      </div>
      <div class="sso-result__row">
        <span class="sso-result__label">Would auto-provision</span>
        <span
          class="sso-result__pill sso-result__pill--${result.wouldProvision ? "ok" : "muted"}"
        >
          ${result.wouldProvision ? "YES" : "NO"}
        </span>
      </div>
      <div class="sso-result__row sso-result__row--stack">
        <span class="sso-result__label">Mapped attributes</span>
        <dl class="sso-result__kv">
          <dt>email</dt>
          <dd>${
            mapped.email ??
            html`
              <span class="sso-result__muted">—</span>
            `
          }</dd>
          <dt>displayName</dt>
          <dd>${
            mapped.displayName ??
            html`
              <span class="sso-result__muted">—</span>
            `
          }</dd>
          <dt>groups</dt>
          <dd>
            ${
              mapped.groups && mapped.groups.length > 0
                ? mapped.groups.map((g) => html`<code class="sso-result__chip">${g}</code>`)
                : html`
                    <span class="sso-result__muted">—</span>
                  `
            }
          </dd>
        </dl>
      </div>
    </div>
  `;
}

// ── Helpers ─────────────────────────────────────────────────────

function capitalize(s: string): string {
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

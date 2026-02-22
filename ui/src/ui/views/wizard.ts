import { html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import {
  answerWizardStep,
  cancelWizard,
  estimateSidebarIndex,
  goBackWizard,
  PROVIDER_CARD_META,
  startWizard,
  WIZARD_STEP_DESCRIPTIONS,
  WIZARD_STEP_LABELS,
  type WizardState,
  type WizardStep,
} from "../controllers/wizard.ts";
import { providerIcons } from "../icons.ts";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type WizardProps = WizardState & {
  onboarding: boolean;
};

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderWizard(props: WizardProps): TemplateResult {
  if (!props.wizardActive && !props.wizardLoading) {
    return renderWizardWelcome(props);
  }

  const step = props.wizardStep;
  const sidebarIndex = estimateSidebarIndex(step, props.wizardStepIndex);
  const canBack = props.wizardHistory.length > 0 && !props.wizardLoading;

  return html`
    <div class="wizard">
      ${renderWizardSidebar(sidebarIndex)}
      <div class="wizard-content" .key=${step?.id ?? "loading"}>
        ${props.wizardLoading && !step ? renderWizardLoading() : nothing}
        ${step ? renderWizardStep(step, props) : nothing}
        ${props.wizardError
          ? html`<div class="wizard-note wizard-note--danger" style="margin-top:16px">
              <div class="wizard-note__title">Error</div>
              <div class="wizard-note__body">${props.wizardError}</div>
            </div>`
          : nothing}
      </div>
      <div class="wizard-footer">
        <div class="wizard-footer__left">
          <button
            class="wizard-btn"
            ?disabled=${!canBack}
            @click=${() => goBackWizard(props)}
          >Back</button>
          <button
            class="wizard-btn"
            @click=${() => cancelWizard(props)}
          >Cancel</button>
        </div>
        <div class="wizard-footer__right">
          ${step?.type === "note"
            ? html`<button
                class="wizard-btn wizard-btn--primary"
                ?disabled=${props.wizardLoading}
                @click=${() => answerWizardStep(props, step.id, true)}
              >${props.wizardLoading ? html`<span class="wizard-spinner"></span>` : nothing}
              Continue</button>`
            : nothing}
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function renderWizardSidebar(activeIndex: number): TemplateResult {
  return html`
    <aside class="wizard-sidebar">
      <div class="wizard-sidebar__brand">
        <div class="wizard-sidebar__brand-title">OMNI</div>
        <div class="wizard-sidebar__brand-sub">OpenClaw for Enterprises</div>
      </div>
      <div class="wizard-step-list">
        ${WIZARD_STEP_LABELS.map(
          (label, i) => html`
            <div class="wizard-step-item ${i === activeIndex ? "wizard-step-item--active" : ""} ${i < activeIndex ? "wizard-step-item--completed" : ""}">
              ${i < activeIndex
                ? html`<span class="wizard-step-check" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </span>`
                : html`<span class="wizard-step-dot"></span>`}
              <div>
                <span>${label}</span>
                ${WIZARD_STEP_DESCRIPTIONS[label]
                  ? html`<div class="wizard-step-desc">${WIZARD_STEP_DESCRIPTIONS[label]}</div>`
                  : nothing}
              </div>
            </div>
          `,
        )}
      </div>
    </aside>
  `;
}

// ---------------------------------------------------------------------------
// Welcome page (before wizard session starts)
// ---------------------------------------------------------------------------

function renderWizardWelcome(props: WizardProps): TemplateResult {
  const features = [
    { icon: "layers", title: "Multi-Channel", desc: "Discord, Slack, WhatsApp, Nostr — unified AI" },
    { icon: "shield", title: "Enterprise Security", desc: "OWASP compliance, SOC2/HIPAA profiles" },
    { icon: "brain", title: "30+ AI Providers", desc: "OpenAI, Anthropic, Azure, Bedrock, Vertex" },
    { icon: "clock", title: "Always On", desc: "Daemon service, cron jobs, health monitoring" },
  ] as const;

  return html`
    <div class="wizard">
      ${renderWizardSidebar(-1)}
      <div class="wizard-content">
        <div class="wizard-welcome">
          <div class="wizard-welcome__logo">OMNI</div>
          <div class="wizard-welcome__tagline">
            OpenClaw for Enterprises — Secure, Multi-Channel, Always On
          </div>
          <div class="wizard-features">
            ${features.map(
              (f) => html`
                <div class="wizard-feature-card">
                  <span class="wizard-feature-card__icon icon" aria-hidden="true">
                    ${f.icon === "layers"
                      ? html`<svg viewBox="0 0 24 24"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /><path d="m22.6 16.08-8.58 3.91a2 2 0 0 1-1.66 0l-8.58-3.9" /><path d="m22.6 11.08-8.58 3.91a2 2 0 0 1-1.66 0l-8.58-3.9" /></svg>`
                      : f.icon === "shield"
                        ? html`<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>`
                        : f.icon === "brain"
                          ? html`<svg viewBox="0 0 24 24"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" /></svg>`
                          : html`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>`}
                  </span>
                  <div class="wizard-feature-card__title">${f.title}</div>
                  <div class="wizard-feature-card__desc">${f.desc}</div>
                </div>
              `,
            )}
          </div>
          <button
            class="wizard-btn wizard-btn--primary"
            style="margin-top: 32px"
            ?disabled=${props.wizardLoading}
            @click=${() => startWizard(props)}
          >
            ${props.wizardLoading
              ? html`<span class="wizard-spinner"></span> Starting...`
              : "Get Started"}
          </button>
          ${props.wizardError
            ? html`<div class="wizard-note wizard-note--danger" style="margin-top:24px">
                <div class="wizard-note__body">${props.wizardError}</div>
              </div>`
            : nothing}
        </div>
      </div>
      <div class="wizard-footer">
        <div class="wizard-footer__left"></div>
        <div class="wizard-footer__right"></div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Step dispatcher
// ---------------------------------------------------------------------------

function renderWizardStep(step: WizardStep, props: WizardProps): TemplateResult {
  switch (step.type) {
    case "note":
      return renderNote(step);
    case "select":
      return renderSelect(step, props);
    case "text":
      return renderText(step, props);
    case "confirm":
      return renderConfirm(step, props);
    case "multiselect":
      return renderMultiselect(step, props);
    case "progress":
      return renderProgress(step);
    case "action":
      return renderProgress(step);
    default:
      return html`<div class="wizard-note"><div class="wizard-note__body">Unknown step type: ${step.type}</div></div>`;
  }
}

// ---------------------------------------------------------------------------
// Note
// ---------------------------------------------------------------------------

function renderNote(step: WizardStep): TemplateResult {
  const isWarning = (step.message ?? "").toLowerCase().includes("warning");
  const isDanger = (step.message ?? "").toLowerCase().includes("critical");

  // Check for OWASP metadata for rich rendering
  if (step.metadata?.owaspCoverage) {
    return renderOwaspDashboard(step);
  }

  // Check for review summary metadata
  if (step.metadata?.reviewSummary) {
    return renderReviewDashboard(step);
  }

  return html`
    <div class="wizard-content__title">${step.title ?? "Information"}</div>
    <div class="wizard-note ${isWarning ? "wizard-note--warning" : ""} ${isDanger ? "wizard-note--danger" : ""}">
      ${step.title ? html`<div class="wizard-note__title">${step.title}</div>` : nothing}
      <div class="wizard-note__body">${step.message}</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Select (card-based)
// ---------------------------------------------------------------------------

function renderSelect(step: WizardStep, props: WizardProps): TemplateResult {
  const options = step.options ?? [];
  const isComplianceProfile = (step.message ?? "").toLowerCase().includes("compliance");
  const selected = props.wizardSelectedValue ?? step.initialValue;

  // Detect if this is a provider selection by checking if any option matches PROVIDER_CARD_META
  const isProviderSelect = options.some((opt) => PROVIDER_CARD_META[String(opt.value)]);

  return html`
    <div class="wizard-content__title">${step.title ?? step.message}</div>
    ${step.title && step.message ? html`<div class="wizard-content__subtitle">${step.message}</div>` : nothing}
    ${isProviderSelect
      ? renderProviderSelect(options, selected, step, props)
      : html`
        <div class="${isComplianceProfile ? "compliance-grid" : "wizard-select-grid"}">
          ${options.map((opt) => {
            const isSelected = opt.value === selected;
            if (isComplianceProfile) {
              return renderComplianceCard(opt, isSelected, step, props);
            }
            return html`
              <div
                class="wizard-select-card ${isSelected ? "wizard-select-card--selected" : ""}"
                @click=${() => {
                  props.wizardSelectedValue = opt.value;
                  answerWizardStep(props, step.id, opt.value);
                }}
              >
                <div class="wizard-select-card__label">${opt.label}</div>
                ${opt.hint ? html`<div class="wizard-select-card__hint">${opt.hint}</div>` : nothing}
              </div>
            `;
          })}
        </div>
      `}
  `;
}

function renderComplianceCard(
  opt: { value: unknown; label: string; hint?: string },
  isSelected: boolean,
  step: WizardStep,
  props: WizardProps,
): TemplateResult {
  // Map profile IDs to risk levels for badge styling
  const riskMap: Record<string, string> = {
    "zero-trust": "maximum",
    "soc2-hardened": "high",
    hipaa: "elevated",
    standard: "balanced",
    development: "relaxed",
  };
  const riskLevel = riskMap[String(opt.value)] ?? "balanced";

  return html`
    <div
      class="compliance-card ${isSelected ? "compliance-card--selected" : ""}"
      @click=${() => {
        props.wizardSelectedValue = opt.value;
        answerWizardStep(props, step.id, opt.value);
      }}
    >
      <span class="compliance-card__badge compliance-card__badge--${riskLevel}">
        ${riskLevel}
      </span>
      <div class="compliance-card__title">${opt.label}</div>
      <div class="compliance-card__desc">${opt.hint}</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Text input
// ---------------------------------------------------------------------------

function renderText(step: WizardStep, props: WizardProps): TemplateResult {
  const helperText = step.metadata?.helperText as string | undefined;

  return html`
    <div class="wizard-content__title">${step.title ?? step.message}</div>
    <form @submit=${(e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const input = form.querySelector("input") as HTMLInputElement;
      answerWizardStep(props, step.id, input.value);
    }}>
      <div class="wizard-input-wrapper">
        <input
          class="wizard-input"
          type="${step.sensitive ? "password" : "text"}"
          placeholder="${step.placeholder ?? ""}"
          value="${String(step.initialValue ?? "")}"
          autofocus
          @input=${(e: Event) => {
            const input = e.target as HTMLInputElement;
            const indicator = input.parentElement?.querySelector(".wizard-input-indicator");
            if (indicator) {
              indicator.textContent = input.value.trim() ? "\u2713" : "";
              indicator.className = `wizard-input-indicator ${input.value.trim() ? "wizard-input-indicator--valid" : ""}`;
            }
          }}
        />
        <span class="wizard-input-indicator"></span>
      </div>
      ${helperText ? html`<div class="wizard-input-helper">${helperText}</div>` : nothing}
      <div style="margin-top: 16px">
        <button
          type="submit"
          class="wizard-btn wizard-btn--primary"
          ?disabled=${props.wizardLoading}
        >${props.wizardLoading ? html`<span class="wizard-spinner"></span>` : nothing}
        Continue</button>
      </div>
    </form>
  `;
}

// ---------------------------------------------------------------------------
// Confirm (yes/no)
// ---------------------------------------------------------------------------

function renderConfirm(step: WizardStep, props: WizardProps): TemplateResult {
  return html`
    <div class="wizard-content__title">${step.message}</div>
    <div class="wizard-select-grid" style="margin-top: 20px; grid-template-columns: 1fr 1fr;">
      <div
        class="wizard-select-card ${props.wizardSelectedValue === true ? "wizard-select-card--selected" : ""}"
        @click=${() => {
          props.wizardSelectedValue = true;
          answerWizardStep(props, step.id, true);
        }}
      >
        <div class="wizard-select-card__label">Yes</div>
      </div>
      <div
        class="wizard-select-card ${props.wizardSelectedValue === false ? "wizard-select-card--selected" : ""}"
        @click=${() => {
          props.wizardSelectedValue = false;
          answerWizardStep(props, step.id, false);
        }}
      >
        <div class="wizard-select-card__label">No</div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Multiselect (checkbox list)
// ---------------------------------------------------------------------------

function renderMultiselect(step: WizardStep, props: WizardProps): TemplateResult {
  const options = step.options ?? [];
  const selected = new Set((props.wizardSelectedValue as unknown[] | null) ?? (step.initialValue as unknown[] | null) ?? []);

  return html`
    <div class="wizard-content__title">${step.title ?? step.message}</div>
    <div class="wizard-checkbox-list">
      ${options.map(
        (opt) => html`
          <div
            class="wizard-checkbox-item ${selected.has(opt.value) ? "wizard-checkbox-item--checked" : ""}"
            @click=${() => {
              const next = new Set(selected);
              if (next.has(opt.value)) next.delete(opt.value);
              else next.add(opt.value);
              props.wizardSelectedValue = [...next];
            }}
          >
            <span style="font-size: 16px">${selected.has(opt.value) ? "☑" : "☐"}</span>
            <div>
              <div style="font-weight: 500; color: var(--text)">${opt.label}</div>
              ${opt.hint ? html`<div style="font-size: 12px; color: var(--muted)">${opt.hint}</div>` : nothing}
            </div>
          </div>
        `,
      )}
    </div>
    <div style="margin-top: 16px">
      <button
        class="wizard-btn wizard-btn--primary"
        ?disabled=${props.wizardLoading}
        @click=${() => answerWizardStep(props, step.id, [...selected])}
      >Continue</button>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Progress / loading
// ---------------------------------------------------------------------------

function renderProgress(step: WizardStep): TemplateResult {
  return html`
    <div class="wizard-progress-label">
      <span class="wizard-spinner"></span>
      <span>${step.message ?? "Working..."}</span>
    </div>
  `;
}

function renderWizardLoading(): TemplateResult {
  return html`
    <div class="wizard-progress-label">
      <span class="wizard-spinner"></span>
      <span>Loading...</span>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Provider selection with rich cards and categories
// ---------------------------------------------------------------------------

function renderProviderSelect(
  options: Array<{ value: unknown; label: string; hint?: string }>,
  selected: unknown,
  step: WizardStep,
  props: WizardProps,
): TemplateResult {
  // Group options by category
  const categories = new Map<string, Array<{ value: unknown; label: string; hint?: string }>>();
  for (const opt of options) {
    const meta = PROVIDER_CARD_META[String(opt.value)];
    const category = meta?.category ?? "Other";
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    categories.get(category)!.push(opt);
  }

  // Sort: Enterprise Cloud first, then alphabetically
  const categoryOrder = ["Enterprise Cloud", "API Providers", "Community", "Self-Hosted", "Other"];
  const sortedCategories = [...categories.entries()].sort((a, b) => {
    const ai = categoryOrder.indexOf(a[0]);
    const bi = categoryOrder.indexOf(b[0]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return html`
    ${sortedCategories.map(
      ([category, opts]) => html`
        <div class="provider-category">
          <div class="provider-category__title">${category}</div>
          <div class="provider-card-grid">
            ${opts.map((opt) => renderProviderCard(opt, opt.value === selected, step, props))}
          </div>
        </div>
      `,
    )}
  `;
}

function renderProviderCard(
  opt: { value: unknown; label: string; hint?: string },
  isSelected: boolean,
  step: WizardStep,
  props: WizardProps,
): TemplateResult {
  const meta = PROVIDER_CARD_META[String(opt.value)];
  const iconKey = meta?.icon;
  const iconSvg = iconKey ? providerIcons[iconKey] : undefined;
  const badge = meta?.badge;
  const desc = meta?.description ?? opt.hint;

  return html`
    <div
      class="provider-card ${isSelected ? "provider-card--selected" : ""}"
      @click=${() => {
        props.wizardSelectedValue = opt.value;
        answerWizardStep(props, step.id, opt.value);
      }}
    >
      ${badge
        ? html`<span class="provider-card__badge provider-card__badge--${badge}">${badge}</span>`
        : nothing}
      ${iconSvg
        ? html`<span class="provider-card__icon">${unsafeHTML(iconSvg)}</span>`
        : nothing}
      <div class="provider-card__label">${opt.label}</div>
      ${desc ? html`<div class="provider-card__desc">${desc}</div>` : nothing}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Review dashboard (rendered from reviewSummary metadata)
// ---------------------------------------------------------------------------

function renderReviewDashboard(step: WizardStep): TemplateResult {
  const summary = step.metadata?.reviewSummary as Record<string, unknown> | undefined;
  if (!summary) return renderNote(step);

  const cards: Array<{ title: string; rows: Array<{ label: string; value: string }> }> = [
    {
      title: "AI Provider",
      rows: [
        { label: "Provider", value: String(summary.provider ?? "—") },
        { label: "Model", value: String(summary.model ?? "—") },
      ],
    },
    {
      title: "Gateway",
      rows: [
        { label: "Port", value: String(summary.gatewayPort ?? "—") },
        { label: "Bind", value: String(summary.gatewayBind ?? "—") },
        { label: "Auth", value: String(summary.gatewayAuth ?? "—") },
      ],
    },
    {
      title: "Security",
      rows: [{ label: "Profile", value: String(summary.securityProfile ?? "standard") }],
    },
    {
      title: "Workspace",
      rows: [{ label: "Directory", value: String(summary.workspace ?? "—") }],
    },
  ];

  return html`
    <div class="wizard-content__title">${step.title ?? "Configuration Review"}</div>
    ${step.message
      ? html`<div class="wizard-content__subtitle">${step.message}</div>`
      : nothing}
    <div class="review-grid">
      ${cards.map(
        (card) => html`
          <div class="review-card">
            <div class="review-card__title">${card.title}</div>
            ${card.rows.map(
              (row) => html`
                <div class="review-card__row">
                  <span class="review-card__label">${row.label}</span>
                  <span class="review-card__value">${row.value}</span>
                </div>
              `,
            )}
          </div>
        `,
      )}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// OWASP Dashboard (rendered from metadata)
// ---------------------------------------------------------------------------

function renderOwaspDashboard(step: WizardStep): TemplateResult {
  const coverage = step.metadata?.owaspCoverage as Record<string, string> | undefined;
  if (!coverage) return renderNote(step);

  const llmRisks = Object.entries(coverage).filter(([id]) => id.startsWith("LLM"));
  const agRisks = Object.entries(coverage).filter(([id]) => id.startsWith("AG"));

  const greenCount = Object.values(coverage).filter((s) => s === "green").length;
  const total = Object.keys(coverage).length;

  return html`
    <div class="wizard-content__title">${step.title ?? "OWASP Compliance"}</div>
    <div class="owasp-dashboard">
      <div class="owasp-dashboard__header">
        <div class="owasp-dashboard__score">${greenCount}/${total}</div>
        <div class="owasp-dashboard__score-label">risks mitigated</div>
      </div>
      <div class="owasp-columns">
        <div>
          <div class="owasp-column__title">LLM Top 10 (2025)</div>
          ${llmRisks.map(([id, status]) => renderOwaspItem(id, status))}
        </div>
        <div>
          <div class="owasp-column__title">Agentic Top 10 (2026)</div>
          ${agRisks.map(([id, status]) => renderOwaspItem(id, status))}
        </div>
      </div>
    </div>
    ${step.message
      ? html`<div class="wizard-note" style="margin-top: 20px">
          <div class="wizard-note__body">${step.message}</div>
        </div>`
      : nothing}
  `;
}

function renderOwaspItem(id: string, status: string): TemplateResult {
  const names: Record<string, string> = {
    LLM01: "Prompt Injection",
    LLM02: "Sensitive Info Disclosure",
    LLM03: "Supply Chain",
    LLM04: "Data Poisoning",
    LLM05: "Insecure Output Handling",
    LLM06: "Excessive Agency",
    LLM07: "System Prompt Leakage",
    LLM08: "Vector & Embedding",
    LLM09: "Misinformation",
    LLM10: "Unbounded Consumption",
    AG01: "Goal Hijacking",
    AG02: "Tool Misuse",
    AG03: "Data Leakage",
    AG04: "Knowledge Poisoning",
    AG05: "Resource Exhaustion",
    AG06: "Rogue Agent",
    AG07: "Cascading Failures",
    AG08: "Insufficient Access",
    AG09: "Inadequate Audit",
    AG10: "Insecure Credentials",
  };

  return html`
    <div class="owasp-item">
      <span class="risk-dot risk-dot--${status}"></span>
      <div>
        <span class="owasp-item__id">${id}</span>
        <span class="owasp-item__name">${names[id] ?? id}</span>
      </div>
    </div>
  `;
}

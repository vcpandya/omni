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
        ${
          props.wizardError
            ? html`<div class="wizard-note wizard-note--danger" style="margin-top:16px">
              <div class="wizard-note__title">Error</div>
              <div class="wizard-note__body">${props.wizardError}</div>
            </div>`
            : nothing
        }
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
          ${
            step?.type === "note"
              ? html`<button
                class="wizard-btn wizard-btn--primary"
                ?disabled=${props.wizardLoading}
                @click=${() => answerWizardStep(props, step.id, true)}
              >${
                props.wizardLoading
                  ? html`
                      <span class="wizard-spinner"></span> Continue
                    `
                  : html`
                      Continue <span class="wizard-btn__kbd" aria-hidden="true">⏎</span>
                    `
              }</button>`
              : nothing
          }
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function renderWizardSidebar(activeIndex: number): TemplateResult {
  // Numeric pips (01, 02, …) double as a progress marker and a compact id —
  // no need for separate dot + check SVGs when the pip itself renders the state.
  return html`
    <aside class="wizard-sidebar">
      <div class="wizard-sidebar__brand">
        <div class="wizard-sidebar__brand-title">OMNI</div>
        <div class="wizard-sidebar__brand-sub">OpenClaw · Enterprise</div>
      </div>
      <div class="wizard-step-list" role="list">
        ${WIZARD_STEP_LABELS.map((label, i) => {
          const isActive = i === activeIndex;
          const isCompleted = i < activeIndex;
          const stateClass = isActive
            ? "wizard-step-item--active"
            : isCompleted
              ? "wizard-step-item--completed"
              : "";
          return html`
            <div
              class="wizard-step-item ${stateClass}"
              role="listitem"
              aria-current=${isActive ? "step" : nothing}
            >
              <span class="wizard-step-pip" aria-hidden="true">
                ${
                  isCompleted
                    ? html`
                        <svg viewBox="0 0 24 24" width="12" height="12">
                          <path
                            d="M20 6 9 17l-5-5"
                            stroke="currentColor"
                            stroke-width="3"
                            fill="none"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          />
                        </svg>
                      `
                    : String(i + 1).padStart(2, "0")
                }
              </span>
              <div>
                <span>${label}</span>
                ${
                  WIZARD_STEP_DESCRIPTIONS[label]
                    ? html`<div class="wizard-step-desc">${WIZARD_STEP_DESCRIPTIONS[label]}</div>`
                    : nothing
                }
              </div>
            </div>
          `;
        })}
      </div>
    </aside>
  `;
}

// ---------------------------------------------------------------------------
// Welcome page (before wizard session starts)
// ---------------------------------------------------------------------------

function renderWizardWelcome(props: WizardProps): TemplateResult {
  // Proof-strip: signal concrete enterprise-grade capabilities up-front.
  // Each slot is a stat, not a feature description — buyers scan these in <2s.
  const stats = [
    {
      eyebrow: "Providers",
      value: "30+",
      title: "Multi-Cloud AI",
      desc: "Azure OpenAI, Bedrock, Vertex AI, plus API & self-hosted",
      icon: "brain",
    },
    {
      eyebrow: "Compliance",
      value: "SOC2 / HIPAA",
      title: "Ready on day one",
      desc: "Zero-Trust, SOC2-Hardened, HIPAA profiles with audit trail",
      icon: "shield",
    },
    {
      eyebrow: "OWASP",
      value: "20 / 20",
      title: "LLM + Agentic risks",
      desc: "OWASP LLM Top 10 (2025) + Agentic Top 10 (2026), fully mapped",
      icon: "check",
    },
    {
      eyebrow: "Setup",
      value: "< 2 min",
      title: "Frictionless onboarding",
      desc: "Profile-driven config, SSO provisioning, fleet sync",
      icon: "clock",
    },
  ] as const;

  return html`
    <div class="wizard">
      ${renderWizardSidebar(-1)}
      <div class="wizard-content">
        <div class="wizard-welcome">
          <div class="wizard-welcome__eyebrow">
            <span class="wizard-welcome__eyebrow-dot" aria-hidden="true"></span>
            Enterprise control plane · v1.0
          </div>
          <div class="wizard-welcome__logo">OMNI</div>
          <div class="wizard-welcome__tagline">
            The <strong>enterprise-hardened</strong> build of OpenClaw — secure
            by default, auditable by design, deployable across your fleet.
          </div>

          <div class="wizard-features" role="list" aria-label="Enterprise proof points">
            ${stats.map(
              (s) => html`
                <div class="wizard-feature-card" role="listitem">
                  <div class="wizard-feature-card__eyebrow">
                    <span class="wizard-feature-card__eyebrow-icon" aria-hidden="true">
                      ${
                        s.icon === "shield"
                          ? html`
                              <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                            `
                          : s.icon === "brain"
                            ? html`
                                <svg viewBox="0 0 24 24">
                                  <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
                                  <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
                                </svg>
                              `
                            : s.icon === "clock"
                              ? html`
                                  <svg viewBox="0 0 24 24">
                                    <circle cx="12" cy="12" r="10" />
                                    <polyline points="12 6 12 12 16 14" />
                                  </svg>
                                `
                              : html`
                                  <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                                `
                      }
                    </span>
                    ${s.eyebrow}
                  </div>
                  <div class="wizard-feature-card__value">${s.value}</div>
                  <div class="wizard-feature-card__title">${s.title}</div>
                  <div class="wizard-feature-card__desc">${s.desc}</div>
                </div>
              `,
            )}
          </div>

          <button
            class="wizard-btn wizard-btn--primary"
            style="margin-top: 40px"
            ?disabled=${props.wizardLoading}
            @click=${() => startWizard(props)}
          >
            ${
              props.wizardLoading
                ? html`
                    <span class="wizard-spinner"></span> Starting...
                  `
                : html`
                    Get started <span class="wizard-btn__kbd" aria-hidden="true">⏎</span>
                  `
            }
          </button>
          ${
            props.wizardError
              ? html`<div class="wizard-note wizard-note--danger" style="margin-top:24px">
                <div class="wizard-note__body">${props.wizardError}</div>
              </div>`
              : nothing
          }
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
    ${
      isProviderSelect
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
      `
    }
  `;
}

function renderComplianceCard(
  opt: { value: unknown; label: string; hint?: string },
  isSelected: boolean,
  step: WizardStep,
  props: WizardProps,
): TemplateResult {
  // Map profile IDs to risk levels for badge styling + visual accent stripe.
  const riskMap: Record<string, string> = {
    "zero-trust": "maximum",
    "soc2-hardened": "high",
    hipaa: "elevated",
    standard: "balanced",
    development: "relaxed",
  };
  const key = String(opt.value);
  const riskLevel = riskMap[key] ?? "balanced";
  const isRecommended = key === "soc2-hardened";

  // Capability matrix — each axis is 1..4 ticks, filled proportional to strictness.
  // This surfaces the trust ladder at a glance, so operators can compare profiles
  // without reading long descriptions.
  const CAP_MATRIX: Record<string, { sandbox: number; auth: number; log: number; tool: number }> = {
    "zero-trust": { sandbox: 4, auth: 4, log: 4, tool: 4 },
    "soc2-hardened": { sandbox: 3, auth: 3, log: 4, tool: 3 },
    hipaa: { sandbox: 4, auth: 4, log: 4, tool: 3 },
    standard: { sandbox: 2, auth: 2, log: 2, tool: 2 },
    development: { sandbox: 1, auth: 1, log: 1, tool: 1 },
  };
  const caps = CAP_MATRIX[key] ?? { sandbox: 2, auth: 2, log: 2, tool: 2 };

  const renderTicks = (filled: number) => html`
    <span class="compliance-card__matrix-strength" aria-label="Level ${filled} of 4">
      ${[1, 2, 3, 4].map(
        (n) =>
          html`<span class="compliance-card__matrix-tick ${n <= filled ? "compliance-card__matrix-tick--on" : ""}"></span>`,
      )}
    </span>
  `;

  return html`
    <div
      class="compliance-card ${isSelected ? "compliance-card--selected" : ""} ${isRecommended ? "compliance-card--recommended" : ""}"
      data-risk=${riskLevel}
      tabindex="0"
      role="button"
      aria-pressed=${isSelected}
      @keydown=${(e: KeyboardEvent) => {
        // Space must preventDefault to stop page scroll; assistive tech + browsers
        // auto-synthesize click on Enter for role="button" + tabindex="0", so we
        // deliberately leave Enter to the @click handler to avoid double-firing.
        if (e.key === " ") {
          e.preventDefault();
          props.wizardSelectedValue = opt.value;
          answerWizardStep(props, step.id, opt.value);
        }
      }}
      @click=${() => {
        props.wizardSelectedValue = opt.value;
        answerWizardStep(props, step.id, opt.value);
      }}
    >
      ${
        isRecommended
          ? html`
              <span class="compliance-card__recommended-pill" aria-label="Recommended">Recommended</span>
            `
          : nothing
      }
      <span class="compliance-card__badge compliance-card__badge--${riskLevel}">
        ${riskLevel}
      </span>
      <div class="compliance-card__title">${opt.label}</div>
      <div class="compliance-card__desc">${opt.hint}</div>
      <div class="compliance-card__matrix" aria-label="Capability posture">
        <div class="compliance-card__matrix-row">
          <span class="compliance-card__matrix-label">Sandbox</span>
          ${renderTicks(caps.sandbox)}
        </div>
        <div class="compliance-card__matrix-row">
          <span class="compliance-card__matrix-label">Auth</span>
          ${renderTicks(caps.auth)}
        </div>
        <div class="compliance-card__matrix-row">
          <span class="compliance-card__matrix-label">Logging</span>
          ${renderTicks(caps.log)}
        </div>
        <div class="compliance-card__matrix-row">
          <span class="compliance-card__matrix-label">Tool safety</span>
          ${renderTicks(caps.tool)}
        </div>
      </div>
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
        >${
          props.wizardLoading
            ? html`
                <span class="wizard-spinner"></span>
              `
            : nothing
        }
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
  const selected = new Set(
    (props.wizardSelectedValue as unknown[] | null) ??
      (step.initialValue as unknown[] | null) ??
      [],
  );

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
      ${
        badge
          ? html`<span class="provider-card__badge provider-card__badge--${badge}">${badge}</span>`
          : nothing
      }
      ${iconSvg ? html`<span class="provider-card__icon">${unsafeHTML(iconSvg)}</span>` : nothing}
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
    ${step.message ? html`<div class="wizard-content__subtitle">${step.message}</div>` : nothing}
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
        <div class="owasp-dashboard__score">
          ${greenCount}<small>/${total}</small>
        </div>
        <div class="owasp-dashboard__score-label">Risks mitigated · OWASP 2025/2026</div>
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
    ${
      step.message
        ? html`<div class="wizard-note" style="margin-top: 20px">
          <div class="wizard-note__body">${step.message}</div>
        </div>`
        : nothing
    }
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

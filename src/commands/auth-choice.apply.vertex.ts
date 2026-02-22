import { resolveEnvApiKey } from "../agents/model-auth.js";
import { applyAuthProfileConfig } from "./onboard-auth.config-core.js";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyPrimaryModel } from "./model-picker.js";

const VERTEX_LOCATIONS = [
  { value: "us-central1", label: "US Central (Iowa)" },
  { value: "us-east4", label: "US East (N. Virginia)" },
  { value: "europe-west4", label: "Europe West (Netherlands)" },
  { value: "europe-west1", label: "Europe West (Belgium)" },
  { value: "asia-southeast1", label: "Asia Southeast (Singapore)" },
  { value: "asia-northeast1", label: "Asia Northeast (Tokyo)" },
] as const;

const VERTEX_DEFAULT_MODEL = "gemini-2.5-pro";

export async function applyAuthChoiceVertex(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "vertex-gcloud") {
    return null;
  }

  const { prompter } = params;
  let nextConfig = params.config;

  await prompter.note(
    [
      "Google Vertex AI setup:",
      "",
      "1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install",
      "2. Run: gcloud auth application-default login",
      "3. Enable the Vertex AI API in your GCP project",
    ].join("\n"),
    "Google Vertex AI",
  );

  // --- Check for existing ADC ---
  const existingAdc = resolveEnvApiKey("google-vertex");
  if (existingAdc) {
    await prompter.note(
      `Found existing credentials: ${existingAdc.source}`,
      "Vertex AI Credentials",
    );
  } else {
    await prompter.note(
      [
        "No Application Default Credentials (ADC) found.",
        "",
        "Run the following command to authenticate:",
        "  gcloud auth application-default login",
        "",
        "Then restart the onboarding wizard.",
      ].join("\n"),
      "Authentication Required",
    );
  }

  // --- GCP Project ID ---
  const projectId = await prompter.text({
    message: "GCP Project ID",
    placeholder: "my-gcp-project",
    validate: (val) => (val.trim() ? undefined : "Project ID is required"),
  });

  // --- Vertex location ---
  const location = await prompter.select({
    message: "Vertex AI location",
    options: VERTEX_LOCATIONS.map((l) => ({
      value: l.value,
      label: `${l.value} — ${l.label}`,
    })),
    initialValue: "us-central1",
  });

  // Build the Vertex AI base URL
  const baseUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId.trim()}/locations/${location}/publishers/google`;

  // Apply auth profile config
  nextConfig = applyAuthProfileConfig(nextConfig, {
    profileId: "google-vertex:default",
    provider: "google-vertex",
    mode: "api_key", // ADC resolved at runtime
  });

  // Configure the vertex provider
  const providers = nextConfig.models?.providers ?? {};
  nextConfig = {
    ...nextConfig,
    models: {
      ...nextConfig.models,
      mode: nextConfig.models?.mode ?? "merge",
      providers: {
        ...providers,
        "google-vertex": {
          ...providers["google-vertex"],
          baseUrl,
          api: "openai-completions",
          models: [
            {
              id: VERTEX_DEFAULT_MODEL,
              name: "Gemini 2.5 Pro (Vertex AI)",
              contextWindow: 1048576,
              maxTokens: 65536,
              input: ["text", "image"] as ("text" | "image")[],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              reasoning: true,
            },
          ],
        },
      },
    },
  };

  // Set primary model
  const modelRef = `google-vertex/${VERTEX_DEFAULT_MODEL}`;
  nextConfig = applyPrimaryModel(nextConfig, modelRef);

  return { config: nextConfig };
}

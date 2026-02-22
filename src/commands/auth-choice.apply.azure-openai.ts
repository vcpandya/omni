import { resolveEnvApiKey } from "../agents/model-auth.js";
import { formatApiKeyPreview, normalizeApiKeyInput } from "./auth-choice.api-key.js";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyCustomApiConfig } from "./onboard-custom.js";

export async function applyAuthChoiceAzureOpenAI(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "azure-openai") {
    return null;
  }

  const { prompter } = params;
  let nextConfig = params.config;

  await prompter.note(
    [
      "Azure OpenAI / Azure AI Foundry setup:",
      "",
      "1. Azure portal → your OpenAI resource → Keys and Endpoint",
      "2. Copy the Endpoint URL (e.g. https://<resource>.openai.azure.com)",
      "3. Copy an API key (Key 1 or Key 2)",
      "4. Note your deployment name (the model deployment ID)",
    ].join("\n"),
    "Azure OpenAI",
  );

  // --- Endpoint URL ---
  const optsEndpoint = params.opts?.azureEndpoint?.trim();
  const endpoint =
    optsEndpoint ||
    (await prompter.text({
      message: "Azure endpoint URL",
      placeholder: "https://<resource>.openai.azure.com",
      validate: (val) => {
        try {
          const url = new URL(val);
          const host = url.hostname.toLowerCase();
          if (
            host.endsWith(".openai.azure.com") ||
            host.endsWith(".services.ai.azure.com")
          ) {
            return undefined;
          }
          return "Expected an Azure OpenAI endpoint (*.openai.azure.com or *.services.ai.azure.com)";
        } catch {
          return "Please enter a valid URL";
        }
      },
    }));

  // --- API Key ---
  let apiKey = params.opts?.azureApiKey?.trim() || "";
  if (!apiKey) {
    const envKey = resolveEnvApiKey("openai");
    if (envKey) {
      const useExisting = await prompter.confirm({
        message: `Use existing AZURE_OPENAI_API_KEY / OPENAI_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        apiKey = envKey.apiKey;
      }
    }
  }
  if (!apiKey) {
    const envAzure = process.env.AZURE_OPENAI_API_KEY?.trim();
    if (envAzure) {
      const useExisting = await prompter.confirm({
        message: `Use existing AZURE_OPENAI_API_KEY (${formatApiKeyPreview(envAzure)})?`,
        initialValue: true,
      });
      if (useExisting) {
        apiKey = envAzure;
      }
    }
  }
  if (!apiKey) {
    apiKey = normalizeApiKeyInput(
      await prompter.text({
        message: "Azure API key",
        validate: (val) => (val.trim() ? undefined : "API key is required"),
      }),
    );
  }

  // --- Deployment name ---
  const optsDeployment = params.opts?.azureDeploymentName?.trim();
  const deploymentName =
    optsDeployment ||
    (await prompter.text({
      message: "Deployment name (model deployment ID)",
      placeholder: "e.g. gpt-4o, gpt-4o-mini",
      validate: (val) => (val.trim() ? undefined : "Deployment name is required"),
    }));

  // Apply via the custom API config path (Azure URLs are detected and transformed)
  const result = applyCustomApiConfig({
    config: nextConfig,
    baseUrl: endpoint.trim(),
    modelId: deploymentName.trim(),
    compatibility: "openai",
    apiKey,
    providerId: "azure-openai",
  });
  nextConfig = result.config;

  return { config: nextConfig };
}

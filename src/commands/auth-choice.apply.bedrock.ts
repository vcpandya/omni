import { discoverBedrockModels } from "../agents/bedrock-discovery.js";
import { resolveAwsSdkEnvVarName } from "../agents/model-auth.js";
import { applyAuthProfileConfig } from "./onboard-auth.config-core.js";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyPrimaryModel } from "./model-picker.js";

const BEDROCK_REGIONS = [
  { value: "us-east-1", label: "US East (N. Virginia)" },
  { value: "us-west-2", label: "US West (Oregon)" },
  { value: "eu-west-1", label: "EU West (Ireland)" },
  { value: "eu-central-1", label: "EU Central (Frankfurt)" },
  { value: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
] as const;

const BEDROCK_PROVIDER_FILTERS = [
  { value: "", label: "All providers" },
  { value: "Anthropic", label: "Anthropic (Claude)" },
  { value: "Meta", label: "Meta (Llama)" },
  { value: "Mistral AI", label: "Mistral" },
  { value: "Amazon", label: "Amazon (Titan / Nova)" },
] as const;

export async function applyAuthChoiceBedrock(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "bedrock-aws") {
    return null;
  }

  const { prompter } = params;
  let nextConfig = params.config;

  await prompter.note(
    [
      "AWS Bedrock setup:",
      "",
      "1. AWS Console → Amazon Bedrock → Model access",
      "2. Request access to the models you want to use",
      "3. Ensure you have valid AWS credentials (profile, access key, or SSO)",
    ].join("\n"),
    "AWS Bedrock",
  );

  // --- Region ---
  const optsRegion = params.opts?.bedrockRegion?.trim();
  const region =
    optsRegion ||
    (await prompter.select({
      message: "AWS region",
      options: BEDROCK_REGIONS.map((r) => ({ value: r.value, label: `${r.value} — ${r.label}` })),
      initialValue: "us-east-1",
    }));

  // --- AWS credentials check ---
  const existingEnvVar = resolveAwsSdkEnvVarName();
  if (existingEnvVar) {
    await prompter.note(
      `Found AWS credentials: ${existingEnvVar}`,
      "AWS Credentials",
    );
  } else {
    const authMode = await prompter.select({
      message: "AWS authentication method",
      options: [
        { value: "profile", label: "AWS Profile", hint: "Named profile from ~/.aws/credentials" },
        { value: "access-key", label: "Access Key", hint: "AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY" },
      ],
    });

    if (authMode === "profile") {
      const profile = await prompter.text({
        message: "AWS profile name",
        placeholder: "default",
        initialValue: "default",
      });
      process.env.AWS_PROFILE = profile.trim();
    } else {
      const accessKey = await prompter.text({
        message: "AWS Access Key ID",
        validate: (val) => (val.trim() ? undefined : "Access Key ID is required"),
      });
      const secretKey = await prompter.text({
        message: "AWS Secret Access Key",
        validate: (val) => (val.trim() ? undefined : "Secret Access Key is required"),
      });
      process.env.AWS_ACCESS_KEY_ID = accessKey.trim();
      process.env.AWS_SECRET_ACCESS_KEY = secretKey.trim();
    }
  }

  // --- Provider filter ---
  const optsFilter = params.opts?.bedrockProviderFilter?.trim();
  const providerFilter =
    optsFilter ||
    (await prompter.select({
      message: "Filter by provider",
      options: BEDROCK_PROVIDER_FILTERS.map((f) => ({
        value: f.value,
        label: f.label,
      })),
    }));

  // --- Model discovery ---
  const progressSpinner = prompter.progress("Discovering Bedrock models...");
  let models;
  try {
    models = await discoverBedrockModels({
      region,
      config: {
        providerFilter: providerFilter ? [providerFilter] : undefined,
      },
    });
    progressSpinner.stop(`Found ${models.length} model(s).`);
  } catch (err) {
    progressSpinner.stop("Model discovery failed.");
    await prompter.note(
      `Could not discover models: ${err instanceof Error ? err.message : String(err)}\n\nCheck your AWS credentials and region, and ensure Bedrock model access is enabled.`,
      "Bedrock Discovery",
    );
    return { config: nextConfig };
  }

  if (models.length === 0) {
    await prompter.note(
      "No models found. Ensure model access is enabled in the AWS Bedrock console for the selected region.",
      "Bedrock",
    );
    return { config: nextConfig };
  }

  // Apply auth profile and provider config
  nextConfig = applyAuthProfileConfig(nextConfig, {
    profileId: "amazon-bedrock:default",
    provider: "amazon-bedrock",
    mode: "api_key", // aws-sdk mode is resolved at runtime
  });

  // Configure the bedrock provider with discovered models
  const providers = nextConfig.models?.providers ?? {};
  nextConfig = {
    ...nextConfig,
    models: {
      ...nextConfig.models,
      mode: nextConfig.models?.mode ?? "merge",
      bedrockDiscovery: {
        enabled: true,
        region,
        ...(providerFilter ? { providerFilter: [providerFilter] } : {}),
      },
      providers: {
        ...providers,
        "amazon-bedrock": {
          ...providers["amazon-bedrock"],
          baseUrl: `https://bedrock-runtime.${region}.amazonaws.com`,
          auth: "aws-sdk",
          models: models.slice(0, 20), // Cap at 20 for initial config
        },
      },
    },
  };

  // Set first discovered model as primary
  if (models.length > 0 && models[0]?.id) {
    const modelRef = `amazon-bedrock/${models[0].id}`;
    nextConfig = applyPrimaryModel(nextConfig, modelRef);
  }

  return { config: nextConfig };
}

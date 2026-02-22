---
summary: "Enterprise AI provider onboarding: Azure OpenAI, AWS Bedrock, Google Vertex AI"
read_when:
  - Setting up enterprise cloud AI providers
  - Configuring Azure OpenAI, Bedrock, or Vertex AI
  - Choosing between API providers and enterprise cloud
title: "Enterprise AI Providers"
sidebarTitle: "Enterprise Providers"
---

# Enterprise AI Providers

OpenClaw supports three enterprise cloud AI providers as first-class options during
onboarding. These are presented at the top of the provider selection screen with
an **enterprise** badge.

| Provider | Auth Method | Model Discovery |
|----------|------------|-----------------|
| Azure OpenAI | Endpoint URL + API key + deployment name | Manual |
| AWS Bedrock | AWS credentials (profile or access key) + region | Automatic |
| Google Vertex AI | gcloud Application Default Credentials | Manual |

## Azure OpenAI

Azure OpenAI Service (including Azure AI Foundry) provides enterprise-grade access
to OpenAI models with data residency guarantees and private endpoints.

### Prerequisites

- An Azure OpenAI resource deployed in your Azure subscription
- An API key from the Azure portal (Keys and Endpoint blade)
- A deployed model (deployment name)

### Wizard flow

1. Enter your Azure endpoint URL (e.g. `https://myresource.openai.azure.com`)
2. Enter your API key (auto-detected from `AZURE_OPENAI_API_KEY` if set)
3. Enter your deployment name (the model deployment ID, not the model name)

### Non-interactive setup

```bash
openclaw onboard --non-interactive \
  --mode local \
  --auth-choice azure-openai \
  --azure-endpoint "https://myresource.openai.azure.com" \
  --azure-api-key "$AZURE_OPENAI_API_KEY" \
  --azure-deployment-name "gpt-4o-deployment" \
  --gateway-port 18789 \
  --gateway-bind loopback
```

### Config output

```json
{
  "models": {
    "providers": {
      "azure-openai": {
        "baseUrl": "https://myresource.openai.azure.com/openai/deployments/gpt-4o-deployment",
        "apiKey": "...",
        "api": "openai-completions",
        "models": [{ "id": "gpt-4o-deployment", "name": "Azure OpenAI" }]
      }
    }
  }
}
```

<Tip>
Azure endpoint URLs are automatically normalized. Both
`https://myresource.openai.azure.com` and
`https://myresource.openai.azure.com/openai` are accepted.
</Tip>

## AWS Bedrock

Amazon Bedrock provides managed access to foundation models from Anthropic, Meta,
Mistral, Amazon, and others with IAM-based access control.

### Prerequisites

- AWS credentials configured (profile, access key, or IAM role)
- Model access enabled in the AWS Bedrock console for your region
- A supported region (us-east-1, us-west-2, eu-west-1, etc.)

### Wizard flow

1. Select your AWS region
2. Configure authentication:
   - **AWS Profile** — uses `~/.aws/credentials` (default profile or named)
   - **Access Key** — enter `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
   - **Auto-detect** — uses existing environment variables or IAM role
3. Optionally filter by provider (Anthropic, Meta, Mistral, Amazon, or All)
4. Automatic model discovery scans available models in the selected region

### Non-interactive setup

```bash
openclaw onboard --non-interactive \
  --mode local \
  --auth-choice bedrock-aws \
  --bedrock-region us-east-1 \
  --gateway-port 18789 \
  --gateway-bind loopback
```

Ensure `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (or `AWS_PROFILE`) are set
in the environment.

### Config output

```json
{
  "models": {
    "bedrockDiscovery": {
      "enabled": true,
      "region": "us-east-1",
      "providerFilter": ["anthropic"],
      "refreshInterval": 3600
    },
    "providers": {
      "amazon-bedrock": {
        "baseUrl": "https://bedrock-runtime.us-east-1.amazonaws.com",
        "auth": "aws-sdk",
        "api": "bedrock-converse-stream",
        "models": []
      }
    }
  }
}
```

<Note>
Bedrock models are discovered at startup and refreshed periodically. The
`models` array in the provider config may be empty after onboarding; models
populate once the gateway starts and runs discovery.
</Note>

## Google Vertex AI

Vertex AI provides access to Gemini and other Google models through your GCP
project with IAM-based authentication.

### Prerequisites

- A GCP project with the Vertex AI API enabled
- `gcloud` CLI installed and authenticated
- Application Default Credentials configured:
  ```bash
  gcloud auth application-default login
  ```

### Wizard flow

1. Check for existing Application Default Credentials
2. If not found, guidance to run `gcloud auth application-default login`
3. Enter your GCP Project ID
4. Select your Vertex AI location (us-central1, europe-west4, etc.)

### Non-interactive setup

Ensure Application Default Credentials are configured, then:

```bash
openclaw onboard --non-interactive \
  --mode local \
  --auth-choice vertex-gcloud \
  --gateway-port 18789 \
  --gateway-bind loopback
```

### Config output

```json
{
  "models": {
    "providers": {
      "google-vertex": {
        "baseUrl": "https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1",
        "auth": "oauth",
        "api": "google-generative-ai",
        "models": [{ "id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro" }]
      }
    }
  }
}
```

## Choosing between providers

| Consideration | Azure OpenAI | AWS Bedrock | Vertex AI |
|--------------|-------------|-------------|-----------|
| **Auth model** | API key | IAM / SDK | ADC / OAuth |
| **Multi-model** | Single deployment | 50+ models | Gemini family |
| **Data residency** | Per-region | Per-region | Per-region |
| **VPC integration** | Private endpoint | VPC endpoint | VPC Service Controls |
| **Cost model** | Per-token | Per-token | Per-token |
| **Model discovery** | Manual | Automatic | Manual |

## Related docs

- [Onboarding Wizard (CLI)](/start/wizard)
- [CLI Automation](/start/wizard-cli-automation)
- [Custom Provider](/start/onboarding-overview#custom-provider)

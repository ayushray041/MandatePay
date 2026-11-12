export type AiAction =
  | 'negotiation_recommendation'
  | 'offer_comparison'
  | 'negotiation_summary'
  | 'negotiation_analysis'
  | 'contract_analysis';

export type AiGenerationInput = {
  action: AiAction;
  systemInstruction: string;
  untrustedContext: unknown;
};

export type AiProviderMetadata = {
  providerId: string;
  modelVersion: string;
};

export type AiUsageMetadata = {
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
};

export interface AiProvider {
  readonly metadata?: AiProviderMetadata;
  generateStructured(input: AiGenerationInput): Promise<unknown>;
}

export class AiProviderError extends Error {
  constructor(
    readonly code: 'AI_NOT_CONFIGURED' | 'AI_PROVIDER_TIMEOUT' | 'AI_PROVIDER_UNAVAILABLE' | 'AI_INVALID_OUTPUT',
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export function writeAiLog(
  action: AiAction,
  outcome: 'success' | 'failure',
  durationMs: number,
  code?: AiProviderError['code'],
  details: Partial<AiProviderMetadata & AiUsageMetadata> = {},
): void {
  const entry = {
    event: 'ai.request',
    provider: details.providerId ?? 'unknown',
    modelVersion: details.modelVersion ?? 'unknown',
    action,
    outcome,
    durationMs: Math.max(0, Math.round(durationMs)),
    ...(details.inputTokens !== undefined ? { inputTokens: details.inputTokens } : {}),
    ...(details.outputTokens !== undefined ? { outputTokens: details.outputTokens } : {}),
    ...(details.estimatedCostUsd !== undefined
      ? { estimatedCostUsd: details.estimatedCostUsd }
      : {}),
    ...(code ? { code } : {}),
  };
  if (outcome === 'success') {
    console.info(JSON.stringify(entry));
  } else {
    console.warn(JSON.stringify(entry));
  }
}

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

export interface AiProvider {
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
): void {
  const entry = {
    event: 'ai.request',
    provider: 'gemini',
    action,
    outcome,
    durationMs: Math.max(0, Math.round(durationMs)),
    ...(code ? { code } : {}),
  };
  if (outcome === 'success') {
    console.info(JSON.stringify(entry));
  } else {
    console.warn(JSON.stringify(entry));
  }
}

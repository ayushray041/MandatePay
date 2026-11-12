import { AiProviderError, type AiProvider } from '@/lib/ai/provider';
import { GeminiAiProvider } from '@/lib/ai/gemini';

export type AiProviderFactory = () => AiProvider;

const providerFactories: Record<string, AiProviderFactory> = {
  gemini: () => new GeminiAiProvider(),
};

export function createAiProvider(
  providerName = process.env.AI_PROVIDER?.trim() || 'gemini',
  factories: Record<string, AiProviderFactory> = providerFactories,
): AiProvider {
  const factory = Object.hasOwn(factories, providerName) ? factories[providerName] : undefined;
  if (!factory) {
    throw new AiProviderError(
      'AI_NOT_CONFIGURED',
      `The configured AI provider "${providerName}" is not available.`,
    );
  }
  return factory();
}

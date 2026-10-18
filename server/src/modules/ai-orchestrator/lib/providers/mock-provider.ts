/**
 * Deterministic, always-configured provider — the default route target
 * when no real provider key is present, and the provider every automated
 * test exercises (no network access, no API key, fully reproducible). Real
 * deployments configure a real provider via env vars; this one exists so
 * the rest of the pipeline (routing, caching, retries, validation,
 * history) is fully exercisable without one, and so "Local Models
 * (future)" already has a concrete slot in the provider registry.
 */
import type {
  ModelCallOptions,
  ModelCallResult,
  ModelMessage,
  ModelProvider,
} from '../../ai-orchestrator.types.js';

export type MockResponder = (options: ModelCallOptions) => string;

const defaultResponder: MockResponder = (options) => {
  const lastUser = [...options.messages].reverse().find((m) => m.role === 'user');
  return JSON.stringify({ mock: true, echo: (lastUser?.content ?? '').slice(0, 200) });
};

/** Content may be a string or parts; an image contributes its encoded length. */
function messageLength(message: ModelMessage): number {
  if (typeof message.content === 'string') return message.content.length;
  return message.content.reduce(
    (sum, part) => sum + (part.type === 'text' ? part.text.length : part.image_url.url.length),
    0,
  );
}

export class MockProvider implements ModelProvider {
  readonly id = 'mock' as const;
  readonly name = 'Mock (offline/testing)';
  readonly defaultModel = 'mock-1';
  readonly costPerMillionInputTokens = 0;
  readonly costPerMillionOutputTokens = 0;
  // The mock answers whatever it is given, images included — tests depend on it.
  readonly supportsImages = true;

  constructor(private readonly responder: MockResponder = defaultResponder) {}

  isConfigured(): boolean {
    return true;
  }

  async call(options: ModelCallOptions): Promise<ModelCallResult> {
    await Promise.resolve();
    const content = this.responder(options);
    const inputChars = options.messages.reduce((sum, m) => sum + messageLength(m), 0);

    return {
      content,
      usage: {
        inputTokens: Math.ceil(inputChars / 4),
        outputTokens: Math.ceil(content.length / 4),
      },
      model: this.defaultModel,
      provider: 'mock',
      stopReason: 'end_turn',
    };
  }
}

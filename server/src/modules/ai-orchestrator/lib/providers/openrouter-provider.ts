/** OpenRouter's OpenAI-compatible chat completions API — the gateway to whichever model a deployment routes through it. Reads `OPENROUTER_API_KEY` from `process.env`. */
import type {
  ModelCallOptions,
  ModelCallResult,
  ModelProvider,
} from '../../ai-orchestrator.types.js';
import { postJson } from './http-utils.js';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenRouterResponse {
  choices: { message: { content: string }; finish_reason: string }[];
  usage: { prompt_tokens: number; completion_tokens: number };
  model: string;
}

export class OpenRouterProvider implements ModelProvider {
  readonly id = 'openrouter' as const;
  readonly name = 'OpenRouter';
  readonly defaultModel = 'openrouter/auto';
  readonly costPerMillionInputTokens = 2;
  readonly costPerMillionOutputTokens = 8;

  isConfigured(): boolean {
    return Boolean(process.env.OPENROUTER_API_KEY);
  }

  async call(options: ModelCallOptions): Promise<ModelCallResult> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

    const body = {
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      messages: options.messages,
    };

    const json = (await postJson(
      API_URL,
      { Authorization: `Bearer ${apiKey}` },
      body,
    )) as OpenRouterResponse;
    const choice = json.choices[0];

    return {
      content: choice?.message.content ?? '',
      usage: { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens },
      model: json.model,
      provider: 'openrouter',
      stopReason: choice?.finish_reason ?? 'unknown',
    };
  }
}

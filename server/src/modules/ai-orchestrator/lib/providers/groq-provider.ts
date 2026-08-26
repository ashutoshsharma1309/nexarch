/**
 * Groq adapter — an OpenAI-compatible chat-completions endpoint in front of
 * open-weight models. This is the provider a local NexArch install runs on:
 * one key, fast responses, and native JSON mode, which is what every
 * pipeline stage needs (each stage asks for one structured object, never
 * prose).
 *
 * The key is read from `process.env` server-side only — the same
 * per-provider convention the other adapters use, deliberately outside the
 * core env schema so a deployment without Groq still boots. `AI_API_KEY` is
 * accepted as the provider-neutral spelling.
 */
import type {
  ModelCallOptions,
  ModelCallResult,
  ModelProvider,
} from '../../ai-orchestrator.types.js';
import { postJson } from './http-utils.js';

const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface GroqResponse {
  choices: { message: { content: string | null }; finish_reason: string }[];
  /** Absent on some error-adjacent responses the endpoint still returns 200 for. */
  usage?: { prompt_tokens: number; completion_tokens: number };
  model: string;
}

/** `GROQ_API_KEY` wins; `AI_API_KEY` is the provider-neutral fallback. */
function apiKey(): string | undefined {
  return process.env.GROQ_API_KEY ?? process.env.AI_API_KEY;
}

export class GroqProvider implements ModelProvider {
  readonly id = 'groq' as const;
  readonly name = 'Groq';
  readonly defaultModel = 'openai/gpt-oss-120b';
  // Public list pricing for gpt-oss-120b, in USD per million tokens.
  readonly costPerMillionInputTokens = 0.15;
  readonly costPerMillionOutputTokens = 0.6;

  isConfigured(): boolean {
    return Boolean(apiKey());
  }

  async call(options: ModelCallOptions): Promise<ModelCallResult> {
    const key = apiKey();
    if (!key) throw new Error('AI_API_KEY (or GROQ_API_KEY) is not configured');

    const body = {
      model: options.model,
      messages: options.messages,
      max_completion_tokens: options.maxTokens,
      temperature: options.temperature ?? 0.2,
      // JSON mode makes "the model returned prose" a non-failure-mode rather
      // than something the response validator has to catch after the fact.
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    };

    const json = (await postJson(
      API_URL,
      { Authorization: `Bearer ${key}` },
      body,
    )) as GroqResponse;
    const choice = json.choices[0];

    return {
      content: choice?.message.content ?? '',
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
      model: json.model,
      provider: 'groq',
      stopReason: choice?.finish_reason ?? 'unknown',
    };
  }
}

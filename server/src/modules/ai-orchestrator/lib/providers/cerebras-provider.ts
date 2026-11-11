/**
 * Cerebras adapter — an OpenAI-compatible chat-completions endpoint. Reads
 * `CEREBRAS_API_KEY` from `process.env`.
 *
 * Model ids differ from Groq's for the same weights (`gpt-oss-120b` here,
 * `openai/gpt-oss-120b` there), so the router keeps a per-provider table
 * rather than reusing one id across the chain.
 */
import type {
  ModelCallOptions,
  ModelCallResult,
  ModelProvider,
} from '../../ai-orchestrator.types.js';
import { postJson, reportedUsage } from './http-utils.js';

const API_URL = 'https://api.cerebras.ai/v1/chat/completions';

interface CerebrasResponse {
  choices?: { message: { content: string | null }; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  model?: string;
}

export class CerebrasProvider implements ModelProvider {
  readonly id = 'cerebras' as const;
  readonly name = 'Cerebras';
  readonly defaultModel = 'gpt-oss-120b';
  // Unused for billing: `lib/model-pricing.ts` prices by model and reports
  // unknown for anything it has no published rate for.
  readonly costPerMillionInputTokens = 0;
  readonly costPerMillionOutputTokens = 0;
  readonly supportsImages = false;

  isConfigured(): boolean {
    return Boolean(process.env.CEREBRAS_API_KEY);
  }

  async call(options: ModelCallOptions): Promise<ModelCallResult> {
    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) throw new Error('CEREBRAS_API_KEY is not configured');

    const body = {
      model: options.model,
      messages: options.messages,
      max_completion_tokens: options.maxTokens,
      temperature: options.temperature ?? 0.2,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    };

    const json = (await postJson(
      API_URL,
      { Authorization: `Bearer ${apiKey}` },
      body,
      options.timeoutMs,
    )) as CerebrasResponse;
    const choice = json.choices?.[0];

    return {
      content: choice?.message.content ?? '',
      usage: reportedUsage(json.usage?.prompt_tokens, json.usage?.completion_tokens),
      model: json.model ?? options.model,
      provider: 'cerebras',
      stopReason: choice?.finish_reason ?? 'unknown',
    };
  }
}

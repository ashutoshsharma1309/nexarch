/** OpenAI Chat Completions API adapter. Reads `OPENAI_API_KEY` from `process.env`. */
import type {
  ModelCallOptions,
  ModelCallResult,
  ModelProvider,
} from '../../ai-orchestrator.types.js';
import { postJson } from './http-utils.js';

const API_URL = 'https://api.openai.com/v1/chat/completions';

interface OpenAiResponse {
  choices: { message: { content: string }; finish_reason: string }[];
  usage: { prompt_tokens: number; completion_tokens: number };
  model: string;
}

export class OpenAiProvider implements ModelProvider {
  readonly id = 'openai' as const;
  readonly name = 'OpenAI';
  readonly defaultModel = 'gpt-5';
  readonly costPerMillionInputTokens = 2.5;
  readonly costPerMillionOutputTokens = 10;

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async call(options: ModelCallOptions): Promise<ModelCallResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

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
    )) as OpenAiResponse;
    const choice = json.choices[0];

    return {
      content: choice?.message.content ?? '',
      usage: { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens },
      model: json.model,
      provider: 'openai',
      stopReason: choice?.finish_reason ?? 'unknown',
    };
  }
}

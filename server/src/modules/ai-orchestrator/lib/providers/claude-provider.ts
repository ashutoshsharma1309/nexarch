/**
 * Anthropic Messages API adapter. Reads `ANTHROPIC_API_KEY` directly from
 * `process.env` rather than the platform's core env schema (Phase 1's
 * `shared/config/env.ts`) — provider keys are optional and per-provider,
 * not something every deployment needs, so they don't belong in the
 * required-config surface every other module shares.
 */
import type {
  ModelCallOptions,
  ModelCallResult,
  ModelProvider,
} from '../../ai-orchestrator.types.js';
import { postJson } from './http-utils.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

interface ClaudeResponse {
  content: { type: string; text?: string }[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  stop_reason: string;
}

export class ClaudeProvider implements ModelProvider {
  readonly id = 'claude' as const;
  readonly name = 'Anthropic Claude';
  readonly defaultModel = 'claude-sonnet-5';
  readonly costPerMillionInputTokens = 3;
  readonly costPerMillionOutputTokens = 15;

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async call(options: ModelCallOptions): Promise<ModelCallResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

    const system = options.messages.find((m) => m.role === 'system')?.content;
    const conversation = options.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const body = {
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      system,
      messages: conversation,
    };

    const json = (await postJson(
      API_URL,
      { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      body,
    )) as ClaudeResponse;

    const text = json.content.find((block) => block.type === 'text')?.text ?? '';

    return {
      content: text,
      usage: { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens },
      model: json.model,
      provider: 'claude',
      stopReason: json.stop_reason,
    };
  }
}

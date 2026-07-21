/** Google Gemini `generateContent` API adapter. Reads `GEMINI_API_KEY` from `process.env`. */
import type {
  ModelCallOptions,
  ModelCallResult,
  ModelProvider,
} from '../../ai-orchestrator.types.js';
import { postJson } from './http-utils.js';

interface GeminiResponse {
  candidates: { content: { parts: { text: string }[] }; finishReason: string }[];
  usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
  modelVersion: string;
}

export class GeminiProvider implements ModelProvider {
  readonly id = 'gemini' as const;
  readonly name = 'Google Gemini';
  readonly defaultModel = 'gemini-2.5-pro';
  readonly costPerMillionInputTokens = 1.25;
  readonly costPerMillionOutputTokens = 5;

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  async call(options: ModelCallOptions): Promise<ModelCallResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

    const system = options.messages.find((m) => m.role === 'system')?.content;
    const contents = options.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const body = {
      contents,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: { maxOutputTokens: options.maxTokens, temperature: options.temperature },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent?key=${apiKey}`;
    const json = (await postJson(url, {}, body)) as GeminiResponse;
    const candidate = json.candidates[0];
    const text = candidate?.content.parts.map((p) => p.text).join('') ?? '';

    return {
      content: text,
      usage: {
        inputTokens: json.usageMetadata.promptTokenCount,
        outputTokens: json.usageMetadata.candidatesTokenCount,
      },
      model: json.modelVersion,
      provider: 'gemini',
      stopReason: candidate?.finishReason ?? 'unknown',
    };
  }
}

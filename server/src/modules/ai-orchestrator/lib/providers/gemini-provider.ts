/** Google Gemini `generateContent` API adapter. Reads `GEMINI_API_KEY` from `process.env`. */
import type {
  ModelCallOptions,
  ModelCallResult,
  ModelProvider,
} from '../../ai-orchestrator.types.js';
import { postJson, reportedUsage } from './http-utils.js';

/** Every field is optional because a blocked or truncated answer omits them on a 200. */
interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
}

/**
 * Output as Google bills it. Its pricing page quotes the output rate as
 * "including thinking tokens", and those are counted apart from the answer,
 * so the candidates count alone would understate a thinking model's spend.
 */
function outputTokens(usage: GeminiResponse['usageMetadata']): number | undefined {
  if (usage?.candidatesTokenCount === undefined) return undefined;
  return usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0);
}

export class GeminiProvider implements ModelProvider {
  readonly id = 'gemini' as const;
  readonly name = 'Google Gemini';
  readonly defaultModel = 'gemini-3.5-flash';
  readonly costPerMillionInputTokens = 1.25;
  readonly costPerMillionOutputTokens = 5;
  // Gemini wants `inlineData` parts; this adapter only maps text.
  readonly supportsImages = false;

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
      generationConfig: {
        maxOutputTokens: options.maxTokens,
        temperature: options.temperature,
        ...(options.json ? { responseMimeType: 'application/json' } : {}),
      },
    };

    // The key travels in a header: `postJson` quotes the URL in its errors,
    // and those reach the logs and the generation history.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent`;
    const json = (await postJson(
      url,
      { 'x-goog-api-key': apiKey },
      body,
      options.timeoutMs,
    )) as GeminiResponse;
    const candidate = json.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

    return {
      content: text,
      usage: reportedUsage(json.usageMetadata?.promptTokenCount, outputTokens(json.usageMetadata)),
      model: json.modelVersion ?? options.model,
      provider: 'gemini',
      stopReason: candidate?.finishReason ?? 'unknown',
    };
  }
}

/**
 * Turns gathered evidence into the structured fields of a research artifact.
 *
 * The prompt asks the model to cite only real sources, and this file assumes it
 * did not. A citation is what separates a finding from a guess, so every one is
 * checked here after the model answers.
 */
import type { generate } from '../../ai-orchestrator/ai-orchestrator.service.js';
import type {
  ResearchConfidence,
  ResearchDecision,
  ResearchFinding,
  ResearchModelCall,
  ResearchSource,
} from '../web-research.types.js';
import {
  BUDGET_MARGIN_MS,
  modelCallFailure,
  modelCallFromRecord,
  withTimeout,
} from './model-calls.js';
import { sanitizeExcerpt } from './sanitize.js';

const MAX_ITEMS_PER_LIST = 12;
const MAX_STATEMENT_CHARS = 400;
const MAX_EVIDENCE_ENTRY_CHARS = 3_200;

export interface SynthesizedFields {
  findings: ResearchFinding[];
  decisions: ResearchDecision[];
  commonPatterns: string[];
  visualDirection: string[];
  featureRecommendations: string[];
  uxPatterns: string[];
  interactions: string[];
  assetRequirements: string[];
  implementationRecommendations: string[];
}

export function emptySynthesis(): SynthesizedFields {
  return {
    findings: [],
    decisions: [],
    commonPatterns: [],
    visualDirection: [],
    featureRecommendations: [],
    uxPatterns: [],
    interactions: [],
    assetRequirements: [],
    implementationRecommendations: [],
  };
}

export interface SynthesisOutcome {
  fields: SynthesizedFields;
  succeeded: boolean;
  limitations: string[];
  modelCall: ResearchModelCall | null;
}

export interface SynthesisInput {
  prompt: string;
  objective: string;
  domainLabel: string;
  questions: readonly string[];
  sources: readonly ResearchSource[];
  maxEvidenceChars: number;
  timeoutMs: number;
  /** JSON from `buildReferenceEvidence`; null when no reference could be measured. */
  referenceEvidence?: string | null;
}

/** Sources with content to cite. An unreachable page has none. */
export function citableSources(sources: readonly ResearchSource[]): ResearchSource[] {
  return sources.filter(
    (source) => source.retrievalKind !== 'unreachable' && source.excerpt !== '',
  );
}

/**
 * JSON, not a text layout: string escaping leaves a page no way to fake the
 * start of another source's entry. Pages come first, as the stronger evidence.
 */
export function buildEvidence(
  sources: readonly ResearchSource[],
  maxChars: number,
): { text: string; includedIds: Set<string> } {
  const ordered = [...citableSources(sources)].sort(
    (a, b) =>
      Number(b.retrievalKind === 'extracted-page') - Number(a.retrievalKind === 'extracted-page'),
  );
  const entries: string[] = [];
  const includedIds = new Set<string>();
  let used = 2;
  for (const source of ordered) {
    const entry = JSON.stringify({
      id: source.id,
      title: source.title,
      url: source.url.slice(0, 300),
      kind: source.retrievalKind,
      excerpt: source.excerpt.slice(0, MAX_EVIDENCE_ENTRY_CHARS),
    });
    if (used + entry.length + 1 > maxChars) continue;
    entries.push(entry);
    includedIds.add(source.id);
    used += entry.length + 1;
  }
  return { text: `[${entries.join(',')}]`, includedIds };
}

/** Measurements follow the sources in the same untrusted message, under their own label. */
function withReferences(evidence: string, references: string | null | undefined): string {
  return references ? `${evidence}\n\nMEASURED_REFERENCES ${references}` : evidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Model output is fed to later prompts, so it is held to the same rule as web text. */
function cleanStatement(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = sanitizeExcerpt(value, MAX_STATEMENT_CHARS);
  return cleaned.flaggedLines.length > 0 || cleaned.text === '' ? null : cleaned.text;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(cleanStatement)
    .filter((item): item is string => item !== null)
    .slice(0, MAX_ITEMS_PER_LIST);
}

function lowerConfidence(confidence: ResearchConfidence): ResearchConfidence {
  return confidence === 'high' ? 'medium' : 'low';
}

function parseConfidence(value: unknown): ResearchConfidence {
  return value === 'high' || value === 'medium' ? value : 'low';
}

interface CitationCheck {
  sourceIds: string[];
  confidence: ResearchConfidence;
  unknownCitations: boolean;
}

/**
 * Null when nothing cited exists. A claim that also cited something invented
 * survives one step less sure, and a snippet alone never supports `high`.
 */
function checkCitations(
  rawIds: unknown,
  rawConfidence: unknown,
  known: ReadonlyMap<string, ResearchSource>,
): CitationCheck | null {
  const cited = Array.isArray(rawIds)
    ? [...new Set(rawIds.filter((id): id is string => typeof id === 'string'))]
    : [];
  const sourceIds = cited.filter((id) => known.has(id));
  if (sourceIds.length === 0) return null;

  const unknownCitations = sourceIds.length < cited.length;
  let confidence = parseConfidence(rawConfidence);
  if (unknownCitations) confidence = lowerConfidence(confidence);
  const readAPage = sourceIds.some((id) => known.get(id)?.retrievalKind === 'extracted-page');
  if (!readAPage && confidence === 'high') confidence = 'medium';
  return { sourceIds, confidence, unknownCitations };
}

function parseSynthesis(
  json: Record<string, unknown>,
  sources: readonly ResearchSource[],
  readable: ReadonlySet<string>,
): { fields: SynthesizedFields; dropped: number; downgraded: number } {
  // Only what the model was actually sent can back a claim.
  const known = new Map(
    citableSources(sources)
      .filter((source) => readable.has(source.id))
      .map((source) => [source.id, source]),
  );
  let dropped = 0;
  let downgraded = 0;

  const items = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.filter(isRecord).slice(0, MAX_ITEMS_PER_LIST) : [];

  const findings: ResearchFinding[] = [];
  for (const item of items(json.findings)) {
    const statement = cleanStatement(item.statement);
    const check = checkCitations(item.sourceIds, item.confidence, known);
    if (statement === null || check === null) {
      dropped += 1;
      continue;
    }
    if (check.unknownCitations) downgraded += 1;
    findings.push({ statement, sourceIds: check.sourceIds, confidence: check.confidence });
  }

  const decisions: ResearchDecision[] = [];
  for (const item of items(json.decisions)) {
    const decision = cleanStatement(item.decision);
    const rationale = cleanStatement(item.rationale);
    const check = checkCitations(item.sourceIds, item.confidence, known);
    if (decision === null || rationale === null || check === null) {
      dropped += 1;
      continue;
    }
    if (check.unknownCitations) downgraded += 1;
    decisions.push({
      decision,
      rationale,
      sourceIds: check.sourceIds,
      confidence: check.confidence,
    });
  }

  return {
    fields: {
      findings,
      decisions,
      commonPatterns: stringList(json.commonPatterns),
      visualDirection: stringList(json.visualDirection),
      featureRecommendations: stringList(json.featureRecommendations),
      uxPatterns: stringList(json.uxPatterns),
      interactions: stringList(json.interactions),
      assetRequirements: stringList(json.assetRequirements),
      implementationRecommendations: stringList(json.implementationRecommendations),
    },
    dropped,
    downgraded,
  };
}

export async function synthesizeResearch(
  input: SynthesisInput,
  generateFn: typeof generate,
): Promise<SynthesisOutcome> {
  const failed = (reason: string, modelCall: ResearchModelCall | null): SynthesisOutcome => ({
    fields: emptySynthesis(),
    succeeded: false,
    limitations: [`Synthesis did not produce findings (${reason}). Sources are listed unanalysed.`],
    modelCall,
  });

  const citable = citableSources(input.sources);
  const evidence = buildEvidence(input.sources, input.maxEvidenceChars);
  const startedAt = Date.now();
  try {
    const response = await withTimeout(
      generateFn(
        {
          promptId: 'web-research-synthesis',
          complexity: 'research-synthesis',
          schema: 'generic-json',
          variables: {
            USER_REQUEST: input.prompt,
            OBJECTIVE: input.objective,
            DOMAIN_LABEL: input.domainLabel,
            QUESTIONS: input.questions.map((question) => `- ${question}`).join('\n'),
            ALLOWED_SOURCE_IDS: citable
              .filter((source) => evidence.includedIds.has(source.id))
              .map((source) => source.id)
              .join(', '),
          },
          untrustedData: withReferences(evidence.text, input.referenceEvidence),
        },
        { timeBudgetMs: Math.max(1, input.timeoutMs - BUDGET_MARGIN_MS) },
      ),
      input.timeoutMs,
    );
    const modelCall = modelCallFromRecord('synthesis', response.record);
    // The mock's echo would read as an empty, successful synthesis.
    if (response.record.provider === 'mock') return failed('no AI model is configured', modelCall);

    let json: unknown;
    try {
      json = JSON.parse(response.content);
    } catch {
      return failed('the model did not return JSON', modelCall);
    }
    if (!isRecord(json)) return failed('the model did not return an object', modelCall);

    const { fields, dropped, downgraded } = parseSynthesis(
      json,
      input.sources,
      evidence.includedIds,
    );
    // Lists without one verified finding have nothing tying them to the evidence.
    if (fields.findings.length === 0 && fields.decisions.length === 0) {
      return failed(
        dropped > 0
          ? `all ${dropped} of the model's claims cited unknown sources or were unusable`
          : 'the model returned no findings',
        modelCall,
      );
    }

    const limitations: string[] = [];
    const leftOut = citable.length - evidence.includedIds.size;
    if (leftOut > 0) {
      limitations.push(
        `${leftOut} source(s) were left out because the evidence limit was reached, so no finding rests on them.`,
      );
    }
    if (dropped > 0) {
      limitations.push(
        `${dropped} claim(s) from the model were dropped for citing no real source.`,
      );
    }
    if (downgraded > 0) {
      limitations.push(
        `${downgraded} claim(s) cited a non-existent source and had their confidence lowered.`,
      );
    }
    return { fields, succeeded: true, limitations, modelCall };
  } catch {
    // Only the clock can say the time ran out: a timed-out first provider and a
    // rate-limited rest of the chain would otherwise read as a slow answer.
    const ranOut = Date.now() - startedAt >= input.timeoutMs * 0.9;
    return failed(
      ranOut
        ? `no AI provider answered within the ${String(Math.round(input.timeoutMs / 1_000))}s available`
        : 'every AI provider refused or failed the call, through rate limits, size limits or billing',
      modelCallFailure('synthesis', startedAt),
    );
  }
}

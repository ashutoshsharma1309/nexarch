/**
 * Validates a model's raw text response: must parse as JSON, and — for the
 * schemas this platform actually expects back (a requirement spec, an
 * architecture plan, a design bundle) — must carry the top-level keys a
 * real one always has. This isn't a full Zod schema re-declaration (those
 * already exist as TypeScript interfaces upstream, not runtime schemas);
 * it's the fast, cheap check that catches the two failure modes that
 * actually happen with LLM output: truncated JSON and a plausible-looking
 * object missing the fields a real pipeline stage needs next.
 */
import type {
  GenerateRequest,
  ValidationIssue,
  ValidationResult,
} from '../ai-orchestrator.types.js';

const REQUIRED_KEYS: Partial<Record<NonNullable<GenerateRequest['schema']>, string[]>> = {
  'requirement-spec': ['projectName', 'projectType', 'roles', 'modules'],
  'architecture-plan': ['meta', 'apiModules', 'decisions'],
  'database-design': ['databaseDesign', 'prismaSchema', 'openapi'],
};

function parseJson(text: string): { value: unknown; error: string | null } {
  try {
    return { value: JSON.parse(text) as unknown, error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function validateResponse(
  text: string,
  schema: GenerateRequest['schema'] = 'generic-json',
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { value, error } = parseJson(text);

  if (error) {
    return {
      valid: false,
      issues: [{ path: '$', message: `Response is not valid JSON: ${error}`, kind: 'incomplete' }],
    };
  }

  if (schema === 'generic-json') {
    return { valid: true, issues: [] };
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      valid: false,
      issues: [
        {
          path: '$',
          message: `Expected a JSON object for schema "${schema}", got ${Array.isArray(value) ? 'an array' : typeof value}`,
          kind: 'type-mismatch',
        },
      ],
    };
  }

  const requiredKeys = REQUIRED_KEYS[schema] ?? [];
  const record = value as Record<string, unknown>;
  for (const key of requiredKeys) {
    if (!(key in record)) {
      issues.push({ path: key, message: `Missing required field "${key}"`, kind: 'missing' });
    } else if (record[key] === null || record[key] === undefined) {
      issues.push({
        path: key,
        message: `Field "${key}" is present but empty`,
        kind: 'incomplete',
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

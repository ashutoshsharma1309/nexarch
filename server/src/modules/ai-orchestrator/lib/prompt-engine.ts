/**
 * Loads and renders the `prompts/*.md` templates. Templates are real files
 * on disk (not strings embedded in TypeScript) so a prompt can be reviewed
 * and edited without touching code — the one deliberate exception to this
 * codebase's usual "everything generated is a template literal in a .ts
 * file" convention, because prompts are the one artifact a non-engineer
 * (a prompt engineer, a reviewer) legitimately needs to read on their own.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PromptTemplate, PromptVariables } from '../ai-orchestrator.types.js';

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
const VARIABLE_PATTERN = /\{\{([A-Z_][A-Z0-9_]*)\}\}/g;

function extractVariables(raw: string): string[] {
  const names = new Set<string>();
  for (const match of raw.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return [...names];
}

function loadTemplate(id: string): PromptTemplate {
  const file = `${id}.md`;
  const raw = readFileSync(join(PROMPTS_DIR, file), 'utf-8');
  return { id, file, variables: extractVariables(raw), raw };
}

let cachedTemplates: Map<string, PromptTemplate> | null = null;

function templates(): Map<string, PromptTemplate> {
  if (cachedTemplates) return cachedTemplates;
  const map = new Map<string, PromptTemplate>();
  for (const entry of readdirSync(PROMPTS_DIR)) {
    if (!entry.endsWith('.md')) continue;
    const id = entry.replace(/\.md$/, '');
    map.set(id, loadTemplate(id));
  }
  cachedTemplates = map;
  return map;
}

export function listPromptTemplates(): PromptTemplate[] {
  return [...templates().values()];
}

export function getPromptTemplate(id: string): PromptTemplate {
  const template = templates().get(id);
  if (!template) {
    const known = [...templates().keys()].join(', ');
    throw new Error(`Unknown prompt template "${id}" — known templates: ${known}`);
  }
  return template;
}

export interface RenderedPrompt {
  templateId: string;
  text: string;
  missingVariables: string[];
}

/** Substitutes `{{VAR}}` placeholders; any placeholder left unfilled is reported rather than sent to a model as literal `{{VAR}}` text. */
export function renderPrompt(templateId: string, variables: PromptVariables): RenderedPrompt {
  const template = getPromptTemplate(templateId);
  const missingVariables = template.variables.filter((name) => variables[name] === undefined);

  const text = template.raw.replace(
    VARIABLE_PATTERN,
    (match, name: string) => variables[name] ?? match,
  );

  return { templateId, text, missingVariables };
}

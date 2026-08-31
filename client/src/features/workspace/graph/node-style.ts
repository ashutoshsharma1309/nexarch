/**
 * The visual vocabulary.
 *
 * Thirteen node types, six colour families. One hue per type would produce
 * a rainbow nobody can hold in their head, so colour carries the *family* —
 * intent, backend, frontend, data, security, artifact — and a mono type
 * label on the node carries the exact type. Colour narrows, text confirms.
 *
 * Every colour is an existing design token. Nothing here introduces a
 * palette of its own.
 */
import type { EngNodeType } from '@/shared/types/api';

export type NodeFamily =
  'project' | 'intent' | 'backend' | 'frontend' | 'data' | 'security' | 'artifact';

export const FAMILY_OF: Record<EngNodeType, NodeFamily> = {
  PROJECT: 'project',
  REQUIREMENT: 'intent',
  FEATURE: 'intent',
  MODULE: 'backend',
  SERVICE: 'backend',
  API: 'frontend',
  COMPONENT: 'frontend',
  ENTITY: 'data',
  FIELD: 'data',
  SECURITY_RULE: 'security',
  FILE: 'artifact',
  TEST: 'artifact',
  DEPENDENCY: 'artifact',
};

/**
 * Tailwind classes per family. Border and text carry the colour; the fill
 * stays near-surface so a dense graph reads as structure rather than as a
 * field of coloured blocks.
 */
export const FAMILY_CLASS: Record<NodeFamily, string> = {
  project: 'border-ember/70 bg-ember-soft text-fg',
  intent: 'border-accent/60 bg-accent-soft text-fg',
  backend: 'border-line-strong bg-raised text-fg',
  frontend: 'border-success/50 bg-surface text-fg',
  data: 'border-warning/50 bg-surface text-fg',
  security: 'border-danger/50 bg-surface text-fg',
  artifact: 'border-line bg-surface text-fg-muted',
};

/** Legend swatches — the dot colour alone, matching the border above. */
export const FAMILY_DOT: Record<NodeFamily, string> = {
  project: 'bg-ember',
  intent: 'bg-accent',
  backend: 'bg-line-strong',
  frontend: 'bg-success',
  data: 'bg-warning',
  security: 'bg-danger',
  artifact: 'bg-fg-subtle',
};

export const FAMILY_LABEL: Record<NodeFamily, string> = {
  project: 'Project',
  intent: 'Requirement · Feature',
  backend: 'Module · Service',
  frontend: 'API · Component',
  data: 'Entity · Field',
  security: 'Security rule',
  artifact: 'File · Test · Dependency',
};

export const FAMILY_ORDER: NodeFamily[] = [
  'project',
  'intent',
  'backend',
  'frontend',
  'data',
  'security',
  'artifact',
];

/**
 * Relationship density, bucketed. Drives node emphasis: a service twenty
 * things depend on should not look like a leaf field.
 */
export function densityTier(degree: number): 0 | 1 | 2 {
  if (degree >= 8) return 2;
  if (degree >= 3) return 1;
  return 0;
}

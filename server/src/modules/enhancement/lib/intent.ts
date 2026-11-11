/**
 * What kind of change this is, and whether the web can help with it.
 *
 * Deterministic on purpose. The kind decides which areas of the project must
 * really change for the request to count as done, so it should not depend on
 * how a model felt about the sentence.
 */
import type { EnhancementKind } from '../enhancement.types.js';

/** Most specific first: "add login to the dashboard page" is auth, not a page. */
const RULES: { kind: EnhancementKind; pattern: RegExp; unless?: RegExp }[] = [
  {
    kind: 'research-features',
    pattern:
      /\b(research|find out|look up|investigate|what features|which features|competitors?|what do (similar|other))\b/i,
  },
  {
    kind: 'add-authentication',
    pattern:
      /\b(add|enable|implement|set ?up|need|build|create|support)\b(?:\s+\w+){0,3}?\s+(auth|authentication|login|log-in|sign[- ]?in|sign[- ]?up|registration|user accounts?)\b(?!\s+(page|button|form|screen|link))/i,
  },
  {
    kind: 'add-database',
    pattern:
      /\b(add|connect|implement|set ?up|need|persist)\b(?:\s+\w+){0,3}?\s+(database|db|postgres|mysql|prisma|sql|persistence)\b|\buse\s+(a\s+)?(database|postgres|mysql|prisma)\b/i,
  },
  {
    kind: 'integrate-api',
    pattern:
      /\b(integrat\w*|connect to|hook up|call)\b.*\b(api|stripe|paypal|twilio|sendgrid|mailgun|webhook|slack|openai|google maps|third[- ]party)\b/i,
  },
  { kind: 'add-tests', pattern: /\b(add|write|create|increase)\b.*\b(tests?|coverage|e2e)\b/i },
  {
    kind: 'improve-accessibility',
    // Bare "contrast" is a design word: "stronger hierarchy and contrast" is a
    // visual change, and only a stated ratio or standard makes it about access.
    pattern: /\b(accessib\w*|a11y|screen reader|aria|wcag|keyboard nav\w*|contrast ratios?)\b/i,
  },
  {
    kind: 'improve-mobile',
    pattern: /\b(mobile|responsive|phone|tablet|small screens?|touch)\b/i,
  },
  {
    kind: 'improve-performance',
    pattern: /\b(performance|faster|speed|slow|lazy[- ]?load|bundle size|optimi[sz]e|caching)\b/i,
  },
  {
    kind: 'fix-bug',
    pattern: /\b(bug|fix|broken|error|crash\w*|does ?n[o']t work|not working|issue with)\b/i,
  },
  {
    kind: 'refactor',
    pattern: /\b(refactor|clean ?up|restructure|reorgani[sz]e|simplify the code|split .* into)\b/i,
  },
  {
    // Ahead of the "add …" rules, which would otherwise read "improve the look
    // of the page with a new hero" as a request for a new page. `unless` keeps
    // a real "add a dashboard and make it look good" with those rules.
    kind: 'improve-visuals',
    pattern:
      /\b(improve|enhance|refine|polish|elevate|upgrade|restyle|moderni[sz]e|beautify|make)\b[^.;]*\b(visual\w*|look and feel|looks?\b|appearance|aesthetic\w*|styl(e|es|ing)|typograph\w*|colou?r (palette|scheme)s?|colou?rs|spacing|contrast|hierarchy|design)\b/i,
    unless:
      /\b(add|build|create)\b\s+(?:(?:a|an|the|new|real|working|another|some)\s+)*(?:\w+\s+){0,2}?(modules?|features?|screens?|dashboards?|tabs?|backend|api|endpoints?|server|routes?|pages?)\b/i,
  },
  {
    kind: 'add-backend',
    pattern: /\b(add|build|create|need)\b.*\b(backend|api endpoints?|server|rest api|route)\b/i,
  },
  {
    kind: 'add-module',
    pattern: /\b(add|build|create|new)\b.*\b(module|feature|section|page|screen|dashboard|tab)\b/i,
  },
  {
    kind: 'redesign-page',
    pattern: /\b(redesign|rebuild|rework|new layout|overhaul)\b/i,
  },
  {
    kind: 'improve-visuals',
    pattern:
      /\b(visual\w*|look\w*|style|styling|theme|colou?r|typograph\w*|font|prettier|modern|polish|contrast|ui\b)\b/i,
  },
];

export function classifyInstruction(instruction: string): EnhancementKind {
  for (const rule of RULES) {
    if (rule.pattern.test(instruction) && !rule.unless?.test(instruction)) return rule.kind;
  }
  return 'general';
}

/** Kinds where outside evidence changes what should be built. */
const RESEARCH_HELPS: readonly EnhancementKind[] = ['research-features', 'integrate-api'];

export interface ResearchDecision {
  run: boolean;
  /** Stated to the user either way, so the choice can be questioned. */
  reason: string;
  /** Research would have helped, but this server cannot do it. */
  unavailable?: boolean;
}

/**
 * Should this enhancement search the web?
 *
 * Search quota is metered and adds minutes, and most changes to an existing
 * codebase are answered by that codebase. So research runs only when the
 * request is about something outside the project, or the person asked for it.
 * An explicit no always wins; a missing key is reported, never hidden.
 */
export function decideResearch(input: {
  kind: EnhancementKind;
  instruction: string;
  explicit?: boolean | undefined;
  providersConfigured: boolean;
}): ResearchDecision {
  if (input.explicit === false) {
    return { run: false, reason: 'You asked for this to run without web research.' };
  }
  const wanted =
    input.explicit === true ||
    RESEARCH_HELPS.includes(input.kind) ||
    /\b(best practices?|industry standard|latest|current (trends?|standards?))\b/i.test(
      input.instruction,
    );
  if (!wanted) {
    return {
      run: false,
      reason: 'This can be planned from the project itself, so no web search was run.',
    };
  }
  if (!input.providersConfigured) {
    return {
      run: false,
      unavailable: true,
      reason:
        'Web research would help here, but no search provider key is configured on this server, so it was not run.',
    };
  }
  return {
    run: true,
    reason:
      input.explicit === true
        ? 'You asked for web research.'
        : 'This depends on information outside the project, so the web was searched.',
  };
}

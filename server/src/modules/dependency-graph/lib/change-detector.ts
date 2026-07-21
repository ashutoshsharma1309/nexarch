/**
 * Classifies a natural-language change request ("Add Google Login", "Add
 * Dark Mode") into a category and a set of seed graph nodes. Two signals
 * combine: a small taxonomy of common change categories (keyword →
 * category, with node-type hints for categories that always touch a
 * specific kind of node, e.g. authentication always touches a
 * security-module), and generic token overlap against every node's own
 * label — the taxonomy alone can't generalize to a project's actual entity
 * names ("Update the Products page"), so it's a boost, not the only signal.
 */
import type { ChangeClassification, GraphNode, NodeType } from '../dependency-graph.types.js';

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'add',
  'create',
  'update',
  'remove',
  'delete',
  'implement',
  'make',
  'with',
  'for',
  'to',
  'and',
  'or',
  'on',
  'in',
  'of',
  'new',
  'feature',
  'support',
  'allow',
  'enable',
  'please',
  'i',
  'want',
  'need',
  'change',
  'modify',
]);

interface CategoryDef {
  category: string;
  keywords: string[];
  typeHints: NodeType[];
}

const CATEGORIES: CategoryDef[] = [
  {
    category: 'authentication',
    keywords: [
      'login',
      'sign in',
      'signin',
      'sign up',
      'signup',
      'register',
      'auth',
      'oauth',
      'google login',
      'password',
      'session',
      'logout',
      'jwt',
      'sso',
    ],
    typeHints: ['security-module'],
  },
  {
    category: 'theme',
    keywords: [
      'dark mode',
      'theme',
      'dark theme',
      'color scheme',
      'light mode',
      'styling',
      'css',
      'tailwind',
    ],
    typeHints: ['config', 'store'],
  },
  {
    category: 'payment',
    keywords: ['payment', 'checkout', 'stripe', 'billing', 'invoice', 'pay'],
    typeHints: [],
  },
  {
    category: 'notification',
    keywords: ['notification', 'email', 'sms', 'alert', 'reminder'],
    typeHints: [],
  },
  { category: 'search', keywords: ['search', 'filter', 'sort'], typeHints: [] },
  { category: 'validation', keywords: ['validation', 'validate', 'required field'], typeHints: [] },
  { category: 'api', keywords: ['endpoint', 'api', 'route'], typeHints: ['api-endpoint'] },
  {
    category: 'file-upload',
    keywords: ['upload', 'file upload', 'attachment', 'image upload'],
    typeHints: ['security-module'],
  },
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function splitLabel(label: string): string[] {
  return label
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function classifyCategory(requestLower: string): {
  category: string;
  keywords: string[];
  typeHints: NodeType[];
} {
  let best: { category: string; keywords: string[]; typeHints: NodeType[]; score: number } = {
    category: 'general',
    keywords: [],
    typeHints: [],
    score: 0,
  };
  for (const def of CATEGORIES) {
    const matched = def.keywords.filter((k) => requestLower.includes(k));
    if (matched.length > best.score) {
      best = {
        category: def.category,
        keywords: matched,
        typeHints: def.typeHints,
        score: matched.length,
      };
    }
  }
  return best;
}

export function detectChange(request: string, nodes: readonly GraphNode[]): ChangeClassification {
  const requestLower = request.toLowerCase();
  const tokens = new Set(tokenize(request));
  const { category, keywords, typeHints } = classifyCategory(requestLower);

  const seedNodeIds: string[] = [];
  for (const node of nodes) {
    const labelTokens = splitLabel(node.label);
    const labelOverlap = labelTokens.some((t) => tokens.has(t));
    const typeHintMatch = typeHints.includes(node.type);
    if (labelOverlap || typeHintMatch) seedNodeIds.push(node.id);
  }

  const hasKeywordMatch = keywords.length > 0;
  const hasSeedMatch = seedNodeIds.length > 0;
  const confidence = Math.min(1, (hasKeywordMatch ? 0.55 : 0.15) + (hasSeedMatch ? 0.35 : 0));

  return { category, keywords, confidence: Math.round(confidence * 100) / 100, seedNodeIds };
}

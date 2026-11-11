/**
 * What the request asked for, and whether the delivered files really do it.
 *
 * Deterministic on purpose. The capability list comes from the requirement,
 * and "this capability is implemented" is judged from the files, never taken
 * from a model's own claim that it finished. Nothing here knows any industry:
 * it knows stubs, placeholder pages, file tags, imports and service names.
 */
import { importedPaths } from '../../enhancement/lib/implementer.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';
import type { ProductDecision } from './product-decision.js';

export type CapabilitySource = 'request' | 'requirement' | 'integration' | 'planner';

export interface RequestedCapability {
  id: string;
  title: string;
  /** What the app must really do for this to be true. */
  detail: string;
  source: CapabilitySource;
  /** Set for an outside service: the name that must appear in the code that calls it. */
  service?: string;
}

export type CoverageStatus = 'implemented' | 'missing';

export interface CapabilityCoverage {
  id: string;
  title: string;
  source: CapabilitySource;
  status: CoverageStatus;
  /** Project paths that implement it. Empty when missing. */
  files: string[];
  /** Why it counts as missing, in plain words. Empty when implemented. */
  gaps: string[];
}

export interface StubFinding {
  path: string;
  kind: 'not-implemented-handler' | 'placeholder-page';
}

const AUTH_CAPABILITY =
  /\b(log[- ]?in|sign[- ]?in|regist(er|ration)|passwords?|authenticat\w*|user accounts?)\b/i;
const PAYMENT_CAPABILITY = /\b(payments?|billing|invoic\w+|subscriptions?|credit cards?)\b/i;
const APPLICATION_CODE = /^(backend|frontend)\/src\//;
const GENERIC_SERVICE = /^(third[- ]party|external api|webhooks?|integrat\w+ with)$/i;
const MAX_CAPABILITIES = 16;
const MAX_TITLE = 100;
const MAX_DETAIL = 400;

const CHROME_MODULE = /^(auth\w*|login|sign[- ]?in|settings|profile|home|landing( page)?)$/i;
const STOP_WORDS = new Set(
  'the a an and or to of in on for with from their its can must should will would user users system app application page website data every each new add manage real that this into have has'.split(
    ' ',
  ),
);

function compact(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
}

function sameCapability(a: string, b: string): boolean {
  const wordsA = new Set(significantWords(a));
  const wordsB = new Set(significantWords(b));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
  return shared / Math.min(wordsA.size, wordsB.size) >= 0.8;
}

/**
 * The requested capabilities, in priority order: named services first, because
 * a missing integration is the most visible kind of fake, then the functional
 * requirements, then modules where the requirement listed no functions.
 */
export function deriveCapabilities(
  spec: RequirementSpec,
  decision: Pick<ProductDecision, 'externalApis'> &
    Partial<Pick<ProductDecision, 'authentication' | 'payments'>>,
): RequestedCapability[] {
  // The analyzer adds sign-in and payment to anything shaped like a shop. The
  // decision already ruled on those, from the user's own words.
  const ruledOut = (text: string): boolean =>
    (decision.authentication?.needed === false && AUTH_CAPABILITY.test(text)) ||
    (decision.payments?.needed === false && PAYMENT_CAPABILITY.test(text));
  const capabilities: RequestedCapability[] = [];
  const add = (title: string, detail: string, source: CapabilitySource, service?: string): void => {
    const name = compact(title, MAX_TITLE);
    if (name === '' || ruledOut(name) || capabilities.some((c) => sameCapability(c.title, name)))
      return;
    capabilities.push({
      id: `C${String(capabilities.length + 1)}`,
      title: name,
      detail: compact(detail, MAX_DETAIL),
      source,
      ...(service === undefined ? {} : { service }),
    });
  };

  if (decision.externalApis.needed) {
    // Generic phrases say an integration exists, not which one, so there is
    // no name to look for in the code.
    for (const service of decision.externalApis.signals.filter(
      (signal) => !GENERIC_SERVICE.test(signal),
    )) {
      add(
        `Call ${service}`,
        `The application really calls ${service} and shows what comes back, with handled errors. A mention in copy is not enough.`,
        'integration',
        service,
      );
    }
  }
  const functional = (spec.functionalRequirements ?? []).filter((item) => item.trim() !== '');
  for (const item of functional) add(item, item, 'requirement');
  if (functional.length === 0) {
    for (const module of spec.modules) {
      if (!CHROME_MODULE.test(module.trim()))
        add(module, `A working ${module} capability.`, 'requirement');
    }
  }
  return capabilities.slice(0, MAX_CAPABILITIES);
}

/** Adds what the planner found in the request and the list above missed. */
export function withPlannerCapabilities(
  known: readonly RequestedCapability[],
  listed: readonly { id: string; title: string; detail: string }[],
): RequestedCapability[] {
  const merged = [...known];
  for (const entry of listed) {
    if (merged.length >= MAX_CAPABILITIES) break;
    if (merged.some((c) => c.id === entry.id || sameCapability(c.title, entry.title))) continue;
    merged.push({
      id: entry.id,
      title: compact(entry.title, MAX_TITLE),
      detail: compact(entry.detail, MAX_DETAIL),
      source: 'planner',
    });
  }
  return merged;
}

const NOT_IMPLEMENTED_THROW = /throw\s+new\s+NotImplementedError\b/;
const PLACEHOLDER_PAGE = /not implemented yet|Backend not implemented/i;
/** The error class's own definition is not a stub. */
const STUB_DEFINITION = '/errors/app-error.ts';
const CODE_FILE = /\.(ts|tsx|js|jsx)$/;

/** Every handler that cannot work and every page that says it does not. */
export function findStubs(files: ReadonlyMap<string, string>): StubFinding[] {
  const stubs: StubFinding[] = [];
  for (const [path, content] of files) {
    if (!CODE_FILE.test(path) || path.endsWith(STUB_DEFINITION)) continue;
    if (path.startsWith('backend/') && NOT_IMPLEMENTED_THROW.test(content)) {
      stubs.push({ path, kind: 'not-implemented-handler' });
    } else if (path.startsWith('frontend/') && PLACEHOLDER_PAGE.test(content)) {
      stubs.push({ path, kind: 'placeholder-page' });
    }
  }
  return stubs;
}

/** True when any code in the project really references this service. */
export function callsService(service: string, files: ReadonlyMap<string, string>): boolean {
  const slug = service.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (slug.length < 3) return false;
  for (const [path, content] of files) {
    if (!CODE_FILE.test(path) || path.endsWith('content/site.ts')) continue;
    if (!path.startsWith('backend/') && !path.startsWith('frontend/src/')) continue;
    const code = content.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (code.includes(slug) && /https?:|fetch\(|axios/.test(content)) return true;
  }
  return false;
}

const ENTRY_POINT =
  /(^|\/)(index|main|app|server|router|routes)\.(ts|tsx)$|\.d\.ts$|\.test\.|\.spec\.|\/seed\./i;

/** True when another file imports this one, relatively or through the `@/` alias. */
export function isConnected(path: string, files: ReadonlyMap<string, string>): boolean {
  if (ENTRY_POINT.test(path) || !CODE_FILE.test(path)) return true;
  const known = new Set(files.keys());
  const alias = path.startsWith('frontend/src/')
    ? `@/${path.slice('frontend/src/'.length).replace(/(\/index)?\.(ts|tsx)$/, '')}`
    : null;
  for (const [other, content] of files) {
    if (other === path) continue;
    if (alias !== null && (content.includes(`'${alias}'`) || content.includes(`"${alias}"`)))
      return true;
    if (importedPaths(other, content, known).includes(path)) return true;
  }
  return false;
}

function mentionsAny(words: readonly string[], content: string): boolean {
  const body = content.toLowerCase();
  // A short stem, so "reservations" is found in code that says "reservation".
  return words.some((word) => body.includes(word.slice(0, 6)));
}

/** Pure, so what counts as implemented can be asserted directly. */
export function evaluateCapabilities(input: {
  capabilities: readonly RequestedCapability[];
  /** Capability id to the project paths that really changed for it. */
  implementedBy: ReadonlyMap<string, readonly string[]>;
  files: ReadonlyMap<string, string>;
  /** Every file this stage changed, for capabilities the plan forgot to tag. */
  changed: readonly string[];
  /** Stubs still in the project after implementation. */
  stubs: readonly StubFinding[];
}): CapabilityCoverage[] {
  return input.capabilities.map((capability) => {
    const tagged = (input.implementedBy.get(capability.id) ?? []).filter((path) =>
      input.files.has(path),
    );
    // A plan that forgot its tag still did the work if the code mentions it,
    // though two words must match, so a shared helper does not take the credit.
    const titleWords = significantWords(capability.title);
    const mentioned = input.changed.filter(
      (path) =>
        input.files.has(path) &&
        (titleWords.length === 1
          ? mentionsAny(titleWords, input.files.get(path) ?? '')
          : titleWords.filter((word) => mentionsAny([word], input.files.get(path) ?? '')).length >=
            2),
    );
    const paths = [...new Set([...tagged, ...mentioned])];
    const gaps: string[] = [];
    if (paths.length === 0) gaps.push('No file was changed for it.');

    // A schema or seed change alone delivers nothing a user can do: real runs
    // reported a capability as built when only a table had been added for it.
    const code = paths.filter((path) => APPLICATION_CODE.test(path));
    if (paths.length > 0 && code.length === 0) {
      gaps.push(`Only ${paths.join(', ')} changed for it, and no application code does it.`);
    }
    const hasFrontend = [...input.files.keys()].some((path) => path.startsWith('frontend/src/'));
    if (
      code.length > 0 &&
      hasFrontend &&
      capability.service === undefined &&
      !code.some((path) => path.startsWith('frontend/src/'))
    ) {
      gaps.push('No page uses it, so a user cannot reach it.');
    }
    const words = significantWords(capability.title);
    const needed = Math.min(2, words.length);
    const body = code.map((path) => input.files.get(path) ?? '').join('\n');
    const matched = words.filter((word) => mentionsAny([word], body)).length;
    if (code.length > 0 && matched < needed) {
      gaps.push(
        `The implementing code does not mention it (looked for: ${words.slice(0, 4).join(', ')}).`,
      );
    }
    for (const path of paths) {
      if (input.stubs.some((stub) => stub.path === path)) {
        gaps.push(`${path} is still a placeholder.`);
      }
      if (!isConnected(path, input.files)) gaps.push(`${path} is not imported by anything.`);
    }
    if (capability.service !== undefined && !callsService(capability.service, input.files)) {
      gaps.push(`No code calls ${capability.service}.`);
    }
    return {
      id: capability.id,
      title: capability.title,
      source: capability.source,
      status: gaps.length === 0 ? ('implemented' as const) : ('missing' as const),
      files: gaps.length === 0 ? paths : [],
      gaps,
    };
  });
}

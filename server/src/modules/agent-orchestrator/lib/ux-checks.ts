/**
 * What a person would notice, checked against what was actually emitted.
 *
 * Every check here reads the generated source and reports something it
 * observed — not something it assumes. That distinction is the whole
 * design: a review that says "consider adding loading states" to a project
 * that already has them is noise, and a reviewer that produces noise stops
 * being read.
 *
 * The checks are deliberately code rather than prompts. "Does this form
 * label its inputs" is a question with an answer in the file; asking a
 * model to guess costs tokens and returns a worse answer. The model's pass
 * lives elsewhere and covers the things code genuinely cannot judge —
 * whether a journey makes sense, whether the primary action is the
 * prominent one.
 *
 * Each check knows its own category, so a category with no findings can be
 * reported as *passed* rather than merely absent. A review that lists four
 * problems and nothing else leaves a reader unable to tell thoroughness
 * from laziness.
 */
import { canonicalize } from '../../engineering-graph/lib/canonical.js';
import type { UxCategory, UxFinding } from '../../../shared/types/generation.js';
import type { ProductSpec } from '../../../shared/types/product.js';

export interface ReviewFile {
  path: string;
  content: string;
}

/** Every category these checks cover, for the passed/failed accounting. */
export const CHECKED_CATEGORIES: readonly UxCategory[] = [
  'STATE',
  'FORMS',
  'ACCESSIBILITY',
  'RESPONSIVENESS',
  'HIERARCHY',
  'CONSISTENCY',
  'NAVIGATION',
];

/** `src/features/products/ProductsPage.tsx` → `Products`. */
function screenName(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.tsx?$/, '');
}

const isPage = (file: ReviewFile): boolean => file.path.endsWith('Page.tsx');
const isForm = (file: ReviewFile): boolean => file.path.endsWith('Form.tsx');
const isLayout = (file: ReviewFile): boolean => file.path.includes('/layouts/');

/**
 * A page that talks to the server. Pages that render a static placeholder
 * have no async state to handle, and holding them to the same standard
 * would be reporting an absence as a defect.
 */
function isDataPage(file: ReviewFile): boolean {
  return isPage(file) && /use[A-Z]\w*(?:List|Query)\(|\.mutate\(/.test(file.content);
}

/* ── STATE ─────────────────────────────────────────────────────────────── */

/**
 * A mutation whose failure the user never sees.
 *
 * This is the highest-value check in the file. A `mutate` call with an
 * `onSuccess` and no `onError` produces a screen where submitting a bad
 * form does nothing at all: no message, no retry, no indication the
 * request was even made. It looks like the button is broken.
 */
function mutationErrorHandling(files: readonly ReviewFile[]): UxFinding[] {
  const findings: UxFinding[] = [];

  for (const file of files.filter(isPage)) {
    const mutations = [...file.content.matchAll(/\.mutate\(/g)].length;
    if (mutations === 0) continue;
    const handled = [...file.content.matchAll(/onError\s*:/g)].length;
    if (handled >= mutations) continue;

    findings.push({
      severity: 'HIGH',
      category: 'STATE',
      target: screenName(file.path),
      file: file.path,
      issue: `${String(mutations - handled)} of ${String(mutations)} write operations have no failure handling — a rejected request leaves the screen silent.`,
      recommendation:
        'Surface the server error on failure, so a validation error or a lost connection is visible rather than looking like an unresponsive button.',
      observed: true,
    });
  }
  return findings;
}

function asyncStates(files: readonly ReviewFile[]): UxFinding[] {
  const findings: UxFinding[] = [];

  for (const file of files.filter(isDataPage)) {
    const target = screenName(file.path);
    const has = (pattern: RegExp): boolean => pattern.test(file.content);

    if (!has(/isPending|isLoading|loading=/)) {
      findings.push({
        severity: 'MEDIUM',
        category: 'STATE',
        target,
        file: file.path,
        issue: 'The screen fetches data but renders nothing while the request is in flight.',
        recommendation: 'Render a loading state driven by the query’s own pending flag.',
        observed: true,
      });
    }
    if (!has(/isError|ErrorState/)) {
      findings.push({
        severity: 'MEDIUM',
        category: 'STATE',
        target,
        file: file.path,
        issue:
          'A failed fetch has no visible outcome — the screen renders as though the data were simply empty.',
        recommendation:
          'Distinguish "failed to load" from "nothing here yet"; they need different actions.',
        observed: true,
      });
    }
    if (has(/DataTable|\.map\(/) && !has(/[Ee]mpty/)) {
      findings.push({
        severity: 'LOW',
        category: 'STATE',
        target,
        file: file.path,
        issue: 'A list with no results renders as blank space.',
        recommendation:
          'Give the empty case a title and a next action, so a new project does not look broken.',
        observed: true,
      });
    }
  }
  return findings;
}

/* ── FORMS ─────────────────────────────────────────────────────────────── */

function formQuality(files: readonly ReviewFile[]): UxFinding[] {
  const findings: UxFinding[] = [];

  for (const file of files.filter(isForm)) {
    const target = screenName(file.path);
    const inputs = [...file.content.matchAll(/<(?:Input|Select|Textarea)\b/g)].length;
    const labels = [...file.content.matchAll(/<Label\s+htmlFor=/g)].length;

    if (inputs > labels) {
      findings.push({
        severity: 'HIGH',
        category: 'FORMS',
        target,
        file: file.path,
        issue: `${String(inputs - labels)} of ${String(inputs)} fields have no associated label.`,
        recommendation:
          'Associate every field with a Label via htmlFor. Placeholder text disappears on focus and is not read as a name.',
        observed: true,
      });
    }
    if (!/loading=|disabled=/.test(file.content)) {
      findings.push({
        severity: 'MEDIUM',
        category: 'FORMS',
        target,
        file: file.path,
        issue:
          'The submit control stays active while the request is in flight, so a form can be submitted twice.',
        recommendation: 'Disable submission while the mutation is pending.',
        observed: true,
      });
    }
    if (!/errors\.\w+/.test(file.content)) {
      findings.push({
        severity: 'MEDIUM',
        category: 'FORMS',
        target,
        file: file.path,
        issue: 'Validation failures are not shown next to the field that caused them.',
        recommendation: 'Render each field’s error beneath the field.',
        observed: true,
      });
    }
  }
  return findings;
}

/* ── ACCESSIBILITY ─────────────────────────────────────────────────────── */

function accessibility(files: readonly ReviewFile[]): UxFinding[] {
  const findings: UxFinding[] = [];

  for (const file of files) {
    const target = screenName(file.path);

    const untypedButtons = [...file.content.matchAll(/<button(?![^>]*\btype=)[^>]*>/g)].length;
    if (untypedButtons > 0) {
      findings.push({
        severity: 'MEDIUM',
        category: 'ACCESSIBILITY',
        target,
        file: file.path,
        issue: `${String(untypedButtons)} button(s) declare no type and default to submit inside a form.`,
        recommendation: 'Set type="button" on any control that is not the form’s submit action.',
        observed: true,
      });
    }

    /*
     * An icon with no text and no label is a button whose purpose a screen
     * reader announces as "button". The pattern looks for a control whose
     * only child is an icon element.
     */
    const iconOnly = [
      ...file.content.matchAll(
        /<(?:button|Button)(?![^>]*aria-label)[^>]*>\s*<[A-Z]\w*\s+className="[^"]*size-[^"]*"\s*\/>\s*<\/(?:button|Button)>/g,
      ),
    ].length;
    if (iconOnly > 0) {
      findings.push({
        severity: 'MEDIUM',
        category: 'ACCESSIBILITY',
        target,
        file: file.path,
        issue: `${String(iconOnly)} icon-only control(s) have no accessible name.`,
        recommendation: 'Give each an aria-label describing the action, not the icon.',
        observed: true,
      });
    }
  }
  return findings;
}

/* ── RESPONSIVENESS ────────────────────────────────────────────────────── */

const BREAKPOINT = /\b(?:sm|md|lg|xl|2xl):/;

function responsiveness(files: readonly ReviewFile[]): UxFinding[] {
  const findings: UxFinding[] = [];

  for (const file of files.filter((f) => isLayout(f) || isPage(f))) {
    const target = screenName(file.path);

    // A table wide enough to overflow, with nothing allowing it to.
    if (/<table\b/.test(file.content) && !/overflow-x|overflow-auto/.test(file.content)) {
      findings.push({
        severity: 'HIGH',
        category: 'RESPONSIVENESS',
        target,
        file: file.path,
        issue:
          'A table has no horizontal overflow container, so on a narrow screen it forces the whole page to scroll sideways.',
        recommendation: 'Wrap the table in its own overflow-x container.',
        observed: true,
      });
    }

    if (isLayout(file) && !BREAKPOINT.test(file.content)) {
      findings.push({
        severity: 'HIGH',
        category: 'RESPONSIVENESS',
        target,
        file: file.path,
        issue:
          'A layout with no breakpoint behaviour renders the desktop arrangement at every width.',
        recommendation:
          'Give the layout a genuine small-screen arrangement rather than a scaled-down desktop one.',
        observed: true,
      });
    }
  }
  return findings;
}

/* ── HIERARCHY, CONSISTENCY, NAVIGATION ────────────────────────────────── */

function hierarchy(files: readonly ReviewFile[]): UxFinding[] {
  return files
    .filter(isPage)
    .filter((file) => !/PageHeader|<h1/.test(file.content))
    .map((file) => ({
      severity: 'MEDIUM' as const,
      category: 'HIERARCHY' as const,
      target: screenName(file.path),
      file: file.path,
      issue: 'The screen has no heading, so it opens with no statement of where the user is.',
      recommendation: 'Give every screen one top-level heading naming it.',
      observed: true,
    }));
}

/**
 * Raw elements used where the emitted design system already has a
 * primitive. This is the check that keeps a generated app from drifting
 * into the look Step 13 warns about — inconsistency reads as unfinished
 * long before anyone can say which control is wrong.
 */
function consistency(files: readonly ReviewFile[]): UxFinding[] {
  const findings: UxFinding[] = [];

  for (const file of files.filter((f) => isPage(f) || isForm(f))) {
    const raw = [...file.content.matchAll(/<(?:input|select|textarea)\b/g)].length;
    if (raw > 0) {
      findings.push({
        severity: 'LOW',
        category: 'CONSISTENCY',
        target: screenName(file.path),
        file: file.path,
        issue: `${String(raw)} raw form element(s) bypass the design system’s primitives.`,
        recommendation:
          'Use the shared Input/Select/Textarea so focus, invalid and disabled states match everywhere.',
        observed: true,
      });
    }
  }
  return findings;
}

/**
 * A product module with no screen behind it.
 *
 * This is the one check that reads the product spec rather than the code,
 * and it catches the failure that matters most to a user: a capability the
 * product promised that the interface has no way to reach.
 *
 * Matching the two is the hard part, and doing it naively made this check
 * useless. The product layer names a module "Product Catalog" where the
 * generator emits `ProductsPage`, so a substring comparison reported four
 * missing screens on a project where every one of them existed. The graph
 * already solved this exact problem — `canonicalize` folds both spellings
 * to `product` — so this uses it rather than inventing a second, worse
 * answer to the same question.
 *
 * Canonicalization alone is still not enough for a module realized by
 * several screens under different names: "Authentication" is delivered by
 * Login, Register and Profile, none of which canonicalize to it. The
 * product spec already records that relationship in `screens[].module`, so
 * a module is also considered reached when one of its own declared screens
 * was generated.
 */
function navigation(files: readonly ReviewFile[], product: ProductSpec | undefined): UxFinding[] {
  if (!product) return [];

  const built = new Set(
    files.filter(isPage).map((file) => canonicalize(screenName(file.path).replace(/Page$/, ''))),
  );

  const screensOfModule = new Map<string, string[]>();
  for (const screen of product.screens) {
    const key = canonicalize(screen.module);
    screensOfModule.set(key, [...(screensOfModule.get(key) ?? []), canonicalize(screen.name)]);
  }

  const missing = product.modules.filter((mod) => {
    const canonical = canonicalize(mod.name);
    if (built.has(canonical)) return false;
    return !(screensOfModule.get(canonical) ?? []).some((screen) => built.has(screen));
  });

  return missing.map((mod) => ({
    severity: 'HIGH' as const,
    category: 'NAVIGATION' as const,
    target: mod.name,
    file: null,
    issue: `The product spec defines "${mod.name}" but no screen reaches it.`,
    recommendation: `Add a route and screen for ${mod.name}, or drop it from the product spec if it is not in scope.`,
    observed: true,
  }));
}

/* ── Entry point ───────────────────────────────────────────────────────── */

export function runUxChecks(
  files: readonly ReviewFile[],
  product: ProductSpec | undefined,
): UxFinding[] {
  return [
    ...mutationErrorHandling(files),
    ...asyncStates(files),
    ...formQuality(files),
    ...accessibility(files),
    ...responsiveness(files),
    ...hierarchy(files),
    ...consistency(files),
    ...navigation(files, product),
  ];
}

/** Categories that were checked and produced nothing. */
export function passedCategories(findings: readonly UxFinding[]): UxCategory[] {
  const failed = new Set(findings.map((finding) => finding.category));
  return CHECKED_CATEGORIES.filter((category) => !failed.has(category));
}

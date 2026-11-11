/**
 * What this product actually needs, decided before anything is planned.
 *
 * The decision reads the user's own words. The analyzer's output cannot be
 * the evidence: its prompt asks for five to twelve entities on every request
 * and `normalizeSpec` adds `Users` and an auth method regardless, so a cafe
 * brochure "requires" a database by construction.
 *
 * A capability is dropped only when the request gives a positive reason to
 * drop it. Anything ambiguous keeps today's full build and says it assumed so,
 * because an unneeded table costs less than an app that cannot save anything.
 * Words that also fill ordinary brochure copy ("customers", "reviews", "contact
 * form") are weak: they never outweigh a stated website, and when one decides
 * the outcome the reason says it was an assumption.
 */
import { withoutAuthentication } from '../../architecture/lib/public-mvp.js';
import type { ArchitecturePlan } from '../../../shared/types/architecture.js';
import type { RequirementSpec } from '../../../shared/types/requirement.js';

export interface CapabilityDecision {
  needed: boolean;
  reason: string;
  /** The words in the request that decided it. Empty when nothing did. */
  signals: string[];
}

export interface ProductDecision {
  database: CapabilityDecision;
  authentication: CapabilityDecision;
  payments: CapabilityDecision;
  externalApis: CapabilityDecision;
  /** False when only a public website was asked for: no API and no tables. */
  backend: boolean;
  /** Things the decision could not carry out on this deployment. */
  limitations: string[];
}

const AUTH =
  /\b(log[- ]?ins?|sign[- ]?(in|up)s?|user accounts?|accounts?|passwords?|authenticat\w+|members?[- ]only|role[- ]based|permissions?|admin (panel|dashboard|area)|my profile)\b/gi;
const PAYMENTS =
  /\b(payments?|pay online|checkout|stripe|paypal|razorpay|billing|invoic\w+|subscriptions?|credit cards?)\b/gi;
const EXTERNAL_APIS =
  /\b(third[- ]party|external api|integrat\w+ with|webhooks?|google maps|twilio|sendgrid|mailchimp|slack|zapier|salesforce|hubspot|openai|whatsapp)\b/gi;
/** Words that sit before "API" without naming anyone else's service. */
const NOT_A_SERVICE = new Set(
  'a an the and or rest restful graphql grpc http https json web public private internal external own our your my their this that any new simple backend server application app'.split(
    ' ',
  ),
);
/** "the Open-Meteo API", "Twilio SDK", "Foo webhooks". */
const SERVICE_BEFORE_API =
  /\b([A-Za-z][\w.-]*(?:\s+[A-Z][\w.-]*){0,2})\s+(?:API|APIs|SDK|SDKs|[Ww]ebhooks?)\b/g;
/** "integrate with Foo", "connect to Foo", "powered by Foo", "data from Foo". */
const SERVICE_AFTER_VERB =
  /\b(?:integrat\w+\s+with|connect\w*\s+to|sync\w*\s+with|powered\s+by|data\s+from)\s+(?:the\s+)?([A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,2})/g;
/** An API host named outright. A reference site's URL is not an integration. */
const API_HOST =
  /\b((?:[a-z0-9-]+\.)*(?:api[a-z0-9-]*\.[a-z0-9-]+|[a-z0-9-]*api\.[a-z]{2,})(?:\.[a-z]{2,})?)\b/gi;

const LEAD_CAPTURE = /\b(early[- ]access|wait[- ]?list|newsletter|mailing list|notify me)\b/i;

const STORED_DATA =
  /\b(manag\w+|track\w*|dashboard|admin|crud|records?|database|inventory|orders?|ordering|cart|bookings?|appointments?|reservations?|submissions?|students?|patients?|employees?|saved?|stored?|portal|crm|erp|lms|marketplace|e-?commerce|tickets?|tasks?|attendance|payroll|web app)\b/gi;
const WEAK_STORED_DATA =
  /\b(forms?|users?|customers?|history|reports?|analytics|saas|comments?|reviews?|platform|system|application|tool)\b/gi;
const INFORMATIONAL =
  /\b(web ?sites?|landing pages?|home ?pages?|portfolios?|brochures?|marketing (site|page)s?|static (site|page)s?|one[- ]page|microsites?|sites?(?=\s+(?:for|about|that|to|showing|with)\b|[.,!?]|\s*$))\b/gi;

function signalsIn(text: string, pattern: RegExp): string[] {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[0].toLowerCase()))].slice(
    0,
    6,
  );
}

function listed(signals: readonly string[]): string {
  return signals.map((signal) => `"${signal}"`).join(', ');
}

/**
 * Outside services the request names, in the user's own words.
 *
 * Reads the request, and the analyzer's integrations only where the request
 * itself names them: the analyzer lists integrations a domain usually has, and
 * those are not asked-for services.
 */
export function namedServices(prompt: string, integrations: readonly string[] = []): string[] {
  const found = new Map<string, string>();
  const add = (name: string): void => {
    const words = name.trim().replace(/\.$/, '').split(/\s+/);
    // "the Open-Meteo" is the regex reaching back a word too far.
    while (words[0] !== undefined && NOT_A_SERVICE.has(words[0].toLowerCase())) words.shift();
    const trimmed = words.join(' ');
    if (trimmed.length < 3) return;
    const key = trimmed.toLowerCase();
    if (!found.has(key)) found.set(key, trimmed);
  };
  for (const match of prompt.matchAll(SERVICE_BEFORE_API)) add(match[1] ?? '');
  for (const match of prompt.matchAll(SERVICE_AFTER_VERB)) add(match[1] ?? '');
  for (const match of prompt.matchAll(API_HOST)) add(match[1] ?? '');
  for (const integration of integrations) {
    if (!PAYMENT_NAME.test(integration) && requestNames(prompt, integration)) add(integration);
  }
  return [...found.values()].slice(0, 6);
}

export function decideProduct(
  prompt: string,
  options: { appAuthEnabled: boolean; integrations?: readonly string[] },
): ProductDecision {
  // "An early access sign-up form" collects an email; it does not mean accounts.
  const auth = signalsIn(prompt, AUTH).filter(
    (signal) => !(LEAD_CAPTURE.test(prompt) && /^sign[- ]?ups?$/.test(signal)),
  );
  const payment = signalsIn(prompt, PAYMENTS);
  const external = [
    ...new Set([
      ...signalsIn(prompt, EXTERNAL_APIS),
      ...namedServices(prompt, options.integrations ?? []).map((name) => name.toLowerCase()),
    ]),
  ].slice(0, 6);
  const stored = signalsIn(prompt, STORED_DATA);
  const weaklyStored = signalsIn(prompt, WEAK_STORED_DATA);
  const informational = signalsIn(prompt, INFORMATIONAL);

  const authentication: CapabilityDecision =
    auth.length > 0
      ? { needed: true, reason: `The request mentions ${listed(auth)}.`, signals: auth }
      : {
          needed: false,
          reason: 'The request never mentions accounts or signing in.',
          signals: [],
        };
  const payments: CapabilityDecision =
    payment.length > 0
      ? { needed: true, reason: `The request mentions ${listed(payment)}.`, signals: payment }
      : { needed: false, reason: 'The request never mentions taking payment.', signals: [] };
  const externalApis: CapabilityDecision =
    external.length > 0
      ? { needed: true, reason: `The request mentions ${listed(external)}.`, signals: external }
      : { needed: false, reason: 'The request names no outside service.', signals: [] };

  const required = [authentication, payments, externalApis].filter((entry) => entry.needed);
  const websiteOnly = informational.length > 0 && stored.length === 0 && required.length === 0;

  let database: CapabilityDecision;
  if (websiteOnly) {
    database = {
      needed: false,
      reason: `The request is for ${listed(informational)} and describes nothing to store.`,
      signals: informational,
    };
  } else if (stored.length > 0) {
    database = {
      needed: true,
      reason: `The request implies stored records: ${listed(stored)}.`,
      signals: stored,
    };
  } else if (required.length > 0) {
    database = {
      needed: true,
      reason: 'Accounts, payments and integrations run on the generated backend, which uses it.',
      signals: [],
    };
  } else if (weaklyStored.length > 0) {
    database = {
      needed: true,
      reason: `Assumed: ${listed(weaklyStored)} usually means saved records, but the request does not say so.`,
      signals: weaklyStored,
    };
  } else {
    database = {
      needed: true,
      reason: 'Assumed: the request does not read as a purely informational website.',
      signals: [],
    };
  }

  const limitations: string[] = [];
  if (authentication.needed && !options.appAuthEnabled) {
    limitations.push(
      'The request asks for sign-in, but this deployment generates public apps (app authentication is off), so none was built.',
    );
  }
  if (payments.needed) {
    limitations.push(
      `The request mentions ${listed(payment)}, but the generators connect no payment provider. Any payment screen or table is a placeholder that takes no money.`,
    );
  }
  if (externalApis.needed) {
    limitations.push(
      `The request names ${listed(external)}, but the generators connect no outside service, so these are not built unless Feature Implementation builds them; its capability coverage records whether it did.`,
    );
  }

  return {
    database,
    authentication,
    payments,
    externalApis,
    backend: database.needed,
    limitations,
  };
}

const PAYMENT_NAME = /payment|billing|invoice|checkout|stripe|paypal|subscription/i;

/** Whether the request itself names this integration, by its first word. */
function requestNames(prompt: string, integration: string): boolean {
  const first = integration.trim().split(/\s+/)[0]?.toLowerCase();
  return first !== undefined && first !== '' && prompt.toLowerCase().includes(first);
}

/**
 * The spec with everything the decision ruled out removed, so the planners
 * never see it. Payment entities are matched by name because the analyzer adds
 * them to shop-shaped requests that never asked to take money.
 */
export function scopeRequirements(
  spec: RequirementSpec,
  decision: ProductDecision,
  prompt: string,
): RequirementSpec {
  const integrations = spec.integrations.filter((integration) =>
    PAYMENT_NAME.test(integration)
      ? decision.payments.needed
      : decision.externalApis.needed || requestNames(prompt, integration),
  );
  if (!decision.backend) {
    return { ...spec, modules: [], database: [], authentication: [], integrations: [] };
  }
  const allowed = (name: string): boolean => decision.payments.needed || !PAYMENT_NAME.test(name);
  return {
    ...spec,
    modules: spec.modules.filter(allowed),
    database: spec.database.filter(allowed),
    integrations,
    authentication: decision.authentication.needed ? spec.authentication : [],
  };
}

/** The plan with sign-in and, for a website, the API and tables taken out. */
export function scopePlan(plan: ArchitecturePlan, decision: ProductDecision): ArchitecturePlan {
  const scoped = decision.authentication.needed ? plan : withoutAuthentication(plan);
  if (decision.backend) return scoped;
  return {
    ...scoped,
    apiModules: [],
    services: [],
    database: { ...scoped.database, entities: [] },
  };
}

export function summarizeDecision(decision: ProductDecision): string {
  const yesNo = (entry: CapabilityDecision): string => (entry.needed ? 'yes' : 'no');
  // "Yes" would read as built. At this point nothing has been; an integration
  // that Feature Implementation builds is reported by its capability coverage.
  const asked = (entry: CapabilityDecision): string =>
    entry.needed ? 'requested, not built' : 'no';
  return `database ${yesNo(decision.database)} · sign-in ${yesNo(decision.authentication)} · payments ${asked(decision.payments)} · external APIs ${asked(decision.externalApis)}`;
}

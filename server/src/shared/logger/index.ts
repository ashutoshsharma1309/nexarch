/**
 * Application logger.
 *
 * Human-readable single-line output in development; structured JSON in
 * production so log aggregators (Datadog, Loki, CloudWatch) can index fields
 * without regex heroics. Morgan pipes HTTP access logs through the same
 * transport via `httpLogStream`, so there is exactly one logging pathway.
 *
 * Two policies are enforced on the way out, for every caller, rather than
 * asked of each one: the ambient correlation ids are attached (see
 * `context.ts`) and secret-shaped values are redacted. Typed operational
 * events live in `events.ts`.
 */
import winston from 'winston';

import { currentLogContext } from './context.js';
import { config } from '../config/index.js';
import { redactString, redactValue } from '../security/redact.js';

/**
 * Attaches the ambient request/run ids to every record.
 *
 * Without this, a line emitted deep in a pipeline stage — minutes after the
 * response went out — has nothing joining it to the request that started
 * the work. A field the caller passed explicitly always wins: this fills
 * gaps, it never rewrites what a call site asserted.
 *
 * An explicit `null` counts as a gap, not an assertion. `audit()` writes
 * `requestId: context.requestId ?? null` for every event, so treating null
 * as taken would leave exactly the lines an operator reaches for first —
 * the unauthorized-access attempts — permanently uncorrelated.
 */
const withAmbientContext = winston.format((info) => {
  const context = currentLogContext();
  if (context === undefined) return info;
  const record = info as Record<string, unknown>;
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    if (!(key in record) || record[key] === null) record[key] = value;
  }
  return info;
});

/**
 * The ceiling on any one string a caller hands the logger.
 *
 * A prompt, a model response and a generated file are all strings a call
 * site can reach, and the failure this prevents is the ordinary one: an
 * `error` field or a debug line that drags a 200 KB generated component
 * into the log, where it is both useless and a copy of the user's data
 * sitting in a place with a different retention policy. 1 KB is more than
 * any message, id or reason needs.
 */
const MAX_LOG_STRING = 1024;

function capStrings(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === 'string') {
    return value.length > MAX_LOG_STRING
      ? `${value.slice(0, MAX_LOG_STRING)}…[+${value.length - MAX_LOG_STRING} chars]`
      : value;
  }
  if (Array.isArray(value)) return value.map((entry) => capStrings(entry, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = capStrings(entry, depth + 1);
    return out;
  }
  return value;
}

/**
 * Redacts secret-shaped values out of every log record before any transport
 * sees it. This is the backstop for Step 24: even a caller that forgets to
 * scrub — logging a whole request body, say — cannot leak a credential,
 * because the transform runs on the way out regardless.
 *
 * `message` and `stack` are Winston's own, so they are handled by name
 * rather than walked. They are not exempt: a provider error message is one
 * of the likeliest places an API key appears, and `logger.error(err)` puts
 * that message in both. The stack is redacted but not capped — truncating
 * it would throw away the frames that make it worth logging.
 *
 * Redaction runs before capping: capping first could cut a credential URL
 * in half and leave the head of the password behind, which the redactor
 * would then no longer recognise.
 */
const redactMeta = winston.format((info) => {
  const reserved = new Set(['level', 'message', 'timestamp', 'stack', 'label', 'ms']);
  for (const key of Object.keys(info)) {
    if (reserved.has(key)) continue;
    (info as Record<string, unknown>)[key] = capStrings(
      redactValue((info as Record<string, unknown>)[key]),
    );
  }
  if (typeof info.message === 'string') {
    info.message = capStrings(redactString(info.message));
  }
  if (typeof info.stack === 'string') {
    info.stack = redactString(info.stack);
  }
  return info;
});

/*
 * `errors()` runs before `redactMeta()` so that the message and stack it
 * lifts off a thrown Error are redacted too — a format that ran after the
 * redactor would reintroduce the raw text it had just cleaned.
 */
const developmentFormat = winston.format.combine(
  withAmbientContext(),
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  redactMeta(),
  winston.format.colorize({ level: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack, ...meta } = info;
    const base = `${String(timestamp)} ${level} ${String(message)}`;
    const metaKeys = Object.keys(meta);
    const metaSuffix = metaKeys.length > 0 ? ` ${JSON.stringify(meta)}` : '';
    const stackSuffix = typeof stack === 'string' ? `\n${stack}` : '';
    return `${base}${metaSuffix}${stackSuffix}`;
  }),
);

const productionFormat = winston.format.combine(
  withAmbientContext(),
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  redactMeta(),
  winston.format.json(),
);

export const logger: winston.Logger = winston.createLogger({
  level: config.logging.level,
  levels: winston.config.npm.levels,
  format: config.isProduction ? productionFormat : developmentFormat,
  transports: [new winston.transports.Console()],
  silent: config.isTest,
});

/** Adapter so Morgan writes through Winston instead of stdout directly. */
export const httpLogStream = {
  write(message: string): void {
    logger.http(message.trim());
  },
};

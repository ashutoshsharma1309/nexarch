/**
 * Application logger.
 *
 * Human-readable single-line output in development; structured JSON in
 * production so log aggregators (Datadog, Loki, CloudWatch) can index fields
 * without regex heroics. Morgan pipes HTTP access logs through the same
 * transport via `httpLogStream`, so there is exactly one logging pathway.
 */
import winston from 'winston';

import { config } from '../config/index.js';
import { redactValue } from '../security/redact.js';

/**
 * Redacts secret-shaped values out of every log record's metadata before
 * any transport sees it. This is the backstop for Step 24: even a caller
 * that forgets to scrub — logging a whole request body, say — cannot leak
 * a credential, because the transform runs on the way out regardless.
 * `message`, `level` and `timestamp` are Winston's own and left intact;
 * everything else is caller-supplied and gets walked.
 */
const redactMeta = winston.format((info) => {
  const reserved = new Set(['level', 'message', 'timestamp', 'stack', 'label', 'ms']);
  for (const key of Object.keys(info)) {
    if (reserved.has(key)) continue;
    (info as Record<string, unknown>)[key] = redactValue((info as Record<string, unknown>)[key]);
  }
  return info;
});

const developmentFormat = winston.format.combine(
  redactMeta(),
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
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
  redactMeta(),
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
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

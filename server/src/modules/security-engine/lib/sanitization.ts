/**
 * Input sanitization: neutralizes the classic request-body XSS vectors
 * (script/iframe injection, inline event handlers, `javascript:` URIs)
 * without rewriting ordinary punctuation — full output encoding still
 * belongs to the renderer (React already escapes by default), this is
 * defense-in-depth at the boundary before anything reaches a service.
 */
import type { GeneratedFile } from '../security-engine.types.js';
import { file } from './file-tree.js';

const sanitizeMiddleware = `import type { NextFunction, Request, RequestHandler, Response } from 'express';

const DANGEROUS_PATTERNS: RegExp[] = [
  /<script[\\s\\S]*?>[\\s\\S]*?<\\/script>/gi,
  /<iframe[\\s\\S]*?>[\\s\\S]*?<\\/iframe>/gi,
  /\\son\\w+\\s*=\\s*"[^"]*"/gi,
  /\\son\\w+\\s*=\\s*'[^']*'/gi,
  /javascript:/gi,
];

function sanitizeString(input: string): string {
  return DANGEROUS_PATTERNS.reduce((value, pattern) => value.replace(pattern, ''), input);
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeValue(entry);
    }
    return result;
  }
  return value;
}

/** Recursively strips dangerous markup from \`body\`, \`query\`, and \`params\` before any handler sees it. */
export const sanitizeInput: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  for (const key of ['query', 'params'] as const) {
    const source = req[key];
    if (source && typeof source === 'object') {
      Object.assign(source as Record<string, unknown>, sanitizeValue(source) as Record<string, unknown>);
    }
  }
  next();
};
`;

export function emitSanitization(): GeneratedFile[] {
  return [file('src/shared/middleware/sanitize.ts', 'typescript', sanitizeMiddleware)];
}

/**
 * Security-sensitive events, recorded as structured log lines.
 *
 * These are the events an operator needs to see when something is wrong:
 * who signed in, whose project was touched, when an agent run or repair
 * started, and — the one that matters most — every time a request reached
 * for a resource it did not own. They ride the existing Winston logger at
 * a dedicated `audit` marker rather than a second sink, so redaction and
 * transport are already handled.
 *
 * The detail payload is redacted before it is written. An audit event
 * about a failed login must never be the thing that logs the password
 * that failed.
 */
import { logger } from '../logger/index.js';
import { redactValue } from './redact.js';

export type AuditEvent =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'SIGNUP'
  | 'LOGOUT'
  | 'PROJECT_CREATED'
  | 'PROJECT_DELETED'
  | 'AGENT_RUN_STARTED'
  | 'AGENT_RUN_FAILED'
  | 'REPAIR_STARTED'
  | 'REPAIR_ACCEPTED'
  | 'REPAIR_ROLLED_BACK'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED_ACCESS_ATTEMPT'
  | 'VALIDATION_FAILED';

export interface AuditContext {
  /** The acting user, when known. Never their email or any PII beyond the id. */
  userId?: string | null;
  projectId?: string | null;
  runId?: string | null;
  requestId?: string | null;
  /** Anything else worth recording — redacted before it is written. */
  detail?: Record<string, unknown>;
}

export function audit(event: AuditEvent, context: AuditContext = {}): void {
  logger.info(`audit ${event}`, {
    audit: true,
    event,
    userId: context.userId ?? null,
    projectId: context.projectId ?? null,
    runId: context.runId ?? null,
    requestId: context.requestId ?? null,
    ...(context.detail ? { detail: redactValue(context.detail) } : {}),
  });
}

/**
 * Output leaving verification: real, but safe to store and show.
 *
 * Build logs are where secrets go to be accidentally published, and the
 * absolute workspace path says nothing useful about the project while saying
 * something about the machine.
 */
import { redactString } from '../../../shared/security/redact.js';

const OUTPUT_CAP = 8_000;

/** Tail-capped: the end of a build log is where its error is. */
export function cleanOutput(text: string, workspaceDir: string | null): string {
  const relative = workspaceDir ? text.split(`${workspaceDir}/`).join('') : text;
  const scrubbed = redactString(relative)
    .replace(/\b(?:gsk|sk|pk|rk)[_-][A-Za-z0-9_-]{8,}\b/g, '***')
    .trim();
  return scrubbed.length > OUTPUT_CAP ? `…${scrubbed.slice(-OUTPUT_CAP)}` : scrubbed;
}

/** The first line of a failure that looks like it names the cause. */
export function firstErrorLine(output: string): string | null {
  const line = output
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => /\berror\b|Cannot find|not found|failed/i.test(entry));
  return line ? line.slice(0, 240) : null;
}

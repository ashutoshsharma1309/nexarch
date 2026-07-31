/**
 * Failure translation: turn what a dying child process left behind into a
 * diagnosis a user can act on. Pattern-matched on the collected log tail
 * — the goal is "your MySQL isn't running", never "exit code 1".
 */

interface DiagnosticRule {
  pattern: RegExp;
  explain: string;
}

const RULES: DiagnosticRule[] = [
  {
    pattern: /EADDRINUSE/,
    explain:
      'A port the project needed was taken between detection and start — restart the session.',
  },
  {
    pattern: /ECONNREFUSED.*3306|Can't connect to.*MySQL|P1001/i,
    explain:
      'The backend could not reach MySQL — start a database (e.g. docker compose up mysql) or point DATABASE_URL at one.',
  },
  {
    pattern: /Missing script/i,
    explain:
      'The package.json does not define the expected npm script — regenerate the project or check its scripts.',
  },
  {
    pattern: /npm ERR!.*E404|404 Not Found.*registry/i,
    explain:
      'npm could not resolve a dependency — a package name or version in package.json does not exist.',
  },
  {
    pattern: /ENOTFOUND|ETIMEDOUT.*registry|network/i,
    explain: 'npm install hit a network problem — check connectivity and retry.',
  },
  {
    pattern: /Unsupported engine|EBADENGINE/i,
    explain: "The local Node version does not satisfy the project's engines requirement.",
  },
  {
    pattern: /error TS\d+/,
    explain:
      'TypeScript compilation failed in the generated project — see the log lines above for the exact file.',
  },
  {
    pattern: /Fatal: invalid environment configuration/,
    explain:
      "The project's env validation rejected its .env — open the workspace .env and fill the flagged values.",
  },
];

export function diagnose(exitCode: number | null, logTail: readonly string[]): string[] {
  const joined = logTail.join('\n');
  const findings = RULES.filter((rule) => rule.pattern.test(joined)).map((rule) => rule.explain);

  if (findings.length === 0) {
    findings.push(
      exitCode === null
        ? 'The process was terminated before finishing startup.'
        : `The process exited with code ${String(exitCode)} before becoming ready — the last log lines usually name the cause.`,
    );
  }
  return findings;
}

/**
 * The generated backend already ships structured (Winston) logging,
 * request logging (Morgan → Winston), error logging, and startup logs
 * (`backend-generator/lib/emit-shared.ts`) — this module doesn't recreate
 * any of that. The one real gap is log rotation (the existing transport is
 * Console-only), so this emits an opt-in rotating file transport plus a
 * doc explaining how the pieces fit together for deployment.
 */
import type { LoggingBundle } from '../deployment.types.js';

function rotationTransport(): string {
  return `/**
 * Optional file transport with size-based rotation, for deployments that
 * read logs from disk instead of stdout (most container platforms should
 * prefer stdout + the platform's own log aggregation — see LOGGING.md).
 * Wire it in by adding \`new transports.DailyRotateFile(rotatingFileTransport)\`
 * to the base logger's transports array; requires \`winston-daily-rotate-file\`.
 */
import { transports } from 'winston';

export const rotatingFileTransport = new transports.File({
  filename: 'logs/app.log',
  maxsize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
  tailable: true,
});
`;
}

function loggingDocs(): string {
  return `# Logging

The generated backend already ships everything most deployments need:

- **Structured logging** — Winston, JSON in production, colorized single-line in development (\`backend/src/shared/logger/index.ts\`).
- **Request logging** — Morgan piped into Winston at the \`http\` level, one line per request.
- **Error logging** — the central error handler logs operational errors as \`warn\` and unexpected errors as \`error\`, with full context.
- **Startup logs** — the server logs its listening port and environment on boot, and the shutdown signal it received on exit.

## Log rotation

Containers should log to stdout/stderr and let the platform handle
rotation and retention — this is why \`docker-compose.prod.yml\` sets the
\`json-file\` driver's \`max-size\`/\`max-file\` options rather than rotating
inside the app. For deployments that read log files directly (bare VMs,
some PaaS targets), an optional size-based file transport is provided at
\`backend/src/shared/logger/rotation.ts\` — wire it into the transports
array only if you're not already relying on the platform's log driver.

## Where logs go per target

| Target | Log destination |
| --- | --- |
| Docker / Docker Compose | \`docker compose logs\`, rotated by the \`json-file\` driver |
| AWS ECS | CloudWatch Logs (via the \`awslogs\` driver) |
| Google Cloud Run | Cloud Logging (automatic, stdout/stderr) |
| Azure App Service | Log stream / Application Insights |
| Vercel / Netlify / Render / Railway | Platform's built-in log viewer |
| AWS EC2 / DigitalOcean / local | stdout, or the rotation transport above |
`;
}

export function generateLoggingBundle(): LoggingBundle {
  return {
    files: [
      {
        path: 'backend/src/shared/logger/rotation.ts',
        language: 'typescript',
        content: rotationTransport(),
      },
      { path: 'LOGGING.md', language: 'markdown', content: loggingDocs() },
    ],
  };
}

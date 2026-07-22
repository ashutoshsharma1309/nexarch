/**
 * A `/metrics` endpoint in Prometheus text exposition format — hand-rolled
 * counters/gauges, no `prom-client` dependency, consistent with the
 * platform's own "no dependency the codebase doesn't already need"
 * philosophy (Phase 5's ZIP writer, Phase 8's SVG graph). Covers the
 * spec's four categories: application (requests), performance (latency),
 * error (error rate), and system (process) metrics.
 */
import type { MonitoringBundle } from '../deployment.types.js';

function metricsModule(): string {
  return `/**
 * Minimal Prometheus-format metrics — request counts, latency histogram
 * buckets, error counts, and process/system gauges. No external
 * dependency: the exposition format is plain text, not worth a library.
 */
type Labels = Record<string, string>;

function labelString(labels: Labels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return \`{\${entries.map(([key, value]) => \`\${key}="\${value}"\`).join(',')}}\`;
}

class Counter {
  private readonly values = new Map<string, number>();
  constructor(
    private readonly name: string,
    private readonly help: string,
  ) {}

  inc(labels: Labels = {}, amount = 1): void {
    const key = labelString(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + amount);
  }

  render(): string {
    const lines = [\`# HELP \${this.name} \${this.help}\`, \`# TYPE \${this.name} counter\`];
    for (const [key, value] of this.values) lines.push(\`\${this.name}\${key} \${value}\`);
    return lines.join('\\n');
  }
}

const LATENCY_BUCKETS_MS = [10, 50, 100, 250, 500, 1000, 2500, 5000];

class Histogram {
  private readonly buckets = new Map<string, number[]>();
  constructor(
    private readonly name: string,
    private readonly help: string,
  ) {}

  observe(valueMs: number, labels: Labels = {}): void {
    const key = labelString(labels);
    const counts = this.buckets.get(key) ?? new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0);
    const bucketIndex = LATENCY_BUCKETS_MS.findIndex((bound) => valueMs <= bound);
    counts[bucketIndex === -1 ? LATENCY_BUCKETS_MS.length : bucketIndex] += 1;
    this.buckets.set(key, counts);
  }

  render(): string {
    const lines = [\`# HELP \${this.name} \${this.help}\`, \`# TYPE \${this.name} histogram\`];
    for (const [key, counts] of this.buckets) {
      let cumulative = 0;
      LATENCY_BUCKETS_MS.forEach((bound, index) => {
        cumulative += counts[index] ?? 0;
        lines.push(\`\${this.name}_bucket\${labelString({ le: String(bound) })} \${cumulative}\`);
      });
      cumulative += counts[LATENCY_BUCKETS_MS.length] ?? 0;
      lines.push(\`\${this.name}_bucket\${labelString({ le: '+Inf' })} \${cumulative}\`);
      lines.push(\`\${this.name}_count\${key} \${cumulative}\`);
    }
    return lines.join('\\n');
  }
}

export const httpRequestsTotal = new Counter('http_requests_total', 'Total HTTP requests handled');
export const httpErrorsTotal = new Counter('http_errors_total', 'Total HTTP responses with status >= 500');
export const httpRequestDurationMs = new Histogram('http_request_duration_ms', 'HTTP request duration in milliseconds');

/** Express middleware — records one observation per response. */
export function metricsMiddleware(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const labels = { method: req.method, route: req.route?.path ?? req.path, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    httpRequestDurationMs.observe(Date.now() - start, labels);
    if (res.statusCode >= 500) httpErrorsTotal.inc(labels);
  });
  next();
}

function systemMetrics(): string {
  const mem = process.memoryUsage();
  const lines = [
    '# HELP process_uptime_seconds Process uptime in seconds',
    '# TYPE process_uptime_seconds gauge',
    \`process_uptime_seconds \${process.uptime().toFixed(0)}\`,
    '# HELP process_memory_rss_bytes Resident set size in bytes',
    '# TYPE process_memory_rss_bytes gauge',
    \`process_memory_rss_bytes \${mem.rss}\`,
    '# HELP process_memory_heap_used_bytes Heap used in bytes',
    '# TYPE process_memory_heap_used_bytes gauge',
    \`process_memory_heap_used_bytes \${mem.heapUsed}\`,
  ];
  return lines.join('\\n');
}

/** GET /metrics handler — Prometheus text exposition format. */
export function metricsHandler(_req: import('express').Request, res: import('express').Response): void {
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(
    [
      httpRequestsTotal.render(),
      httpErrorsTotal.render(),
      httpRequestDurationMs.render(),
      systemMetrics(),
    ].join('\\n\\n') + '\\n',
  );
}
`;
}

export function generateMonitoringBundle(): MonitoringBundle {
  return {
    files: [
      {
        path: 'backend/src/shared/monitoring/metrics.ts',
        language: 'typescript',
        content: metricsModule(),
      },
    ],
  };
}
